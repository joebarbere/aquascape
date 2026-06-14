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
  /** Health fraction in `[0, 1]` (1 = healthy, 0 = critical). */
  readonly health: number;
  /** Food / fullness fraction in `[0, 1]` (1 = full, 0 = starving). */
  readonly food: number;
  /**
   * Optional stamina fraction in `[0, 1]`, or `null` when the active mode has
   * no stamina concept. Survival (F16.2) drives it (drains while a predator is
   * near); other modes leave it `null` and the HUD hides the bar.
   */
  readonly stamina: number | null;
  /**
   * `true` while the values are the F16.1 STUB (no real game wired yet) — the
   * HUD marks the bar "preview". The real-vitality modes (F16.2 survival /
   * F16.3 feeding, Stage 14-backed) set `false` so the bar reads as live.
   */
  readonly isPlaceholder: boolean;
}

const PLACEHOLDER_VITALITY: PlayerVitality = {
  health: 1,
  food: 0.5,
  stamina: null,
  isPlaceholder: true,
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

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
   * Update the placeholder vitality (used by the generic shell / modes without
   * real vitality wired). Clamps both to `[0, 1]` and keeps `isPlaceholder`
   * true so the HUD shows the "preview" badge.
   */
  setVitalityPlaceholder(health: number, food: number): void {
    this._vitality.set({
      health: clamp01(health),
      food: clamp01(food),
      stamina: null,
      isPlaceholder: true,
    });
  }

  /**
   * Set the REAL player vitality from the live world (Stage 14 health/hunger).
   * The per-mode game service reads the player's `HealthDrive.health` +
   * `FeedingDrive.hunger` from the world snapshot each frame and pushes it here,
   * replacing the F16.1 placeholder. `stamina` is mode-local (survival drives
   * it; pass `null` when the mode has no stamina). All fields clamp to `[0, 1]`;
   * `isPlaceholder` is `false` so the HUD drops the "preview" badge.
   */
  setVitality(health: number, food: number, stamina: number | null = null): void {
    this._vitality.set({
      health: clamp01(health),
      food: clamp01(food),
      stamina: stamina === null ? null : clamp01(stamina),
      isPlaceholder: false,
    });
  }
}
