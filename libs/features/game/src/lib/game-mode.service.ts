// GameModeService (Stage 16 F16.1) — the game shell's Angular glue.
//
// Owns the shared game lifecycle for a single run: the state machine, the
// active sub-mode descriptor, the score, and a placeholder player vitality
// bar (Stage 14 vitality isn't built yet — the bar value is a clearly-marked
// stub). Surfaces everything as read-only signals the HUD binds to.
//
// What lives here vs. elsewhere:
//   - PURE game logic (state machine, scoring, input-intent → velocity,
//     sub-mode descriptors) lives in framework-free modules in this lib.
//   - This SERVICE is the thin Angular wrapper: signals + a couple of
//     orchestration methods. It does NOT own the keyboard listener, the rAF
//     loop, or the ECS world — the app (`apps/web`) wires raw input into
//     `setIntent` each frame and reads `playerVelocity` to push onto
//     `LivestockWorld.setPlayerVelocity`. That keeps `features/*` free of a
//     concrete renderer / platform (layer-boundary rule).

import { Injectable, Signal, computed, signal } from '@angular/core';

import { describeGameMode, type GameMode, type GameModeDescriptor } from './game-modes';
import {
  GameStateMachine,
  type GameEvent,
  type GameState,
  isLiveState,
} from './game-state-machine';
import {
  NEUTRAL_INTENT,
  intentToVelocity,
  type InputIntent,
} from './input-intent';
import { INITIAL_SCORE, awardPoints, tickElapsed, type ScoreState } from './scoring';

/**
 * Placeholder player vitality (Stage 14 not built). The bar reads this so the
 * HUD layout + a11y are validated now; `isPlaceholder` is surfaced so the HUD
 * can mark it unmistakably (e.g. a "stub" badge) rather than implying a real
 * health system exists.
 */
export interface PlayerVitality {
  /** Health fraction in `[0, 1]`. Stubbed to full until Stage 14 wires real vitality. */
  readonly health: number;
  /** Food / hunger fraction in `[0, 1]`. Stubbed to mid until Stage 14. */
  readonly food: number;
  /** Always `true` in F16.1 — flags the values as not-yet-real. */
  readonly isPlaceholder: boolean;
}

const PLACEHOLDER_VITALITY: PlayerVitality = {
  health: 1,
  food: 0.5,
  isPlaceholder: true,
};

@Injectable({ providedIn: 'root' })
export class GameModeService {
  private readonly machine = new GameStateMachine('objective');

  private readonly _state = signal<GameState>(this.machine.state);
  private readonly _mode = signal<GameMode | null>(null);
  private readonly _score = signal<ScoreState>(INITIAL_SCORE);
  private readonly _intent = signal<InputIntent>(NEUTRAL_INTENT);
  private readonly _vitality = signal<PlayerVitality>(PLACEHOLDER_VITALITY);

  /** Current lifecycle state. */
  readonly state: Signal<GameState> = this._state.asReadonly();
  /** Active sub-mode, or null when no game is started. */
  readonly mode: Signal<GameMode | null> = this._mode.asReadonly();
  /** Current score + elapsed time. */
  readonly score: Signal<ScoreState> = this._score.asReadonly();
  /** Latest input intent (set by the app each frame). */
  readonly intent: Signal<InputIntent> = this._intent.asReadonly();
  /** Placeholder player vitality (Stage 14 stub). */
  readonly vitality: Signal<PlayerVitality> = this._vitality.asReadonly();

  /** The active sub-mode descriptor, or null when no game is started. */
  readonly descriptor: Signal<GameModeDescriptor | null> = computed(() => {
    const m = this._mode();
    return m === null ? null : describeGameMode(m);
  });

  /** The objective string for the HUD / briefing. Empty when no game is started. */
  readonly objective: Signal<string> = computed(() => this.descriptor()?.objective ?? '');

  /** True while the run is live (sim ticking + player controllable). */
  readonly isLive: Signal<boolean> = computed(() => isLiveState(this._state()));

  /**
   * Player world velocity (mm/s) derived from the latest intent + the active
   * sub-mode's speed. Zero unless the run is live — pausing / results / the
   * briefing all freeze the player. The app reads this each frame and pushes
   * it onto `LivestockWorld.setPlayerVelocity`.
   */
  readonly playerVelocity: Signal<{ x: number; y: number; z: number }> = computed(() => {
    if (!this.isLive()) return { x: 0, y: 0, z: 0 };
    const speed = this.descriptor()?.playerSpeedMmPerSec ?? 0;
    return intentToVelocity(this._intent(), speed);
  });

  /**
   * Begin a game in `mode`. Resets the run (score + state machine) and shows
   * the objective briefing. The app then loads the scene, marks the player
   * entity, and switches the renderer into fish-eye.
   */
  startGame(mode: GameMode): void {
    this._mode.set(mode);
    this.machine.reset();
    this._state.set(this.machine.state);
    this._score.set(INITIAL_SCORE);
    this._intent.set(NEUTRAL_INTENT);
    this._vitality.set(PLACEHOLDER_VITALITY);
  }

  /** Dispatch a lifecycle event through the state machine. */
  dispatch(event: GameEvent): GameState {
    const next = this.machine.dispatch(event);
    this._state.set(next);
    return next;
  }

  /** Set the latest input intent (called by the app's input service each frame). */
  setIntent(intent: InputIntent): void {
    this._intent.set(intent);
  }

  /** Award (or deduct) points. The total is clamped at 0. */
  award(delta: number): void {
    this._score.update((s) => awardPoints(s, delta));
  }

  /**
   * Advance the elapsed-time clock — only does work while the run is live, so
   * paused time isn't counted. The app calls this from its sim/rAF loop.
   */
  tick(dtSec: number): void {
    if (!this.isLive()) return;
    this._score.update((s) => tickElapsed(s, dtSec));
  }

  /**
   * Update the placeholder vitality (Stage 14 will replace this with a read
   * from the player entity's real health/hunger). Kept so the HUD can be
   * exercised; clamps both to `[0, 1]`.
   */
  setVitalityPlaceholder(health: number, food: number): void {
    const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
    this._vitality.set({ health: clamp(health), food: clamp(food), isPlaceholder: true });
  }
}
