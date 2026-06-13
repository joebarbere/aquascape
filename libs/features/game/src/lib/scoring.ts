// Game scoring (Stage 16 F16.1).
//
// PURE — the shared score accumulator the four games drive. F16.1 ships the
// generic primitive (a clamped, non-negative running total + an elapsed
// timer); each game (16.2–16.5) layers its own award rules on top. Kept
// framework-free so win/lose rules are unit-testable.

/** A snapshot of the current run's score + elapsed playing time. */
export interface ScoreState {
  /** Running point total. Never negative (clamped at 0). */
  readonly points: number;
  /** Seconds of *playing* time elapsed (paused time excluded — the host only ticks while live). */
  readonly elapsedSec: number;
}

/** The starting score for a fresh run. */
export const INITIAL_SCORE: ScoreState = { points: 0, elapsedSec: 0 };

/**
 * Award (or deduct) points. The total is clamped at 0 — a game can penalise
 * (negative `delta`) but the displayed score never goes negative.
 */
export function awardPoints(score: ScoreState, delta: number): ScoreState {
  const next = score.points + delta;
  return { ...score, points: next < 0 ? 0 : next };
}

/** Advance the elapsed-time clock by `dtSec` (only called while playing). */
export function tickElapsed(score: ScoreState, dtSec: number): ScoreState {
  if (dtSec <= 0) return score;
  return { ...score, elapsedSec: score.elapsedSec + dtSec };
}
