// Day-night cycle scrubber. Stage 11 F11.7 Wave 5.
//
// Sidebar accordion section with a single phase slider + a three-button
// mode radiogroup ("Manual" / "Real-time" / "Equipment"). Both drive
// `DayNightService` — slider input calls `setPhase`, mode-button click
// calls `setMode`. The renderer (`Three3DRenderer` via apps/web's render
// wiring in Wave 3) reads `service.lookup()` per render, so the user sees
// the tank's ambient + background + plant emissive shift live as they
// scrub.
//
// Why a sidebar panel rather than a toolbar dial?
//   * Three input affordances (slider + 3 radios + future schedule UI)
//     don't fit a toolbar pill.
//   * Mirrors the "view-only renderer dial" pattern the user already
//     knows from Composition / Snap / Wall / Backdrop — same header /
//     chevron / collapsed-state convention; same storage-backed
//     persistence under `aquascape.ui.collapsed.day-night`.
//
// Visible in 2D too — even though the 2D renderer ignores `lookup()` in
// v1, hiding the panel based on view mode would teach the user that
// day-night is mode-conditional, which it isn't (it's a property of the
// scene the renderer chooses whether to honour). When 2D learns to read
// the lookup later, no UI change is required.
//
// PHASE LABEL FORMAT
// ------------------
// Four named keypoints — midnight / dawn / noon / dusk — bracket the
// cycle the user already knows. Between keypoints we fall back to
// `HH:MM` so a user scrubbing into "11:30" sees an unambiguous wall-
// clock readout. The keypoint band is ±0.02 (≈29 min) wide so a casual
// scrub lands on the label without needing pixel-perfect aim.

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

import { DayNightService, type DayNightMode } from './day-night.service';

/** StorageService key for the collapsed-state flag. */
export const DAY_NIGHT_CONTROL_COLLAPSED_KEY = 'aquascape.ui.collapsed.day-night';

/** Half-width of the band that snaps to a named keypoint label. */
const KEYPOINT_BAND = 0.02;

interface ModeOption {
  readonly value: DayNightMode;
  readonly label: string;
}

@Component({
  selector: 'aquascape-day-night-control',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="day-night-control" aria-labelledby="day-night-heading">
      <header class="panel-header">
        <button
          type="button"
          class="panel-header__toggle"
          [attr.aria-expanded]="!collapsed()"
          aria-controls="day-night-body"
          (click)="toggleCollapsed()"
        >
          <span
            class="panel-header__chevron"
            [class.panel-header__chevron--open]="!collapsed()"
            aria-hidden="true"
            >›</span
          >
          <h2 id="day-night-heading" class="panel-header__title">Day / Night</h2>
          <span class="panel-header__count" aria-label="current day-night phase">
            {{ phaseLabel() }}
          </span>
        </button>
      </header>

      <div id="day-night-body" class="day-night-control__body" [hidden]="collapsed()">
        <p class="day-night-control__hint">
          Scrub the cycle to preview the tank under different lighting. Not saved
          with the document.
        </p>

        <label class="day-night-control__field day-night-control__field--phase">
          <span class="day-night-control__field-label">Phase</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            [value]="phase()"
            (input)="onPhaseInput($event)"
            aria-label="Day-night phase: 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk"
          />
          <span class="day-night-control__readout" aria-live="polite">
            {{ phaseLabel() }}
          </span>
        </label>

        <fieldset
          class="day-night-control__fieldset"
          role="radiogroup"
          aria-label="Day-night mode"
        >
          <legend class="visually-hidden">Day-night mode</legend>
          @for (opt of modeOptions; track opt.value) {
            <button
              type="button"
              role="radio"
              class="day-night-control__mode"
              [class.is-active]="mode() === opt.value"
              [attr.aria-checked]="mode() === opt.value"
              (click)="onModeClick(opt.value)"
            >
              {{ opt.label }}
            </button>
          }
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
      .day-night-control__hint {
        margin: 0 0 8px;
        color: var(--text-muted, #777);
        font-size: 11px;
        font-style: italic;
      }
      .day-night-control__field {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        border-radius: 4px;
      }
      .day-night-control__field--phase {
        flex-direction: column;
        align-items: stretch;
        gap: 4px;
      }
      .day-night-control__field-label {
        font-size: 11px;
        color: var(--text-muted, #777);
      }
      .day-night-control__field input[type='range'] {
        width: 100%;
        margin: 0;
      }
      .day-night-control__readout {
        align-self: flex-end;
        font-variant-numeric: tabular-nums;
        font-size: 11px;
        color: var(--text-muted, #777);
      }
      .day-night-control__fieldset {
        display: flex;
        gap: 4px;
        margin: 8px 0 0;
        padding: 0;
        border: 0;
      }
      .day-night-control__mode {
        flex: 1;
        padding: 4px 6px;
        background: transparent;
        color: inherit;
        border: 1px solid var(--border, #d0d4dc);
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
      }
      .day-night-control__mode:hover,
      .day-night-control__mode:focus-visible {
        background: var(--surface-hover, #f0f0f0);
        outline: none;
      }
      .day-night-control__mode.is-active {
        background: var(--accent, #0891b2);
        color: var(--accent-text, #ffffff);
        border-color: var(--accent, #0891b2);
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
export class DayNightControlComponent {
  private readonly service = inject(DayNightService);
  private readonly storage = inject<StorageService>(STORAGE_SERVICE);

  readonly phase = this.service.phase;
  readonly mode = this.service.mode;

  /** Static option table for the mode radiogroup. */
  readonly modeOptions: readonly ModeOption[] = [
    { value: 'manual', label: 'Manual' },
    { value: 'real-time', label: 'Real-time' },
    { value: 'equipment', label: 'Equipment' },
  ];

  /**
   * Human-readable phase label. Snaps to "midnight" / "dawn" / "noon" /
   * "dusk" inside a ±KEYPOINT_BAND window of each keypoint; otherwise
   * falls back to "HH:MM" in 24h time. Computed once per phase change.
   */
  readonly phaseLabel = computed<string>(() => formatPhase(this.phase()));

  readonly collapsed = signal<boolean>(false);

  constructor() {
    this.storage
      .get<boolean>(DAY_NIGHT_CONTROL_COLLAPSED_KEY)
      .then((stored) => {
        if (typeof stored === 'boolean') {
          this.collapsed.set(stored);
        }
      })
      .catch(() => {
        // Best-effort.
      });

    // Persist collapsed flips. Same firstRun-guard shape every other
    // per-panel accordion in this lib uses (composition-overlays,
    // snap-settings, wall-background, backdrop-panel).
    let firstRun = true;
    effect(() => {
      const value = this.collapsed();
      if (firstRun) {
        firstRun = false;
        return;
      }
      this.storage.set(DAY_NIGHT_CONTROL_COLLAPSED_KEY, value).catch(() => {
        // Best-effort.
      });
    });
  }

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  onPhaseInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = Number(raw);
    // Guard against the rare NaN from a non-numeric input value (the type=
    // range guarantees a number in normal browsers, but Playwright /
    // headless drivers can `fill('')`). setPhase wraps; we just gate on
    // NaN here so we don't pollute the signal with it.
    if (!Number.isFinite(value)) return;
    this.service.setPhase(value);
  }

  onModeClick(mode: DayNightMode): void {
    this.service.setMode(mode);
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Format a phase in [0, 1) as a human label. Inside a ±KEYPOINT_BAND
 * window of any of the four named keypoints we return the keyword so
 * scrubbing past noon shows "noon" rather than "12:00"; otherwise we
 * return "HH:MM" so the reader can tell the precise time.
 *
 * Pure helper — exported only for the spec. The component reads it
 * through the `phaseLabel` computed.
 */
export function formatPhase(p: number): string {
  if (Math.abs(p - 0.0) < KEYPOINT_BAND || Math.abs(p - 1.0) < KEYPOINT_BAND) return 'midnight';
  if (Math.abs(p - 0.25) < KEYPOINT_BAND) return 'dawn';
  if (Math.abs(p - 0.5) < KEYPOINT_BAND) return 'noon';
  if (Math.abs(p - 0.75) < KEYPOINT_BAND) return 'dusk';
  const totalMin = Math.round(p * 24 * 60);
  const h = Math.floor(totalMin / 60)
    .toString()
    .padStart(2, '0');
  const m = (totalMin % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}
