// Composition-overlay toggle panel. Stage 5 F5.3.
//
// Sidebar accordion section with three checkboxes — golden ratio, rule of
// thirds, focal points. Each writes through `OverlayOptionsService` and
// (via the renderer call site in apps/web) shows up immediately on the
// canvas. The whole panel collapses like the other tool panels and
// persists its collapsed state under `aquascape.ui.collapsed.composition-
// overlays`.
//
// Why a third "header count" badge?
//   - Matches the visual rhythm of the other accordion headers (substrate,
//     hardscape, planting). Shows "x/3 enabled" so the user can tell at a
//     glance whether any overlays are active before expanding the panel.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';

import { OverlayOptionsService } from './overlay-options.service';

/** StorageService key for the collapsed-state flag. */
export const COMPOSITION_OVERLAYS_COLLAPSED_KEY =
  'aquascape.ui.collapsed.composition-overlays';

@Component({
  selector: 'aquascape-composition-overlays',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="composition-overlays" aria-labelledby="composition-overlays-heading">
      <header class="panel-header">
        <button
          type="button"
          class="panel-header__toggle"
          [attr.aria-expanded]="!collapsed()"
          aria-controls="composition-overlays-body"
          (click)="toggleCollapsed()"
        >
          <span
            class="panel-header__chevron"
            [class.panel-header__chevron--open]="!collapsed()"
            aria-hidden="true"
            >›</span
          >
          <h2 id="composition-overlays-heading" class="panel-header__title">Composition</h2>
          <span class="panel-header__count" aria-label="overlays enabled">
            {{ enabledCount() }}/3
          </span>
        </button>
      </header>

      <div
        id="composition-overlays-body"
        class="composition-overlays__body"
        [hidden]="collapsed()"
      >
        <p class="composition-overlays__hint">
          View-only guides — not saved with the document.
        </p>

        <label class="composition-overlays__field">
          <input
            type="checkbox"
            [checked]="goldenRatio()"
            (change)="onGoldenChange($event)"
            aria-label="Golden ratio guide lines"
          />
          <span>Golden ratio</span>
        </label>

        <label class="composition-overlays__field">
          <input
            type="checkbox"
            [checked]="thirds()"
            (change)="onThirdsChange($event)"
            aria-label="Rule of thirds guide lines"
          />
          <span>Rule of thirds</span>
        </label>

        <label class="composition-overlays__field">
          <input
            type="checkbox"
            [checked]="focalPoints()"
            (change)="onFocalPointsChange($event)"
            aria-label="Golden-ratio focal point markers"
          />
          <span>Focal points</span>
        </label>
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
      .composition-overlays__hint {
        margin: 0 0 8px;
        color: var(--text-muted, #777);
        font-size: 11px;
        font-style: italic;
      }
      .composition-overlays__field {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        border-radius: 4px;
        cursor: pointer;
      }
      .composition-overlays__field:hover,
      .composition-overlays__field:focus-within {
        background: var(--surface-hover, #f0f0f0);
      }
      .composition-overlays__field input[type='checkbox'] {
        margin: 0;
      }
    `,
  ],
})
export class CompositionOverlaysComponent {
  private readonly overlays = inject(OverlayOptionsService);
  private readonly storage = inject<StorageService>(STORAGE_SERVICE);

  readonly goldenRatio = this.overlays.goldenRatio;
  readonly thirds = this.overlays.thirds;
  readonly focalPoints = this.overlays.focalPoints;

  readonly enabledCount = computed<number>(
    () => (this.goldenRatio() ? 1 : 0) + (this.thirds() ? 1 : 0) + (this.focalPoints() ? 1 : 0),
  );

  readonly collapsed = signal<boolean>(false);

  constructor() {
    this.storage
      .get<boolean>(COMPOSITION_OVERLAYS_COLLAPSED_KEY)
      .then((stored) => {
        if (typeof stored === 'boolean') {
          this.collapsed.set(stored);
        }
      })
      .catch(() => {
        // Best-effort.
      });

    // Persist collapsed flips. The `firstRun` guard skips the synchronous
    // initial dependency-registering invocation so we don't immediately
    // overwrite the hydrated value with the seeded `false`.
    let firstRun = true;
    effect(() => {
      const value = this.collapsed();
      if (firstRun) {
        firstRun = false;
        return;
      }
      this.storage.set(COMPOSITION_OVERLAYS_COLLAPSED_KEY, value).catch(() => {
        // Best-effort.
      });
    });
  }

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  onGoldenChange(event: Event): void {
    this.overlays.setGoldenRatio((event.target as HTMLInputElement).checked);
  }

  onThirdsChange(event: Event): void {
    this.overlays.setThirds((event.target as HTMLInputElement).checked);
  }

  onFocalPointsChange(event: Event): void {
    this.overlays.setFocalPoints((event.target as HTMLInputElement).checked);
  }
}
