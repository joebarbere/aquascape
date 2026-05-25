// Floating zoom control. Stage 5.x.
//
// Bottom-right pill above the canvas:  [ − ]  [ 100% ]  [ + ]  [ Fit ]
//
// Buttons step the user-zoom multiplier through `ViewportService`. The
// percentage display reads back from the service. "Fit" resets both
// overrides (zoom + pan) so the viewport returns to fit-to-window.
//
// This component owns ZERO state of its own — every value comes from
// `ViewportService` signals. The host (apps/web) is responsible for
// translating service signals into renderer calls + handling the
// cursor-anchored wheel-zoom gesture on the canvas (the wheel gesture
// needs cursor coords + canvas size, both of which live on the host).

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

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
        [disabled]="viewport.isFit()"
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

  readonly percentLabel = computed<string>(() => formatZoomPercent(this.viewport.userZoomMult()));

  readonly canZoomIn = computed<boolean>(() => {
    const mult = this.viewport.userZoomMult() ?? 1;
    return mult < ZOOM_MULT_MAX;
  });

  readonly canZoomOut = computed<boolean>(() => {
    const mult = this.viewport.userZoomMult() ?? 1;
    return mult > ZOOM_MULT_MIN;
  });

  onZoomIn(): void {
    const current = this.viewport.userZoomMult() ?? 1;
    this.viewport.setZoomMult(clampZoomMult(current * ZOOM_STEP_MULT));
  }

  onZoomOut(): void {
    const current = this.viewport.userZoomMult() ?? 1;
    this.viewport.setZoomMult(clampZoomMult(current / ZOOM_STEP_MULT));
  }

  onFit(): void {
    this.viewport.reset();
  }
}
