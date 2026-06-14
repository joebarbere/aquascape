// Cleaner game-mode rules (Stage 16 F16.5) — PURE + framework-free.
//
// The player swims the tank wielding a `cleaning-tool` (scraper / brush /
// siphon — the siphon REUSES Stage 15's renderer SiphonTool, no fork) and
// clears the Stage 13 F13.6 per-type algae off hardscape (+ glass) while the
// gravel siphon lifts settled waste (the Stage 13 chemistry tie-in). The
// objective is a CLEAN tank. This module owns the PURE rule logic:
//
//   - cleanliness scoring (total algae across the tank → a `[0, 1]` cleanliness
//     fraction → an integer score),
//   - the tool → algae-type mapping (which of the four `AlgaeType`s the active
//     tool removes, derived from its catalog `targetAlgae` + which surface it
//     can reach), and the per-pass rasp amount (the tool's `effectiveness`),
//   - the win/lose evaluation (clean the tank below a target total within the
//     time limit; lose on the clock), and the countdown, and
//   - the per-mode tuning constants.
//
// The WORLD reads (hardscape positions + per-type algae stocks) + the WORLD
// mutation (rasp the algae, dilute the waste via the chemistry service) + the
// rAF wiring live in the app layer
// (`apps/web/src/app/game/cleaner-game.service.ts`), NOT here — this stays a
// domain-shaped, DOM-free, deterministic-given-its-inputs pure module so the
// scoring / tool-mapping / win-lose rules are exhaustively unit-testable.
//
// DETERMINISM BOUNDARY (load-bearing). A clean STROKE is driven by the LIVE
// player position + tool + the held action button, which are the
// non-deterministic signals in a game run. So a rasp is a NON-deterministic
// GAME EVENT — it must stay OUT of the replay-critical deterministic sim core.
// The world mutation (the algae rasp, the waste dilution) runs in the app loop
// only while an active cleaner game has a live player marked; a non-game world
// (no player) never runs it and replays byte-identically. The algae rasp is the
// exact analogue of the predator catch's despawn — a between-ticks mutation, not
// a `world.step()` system. See `docs/caveats/game-modes.md`.

import type { AlgaeType } from '@aquascape/domain/water-sim';

/** Which surfaces a tool can reach (mirrors the catalog `CleaningSurface`). */
export type CleanerSurface = 'glass' | 'hardscape' | 'substrate';

/**
 * The active tool's cleaning profile, distilled from its `cleaning-tool` catalog
 * row. The app resolves a catalog `CleaningToolEntry` into this shape (so the
 * pure rules never import the catalog lib); a scraper/brush/siphon all converge
 * on it.
 */
export interface CleanerToolProfile {
  /** Tool family — informs the UI label + whether the siphon nozzle mounts. */
  readonly type: 'scraper' | 'brush' | 'siphon';
  /** Honest list of algae types this tool removes (catalog `targetAlgae`). */
  readonly targetAlgae: readonly AlgaeType[];
  /** Surfaces the tool acts on (catalog `surfaces`). */
  readonly surfaces: readonly CleanerSurface[];
  /** Modelled removal coefficient in `(0, 1]` — the per-pass rasp fraction. */
  readonly effectiveness: number;
  /** True only for the gravel siphon — it lifts settled waste (Stage 13 chemistry). */
  readonly removesWaste: boolean;
}

/** Tuning for a cleaner run. Kept here so the rules + tests share one source. */
export interface CleanerRuleParams {
  /**
   * The player must be within this distance (mm) of a hardscape surface for the
   * active tool to rasp its algae. Generous so cleaning lands under the fish-eye
   * camera without pixel-perfect aim (mirrors the predator catch radius scale).
   */
  readonly reachMm: number;
  /**
   * Win threshold — total algae (summed per-type stocks across every hardscape)
   * AT OR BELOW this is a clean-enough tank. The showcase tank seeds rocks/wood
   * at stock 1.0 each, so the total starts well above this.
   */
  readonly cleanTargetTotal: number;
  /** Run length in seconds. Failing to clean below the target by here LOSES. */
  readonly timeLimitSec: number;
  /**
   * Per-second waste-dilution fraction applied through the chemistry service
   * while the siphon is actively vacuuming (the Stage 13 tie-in). A small,
   * continuous nudge — the cleaner isn't a full water change.
   */
  readonly wasteDrainPerSec: number;
}

/**
 * Default cleaner tuning. `reachMm` (120) is a touch wider than the predator
 * catch radius — a scrub is a deliberate hover, not a dart. `cleanTargetTotal`
 * (0.5) is "the tank reads visibly clean" — in the showcase tank (rocks + wood
 * seeded at 1.0 total per surface) that's a meaningful scrub-down within 90 s.
 */
export const DEFAULT_CLEANER_PARAMS: CleanerRuleParams = {
  reachMm: 120,
  cleanTargetTotal: 0.5,
  timeLimitSec: 90,
  wasteDrainPerSec: 0.04,
};

/** A minimal positioned surface — a hardscape rock/wood the player can clean. */
export interface CleanPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A hardscape surface candidate: its world eid + position. */
export interface SurfaceCandidate extends CleanPoint {
  /** The world entity id — returned so the caller can rasp it. */
  readonly id: number;
}

/** Squared distance between two points (avoids a sqrt in the hot reach scan). */
function distSq(a: CleanPoint, b: CleanPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Find every hardscape surface within `reachMm` of the player. Returns the
 * matching surface ids in input order (deterministic given the inputs) — the
 * caller rasps each with the active tool's targeted algae types.
 *
 * Pure: no world reads, no mutation. The app builds `surfaces` from the current
 * world snapshot and feeds it in.
 */
export function surfacesInReach(
  player: CleanPoint,
  surfaces: readonly SurfaceCandidate[],
  reachMm: number,
): number[] {
  const r2 = reachMm * reachMm;
  const hit: number[] = [];
  for (const s of surfaces) {
    if (distSq(player, s) <= r2) hit.push(s.id);
  }
  return hit;
}

/**
 * The algae types the active tool removes — its catalog `targetAlgae`, but ONLY
 * when the tool can reach a hardscape/glass surface (a substrate-only siphon
 * doesn't scrape rock-bound algae). The cleaner game cleans algae off hardscape
 * (registered as Hardscape entities), so a tool that lists `hardscape` or
 * `glass` among its surfaces can rasp; a pure-substrate tool returns `[]` (it
 * removes waste, not algae). Pure + total.
 */
export function toolAlgaeTargets(tool: CleanerToolProfile): AlgaeType[] {
  const canScrape =
    tool.surfaces.includes('hardscape') || tool.surfaces.includes('glass');
  if (!canScrape) return [];
  return [...tool.targetAlgae];
}

/**
 * The per-pass rasp amount (algae stock units, same `[0, 1]` scale as the
 * per-type slabs) the tool removes from ONE algae type in ONE frame, given the
 * frame `dtSec`. Scaled by the tool's `effectiveness` so a high-effectiveness
 * scraper clears faster than a stiff brush. Pure.
 */
export function raspAmountPerType(tool: CleanerToolProfile, dtSec: number): number {
  const amt = tool.effectiveness * dtSec;
  return amt > 0 ? amt : 0;
}

/**
 * Map a total algae load to a cleanliness fraction in `[0, 1]` (1 = spotless).
 * `cleanTargetTotal` is the "clean enough to win" total — at or below it the
 * cleanliness reads ≥ the equivalent fraction. We map the total linearly against
 * a reference dirty load (`referenceTotal`, default the per-surface seed × a
 * handful of surfaces) so the HUD bar climbs smoothly as the tank clears. Pure +
 * total; clamps to `[0, 1]`.
 */
export function cleanlinessFraction(totalAlgae: number, referenceTotal: number): number {
  if (!(referenceTotal > 0)) return 1;
  const frac = 1 - totalAlgae / referenceTotal;
  return frac < 0 ? 0 : frac > 1 ? 1 : frac;
}

/**
 * The integer cleaner SCORE for a cleanliness fraction — a 0–100 "clean %"
 * readout the HUD shows + climbs as the player scrubs. Pure.
 */
export function cleanlinessScore(cleanliness: number): number {
  const c = cleanliness < 0 ? 0 : cleanliness > 1 ? 1 : cleanliness;
  return Math.round(c * 100);
}

/** The decided outcome of a cleaner run, or `null` while it's still ongoing. */
export type CleanerOutcome = 'won' | 'lost' | null;

/**
 * Decide a cleaner run from the current total algae + elapsed time.
 *
 *   - Total algae AT OR BELOW `cleanTargetTotal` wins IMMEDIATELY (the tank is
 *     clean — no need to wait out the clock).
 *   - Otherwise, once `elapsedSec` reaches `timeLimitSec` the run is LOST (the
 *     tank wasn't clean in time).
 *   - Before either condition, the run is ongoing → `null`.
 *
 * Pure + total — the app calls this every frame with the live total + timer and
 * transitions the state machine on the first non-null result.
 */
export function evaluateCleanerOutcome(
  totalAlgae: number,
  elapsedSec: number,
  params: CleanerRuleParams,
): CleanerOutcome {
  if (totalAlgae <= params.cleanTargetTotal) return 'won';
  if (elapsedSec >= params.timeLimitSec) return 'lost';
  return null;
}

/** Whole seconds left on the clock (never negative) — for the HUD countdown. */
export function cleanerTimeRemainingSec(elapsedSec: number, params: CleanerRuleParams): number {
  const remaining = params.timeLimitSec - elapsedSec;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}
