// GameInputService (Stage 16 F16.1b) — the app-layer input + per-frame loop.
//
// This is the GLUE the `docs/caveats/game-modes.md` shell describes as "the
// app wires raw input into `GameModeService.setIntent` each frame and reads
// `playerVelocity` to push onto `LivestockWorld.setPlayerVelocity`". It owns:
//
//   1. The keyboard listener — a live `Set<KeyboardEvent.code>` of held keys.
//      Lives HERE (the app layer), NEVER in a `domain/*` or pure `features/*`
//      module: those stay framework- + DOM-free so the same logic runs
//      headless. The pure mapping (held codes → intent → velocity) is the
//      `@aquascape/features/game` input-intent layer; we only feed it.
//   2. A `requestAnimationFrame` loop that, every frame:
//        a. resolves the held codes → `InputIntent` (`keysToIntent`),
//        b. pushes the intent onto `GameModeService.setIntent` (so the HUD /
//           future per-mode rules see it + the service derives velocity),
//        c. reads `GameModeService.playerVelocity` (zero unless the run is
//           live) and pushes it onto the world via `setPlayerVelocity`,
//        d. advances the elapsed clock (`GameModeService.tick`).
//
// DETERMINISM — the seam, restated. `setPlayerVelocity` only STORES a value;
// the world applies it at the very top of `world.step()` (see
// `docs/caveats/livestock-ecs.md` → "Player-control seam"). So pushing the
// velocity from this rAF (≈60 Hz) is independent of the renderer's sim step
// rate (30 Hz): whatever value is current when `step()` runs is what the
// player integrates. The live velocity is the ONE non-deterministic input;
// everything else (scene, player selection, sim) is seed-deterministic.
//
// The gamepad backend (the separate "game-controller support" plan) plugs in
// at the SAME seam: it would build the `InputIntent` from
// `navigator.getGamepads()` Standard-mapping axes/buttons inside this rAF and
// feed `setIntent` identically. F16.1b ships keyboard only; the structure
// keeps that future swap to a single method.

import { DestroyRef, Injectable, NgZone, inject } from '@angular/core';

import { GameModeService, keysToIntent, type InputIntent } from '@aquascape/features/game';

/** Sink the loop pushes the derived player velocity onto each frame. */
export type PlayerVelocitySink = (vx: number, vy: number, vz: number) => void;

/**
 * Optional per-frame hook run after the velocity sink each frame, with the
 * frame `dtSec`. The per-mode RULES (Stage 16 F16.4 predator catch detection
 * + scoring + win/lose) wire in here — the loop already runs every frame with
 * the live world, so the predator rules ride the same beat as the input push.
 * Kept as a plain callback (not a hard dependency) so the generic shell stays
 * mode-agnostic; only a game with rules registers one.
 */
export type GameFrameHook = (dtSec: number) => void;

/**
 * Owns the keyboard listener + the per-frame input loop for an active game
 * run. `root`-provided so a single instance spans the app; `start`/`stop` are
 * idempotent so AppComponent can drive them on game enter / leave without
 * leaking listeners or rAF handles.
 */
@Injectable({ providedIn: 'root' })
export class GameInputService {
  private readonly game = inject(GameModeService);
  private readonly ngZone = inject(NgZone);

  constructor() {
    // Tear the loop + listeners down with the host so a test teardown / HMR
    // re-bootstrap leaves nothing dangling.
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Currently-held `KeyboardEvent.code` strings. */
  private readonly held = new Set<string>();

  /** rAF handle for the loop, or null when stopped. */
  private rafId: number | null = null;

  /** The world sink, set by `start`. Null when the loop isn't running. */
  private sink: PlayerVelocitySink | null = null;

  /** Optional per-mode rules hook, set by `start`. Null = generic loop. */
  private frameHook: GameFrameHook | null = null;

  /** Wall-clock of the previous frame (ms), for the elapsed-clock dt. */
  private lastFrameMs = 0;

  /** Bound listeners, retained so we can detach the exact references. */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.held.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };
  /**
   * If the window loses focus mid-press we never see the keyup, which would
   * leave a phantom held key driving the player forever. Clear on blur.
   */
  private readonly onBlur = (): void => {
    this.held.clear();
  };

  /**
   * Begin the input loop, pushing derived velocity onto `sink` each frame.
   * Idempotent — a second `start` swaps the sink + restarts cleanly. Listeners
   * + the rAF run OUTSIDE Angular's zone (no per-frame change detection); the
   * service's signals are read/written without scheduling CD here (the HUD
   * reads the same signals and refreshes on its own OnPush schedule).
   */
  start(sink: PlayerVelocitySink, frameHook: GameFrameHook | null = null): void {
    if (typeof window === 'undefined') return;
    this.stop();
    this.sink = sink;
    this.frameHook = frameHook;
    this.held.clear();
    this.lastFrameMs = 0;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    this.ngZone.runOutsideAngular(() => {
      this.rafId = window.requestAnimationFrame((t) => this.frame(t));
    });
  }

  /** Stop the loop + detach listeners. Idempotent — safe to call when stopped. */
  stop(): void {
    if (typeof window === 'undefined') return;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.held.clear();
    this.sink = null;
    this.frameHook = null;
    // The host's `leaveGameMode` calls `world.clearPlayer()` right after this,
    // which zeroes the stored player velocity — so a stopped game never leaves
    // the player drifting even though the seam would otherwise keep the last
    // value until overwritten.
  }

  /**
   * Run one frame of the input pipeline. Exposed (not private) so the
   * component test can drive a deterministic frame without a real rAF —
   * `step()` does the exact work the rAF callback does, minus rescheduling.
   */
  step(nowMs: number): void {
    const intent: InputIntent = keysToIntent(this.held);
    this.game.setIntent(intent);

    // Velocity is zero unless the run is live (objective / paused / results
    // freeze the player). The seam stores it; world.step applies it.
    const v = this.game.playerVelocity();
    this.sink?.(v.x, v.y, v.z);

    // Advance the elapsed-time clock (only counts while live — the service
    // guards that internally). First frame seeds lastFrameMs with no dt.
    if (this.lastFrameMs !== 0) {
      const dtSec = Math.max(0, (nowMs - this.lastFrameMs) / 1000);
      // Re-enter the zone for the score signal write so the HUD's OnPush
      // timer refreshes; cheap (once/frame) and only while a game runs. The
      // per-mode rules hook (predator catch detection + scoring + win/lose)
      // rides the same zone re-entry so its score/state writes refresh the HUD.
      this.ngZone.run(() => {
        this.game.tick(dtSec);
        this.frameHook?.(dtSec);
      });
    }
    this.lastFrameMs = nowMs;
  }

  /** The rAF body: do the frame work, then reschedule. */
  private frame(nowMs: number): void {
    this.step(nowMs);
    this.rafId = window.requestAnimationFrame((t) => this.frame(t));
  }

  /** Test-only read of the held-code set (unit tests assert wiring). */
  heldCodesForTest(): ReadonlySet<string> {
    return this.held;
  }
}
