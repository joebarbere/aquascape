// Time-slider toolbar. Plan Stage 4 F4.4.
//
// A horizontal slider that controls the preview age (in weeks) for all
// plants in the scene. Sliding to "Now" snaps to `null` (live mode); any
// other position sets a numeric preview age and the renderer paints plants
// scaled by their growth curve at that age.
//
// The slider does NOT mutate any document state — it only feeds the
// renderer's `previewAgeWeeks` parameter through the PreviewTimeService.
// That's the whole point: pressing play / scrubbing must not produce undo
// stack entries or autosave dirty markers.

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { PreviewTimeService } from './preview-time.service';

const MIN_WEEKS = 0;
const MAX_WEEKS = 52;
const STEP_WEEKS = 1;

@Component({
  selector: 'aquascape-time-slider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <section class="time-slider" aria-label="Preview growth">
      <button
        type="button"
        class="now"
        (click)="onResetToNow()"
        [class.active]="isLive()"
        aria-label="Reset to live (no preview)"
      >
        Now
      </button>
      <input
        type="range"
        [min]="min"
        [max]="max"
        [step]="step"
        [value]="sliderValue()"
        (input)="onInput($event)"
        aria-label="Preview age in weeks"
        [attr.aria-valuetext]="ariaText()"
      />
      <span class="label" aria-hidden="true">{{ label() }}</span>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .time-slider {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        background: #1e2228;
        color: #ddd;
        border-radius: 6px;
        font-size: 13px;
      }
      input[type='range'] {
        flex: 1;
      }
      .label {
        min-width: 4ch;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .now {
        background: #2c3038;
        color: inherit;
        border: 1px solid #3a3f48;
        border-radius: 4px;
        padding: 3px 8px;
        cursor: pointer;
        font: inherit;
      }
      .now:hover,
      .now:focus-visible {
        background: #3a3f48;
        outline: none;
      }
      .now.active {
        background: #3a8050;
        border-color: #3a8050;
      }
    `,
  ],
})
export class TimeSliderComponent {
  private readonly previewTime = inject(PreviewTimeService);

  readonly min = MIN_WEEKS;
  readonly max = MAX_WEEKS;
  readonly step = STEP_WEEKS;

  readonly isLive = computed(() => this.previewTime.previewAgeWeeks() === null);
  readonly sliderValue = computed(() => this.previewTime.previewAgeWeeks() ?? 0);

  readonly label = computed(() => {
    const v = this.previewTime.previewAgeWeeks();
    if (v === null) return 'Now';
    if (v === 0) return 'Week 0';
    return `Wk ${Math.round(v)}`;
  });

  readonly ariaText = computed(() => {
    const v = this.previewTime.previewAgeWeeks();
    return v === null ? 'Now' : `Week ${Math.round(v)}`;
  });

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (input === null) return;
    const value = Number.parseFloat(input.value);
    if (!Number.isFinite(value)) return;
    this.previewTime.setPreviewAge(value);
  }

  onResetToNow(): void {
    this.previewTime.reset();
  }
}
