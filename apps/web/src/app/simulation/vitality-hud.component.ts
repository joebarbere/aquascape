// Stage 14 F14.3 — fish-vitality HUD + click-to-inspect.
//
// A read-only panel pinned to the LEFT-MIDDLE of the canvas in simulation
// mode. It surfaces the fish school's vitality straight from the live
// `WorldSnapshot.health` + `WorldSnapshot.hunger` slabs (F14.2), polled at
// ~12 Hz like the other simulation HUDs:
//
//   1. School aggregates — avg health, min health, % hungry (the pure
//      `computeVitalityAggregate` helper; "hungry" = hunger ≥
//      `HUNGRY_THRESHOLD`, the sim's feeding seek-threshold).
//   2. A selectable fish list — one row per fish (eid + archetype + a mini
//      health/hunger readout). Clicking (or Enter/Space) a row selects that
//      fish for the inspector.
//   3. The inspector — the selected fish's health hearts + hunger meter.
//
// PICKING DECISION (load-bearing — see the report + the simulation-mode guide)
// ---------------------------------------------------------------------------
// The 3D renderer's `hitTest` returns null (the 3D view is read-only — no
// selection or editing), and projecting snapshot world-positions to screen
// would need the live OrbitControls camera matrices, which the renderer does
// NOT expose to apps/web. So "click-to-inspect" is a SELECTABLE LIST, not a
// canvas raycast: deterministic, keyboard-operable, and built on the same
// snapshot-slab reads the behavior-debug overlay already uses. The inspector
// itself is camera-independent, so a future canvas-raycast picker (if the
// renderer ever exposes a project()) can feed the SAME `selectedEid` signal
// without touching the inspector.
//
// GAME-MODE REUSE SEAM
// --------------------
// The per-fish readout is a pure model (`fishVitalityAt` / `healthToHearts`
// in vitality-hud.model.ts). Stage 16's game mode can call `fishVitalityAt`
// for `world.getPlayerEntity()` and render the SAME hearts row for the
// player fish. The HUD already flags the player row (`isPlayer`) so the seam
// is visible today: a game HUD reuses the model + the hearts markup without
// re-deriving anything.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  NgZone,
  type OnDestroy,
  type OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';

import { FISH_ARCHETYPE, NO_ENTITY_REF } from '@aquascape/domain/livestock-ecs';

import { LivestockSimulationService } from '../livestock-simulation.service';
import {
  EMPTY_VITALITY,
  archetypeLabel,
  computeVitalityAggregate,
  fishVitalityAt,
  type FishVitality,
  type VitalityAggregate,
} from './vitality-hud.model';

/** Poll rate (ms). ~12 Hz — live without churning GC, like the perf strip. */
const REFRESH_INTERVAL_MS = 80;

/** Max fish rows in the selectable list before a "+N more" tail. The panel
 *  is a scroll-capped column; showing every fish in a 100+ school would
 *  defeat the at-a-glance triage purpose. */
const MAX_ROWS = 24;

/** Everything the polling tick collects from the live world in one read. */
interface VitalitySnapshot {
  readonly aggregate: VitalityAggregate;
  readonly rows: readonly FishVitality[];
  readonly more: number;
  /** Inspector readout for the selected fish, or null when none / gone. */
  readonly selected: FishVitality | null;
}

const EMPTY: VitalitySnapshot = {
  aggregate: EMPTY_VITALITY,
  rows: [],
  more: 0,
  selected: null,
};

@Component({
  selector: 'aquascape-vitality-hud',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <section class="vit" role="region" aria-label="Fish vitality">
        <header class="vit__head">
          <span class="vit__badge">Vitality</span>
          <h2 class="vit__title">School health</h2>
        </header>

        <dl class="vit__agg" role="group" aria-label="School vitality summary">
          <div
            class="vit__stat"
            [class.vit__stat--stressed]="agg().avgHealth < 0.67"
            [class.vit__stat--critical]="agg().avgHealth < 0.34"
          >
            <dt>Avg health</dt>
            <dd aria-label="Average health">{{ pct(agg().avgHealth) }}%</dd>
          </div>
          <div
            class="vit__stat"
            [class.vit__stat--stressed]="agg().minHealth < 0.67"
            [class.vit__stat--critical]="agg().minHealth < 0.34"
          >
            <dt>Min health</dt>
            <dd aria-label="Lowest health">{{ pct(agg().minHealth) }}%</dd>
          </div>
          <div class="vit__stat" [class.vit__stat--stressed]="agg().hungryFraction > 0.33">
            <dt>Hungry</dt>
            <dd aria-label="Percent hungry">{{ pct(agg().hungryFraction) }}%</dd>
          </div>
        </dl>

        <section class="vit__inspector" aria-live="polite" aria-label="Selected fish">
          @if (selected(); as f) {
            <h3 class="vit__insp-title">
              {{ f.isPlayer ? 'You' : '#' + f.eid }}
              <span class="vit__insp-arch">{{ label(f.archetype) }}</span>
            </h3>
            <div class="vit__hearts" role="img" [attr.aria-label]="heartsLabel(f)">
              @for (h of f.hearts; track $index) {
                <span class="vit__heart vit__heart--{{ h }}" aria-hidden="true">{{
                  heartGlyph(h)
                }}</span>
              }
            </div>
            <div class="vit__meter" role="group" aria-label="Hunger">
              <span class="vit__meter-label">Hunger</span>
              <div class="vit__meter-track" aria-hidden="true">
                <div class="vit__meter-fill" [style.width.%]="hungerPct(f.hunger)"></div>
              </div>
              <span class="vit__meter-val">{{ f.hungry ? 'hungry' : 'fed' }}</span>
            </div>
          } @else {
            <p class="vit__insp-empty">Select a fish to inspect.</p>
          }
        </section>

        <h3 class="vit__list-title" id="vit-list-label">Fish ({{ agg().count }})</h3>
        <ul class="vit__list" role="listbox" aria-labelledby="vit-list-label">
          @for (f of rows(); track f.eid) {
            <li role="presentation">
              <button
                type="button"
                class="vit__row"
                role="option"
                [class.vit__row--sel]="f.eid === selectedEid()"
                [class.vit__row--critical]="f.band === 'critical'"
                [attr.aria-selected]="f.eid === selectedEid()"
                [attr.aria-label]="rowLabel(f)"
                (click)="select(f.eid)"
              >
                <span class="vit__row-id">{{ f.isPlayer ? '★' : '#' + f.eid }}</span>
                <span class="vit__row-arch">{{ label(f.archetype) }}</span>
                <span class="vit__row-health vit__row-health--{{ f.band }}"
                  >{{ pct(f.health) }}%</span
                >
                @if (f.hungry) {
                  <span class="vit__row-hungry" aria-hidden="true">⚠</span>
                }
              </button>
            </li>
          }
          @if (more() > 0) {
            <li class="vit__more" role="presentation">… +{{ more() }} more</li>
          }
        </ul>
      </section>
    }
  `,
  styles: [
    `
      :host {
        position: absolute;
        top: 50%;
        left: 16px;
        transform: translateY(-50%);
        z-index: 6;
        pointer-events: none;
        max-width: 260px;
      }
      .vit {
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px 16px;
        max-height: calc(100vh - 120px);
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
      .vit__head {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .vit__badge {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(120, 230, 160, 0.18);
        color: #9fe7b6;
        border: 1px solid rgba(120, 220, 160, 0.4);
      }
      .vit__title {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
      }
      .vit__agg {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
        margin: 0;
      }
      .vit__stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        padding: 6px 4px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .vit__stat dt {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.6;
        order: 2;
      }
      .vit__stat dd {
        margin: 0;
        order: 1;
        font-size: 16px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: #9fe7b6;
        line-height: 1.1;
      }
      .vit__stat--stressed dd {
        color: #ffd166;
      }
      .vit__stat--critical dd {
        color: #ff7b72;
      }
      .vit__inspector {
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        padding-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-height: 56px;
      }
      .vit__insp-title {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        display: flex;
        gap: 8px;
        align-items: baseline;
      }
      .vit__insp-arch {
        opacity: 0.6;
        font-weight: 400;
        font-size: 11px;
      }
      .vit__hearts {
        display: flex;
        gap: 2px;
        font-size: 16px;
        line-height: 1;
      }
      .vit__heart--full {
        color: #ff6b81;
      }
      .vit__heart--half {
        color: #ff9aa8;
      }
      .vit__heart--empty {
        color: rgba(255, 255, 255, 0.22);
      }
      .vit__meter {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .vit__meter-label {
        opacity: 0.6;
        font-size: 10px;
        min-width: 44px;
      }
      .vit__meter-track {
        flex: 1;
        height: 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
      }
      .vit__meter-fill {
        height: 100%;
        background: linear-gradient(90deg, #6cc6ff, #ffb454);
      }
      .vit__meter-val {
        font-size: 10px;
        opacity: 0.75;
        min-width: 40px;
        text-align: right;
      }
      .vit__insp-empty {
        margin: 0;
        opacity: 0.55;
        font-style: italic;
      }
      .vit__list-title {
        margin: 0;
        font-size: 11px;
        font-weight: 600;
        opacity: 0.7;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        padding-top: 10px;
      }
      .vit__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .vit__row {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .vit__row:hover,
      .vit__row:focus-visible {
        background: rgba(255, 255, 255, 0.08);
        outline: none;
        border-color: rgba(120, 200, 230, 0.5);
      }
      .vit__row--sel {
        background: rgba(120, 200, 230, 0.18);
        border-color: rgba(120, 200, 230, 0.5);
      }
      .vit__row-id {
        min-width: 36px;
        color: #9fe0f5;
        font-variant-numeric: tabular-nums;
      }
      .vit__row-arch {
        flex: 1;
        opacity: 0.85;
      }
      .vit__row-health {
        font-variant-numeric: tabular-nums;
      }
      .vit__row-health--healthy {
        color: #9fe7b6;
      }
      .vit__row-health--stressed {
        color: #ffd166;
      }
      .vit__row-health--critical {
        color: #ff7b72;
      }
      .vit__row--critical {
        background: rgba(255, 123, 114, 0.08);
      }
      .vit__row-hungry {
        color: #ffb454;
      }
      .vit__more {
        opacity: 0.6;
        font-style: italic;
        padding: 2px 6px;
      }
    `,
  ],
})
export class VitalityHudComponent implements OnInit, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly livestockSim = inject(LivestockSimulationService);

  /** Snapshot written by the polling tick. */
  private readonly snap = signal<VitalitySnapshot>(EMPTY);

  /** The fish the user picked. `NO_ENTITY_REF` = nothing selected. The poll
   *  reads this so the inspector tracks the live values of the picked fish. */
  private readonly selectedEidSig = signal<number>(NO_ENTITY_REF);

  /** Visible only once a live world has fish — mirrors the behavior overlay's
   *  "narrate live behaviour, don't confirm an empty scene" rule. */
  readonly visible = computed(() => this.snap().aggregate.count > 0);

  readonly agg = computed(() => this.snap().aggregate);
  readonly rows = computed(() => this.snap().rows);
  readonly more = computed(() => this.snap().more);
  readonly selected = computed(() => this.snap().selected);
  readonly selectedEid = this.selectedEidSig.asReadonly();

  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    // Poll outside Angular so the timer doesn't churn change detection; the
    // signal write re-enters the zone, marking this OnPush component once
    // per refresh. Same pattern as `SimulationHudComponent` + the overlay.
    this.zone.runOutsideAngular(() => {
      this.intervalHandle = setInterval(() => {
        const next = this.collect();
        this.zone.run(() => this.snap.set(next));
      }, REFRESH_INTERVAL_MS);
    });
  }

  ngOnDestroy(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Select a fish for the inspector. Public — the list rows call it. */
  select(eid: number): void {
    this.selectedEidSig.set(eid);
    // Re-collect immediately so the inspector fills in without waiting for
    // the next poll (snappier than an 80 ms lag on click).
    this.snap.set(this.collect());
  }

  /**
   * Read the live world's snapshot into a `VitalitySnapshot`. Pure read —
   * never mutates the world. Returns `EMPTY` when no world is live (no
   * livestock, or the renderer hasn't materialised one yet), which keeps
   * `visible()` false. The selected-fish lookup walks the `ids` slab so a
   * selection survives across re-sorts of the pooled slab.
   */
  private collect(): VitalitySnapshot {
    const world = this.livestockSim.getWorld();
    if (world === null) return EMPTY;

    // `snapshot(0)` is the same read the renderer + overlay make — no new
    // bitECS scan cost. Slabs are pooled; we only read this frame.
    const s = world.snapshot(0);
    const n = s.entityCount;
    if (n === 0) return EMPTY;

    const playerEid = world.getPlayerEntity();
    const selectedEid = this.selectedEidSig();

    const aggregate = computeVitalityAggregate(s.health, s.hunger, n);

    const shown = Math.min(MAX_ROWS, n);
    const rows: FishVitality[] = [];
    let selected: FishVitality | null = null;
    for (let i = 0; i < n; i++) {
      const eid = s.ids[i] as number;
      const archetype = (s.archetype[i] as number | undefined) ?? FISH_ARCHETYPE.SLIM_TETRA;
      const health = s.health[i] ?? 0;
      const hunger = s.hunger[i] ?? 0;
      const fish = fishVitalityAt(eid, i, health, hunger, archetype, playerEid);
      if (i < shown) rows.push(fish);
      if (eid === selectedEid) selected = fish;
    }

    return { aggregate, rows, more: n - shown, selected };
  }

  // ── Template formatters (pure) ─────────────────────────────────────────

  /** Format a [0,1] fraction as an integer percent. */
  pct(fraction: number): number {
    return Math.round(fraction * 100);
  }

  /** Map a hunger value to a clamped [0,100] meter width (full at 1.0). */
  hungerPct(hunger: number): number {
    const v = hunger < 0 ? 0 : hunger > 1 ? 1 : hunger;
    return Math.round(v * 100);
  }

  label(archetype: number): string {
    return archetypeLabel(archetype);
  }

  heartGlyph(state: 'full' | 'half' | 'empty'): string {
    return state === 'full' ? '♥' : state === 'half' ? '♥' : '♡';
  }

  /** Accessible label for a fish's hearts row, e.g. "Health 80 percent". */
  heartsLabel(f: FishVitality): string {
    return `Health ${this.pct(f.health)} percent`;
  }

  /** Accessible label for a selectable fish row. */
  rowLabel(f: FishVitality): string {
    const who = f.isPlayer ? 'Player fish' : `Fish ${f.eid}`;
    const hungry = f.hungry ? ', hungry' : '';
    return `${who}, ${this.label(f.archetype)}, health ${this.pct(f.health)} percent${hungry}`;
  }
}
