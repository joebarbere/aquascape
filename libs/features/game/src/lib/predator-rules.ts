// Predator game-mode rules (Stage 16 F16.4) — PURE + framework-free.
//
// The player IS the predator: they swim the tank and "eat" prey that flee from
// them (via the existing `FearSystem` proximity risk — see
// `docs/caveats/livestock-ecs.md`). This module owns the PURE rule logic:
//
//   - catch detection (which prey are within the catch radius of the player),
//   - the win/lose evaluation (target catches before a time limit), and
//   - the per-mode tuning constants.
//
// The WORLD MUTATION (despawning a caught prey) + the rAF wiring live in the
// app layer (`apps/web/src/app/game/predator-game.service.ts`), NOT here — this
// stays a domain-shaped, DOM-free, deterministic-given-its-inputs pure module
// so the catch/scoring/win-lose rules are exhaustively unit-testable.
//
// DETERMINISM BOUNDARY (load-bearing). Catch detection is driven by the LIVE
// player position, which is the one non-deterministic signal in a game run (the
// player's velocity comes from live input). So a catch is a NON-deterministic
// GAME EVENT — it must stay OUT of the replay-critical deterministic sim core.
// The despawn it triggers happens in the app loop only while an active game has
// a live player marked; a non-game world (no player) never runs catch detection
// and replays byte-identically. See `docs/caveats/game-modes.md`.

/** A minimal positioned entity — the player or a prey fish. */
export interface CatchPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A prey candidate: a stable id (the world eid) + its current position. */
export interface PreyCandidate extends CatchPoint {
  /** The world entity id — returned in the catch result so the caller can despawn it. */
  readonly id: number;
}

/** Tuning for a predator run. Kept here so the rules + tests share one source. */
export interface PredatorRuleParams {
  /** A prey within this distance (mm) of the player is caught + eaten. */
  readonly catchRadiusMm: number;
  /** Catches needed to WIN before the timer expires. */
  readonly targetCatches: number;
  /** Run length in seconds. On expiry the run is decided by catch count. */
  readonly timeLimitSec: number;
}

/**
 * Default predator tuning. The catch radius is generous (a fish body is
 * ~30 mm; 90 mm gives a satisfying "snap" without pixel-perfect aim under the
 * fish-eye camera). 8 catches in 60 s is a brisk-but-achievable hunt in the
 * showcase tank (~108 fish). Tune in one place if play-testing wants it.
 */
export const DEFAULT_PREDATOR_PARAMS: PredatorRuleParams = {
  catchRadiusMm: 90,
  targetCatches: 8,
  timeLimitSec: 60,
};

/** Squared distance between two points (avoids a sqrt in the hot catch scan). */
function distSq(a: CatchPoint, b: CatchPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Find every prey within `catchRadiusMm` of the player. Returns the matching
 * prey ids in input order (deterministic given the inputs) — the caller
 * despawns each + awards a point per catch.
 *
 * Pure: no world reads, no mutation. The app builds `prey` from the current
 * world snapshot (excluding the player's own eid) and feeds it in.
 */
export function detectCatches(
  player: CatchPoint,
  prey: readonly PreyCandidate[],
  catchRadiusMm: number,
): number[] {
  const r2 = catchRadiusMm * catchRadiusMm;
  const caught: number[] = [];
  for (const p of prey) {
    if (distSq(player, p) <= r2) caught.push(p.id);
  }
  return caught;
}

/** The decided outcome of a predator run, or `null` while it's still ongoing. */
export type PredatorOutcome = 'won' | 'lost' | null;

/**
 * Decide a predator run from the current catch count + elapsed time.
 *
 *   - Reaching `targetCatches` wins IMMEDIATELY (no need to wait out the clock).
 *   - Otherwise, once `elapsedSec` reaches `timeLimitSec` the run is LOST
 *     (the target wasn't met in time).
 *   - Before either condition, the run is ongoing → `null`.
 *
 * Pure + total — the app calls this every frame with the live score + timer and
 * transitions the state machine on the first non-null result.
 */
export function evaluatePredatorOutcome(
  catches: number,
  elapsedSec: number,
  params: PredatorRuleParams,
): PredatorOutcome {
  if (catches >= params.targetCatches) return 'won';
  if (elapsedSec >= params.timeLimitSec) return 'lost';
  return null;
}

/** Whole seconds left on the clock (never negative) — for the HUD countdown. */
export function predatorTimeRemainingSec(elapsedSec: number, params: PredatorRuleParams): number {
  const remaining = params.timeLimitSec - elapsedSec;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}
