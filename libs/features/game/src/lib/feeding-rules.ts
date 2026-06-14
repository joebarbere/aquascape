// Feeding game-mode rules (Stage 16 F16.3) — PURE + framework-free.
//
// The player swims the tank and EATS falling food (Stage 14 typed food sprites)
// by proximity. Eating fills a FOOD METER; the goal is to fill it to a target
// fraction without OVEReating (gorging past full caps the meter + penalises the
// score). Under-eating (the meter draining while you starve) drains health and
// eventually loses. This module owns the PURE rule logic:
//
//   - eat detection (which food sprites are within the eat radius of the
//     player — they get consumed),
//   - the food-meter model (fills per bite, drains over time as hunger; eating
//     while already full wastes the bite + costs score), and
//   - the win/lose evaluation (fill the meter to win; starve to health-zero to
//     lose, or run out the clock below target).
//
// The WORLD MUTATION (despawning an eaten sprite, dropping new food) + the rAF
// wiring live in the app layer (`apps/web/src/app/game/feeding-game.service.ts`),
// NOT here — this stays a domain-shaped, DOM-free, deterministic-given-its-
// inputs pure module so the eat/score/win-lose rules are exhaustively
// unit-testable.
//
// DETERMINISM BOUNDARY (load-bearing). Eat detection is driven by the LIVE
// player position, which is the one non-deterministic signal in a game run. So
// an eat is a NON-deterministic GAME EVENT — the despawn it triggers must stay
// OUT of the replay-critical deterministic sim core. It runs in the app loop
// only while an active game has a live player marked; a non-game world (no
// player) never runs it and replays byte-identically. See
// `docs/caveats/game-modes.md`.

import type { CatchPoint } from './predator-rules';

/** A food candidate: a stable id (the world eid) + its current position. */
export interface FoodCandidate extends CatchPoint {
  /** The world entity id — returned in the eat result so the caller can despawn it. */
  readonly id: number;
}

/** Tuning for a feeding run. Kept here so the rules + tests share one source. */
export interface FeedingRuleParams {
  /** A food sprite within this distance (mm) of the player's mouth is eaten. */
  readonly eatRadiusMm: number;
  /** Food-meter fraction `[0,1]` added per bite (when not already full). */
  readonly fillPerBite: number;
  /** Food-meter fraction `[0,1]` drained per second (hunger creeps back). */
  readonly drainPerSec: number;
  /** Meter fraction at/above which the run is WON. */
  readonly targetFill: number;
  /** Run length in seconds. On expiry the run is decided by the meter level. */
  readonly timeLimitSec: number;
  /** Points awarded per well-timed bite (meter below full). */
  readonly scorePerBite: number;
  /** Points DEDUCTED per gorged bite (eating while the meter is already full). */
  readonly overeatPenalty: number;
}

/**
 * Default feeding tuning. The eat radius is a touch tighter than the predator
 * catch radius (food sprites are small; 70 mm rewards aim without demanding
 * pixel-perfection under the fish-eye camera). 12 % per bite means ~8 well-
 * placed bites fill the meter; a slow 4 %/s drain keeps a little pressure on so
 * you can't fill it once and idle. Reaching 90 % wins; gorging past full costs
 * a point so over-feeding is a real mistake (and mirrors the over-feeding-fouls-
 * the-tank theme — see the live chemistry tick the host runs in game mode).
 */
export const DEFAULT_FEEDING_PARAMS: FeedingRuleParams = {
  eatRadiusMm: 70,
  fillPerBite: 0.12,
  drainPerSec: 0.04,
  targetFill: 0.9,
  timeLimitSec: 60,
  scorePerBite: 1,
  overeatPenalty: 1,
};

/** Empty meter at the start of a run. */
export const FEEDING_MAX_FILL = 1;

/** Squared distance between two points (avoids a sqrt in the hot eat scan). */
function distSq(a: CatchPoint, b: CatchPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Find every food sprite within `eatRadiusMm` of the player. Returns the
 * matching ids in input order (deterministic given the inputs) — the caller
 * despawns each + folds them into the meter/score via `applyBites`.
 *
 * Pure: no world reads, no mutation. The app builds `food` from the current
 * world snapshot's food-sprite slab and feeds it in.
 */
export function detectEaten(
  player: CatchPoint,
  food: readonly FoodCandidate[],
  eatRadiusMm: number,
): number[] {
  const r2 = eatRadiusMm * eatRadiusMm;
  const eaten: number[] = [];
  for (const f of food) {
    if (distSq(player, f) <= r2) eaten.push(f.id);
  }
  return eaten;
}

/** The result of folding a batch of bites into the meter + score this frame. */
export interface BiteResult {
  /** The new food-meter fraction `[0, 1]`. */
  readonly fill: number;
  /**
   * Net score delta for the batch — `+scorePerBite` per bite while the meter
   * had headroom, `-overeatPenalty` per bite taken while already full.
   */
  readonly scoreDelta: number;
}

/**
 * Fold `biteCount` eaten sprites into the meter + score. Each bite either fills
 * the meter (and scores) or — if the meter is already full — wastes the bite
 * and PENALISES the score (gorging). Bites are applied one at a time so a batch
 * that crosses "full" is scored correctly (the headroom bites score, the
 * overflow bites penalise). Pure + total.
 */
export function applyBites(
  fill: number,
  biteCount: number,
  params: FeedingRuleParams,
): BiteResult {
  let f = fill;
  let scoreDelta = 0;
  for (let i = 0; i < biteCount; i++) {
    if (f >= FEEDING_MAX_FILL) {
      // Gorging — the meter's full, so this bite is wasted + costs a point.
      scoreDelta -= params.overeatPenalty;
    } else {
      f = Math.min(FEEDING_MAX_FILL, f + params.fillPerBite);
      scoreDelta += params.scorePerBite;
    }
  }
  return { fill: f, scoreDelta };
}

/**
 * Drain the meter for one frame (hunger creeping back). Clamped to `[0, 1]`.
 * Pure + total — the app threads the returned value back in each frame, BEFORE
 * folding in any bites, so a same-frame bite tops the meter back up.
 */
export function drainFill(fill: number, dtSec: number, params: FeedingRuleParams): number {
  const next = fill - params.drainPerSec * dtSec;
  return next < 0 ? 0 : next;
}

/** The decided outcome of a feeding run, or `null` while it's still ongoing. */
export type FeedingOutcome = 'won' | 'lost' | null;

/**
 * Decide a feeding run from the current meter, health, and elapsed time.
 *
 *   - Reaching `targetFill` WINS immediately (you've eaten your fill).
 *   - `health` at/below 0 LOSES (starved — the meter sat empty and Stage 14
 *     vitality drained out).
 *   - Otherwise, once `elapsedSec` reaches `timeLimitSec` the run is LOST (you
 *     didn't eat enough in time).
 *   - Before any condition, the run is ongoing → `null`.
 *
 * Pure + total. Win is checked before the clock so a fill-at-the-buzzer wins.
 */
export function evaluateFeedingOutcome(
  fill: number,
  health: number,
  elapsedSec: number,
  params: FeedingRuleParams,
): FeedingOutcome {
  if (fill >= params.targetFill) return 'won';
  if (health <= 0) return 'lost';
  if (elapsedSec >= params.timeLimitSec) return 'lost';
  return null;
}

/** Whole seconds left on the clock (never negative) — for the HUD countdown. */
export function feedingTimeRemainingSec(elapsedSec: number, params: FeedingRuleParams): number {
  const remaining = params.timeLimitSec - elapsedSec;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}
