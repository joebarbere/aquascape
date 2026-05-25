// User-viewport state service. Stage 5.x (user-controlled zoom).
//
// Holds two optional overrides that compose with the fit-to-window
// `defaultViewport` to produce the actual rendered viewport:
//
//   - `userZoomMult`: number | null
//       `null` → fit-to-window (default). Otherwise a multiplier (1 =
//       fit, 2 = 200 % of fit, 0.5 = 50 % of fit).
//   - `userPan`: Vec2 | null
//       `null` → centred on the tank. Otherwise a world-mm offset from
//       the tank's geometric centre, accumulated when the user pans or
//       zooms around a cursor anchor.
//
// The shell's `app.component` reads both signals when computing the
// viewport for `renderer.render` and re-renders inside an `effect()`
// whenever either flips.
//
// Why a service signal rather than NgRx?
//   - Viewport is transient editor UI state (NOT persisted in `.aqua`).
//   - Exactly one consumer (the render-call site in `apps/web`).
//   - Mirrors PreviewTimeService / OverlayOptionsService / ThemeService.
//
// "Fit" is the user-facing reset action: both overrides → null. That's
// what `reset()` does.

import { Injectable, computed, signal } from '@angular/core';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly userZoomMultSignal = signal<number | null>(null);
  private readonly userPanSignal = signal<Vec2 | null>(null);

  readonly userZoomMult = this.userZoomMultSignal.asReadonly();
  readonly userPan = this.userPanSignal.asReadonly();

  /**
   * True iff the user has applied any override (zoom or pan). Drives the
   * "Fit" button's disabled state in the zoom control.
   */
  readonly isFit = computed<boolean>(
    () => this.userZoomMultSignal() === null && this.userPanSignal() === null,
  );

  /**
   * Set the multiplier directly. `null` clears the override (revert to
   * fit-to-window on the zoom axis). Pan is not touched — the caller
   * should set / clear it independently.
   */
  setZoomMult(mult: number | null): void {
    this.userZoomMultSignal.set(mult);
  }

  /**
   * Set the pan offset (world-mm from tank centre). `null` clears the
   * override.
   */
  setPan(pan: Vec2 | null): void {
    this.userPanSignal.set(pan);
  }

  /**
   * Atomic update of both overrides at once. Used by the cursor-anchored
   * zoom gesture so the renderer observes a single coherent change rather
   * than a transient mid-update where zoom moved but pan hadn't.
   */
  setZoomAndPan(mult: number | null, pan: Vec2 | null): void {
    this.userZoomMultSignal.set(mult);
    this.userPanSignal.set(pan);
  }

  /**
   * Reset to fit-to-window. Both overrides → null.
   */
  reset(): void {
    this.userZoomMultSignal.set(null);
    this.userPanSignal.set(null);
  }
}
