// Wall-background sidebar accordion. Stage 5.x.
//
// Three controls: master enable toggle, color picker, and width / height
// numeric inputs (mm). All drive `WallBackgroundService`; the renderer
// re-paints inside the existing wall-state effect in `apps/web`.
//
// The panel layout mirrors the other sidebar accordions (substrate-tool,
// composition-overlays) so the rhythm stays consistent: header toggle +
// chevron + "x/4 enabled" badge, body hidden when collapsed, persisted
// collapsed state under `aquascape.ui.collapsed.wall-background`.

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
  MAX_WALL_DIM_MM,
  MIN_WALL_DIM_MM,
  WallBackgroundService,
} from './wall-background.service';

/** StorageService key for the collapsed-state flag. */
export const WALL_BACKGROUND_COLLAPSED_KEY = 'aquascape.ui.collapsed.wall-background';

@Component({
  selector: 'aquascape-wall-background',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <section class="wall-background" aria-labelledby="wall-background-heading">
      <header class="panel-header">
        <button
          type="button"
          class="panel-header__toggle"
          [attr.aria-expanded]="!collapsed()"
          aria-controls="wall-background-body"
          (click)="toggleCollapsed()"
        >
          <span
            class="panel-header__chevron"
            [class.panel-header__chevron--open]="!collapsed()"
            aria-hidden="true"
            >›</span
          >
          <h2 id="wall-background-heading" class="panel-header__title">Background</h2>
          <span
            class="panel-header__count"
            [attr.aria-label]="enabled() ? 'wall on' : 'wall off'"
          >
            {{ enabled() ? 'on' : 'off' }}
          </span>
        </button>
      </header>

      <div
        id="wall-background-body"
        class="wall-background__body"
        [hidden]="collapsed()"
      >
        <p class="wall-background__hint">
          The surface the tank sits against. Not saved with the document.
        </p>

        <label class="wall-background__field wall-background__field--row">
          <input
            type="checkbox"
            [checked]="enabled()"
            (change)="onEnabledChange($event)"
            aria-label="Show background"
          />
          <span>Show background</span>
        </label>

        <label class="wall-background__field">
          <span class="wall-background__field-label">Color</span>
          <div class="wall-background__color-row">
            <input
              type="color"
              [value]="color()"
              (input)="onColorChange($event)"
              aria-label="Background color picker"
            />
            <input
              type="text"
              class="wall-background__hex"
              [value]="color()"
              (change)="onColorChange($event)"
              aria-label="Background color hex value"
            />
          </div>
        </label>

        <div class="wall-background__row">
          <label class="wall-background__field">
            <span class="wall-background__field-label">Width (mm)</span>
            <input
              type="number"
              [min]="MIN_DIM"
              [max]="MAX_DIM"
              step="10"
              [value]="widthMm()"
              (input)="onWidthChange($event)"
              aria-label="Background width in millimetres"
            />
          </label>
          <label class="wall-background__field">
            <span class="wall-background__field-label">Height (mm)</span>
            <input
              type="number"
              [min]="MIN_DIM"
              [max]="MAX_DIM"
              step="10"
              [value]="heightMm()"
              (input)="onHeightChange($event)"
              aria-label="Background height in millimetres"
            />
          </label>
        </div>
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
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .wall-background__hint {
        margin: 0 0 8px;
        color: var(--text-muted, #777);
        font-size: 11px;
        font-style: italic;
      }
      .wall-background__field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 8px;
      }
      .wall-background__field--row {
        flex-direction: row;
        align-items: center;
        gap: 8px;
      }
      .wall-background__field-label {
        font-size: 11px;
        color: var(--text-muted, #555);
      }
      .wall-background__field input[type='number'],
      .wall-background__field input[type='text'] {
        font: inherit;
        padding: 4px 6px;
        background: var(--surface-2, #fff);
        color: inherit;
        border: 1px solid var(--border-strong, #ccc);
        border-radius: 3px;
        min-width: 0;
      }
      .wall-background__color-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .wall-background__color-row input[type='color'] {
        width: 32px;
        height: 24px;
        padding: 0;
        background: transparent;
        border: 1px solid var(--border-strong, #ccc);
        border-radius: 3px;
        cursor: pointer;
      }
      .wall-background__hex {
        flex: 1;
        font-family: ui-monospace, SFMono-Regular, monospace;
      }
      .wall-background__row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
    `,
  ],
})
export class WallBackgroundComponent {
  private readonly wall = inject(WallBackgroundService);
  private readonly storage = inject<StorageService>(STORAGE_SERVICE);

  readonly MIN_DIM = MIN_WALL_DIM_MM;
  readonly MAX_DIM = MAX_WALL_DIM_MM;

  readonly enabled = this.wall.enabled;
  readonly color = this.wall.color;
  readonly widthMm = this.wall.widthMm;
  readonly heightMm = this.wall.heightMm;

  readonly collapsed = signal<boolean>(false);

  constructor() {
    this.storage
      .get<boolean>(WALL_BACKGROUND_COLLAPSED_KEY)
      .then((stored) => {
        if (typeof stored === 'boolean') this.collapsed.set(stored);
      })
      .catch(() => {
        // Best-effort.
      });

    let firstRun = true;
    effect(() => {
      const value = this.collapsed();
      if (firstRun) {
        firstRun = false;
        return;
      }
      this.storage.set(WALL_BACKGROUND_COLLAPSED_KEY, value).catch(() => {
        // Best-effort.
      });
    });
  }

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  onEnabledChange(event: Event): void {
    this.wall.setEnabled((event.target as HTMLInputElement).checked);
  }

  onColorChange(event: Event): void {
    this.wall.setColor((event.target as HTMLInputElement).value);
  }

  onWidthChange(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value)) this.wall.setWidthMm(value);
  }

  onHeightChange(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value)) this.wall.setHeightMm(value);
  }

  /**
   * Memoised badge label — exposed for testability (so the spec can read
   * it without inspecting DOM internals). Returns "on" or "off".
   */
  readonly badge = computed<string>(() => (this.enabled() ? 'on' : 'off'));
}
