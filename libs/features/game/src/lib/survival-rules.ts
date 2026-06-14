// Survival game-mode rules (Stage 16 F16.2) — PURE + framework-free.
//
// The player is a PREY fish: the existing `Predator`-tagged agents hunt them
// (via the existing `FearSystem` proximity path — no parallel hunt code), and
// the player flees with the keyboard, using hardscape as cover. This module
// owns the PURE rule logic:
//
//   - "caught" detection (is any predator within the catch radius of the
//     player — the lose trigger),
//   - a STAMINA model (a game-local resource that drains while a predator is
//     near + recovers when safe — kept out of the deterministic ECS core),
//   - the win/lose evaluation (survive `timeLimitSec`, or lose on caught /
//     health-zero / stamina-zero-while-threatened), and
//   - the per-mode tuning constants.
//
// The WORLD reads (predator + player positions) + the rAF wiring live in the
// app layer (`apps/web/src/app/game/survival-game.service.ts`), NOT here — this
// stays a domain-shaped, DOM-free, deterministic-given-its-inputs pure module
// so the catch/stamina/win-lose rules are exhaustively unit-testable.
//
// DETERMINISM BOUNDARY (load-bearing). "Caught" detection is driven by the LIVE
// player position, which is the one non-deterministic signal in a game run. So
// being-caught is a NON-deterministic GAME EVENT — it must stay OUT of the
// replay-critical deterministic sim core. It runs in the app loop only while an
// active game has a live player marked; a non-game world (no player) never runs
// it and replays byte-identically. See `docs/caveats/game-modes.md`.

import type { CatchPoint } from './predator-rules';

/** A predator candidate: a stable id (the world eid) + its current position. */
export interface PredatorCandidate extends CatchPoint {
  /** The world entity id — surfaced so the caller could highlight the threat. */
  readonly id: number;
}

/** Tuning for a survival run. Kept here so the rules + tests share one source. */
export interface SurvivalRuleParams {
  /** A predator within this distance (mm) of the player CATCHES them → lose. */
  readonly catchRadiusMm: number;
  /** A predator within this distance (mm) is a THREAT — stamina drains. */
  readonly threatRadiusMm: number;
  /** Stamina drained per second while at least one predator is within threat range. */
  readonly staminaDrainPerSec: number;
  /** Stamina recovered per second while no predator is within threat range. */
  readonly staminaRecoverPerSec: number;
  /** Run length in seconds. Surviving to here WINS. */
  readonly timeLimitSec: number;
}

/**
 * Default survival tuning. The catch radius matches the predator mode's "snap"
 * (a fish body is ~30 mm; 90 mm is a fair lethal range under the fish-eye
 * camera). The threat radius is wider (a predator looming nearby should bite
 * into stamina before it actually catches you). Surviving 90 s in the showcase
 * tank (one predator roaming ~108 fish) is brisk-but-achievable. Stamina drains
 * over ~5 s of sustained threat and recovers over ~3 s of safety.
 */
export const DEFAULT_SURVIVAL_PARAMS: SurvivalRuleParams = {
  catchRadiusMm: 90,
  threatRadiusMm: 280,
  staminaDrainPerSec: 0.2,
  staminaRecoverPerSec: 0.33,
  timeLimitSec: 90,
};

/** Full stamina at the start of a run. */
export const SURVIVAL_MAX_STAMINA = 1;

/** Squared distance between two points (avoids a sqrt in the hot scan). */
function distSq(a: CatchPoint, b: CatchPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * True when ANY predator is within `radiusMm` of the player. Pure: no world
 * reads, no mutation. The app builds `predators` from the current world (the
 * `Predator`-tagged entities, excluding the player) and feeds it in.
 */
export function anyWithin(
  player: CatchPoint,
  predators: readonly PredatorCandidate[],
  radiusMm: number,
): boolean {
  const r2 = radiusMm * radiusMm;
  for (const p of predators) {
    if (distSq(player, p) <= r2) return true;
  }
  return false;
}

/** True when a predator is within the LETHAL catch radius (the lose trigger). */
export function isCaught(
  player: CatchPoint,
  predators: readonly PredatorCandidate[],
  params: SurvivalRuleParams,
): boolean {
  return anyWithin(player, predators, params.catchRadiusMm);
}

/** True when a predator is within the (wider) THREAT radius — stamina drains. */
export function isThreatened(
  player: CatchPoint,
  predators: readonly PredatorCandidate[],
  params: SurvivalRuleParams,
): boolean {
  return anyWithin(player, predators, params.threatRadiusMm);
}

/**
 * Step the stamina value for one frame. Drains while `threatened`, recovers
 * otherwise; clamped to `[0, SURVIVAL_MAX_STAMINA]`. Pure + total — the app
 * threads the returned value back in each frame.
 */
export function stepStamina(
  stamina: number,
  threatened: boolean,
  dtSec: number,
  params: SurvivalRuleParams,
): number {
  const rate = threatened ? -params.staminaDrainPerSec : params.staminaRecoverPerSec;
  const next = stamina + rate * dtSec;
  if (next < 0) return 0;
  if (next > SURVIVAL_MAX_STAMINA) return SURVIVAL_MAX_STAMINA;
  return next;
}

/** The decided outcome of a survival run, or `null` while it's still ongoing. */
export type SurvivalOutcome = 'won' | 'lost' | null;

/**
 * Decide a survival run.
 *
 *   - `caught` (a predator inside the catch radius) → LOST immediately.
 *   - `health` at/below 0 → LOST (Stage 14 vitality drained, e.g. fouled water).
 *   - `stamina` at/below 0 → LOST (exhausted while being hunted — you can't
 *     outswim the predator any longer).
 *   - surviving to `timeLimitSec` → WON.
 *   - otherwise the run is ongoing → `null`.
 *
 * Pure + total — the app calls this every frame with the live signals and
 * transitions the state machine on the first non-null result. Lose is checked
 * before win so a same-frame caught-at-the-buzzer reads as a loss.
 */
export function evaluateSurvivalOutcome(
  caught: boolean,
  health: number,
  stamina: number,
  elapsedSec: number,
  params: SurvivalRuleParams,
): SurvivalOutcome {
  if (caught) return 'lost';
  if (health <= 0) return 'lost';
  if (stamina <= 0) return 'lost';
  if (elapsedSec >= params.timeLimitSec) return 'won';
  return null;
}

/** Whole seconds left to survive (never negative) — for the HUD countdown. */
export function survivalTimeRemainingSec(elapsedSec: number, params: SurvivalRuleParams): number {
  const remaining = params.timeLimitSec - elapsedSec;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

/**
 * The survival SCORE is the whole seconds survived — a count-up the HUD already
 * shows as elapsed time, but we also award it as points so the results screen +
 * the `getGameScore()` debug hook read a meaningful number. Pure helper so the
 * service awards exactly the per-frame delta.
 */
export function survivalScoreFor(elapsedSec: number): number {
  return Math.floor(elapsedSec);
}
