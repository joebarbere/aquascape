// 3D orbit-controls pill — pan + rotate buttons shown only in 3D mode.
//
// Layout mirrors the floating ZoomControl: a dark-rounded pill positioned
// by its host (`apps/web` places it next to the zoom control). Two
// 3-button D-pads stacked vertically:
//
//     [↑]          [↺]
//   [←][·][→]    [↻][·][↺]
//     [↓]          [↻]
//
// The centre square in each cluster is a visual anchor (a small disc to
// give the cluster a centre of mass); it is NOT a clickable target.
//
// Pan + rotate dispatch through `Orbit3DService`, which routes the call
// to the renderer's `Orbital3DControls.panBy` / `rotateBy`. The "Reset
// view" button calls `Orbit3DService.reset` for parity with the zoom
// control's Fit button — same intent, different scope (Fit = zoom only,
// Reset = full camera pose). When 3D isn't wired in the current host
// (e.g. test bed without an Orbital3DControls provider), the buttons
// stay disabled rather than pretending to work.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { Orbit3DService } from './orbit-3d.service';
import { ViewModeService } from './view-mode.service';

@Component({
  selector: 'aquascape-orbit-3d-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="orbit3d-control" role="toolbar" aria-label="Canvas orbit controls">
        <section class="orbit3d-control__group" aria-label="Pan">
          <span class="orbit3d-control__caption">Pan</span>
          <div class="orbit3d-control__pad">
            <button
              type="button"
              class="orbit3d-control__btn orbit3d-control__btn--up"
              [disabled]="!available()"
              (click)="orbit.panUp()"
              aria-label="Pan up"
              title="Pan up"
            >
              ▲
            </button>
            <button
              type="button"
              class="orbit3d-control__btn orbit3d-control__btn--left"
              [disabled]="!available()"
              (click)="orbit.panLeft()"
              aria-label="Pan left"
              title="Pan left"
            >
              ◀
            </button>
            <span class="orbit3d-control__dot" aria-hidden="true"></span>
            <button
              type="button"
              class="orbit3d-control__btn orbit3d-control__btn--right"
              [disabled]="!available()"
              (click)="orbit.panRight()"
              aria-label="Pan right"
              title="Pan right"
            >
              ▶
            </button>
            <button
              type="button"
              class="orbit3d-control__btn orbit3d-control__btn--down"
              [disabled]="!available()"
              (click)="orbit.panDown()"
              aria-label="Pan down"
              title="Pan down"
            >
              ▼
            </button>
          </div>
        </section>

        <section class="orbit3d-control__group" aria-label="Rotate">
          <span class="orbit3d-control__caption">Orbit</span>
          <div class="orbit3d-control__pad">
            <button
              type="button"
              class="orbit3d-control__btn orbit3d-control__btn--up"
              [disabled]="!available()"
              (click)="orbit.rotateUp()"
              aria-label="Tilt camera up"
              title="Tilt camera up"
            >
              ▲
            </button>
            <button
              type="button"
              class="orbit3d-control__btn orbit3d-control__btn--left"
              [disabled]="!available()"
              (click)="orbit.rotateLeft()"
              aria-label="Rotate camera left"
              title="Rotate camera left"
            >
              ↺
            </button>
            <span class="orbit3d-control__dot" aria-hidden="true"></span>
            <button
              type="button"
              class="orbit3d-control__btn orbit3d-control__btn--right"
              [disabled]="!available()"
              (click)="orbit.rotateRight()"
              aria-label="Rotate camera right"
              title="Rotate camera right"
            >
              ↻
            </button>
            <button
              type="button"
              class="orbit3d-control__btn orbit3d-control__btn--down"
              [disabled]="!available()"
              (click)="orbit.rotateDown()"
              aria-label="Tilt camera down"
              title="Tilt camera down"
            >
              ▼
            </button>
          </div>
        </section>

        <button
          type="button"
          class="orbit3d-control__reset"
          [disabled]="!available()"
          (click)="orbit.reset()"
          aria-label="Reset 3D camera view"
          title="Reset 3D camera view"
        >
          Reset view
        </button>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .orbit3d-control {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        background: rgba(32, 35, 42, 0.92);
        color: #f0f2f5;
        border-radius: 14px;
        font-family: system-ui, sans-serif;
        font-size: 11px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
      }
      .orbit3d-control__group {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }
      .orbit3d-control__caption {
        font-size: 10px;
        opacity: 0.7;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .orbit3d-control__pad {
        display: grid;
        grid-template-columns: repeat(3, 22px);
        grid-template-rows: repeat(3, 22px);
        gap: 1px;
      }
      .orbit3d-control__btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        background: transparent;
        color: inherit;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font: inherit;
        font-size: 11px;
        line-height: 1;
      }
      .orbit3d-control__btn--up {
        grid-column: 2;
        grid-row: 1;
      }
      .orbit3d-control__btn--left {
        grid-column: 1;
        grid-row: 2;
      }
      .orbit3d-control__btn--right {
        grid-column: 3;
        grid-row: 2;
      }
      .orbit3d-control__btn--down {
        grid-column: 2;
        grid-row: 3;
      }
      .orbit3d-control__dot {
        grid-column: 2;
        grid-row: 2;
        align-self: center;
        justify-self: center;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.35);
      }
      .orbit3d-control__btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.15);
      }
      .orbit3d-control__btn:focus-visible {
        outline: 2px solid rgba(58, 142, 255, 0.85);
        outline-offset: 1px;
      }
      .orbit3d-control__reset {
        align-self: stretch;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 10px;
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        font: inherit;
        font-size: 11px;
        font-weight: 500;
        height: 26px;
      }
      .orbit3d-control__reset:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.15);
      }
      .orbit3d-control__reset:focus-visible {
        outline: 2px solid rgba(58, 142, 255, 0.85);
        outline-offset: 1px;
      }
      .orbit3d-control__btn:disabled,
      .orbit3d-control__reset:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    `,
  ],
})
export class Orbit3DControlsComponent {
  readonly viewMode = inject(ViewModeService);
  readonly orbit = inject(Orbit3DService);

  /** Render the pill only when the active mode is 3D — hidden in 2D. */
  readonly visible = (): boolean => this.viewMode.mode() === '3d';

  /** True only when a real Orbital3DControls implementation is wired. */
  readonly available = (): boolean => this.orbit.available;
}
