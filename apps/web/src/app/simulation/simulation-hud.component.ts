// Simulation-mode HUD. Stage "app modes".
//
// A read-only overlay pinned to the upper-right of the canvas while the app
// runs in the borderless-fullscreen showcase (`--mode simulation`). It lists the
// full spec of the displayed tank — dimensions, volume, hardscape/plant/decor
// counts, the livestock manifest with quantities, the equipment — plus a live
// performance strip (FPS / frame time / entity + bubble counts). Purely
// presentational: it owns no state, just a `scene` input (projected through
// `buildSimulationHudModel`) and a `metrics` input sampled by `SimulationPerfService`.

import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgZone,
  type OnDestroy,
  type OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';

import type { Scene } from '@aquascape/domain/scene-model';

import { formatClock } from './simulation-clock';
import { buildSimulationHudModel } from './simulation-hud.model';
import type { PerfMetrics } from './simulation-perf.service';
import { WaterChemistryService } from '../water-chemistry.service';

@Component({
  selector: 'aquascape-simulation-hud',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (vm(); as m) {
      <section class="sim-hud" role="complementary" aria-label="Tank details">
        @if (showClock) {
          <div class="sim-hud__clock" role="group" aria-label="Date and time">
            <time class="sim-hud__clock-time">{{ clock().time }}</time>
            <span class="sim-hud__clock-date">{{ clock().date }}</span>
          </div>
        }

        <header class="sim-hud__head">
          <span class="sim-hud__badge">Simulation</span>
          <h2 class="sim-hud__title">Aquascape</h2>
        </header>

        @if (showPerf) {
          <div class="sim-hud__perf" role="group" aria-label="Performance">
            <div class="sim-hud__stat" [class.sim-hud__stat--warn]="(metrics?.fps ?? 0) < 30">
              <span class="sim-hud__stat-val">{{ metrics?.fps ?? 0 }}</span>
              <span class="sim-hud__stat-label">fps</span>
            </div>
            <div class="sim-hud__stat">
              <span class="sim-hud__stat-val">{{ metrics?.frameMs ?? 0 }}</span>
              <span class="sim-hud__stat-label">ms/frame</span>
            </div>
            <div class="sim-hud__stat">
              <span class="sim-hud__stat-val">{{ metrics?.entities ?? 0 }}</span>
              <span class="sim-hud__stat-label">entities</span>
            </div>
            <div class="sim-hud__stat">
              <span class="sim-hud__stat-val">{{ metrics?.bubbles ?? 0 }}</span>
              <span class="sim-hud__stat-label">bubbles</span>
            </div>
          </div>
        }

        <dl class="sim-hud__grid">
          <dt>Tank</dt>
          <dd>{{ m.tankDimsMm }}</dd>
          <dt>Volume</dt>
          <dd>{{ m.volumeText }}</dd>
          <dt>Frame</dt>
          <dd>{{ m.frame }}</dd>
          <dt>Water line</dt>
          <dd>{{ m.waterLevelMm }} mm</dd>
          <dt>Substrate</dt>
          <dd>{{ m.substrate }}</dd>
          <dt>Composition</dt>
          <dd>
            {{ m.hardscapeCount }} hardscape · {{ m.plantCount }} plantings ·
            {{ m.decorCount }} decor · {{ m.layerCount }} layers
          </dd>
        </dl>

        <section class="sim-hud__block" aria-label="Water chemistry">
          <h3>
            Water chemistry
            <span
              class="sim-hud__cycle sim-hud__cycle--{{ chem().cycle }}"
              [attr.aria-label]="'Cycle stage ' + chem().cycle"
              >{{ chem().cycle }}</span
            >
          </h3>
          <dl class="sim-hud__grid">
            <dt>Ammonia</dt>
            <dd>{{ fmt(chem().state.ammonia) }} mg/L</dd>
            <dt>Nitrite</dt>
            <dd>{{ fmt(chem().state.nitrite) }} mg/L</dd>
            <dt>Nitrate</dt>
            <dd>{{ fmt(chem().state.nitrate) }} mg/L</dd>
            <dt>pH</dt>
            <dd>{{ fmt(chem().state.ph) }}</dd>
          </dl>
        </section>

        <section class="sim-hud__block" aria-label="Livestock">
          <h3>
            Livestock <span class="sim-hud__count">{{ m.livestockTotal }} individuals</span>
          </h3>
          <ul class="sim-hud__list">
            @for (row of m.livestock; track row.name) {
              <li>
                <span class="sim-hud__qty">{{ row.quantity }}×</span>
                <span class="sim-hud__name">{{ row.name }}</span>
              </li>
            }
          </ul>
        </section>

        <section class="sim-hud__block" aria-label="Equipment">
          <h3>Equipment</h3>
          <ul class="sim-hud__list sim-hud__list--plain">
            @for (item of m.equipment; track item) {
              <li>{{ item }}</li>
            }
          </ul>
        </section>

        <footer class="sim-hud__foot">
          <kbd class="sim-hud__kbd">Esc</kbd> to exit · seed {{ m.seed }}
        </footer>
      </section>
    }
  `,
  styles: [
    `
      :host {
        position: absolute;
        top: 16px;
        right: 16px;
        z-index: 6;
        pointer-events: none;
        max-width: 320px;
      }
      .sim-hud {
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px 18px;
        max-height: calc(100vh - 32px);
        overflow-y: auto;
        background: rgba(10, 16, 22, 0.72);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(120, 200, 230, 0.28);
        border-radius: 12px;
        color: #eaf4f8;
        font-size: 12px;
        line-height: 1.45;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
      }
      .sim-hud__clock {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 1px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      .sim-hud__clock-time {
        font-size: 26px;
        font-weight: 600;
        line-height: 1.05;
        letter-spacing: 0.01em;
        font-variant-numeric: tabular-nums;
        color: #f4fbfd;
      }
      .sim-hud__clock-date {
        font-size: 11px;
        opacity: 0.6;
      }
      .sim-hud__head {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .sim-hud__badge {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(90, 200, 240, 0.18);
        color: #9fe0f5;
        border: 1px solid rgba(120, 200, 230, 0.4);
      }
      .sim-hud__title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
      }
      .sim-hud__perf {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
      }
      .sim-hud__stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        padding: 6px 4px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .sim-hud__stat-val {
        font-size: 16px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: #9fe0f5;
        line-height: 1.1;
      }
      .sim-hud__stat--warn .sim-hud__stat-val {
        color: #ffb454;
      }
      .sim-hud__stat-label {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.6;
      }
      .sim-hud__grid {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 4px 12px;
        margin: 0;
      }
      .sim-hud__grid dt {
        opacity: 0.6;
        white-space: nowrap;
      }
      .sim-hud__grid dd {
        margin: 0;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .sim-hud__block h3 {
        margin: 0 0 6px;
        font-size: 12px;
        font-weight: 600;
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        padding-top: 10px;
      }
      .sim-hud__count {
        opacity: 0.6;
        font-weight: 400;
      }
      .sim-hud__cycle {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 1px 7px;
        border-radius: 999px;
        font-weight: 600;
      }
      .sim-hud__cycle--uncycled {
        background: rgba(150, 150, 150, 0.22);
        color: #c7d0d6;
      }
      .sim-hud__cycle--cycling {
        background: rgba(255, 180, 60, 0.22);
        color: #ffcd7a;
      }
      .sim-hud__cycle--cycled {
        background: rgba(120, 220, 140, 0.22);
        color: #9fe7b6;
      }
      .sim-hud__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .sim-hud__list li {
        display: flex;
        gap: 8px;
      }
      .sim-hud__list--plain li {
        opacity: 0.85;
      }
      .sim-hud__qty {
        min-width: 28px;
        text-align: right;
        color: #9fe0f5;
        font-variant-numeric: tabular-nums;
      }
      .sim-hud__name {
        opacity: 0.92;
      }
      .sim-hud__foot {
        opacity: 0.55;
        font-size: 10px;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .sim-hud__kbd {
        display: inline-block;
        padding: 1px 5px;
        border: 1px solid rgba(180, 220, 235, 0.45);
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.06);
        font-family: inherit;
        font-size: 9px;
        line-height: 1.4;
      }
    `,
  ],
})
export class SimulationHudComponent implements OnInit, OnDestroy {
  private readonly zone = inject(NgZone);
  // F13.3 — live water chemistry. The service owns the tick; we just read its
  // `live()` signal so the HUD reflects the running cycle.
  private readonly waterChemistry = inject(WaterChemistryService);

  private readonly sceneSig = signal<Scene | null>(null);

  /** Live chemistry (state + cycle stage) from the running chemistry tick. */
  readonly chem = this.waterChemistry.live;

  /** Format a concentration / pH value to 2 dp for the readout. */
  fmt(value: number): string {
    if (!Number.isFinite(value)) return '0';
    return (Math.round(value * 100) / 100).toFixed(2);
  }

  /** The scene whose spec the HUD displays. Null hides the panel. */
  @Input() set scene(value: Scene | null) {
    this.sceneSig.set(value);
  }

  /**
   * Live performance metrics (FPS / frame time / entity + bubble counts),
   * sampled by `SimulationPerfService` and pushed in by the host. A new object
   * reference each sample drives the OnPush re-render. Null until the first
   * sample lands.
   */
  @Input() metrics: PerfMetrics | null = null;

  /** Sub-element visibility, toggled from the console's `hud` command. */
  @Input() showClock = true;
  @Input() showPerf = true;

  readonly vm = computed(() => {
    const scene = this.sceneSig();
    return scene === null ? null : buildSimulationHudModel(scene);
  });

  /** Current wall-clock time, ticked once a second. */
  private readonly now = signal<Date>(new Date());

  /** Formatted `{ time, date }` derived from {@link now}. */
  readonly clock = computed(() => formatClock(this.now()));

  private clockTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    // Tick the clock once a second. The interval runs OUTSIDE Angular's zone
    // (so the timer itself doesn't churn change detection); we re-enter the
    // zone only for the per-second signal write, which marks this OnPush
    // component for re-render. Mirrors `SimulationPerfService`.
    this.zone.runOutsideAngular(() => {
      this.clockTimer = setInterval(() => {
        this.zone.run(() => this.now.set(new Date()));
      }, 1000);
    });
  }

  ngOnDestroy(): void {
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }
}
