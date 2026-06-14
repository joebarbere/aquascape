// Water test-kit readout + water-change action. Plan Stage 13 F13.5 (F13.5b).
//
// The classic colour-chart readout (ammonia / nitrite / nitrate / pH) surfaced
// in the EDITOR right rail as a collapsible accordion panel — same header /
// chevron / collapsed-state convention as Day/Night, Snap, Wall, Backdrop.
// Reads the chemistry the `PreviewChemistryService` projects for the current
// scene + preview week, maps each value to its band on the selected
// `water-test-kit`'s colour scale (the API Freshwater Master kit by default),
// and shows the value + swatch + a safe / caution / danger verdict.
//
// It also hosts the WATER-CHANGE action — a fraction selector (25 / 50 % presets
// + a custom slider) and an "Apply" button that dispatches the undoable
// `WaterChange` Command through the normal NgRx pipeline (mutating
// `Tank.waterChemistry`). The sibling simulation HUD does the same plus a live
// runtime dilution (WaterChemistryService.applyWaterChange). The persisted /
// editor path is the command; the live path reuses the same pure helper.

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Store } from '@ngrx/store';

import { coreCatalog, type WaterTestKitEntry } from '@aquascape/domain/catalog';
import { waterChange, type Scene } from '@aquascape/domain/scene-model';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';
import { SceneActions, selectScene } from '@aquascape/state';

import { PreviewChemistryService } from './preview-chemistry.service';
import { buildPanelReadout, parameterLabel, type TestKitBand } from './water-test-kit';

/** StorageService key persisting the panel's collapsed state. */
export const TEST_KIT_READOUT_COLLAPSED_KEY = 'aquascape.ui.collapsed.test-kit';

/** Default kit when the user hasn't picked one — the ubiquitous API master kit. */
export const DEFAULT_TEST_KIT_ID = 'water-test-kit.api.freshwater-master';

/** Water-change fraction presets surfaced as quick buttons. */
const PRESET_FRACTIONS = [0.25, 0.5] as const;

@Component({
  selector: 'aquascape-test-kit-readout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tk" aria-labelledby="test-kit-heading">
      <header class="panel-header">
        <button
          type="button"
          class="panel-header__toggle"
          [attr.aria-expanded]="!collapsed()"
          aria-controls="test-kit-body"
          (click)="toggleCollapsed()"
        >
          <span
            class="panel-header__chevron"
            [class.panel-header__chevron--open]="!collapsed()"
            aria-hidden="true"
            >›</span
          >
          <h2 id="test-kit-heading" class="panel-header__title">Water test</h2>
          @if (visible()) {
            <span class="panel-header__count" aria-label="tank cycle stage">
              {{ stageLabel() }}
            </span>
          }
        </button>
      </header>

      <div id="test-kit-body" class="tk__body" [hidden]="collapsed()">
        <label class="tk__kit">
          <span class="tk__kit-label">Test kit</span>
          <select
            [value]="kitId()"
            (change)="onKit($any($event.target).value)"
            aria-label="Water test kit"
          >
            @for (kit of kits; track kit.id) {
              <option [value]="kit.id">{{ kit.name }}</option>
            }
          </select>
        </label>

        @if (visible()) {
          <table class="tk__chart">
            <caption class="tk__caption">
              Readout at week
              {{
                week()
              }}
              ({{
                stageLabel()
              }})
            </caption>
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                <th scope="col">Value</th>
                <th scope="col">Reading</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.parameter) {
                <tr class="tk__row tk__row--{{ row.band }}">
                  <th scope="row">{{ label(row.parameter) }}</th>
                  <td class="tk__value">{{ fmt(row.value) }} {{ unitLabel(row.unit) }}</td>
                  <td class="tk__reading">
                    <span
                      class="tk__swatch"
                      [style.background]="row.swatch"
                      aria-hidden="true"
                    ></span>
                    <span class="tk__band tk__band--{{ row.band }}">{{ bandLabel(row.band) }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <p class="tk__empty">Stock the tank to start tracking water chemistry.</p>
        }

        <div class="tk__change" role="group" aria-label="Water change">
          <div class="tk__change-title">Water change</div>
          <div class="tk__presets">
            @for (p of presets; track p) {
              <button
                type="button"
                class="tk__preset"
                [class.tk__preset--active]="fraction() === p"
                (click)="setFraction(p)"
                [attr.aria-pressed]="fraction() === p"
              >
                {{ pct(p) }}%
              </button>
            }
          </div>
          <label class="tk__slider-label" for="tk-change-frac">
            Replace <span class="tk__slider-val">{{ pct(fraction()) }}%</span>
          </label>
          <input
            id="tk-change-frac"
            type="range"
            min="5"
            max="90"
            step="5"
            [value]="pct(fraction())"
            (input)="onSlider($event)"
            aria-label="Water-change fraction (percent)"
          />
          <button type="button" class="tk__apply" [disabled]="!visible()" (click)="applyChange()">
            Change {{ pct(fraction()) }}% water
          </button>
          @if (status(); as s) {
            <p class="tk__status" role="status" aria-live="polite">{{ s }}</p>
          }
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
        text-transform: capitalize;
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--surface, #f1f1f3);
      }
      .tk__body {
        display: flex;
        flex-direction: column;
        gap: 10px;
        font-size: 12px;
      }
      .tk__kit {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .tk__kit-label {
        color: var(--text-muted, #777);
        font-size: 11px;
      }
      .tk__kit select {
        font: inherit;
        color: inherit;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 3px 5px;
      }
      .tk__chart {
        width: 100%;
        border-collapse: collapse;
      }
      .tk__caption {
        text-align: left;
        color: var(--text-muted, #777);
        font-size: 11px;
        margin-bottom: 4px;
      }
      .tk__chart th[scope='col'] {
        text-align: left;
        font-weight: 600;
        color: var(--text-muted, #777);
        font-size: 11px;
        padding-bottom: 3px;
      }
      .tk__chart th[scope='col']:not(:first-child),
      .tk__value,
      .tk__reading {
        text-align: right;
      }
      .tk__row th[scope='row'] {
        text-align: left;
        font-weight: 500;
        padding: 3px 0;
      }
      .tk__value {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .tk__reading {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        padding: 3px 0;
      }
      .tk__swatch {
        width: 16px;
        height: 16px;
        border-radius: 3px;
        border: 1px solid rgba(0, 0, 0, 0.25);
        flex: none;
      }
      .tk__band {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-weight: 600;
        min-width: 52px;
        text-align: center;
        padding: 1px 6px;
        border-radius: 999px;
      }
      .tk__band--safe {
        background: rgba(120, 220, 140, 0.2);
        color: #2f9e54;
      }
      .tk__band--caution {
        background: rgba(255, 180, 60, 0.22);
        color: #c47d12;
      }
      .tk__band--danger {
        background: rgba(230, 90, 90, 0.22);
        color: #cc3a3a;
      }
      .tk__empty {
        margin: 0;
        color: var(--text-muted, #777);
      }
      .tk__change {
        display: flex;
        flex-direction: column;
        gap: 6px;
        border-top: 1px solid var(--border);
        padding-top: 8px;
      }
      .tk__change-title {
        font-weight: 600;
      }
      .tk__presets {
        display: flex;
        gap: 6px;
      }
      .tk__preset {
        flex: 1;
        font: inherit;
        color: inherit;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 4px 0;
        cursor: pointer;
      }
      .tk__preset--active {
        background: rgba(90, 200, 240, 0.18);
        border-color: rgba(120, 200, 230, 0.6);
      }
      .tk__slider-label {
        display: flex;
        justify-content: space-between;
        color: var(--text-muted, #777);
      }
      .tk__slider-val {
        font-variant-numeric: tabular-nums;
      }
      input[type='range'] {
        width: 100%;
        accent-color: #5ac8f0;
        cursor: pointer;
      }
      .tk__apply {
        font: inherit;
        color: inherit;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 5px 0;
        cursor: pointer;
      }
      .tk__apply:hover:not(:disabled) {
        background: rgba(120, 200, 230, 0.18);
      }
      .tk__apply:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .tk__status {
        margin: 0;
        font-size: 11px;
        color: var(--text-muted, #777);
      }
    `,
  ],
})
export class TestKitReadoutComponent {
  private readonly chem = inject(PreviewChemistryService);
  private readonly store = inject(Store);
  private readonly storage = inject<StorageService>(STORAGE_SERVICE);
  private readonly sceneSig = this.store.selectSignal(selectScene);

  readonly presets = PRESET_FRACTIONS;

  /** Every water-test-kit in the catalog, for the picker. */
  readonly kits: readonly WaterTestKitEntry[] = coreCatalog.byKind('water-test-kit');

  /** Selected kit id (default = API master). */
  readonly kitId = signal<string>(
    this.kits.some((k) => k.id === DEFAULT_TEST_KIT_ID)
      ? DEFAULT_TEST_KIT_ID
      : (this.kits[0]?.id ?? ''),
  );

  /** Water-change fraction the action will apply, in (0, 1]. */
  readonly fraction = signal<number>(0.25);

  /** Last action feedback for the live region. */
  readonly status = signal<string>('');

  readonly collapsed = signal<boolean>(true);

  private readonly snapshot = computed(() => this.chem.chemistry());

  /** Show the readout once the tank actually has a bioload source (stocked). */
  readonly visible = computed(() => this.snapshot().sourceN > 0);

  readonly week = computed(() => Math.round(this.snapshot().week));
  readonly stageLabel = computed(() => this.snapshot().cycle);

  /** The selected kit (or null when the id resolves to nothing). */
  private readonly selectedKit = computed<WaterTestKitEntry | null>(
    () => this.kits.find((k) => k.id === this.kitId()) ?? null,
  );

  /** The four-row panel readout mapped through the selected kit's ranges. */
  readonly rows = computed<TestKitBand[]>(() => {
    const s = this.snapshot().state;
    const reads = this.selectedKit()?.reads ?? [];
    return buildPanelReadout(
      { ammonia: s.ammonia, nitrite: s.nitrite, nitrate: s.nitrate, ph: s.ph },
      reads,
    );
  });

  constructor() {
    this.storage
      .get<boolean>(TEST_KIT_READOUT_COLLAPSED_KEY)
      .then((stored) => {
        if (typeof stored === 'boolean') this.collapsed.set(stored);
      })
      .catch(() => {
        // Best-effort.
      });

    // Persist collapsed flips — same firstRun-guard every per-panel accordion
    // in this lib uses.
    let firstRun = true;
    effect(() => {
      const value = this.collapsed();
      if (firstRun) {
        firstRun = false;
        return;
      }
      this.storage.set(TEST_KIT_READOUT_COLLAPSED_KEY, value).catch(() => {
        // Best-effort.
      });
    });
  }

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  onKit(id: string): void {
    this.kitId.set(id);
  }

  setFraction(f: number): void {
    this.fraction.set(f);
  }

  onSlider(event: Event): void {
    const pct = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(pct)) this.fraction.set(Math.min(1, Math.max(0.01, pct / 100)));
  }

  /**
   * Dispatch the undoable `WaterChange` Command — the persisted/editor path.
   * Clean replacement water (default), so the change dilutes the dissolved
   * nitrogen toward zero. The renderer + the live cycle indicator follow the
   * new `Tank.waterChemistry`.
   */
  applyChange(): void {
    const scene: Scene | null = this.sceneSig();
    if (scene === null || scene.tank.waterChemistry === undefined) {
      this.status.set('No water chemistry to change yet.');
      return;
    }
    this.store.dispatch(SceneActions.dispatchCommand({ command: waterChange(this.fraction()) }));
    this.status.set(`Changed ${this.pct(this.fraction())}% of the water (undoable).`);
  }

  // ── formatting helpers ────────────────────────────────────────────────────

  label = parameterLabel;

  pct(f: number): number {
    return Math.round(f * 100);
  }

  fmt(value: number): string {
    if (!Number.isFinite(value)) return '0';
    return (Math.round(value * 100) / 100).toFixed(2);
  }

  unitLabel(unit: TestKitBand['unit']): string {
    switch (unit) {
      case 'ppm':
        return 'ppm';
      case 'dKH':
        return 'dKH';
      case 'dGH':
        return 'dGH';
      default:
        return '';
    }
  }

  bandLabel(band: TestKitBand['band']): string {
    switch (band) {
      case 'safe':
        return 'Safe';
      case 'caution':
        return 'Caution';
      case 'danger':
        return 'Danger';
    }
  }
}
