// Snap-settings sidebar accordion. Stage 5 F5.4.
//
// Six controls:
//   - Master enable checkbox.
//   - Per-kind toggles (grid, guides, objects) — gated by the master.
//   - Grid spacing (mm) — number input.
//   - Tolerance (CSS px) — number input.
//
// All drive `SnapOptionsService`; drag math in `apps/web/src/app/
// app.component.ts` reads `service.options()` each pointermove and
// applies the snap. Header badge shows `<n>/3` engaged.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';

import {
  MAX_GRID_SIZE_MM,
  MAX_TOLERANCE_CSS_PX,
  MIN_GRID_SIZE_MM,
  MIN_TOLERANCE_CSS_PX,
} from './snap-math';
import { SnapOptionsService } from './snap-options.service';

/** StorageService key for the collapsed-state flag. */
export const SNAP_SETTINGS_COLLAPSED_KEY = 'aquascape.ui.collapsed.snap-settings';

@Component({
  selector: 'aquascape-snap-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <section class="snap-settings" aria-labelledby="snap-settings-heading">
      <header class="panel-header">
        <button
          type="button"
          class="panel-header__toggle"
          [attr.aria-expanded]="!collapsed()"
          aria-controls="snap-settings-body"
          (click)="toggleCollapsed()"
        >
          <span
            class="panel-header__chevron"
            [class.panel-header__chevron--open]="!collapsed()"
            aria-hidden="true"
            >›</span
          >
          <h2 id="snap-settings-heading" class="panel-header__title">Snap</h2>
          <span class="panel-header__count" aria-label="active snap kinds">
            {{ activeKindCount() }}/3
          </span>
        </button>
      </header>

      <div id="snap-settings-body" class="snap-settings__body" [hidden]="collapsed()">
        <p class="snap-settings__hint">
          Snap dragged objects to the grid, the composition guides, or other
          objects' centres. Not saved with the document.
        </p>

        <label class="snap-settings__field snap-settings__field--row">
          <input
            type="checkbox"
            [checked]="enabled()"
            (change)="onEnabledChange($event)"
            aria-label="Enable snapping"
          />
          <span><strong>Snap enabled</strong></span>
        </label>

        <fieldset
          class="snap-settings__fieldset"
          [attr.disabled]="enabled() ? null : true"
          [class.snap-settings__fieldset--disabled]="!enabled()"
        >
          <legend class="visually-hidden">Snap targets</legend>
          <label class="snap-settings__field snap-settings__field--row">
            <input
              type="checkbox"
              [checked]="toGrid()"
              (change)="onToGridChange($event)"
              aria-label="Snap to grid"
              [disabled]="!enabled()"
            />
            <span>To grid</span>
          </label>
          <label class="snap-settings__field snap-settings__field--row">
            <input
              type="checkbox"
              [checked]="toGuides()"
              (change)="onToGuidesChange($event)"
              aria-label="Snap to guides"
              [disabled]="!enabled()"
            />
            <span>To guides (golden / thirds / focal)</span>
          </label>
          <label class="snap-settings__field snap-settings__field--row">
            <input
              type="checkbox"
              [checked]="toObjects()"
              (change)="onToObjectsChange($event)"
              aria-label="Snap to other objects"
              [disabled]="!enabled()"
            />
            <span>To other objects</span>
          </label>

          <div class="snap-settings__row">
            <label class="snap-settings__field">
              <span class="snap-settings__field-label">Grid (mm)</span>
              <input
                type="number"
                [min]="MIN_GRID"
                [max]="MAX_GRID"
                step="1"
                [value]="gridSizeMm()"
                (input)="onGridSizeChange($event)"
                aria-label="Grid spacing in millimetres"
                [disabled]="!enabled()"
              />
            </label>
            <label class="snap-settings__field">
              <span class="snap-settings__field-label">Tolerance (px)</span>
              <input
                type="number"
                [min]="MIN_TOL"
                [max]="MAX_TOL"
                step="1"
                [value]="toleranceCssPx()"
                (input)="onToleranceChange($event)"
                aria-label="Snap tolerance in CSS pixels"
                [disabled]="!enabled()"
              />
            </label>
          </div>
        </fieldset>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 12px;
        font-family: system-ui, sans-serif;
        font-size: 13px;
      }
      .panel-header {
        margin: 0 0 8px;
      }
      .panel-header__toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 4px 6px;
        background: transparent;
        color: inherit;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
        text-align: left;
      }
      .panel-header__toggle:hover,
      .panel-header__toggle:focus-visible {
        background: var(--surface-hover, #f0f0f0);
        outline: none;
        border-color: var(--border, #e0e0e0);
      }
      .panel-header__chevron {
        display: inline-block;
        font-size: 16px;
        line-height: 1;
        width: 12px;
        transition: transform 0.15s ease;
        transform: rotate(0deg);
      }
      .panel-header__chevron--open {
        transform: rotate(90deg);
      }
      @media (prefers-reduced-motion: reduce) {
        .panel-header__chevron {
          transition: none;
        }
      }
      .panel-header__title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        flex: 1;
      }
      .panel-header__count {
        color: var(--text-muted, #777);
        font-variant-numeric: tabular-nums;
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--surface, #f1f1f3);
      }
      .snap-settings__hint {
        margin: 0 0 8px;
        color: var(--text-muted, #777);
        font-size: 11px;
        font-style: italic;
      }
      .snap-settings__fieldset {
        border: none;
        padding: 0;
        margin: 4px 0 0;
      }
      .snap-settings__fieldset--disabled {
        opacity: 0.55;
      }
      .snap-settings__field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 6px;
      }
      .snap-settings__field--row {
        flex-direction: row;
        align-items: center;
        gap: 8px;
      }
      .snap-settings__field-label {
        font-size: 11px;
        color: var(--text-muted, #555);
      }
      .snap-settings__field input[type='number'] {
        font: inherit;
        padding: 4px 6px;
        background: var(--surface-2, #fff);
        color: inherit;
        border: 1px solid var(--border-strong, #ccc);
        border-radius: 3px;
        min-width: 0;
      }
      .snap-settings__row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-top: 4px;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `,
  ],
})
export class SnapSettingsComponent {
  private readonly snap = inject(SnapOptionsService);
  private readonly storage = inject<StorageService>(STORAGE_SERVICE);

  readonly MIN_GRID = MIN_GRID_SIZE_MM;
  readonly MAX_GRID = MAX_GRID_SIZE_MM;
  readonly MIN_TOL = MIN_TOLERANCE_CSS_PX;
  readonly MAX_TOL = MAX_TOLERANCE_CSS_PX;

  readonly enabled = this.snap.enabled;
  readonly toGrid = this.snap.toGrid;
  readonly toGuides = this.snap.toGuides;
  readonly toObjects = this.snap.toObjects;
  readonly gridSizeMm = this.snap.gridSizeMm;
  readonly toleranceCssPx = this.snap.toleranceCssPx;
  readonly activeKindCount = this.snap.activeKindCount;

  readonly collapsed = signal<boolean>(false);

  /** Memoised label exposed for testability. */
  readonly badge = computed<string>(() => `${this.activeKindCount()}/3`);

  constructor() {
    this.storage
      .get<boolean>(SNAP_SETTINGS_COLLAPSED_KEY)
      .then((stored) => {
        if (typeof stored === 'boolean') this.collapsed.set(stored);
      })
      .catch(() => {
        // Best-effort.
      });

    let firstRun = true;
    effect(() => {
      const v = this.collapsed();
      if (firstRun) {
        firstRun = false;
        return;
      }
      this.storage.set(SNAP_SETTINGS_COLLAPSED_KEY, v).catch(() => {
        // Best-effort.
      });
    });
  }

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  onEnabledChange(e: Event): void {
    this.snap.setEnabled((e.target as HTMLInputElement).checked);
  }
  onToGridChange(e: Event): void {
    this.snap.setToGrid((e.target as HTMLInputElement).checked);
  }
  onToGuidesChange(e: Event): void {
    this.snap.setToGuides((e.target as HTMLInputElement).checked);
  }
  onToObjectsChange(e: Event): void {
    this.snap.setToObjects((e.target as HTMLInputElement).checked);
  }
  onGridSizeChange(e: Event): void {
    const v = (e.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(v)) this.snap.setGridSizeMm(v);
  }
  onToleranceChange(e: Event): void {
    const v = (e.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(v)) this.snap.setToleranceCssPx(v);
  }
}
