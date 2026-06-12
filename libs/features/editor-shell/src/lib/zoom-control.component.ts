// Floating zoom control. Stage 5.x; mode-aware update Stage 10 follow-up.
//
// Bottom-right pill above the canvas:  [ − ]  [ 100% ]  [ + ]  [ Fit ]
//
// **In 2D mode** the buttons step the user-zoom multiplier through
// `ViewportService` and the host translates that signal into renderer
// calls (plus the cursor-anchored wheel-zoom gesture).
//
// **In 3D mode** the buttons drive `Orbit3DService` instead — the
// equivalent of "zoom" is the camera-to-target distance in the 3D
// renderer's OrbitControls. The same percent semantics apply (100 % =
// initial framing distance, 200 % = 2× zoomed-in) so the label reads
// consistently across modes.
//
// The component owns ZERO state of its own — every value comes from the
// active mode's signal. Mode flipping is handled by `ViewModeService`.

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { Orbit3DService } from './orbit-3d.service';
import { ViewModeService } from './view-mode.service';
import {
  ZOOM_MULT_MAX,
  ZOOM_MULT_MIN,
  ZOOM_STEP_MULT,
  clampZoomMult,
  formatZoomPercent,
} from './zoom-math';
import { ViewportService } from './viewport.service';

@Component({
  selector: 'aquascape-zoom-control',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="zoom-control" role="toolbar" aria-label="Canvas zoom">
      <button
        type="button"
        class="zoom-control__btn"
        (click)="onZoomOut()"
        [disabled]="!canZoomOut()"
        aria-label="Zoom out"
        title="Zoom out"
      >
        −
      </button>

      <span
        class="zoom-control__value"
        role="status"
        aria-live="polite"
        aria-label="Current zoom"
        title="Current zoom"
      >
        {{ percentLabel() }}
      </span>

      <button
        type="button"
        class="zoom-control__btn"
        (click)="onZoomIn()"
        [disabled]="!canZoomIn()"
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>

      <button
        type="button"
        class="zoom-control__fit"
        (click)="onFit()"
        [disabled]="!canFit()"
        aria-label="Reset zoom to fit window"
        title="Reset zoom to fit window"
      >
        Fit
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .zoom-control {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 4px 6px;
        background: rgba(32, 35, 42, 0.92);
        color: #f0f2f5;
        border-radius: 999px;
        font-family: system-ui, sans-serif;
        font-size: 12px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
      }
      .zoom-control__btn,
      .zoom-control__fit {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 24px;
        padding: 0 8px;
        background: transparent;
        color: inherit;
        border: none;
        border-radius: 12px;
        cursor: pointer;
        font: inherit;
        font-weight: 600;
      }
      .zoom-control__btn {
        font-size: 16px;
        line-height: 1;
      }
      .zoom-control__fit {
        margin-left: 4px;
        padding: 0 10px;
        background: rgba(255, 255, 255, 0.08);
        font-size: 11px;
        font-weight: 500;
      }
      .zoom-control__btn:hover:not(:disabled),
      .zoom-control__fit:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.15);
      }
      .zoom-control__btn:focus-visible,
      .zoom-control__fit:focus-visible {
        outline: 2px solid rgba(58, 142, 255, 0.85);
        outline-offset: 1px;
      }
      .zoom-control__btn:disabled,
      .zoom-control__fit:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .zoom-control__value {
        min-width: 44px;
        text-align: center;
        font-variant-numeric: tabular-nums;
        padding: 0 4px;
      }
    `,
  ],
})
export class ZoomControlComponent {
  readonly viewport = inject(ViewportService);
  readonly viewMode = inject(ViewModeService);
  private readonly orbit = inject(Orbit3DService);

  /** Active zoom fraction — reads from whichever backend matches the mode.
   *  In fish-eye the camera rides a fish (no user zoom), so the label
   *  pins at the 1× default. */
  private readonly activeFraction = computed<number | null>(() => {
    const mode = this.viewMode.mode();
    if (mode === 'fish-eye') return 1;
    if (mode === '3d') return this.orbit.zoomFraction();
    return this.viewport.userZoomMult();
  });

  readonly percentLabel = computed<string>(() => formatZoomPercent(this.activeFraction()));

  readonly canZoomIn = computed<boolean>(() => {
    // Fish-eye: the follow-cam owns the camera every frame — zoom input
    // would be silently overwritten, so the buttons disable.
    if (this.viewMode.mode() === 'fish-eye') return false;
    // 3D has no UI cap — OrbitControls clamps internally to its
    // minDistance/maxDistance bounds — so the button always stays
    // enabled in 3D. The 2D cap stays at ZOOM_MULT_MAX.
    if (this.viewMode.mode() === '3d') return true;
    const mult = this.viewport.userZoomMult() ?? 1;
    return mult < ZOOM_MULT_MAX;
  });

  readonly canZoomOut = computed<boolean>(() => {
    if (this.viewMode.mode() === 'fish-eye') return false;
    if (this.viewMode.mode() === '3d') return true;
    const mult = this.viewport.userZoomMult() ?? 1;
    return mult > ZOOM_MULT_MIN;
  });

  /**
   * "Fit" → fit-to-window in 2D, reset-to-3/4-view in 3D. Disabled when
   * already at the default in either mode so the user can tell the
   * action has nothing to undo. Disabled in fish-eye — the follow-cam
   * owns the framing.
   */
  readonly canFit = computed<boolean>(() => {
    if (this.viewMode.mode() === 'fish-eye') return false;
    if (this.viewMode.mode() === '3d') {
      // Approximate "at default" by zoomFraction ≈ 1. Doesn't account for
      // pure pan/rotate offsets — but the cost of an extra reset is one
      // re-frame, so we err on the side of always-clickable in 3D.
      const frac = this.orbit.zoomFraction();
      return Math.abs(frac - 1) > 1e-3;
    }
    return !this.viewport.isFit();
  });

  onZoomIn(): void {
    const mode = this.viewMode.mode();
    if (mode === 'fish-eye') return;
    if (mode === '3d') {
      this.orbit.zoomIn();
      return;
    }
    const current = this.viewport.userZoomMult() ?? 1;
    this.viewport.setZoomMult(clampZoomMult(current * ZOOM_STEP_MULT));
  }

  onZoomOut(): void {
    const mode = this.viewMode.mode();
    if (mode === 'fish-eye') return;
    if (mode === '3d') {
      this.orbit.zoomOut();
      return;
    }
    const current = this.viewport.userZoomMult() ?? 1;
    this.viewport.setZoomMult(clampZoomMult(current / ZOOM_STEP_MULT));
  }

  onFit(): void {
    const mode = this.viewMode.mode();
    if (mode === 'fish-eye') return;
    if (mode === '3d') {
      this.orbit.reset();
      return;
    }
    this.viewport.reset();
  }
}
