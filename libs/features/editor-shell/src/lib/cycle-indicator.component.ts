// Minimal tank-cycling indicator. Plan Stage 13 F13.3 (editor path).
//
// A compact, read-only badge that sits beside the time slider and surfaces the
// chemistry the `PreviewChemistryService` computes for the current scene at the
// scrubbed preview week: the cycle stage (uncycled / cycling / cycled) plus the
// three nitrogen species. Scrubbing the time slider moves the chemistry through
// its cycle, so this badge updates live as the user drags — the F13.3
// acceptance surface.
//
// This is DELIBERATELY minimal: the full test-kit colour-chart readout (the
// classic API-master-kit panel) is F13.5. This badge just proves the cycle is
// wired to the preview-time axis + gives the user an at-a-glance signal.
//
// Hidden when the tank carries no bioload source (sourceN == 0) — an unstocked
// tank never cycles, so a "uncycled" badge there would be noise.

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { PreviewChemistryService } from './preview-chemistry.service';

@Component({
  selector: 'aquascape-cycle-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    @if (visible()) {
      <section
        class="cyc"
        [class.cyc--uncycled]="stage() === 'uncycled'"
        [class.cyc--cycling]="stage() === 'cycling'"
        [class.cyc--cycled]="stage() === 'cycled'"
        role="status"
        aria-live="polite"
        [attr.aria-label]="ariaLabel()"
      >
        <span class="cyc__stage">{{ stageLabel() }}</span>
        <dl class="cyc__readout" aria-hidden="true">
          <div><dt>NH₃</dt><dd>{{ fmt(ammonia()) }}</dd></div>
          <div><dt>NO₂</dt><dd>{{ fmt(nitrite()) }}</dd></div>
          <div><dt>NO₃</dt><dd>{{ fmt(nitrate()) }}</dd></div>
        </dl>
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .cyc {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 8px;
        border-radius: 6px;
        border: 1px solid var(--border);
        background: var(--surface);
        font-size: 12px;
        line-height: 1.2;
      }
      .cyc__stage {
        font-weight: 600;
        text-transform: capitalize;
        padding: 2px 8px;
        border-radius: 999px;
        white-space: nowrap;
      }
      .cyc--uncycled .cyc__stage {
        background: rgba(150, 150, 150, 0.18);
        color: var(--text-muted, #888);
      }
      .cyc--cycling .cyc__stage {
        background: rgba(255, 180, 60, 0.2);
        color: #c47d12;
      }
      .cyc--cycled .cyc__stage {
        background: rgba(120, 220, 140, 0.2);
        color: #2f9e54;
      }
      .cyc__readout {
        display: flex;
        gap: 8px;
        margin: 0;
      }
      .cyc__readout div {
        display: flex;
        gap: 3px;
        align-items: baseline;
      }
      .cyc__readout dt {
        opacity: 0.6;
        font-size: 11px;
      }
      .cyc__readout dd {
        margin: 0;
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class CycleIndicatorComponent {
  private readonly chem = inject(PreviewChemistryService);

  private readonly snapshot = computed(() => this.chem.chemistry());

  /** Only show once the tank actually has a bioload source (stocked). */
  readonly visible = computed(() => this.snapshot().sourceN > 0);

  readonly stage = computed(() => this.snapshot().cycle);
  readonly ammonia = computed(() => this.snapshot().state.ammonia);
  readonly nitrite = computed(() => this.snapshot().state.nitrite);
  readonly nitrate = computed(() => this.snapshot().state.nitrate);

  readonly stageLabel = computed(() => {
    switch (this.stage()) {
      case 'uncycled':
        return 'Uncycled';
      case 'cycling':
        return 'Cycling';
      case 'cycled':
        return 'Cycled';
    }
  });

  readonly ariaLabel = computed(() => {
    const s = this.snapshot();
    return (
      `Tank cycle: ${s.cycle}. Ammonia ${this.fmt(s.state.ammonia)}, ` +
      `nitrite ${this.fmt(s.state.nitrite)}, nitrate ${this.fmt(s.state.nitrate)} milligrams per litre.`
    );
  });

  /** Format a mg/L concentration to 2 dp for the compact readout. */
  fmt(value: number): string {
    if (!Number.isFinite(value)) return '0';
    return (Math.round(value * 100) / 100).toFixed(2);
  }
}
