// Simulation-mode control HUD (top-left). Stage "app modes".
//
// An interactive panel shown alongside the read-only spec HUD while the
// showcase runs. It mutates the LIVE scene through the normal NgRx + Command
// pipeline (`SceneActions.dispatchCommand`), so the 3D renderer and the
// livestock simulation react exactly as they would in the editor:
//
//   * Lighting — drive the day/night phase (DayNightService).
//   * Water level — SetWaterLevel command.
//   * Livestock — add a species, step quantity up/down, remove (the sim
//     re-spawns deterministically from the new counts).
//   * Items — drop a random rock / wood / plant / decor into the tank.
//   * Reset — reload the pristine showcase scene.
//
// It takes the live `scene` as an input (the host keeps it in sync with the
// store) and is otherwise self-contained.

import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';

import { coreCatalog } from '@aquascape/domain/catalog';
import {
  removeLivestockEntry,
  setWaterLevel,
  updateLivestockQuantity,
  effectiveWaterLevelMm,
  type Scene,
} from '@aquascape/domain/scene-model';
import { DayNightService } from '@aquascape/features/editor-shell';
import { SceneActions } from '@aquascape/state';

import {
  addRandomItem,
  addSpecies as addSpeciesOp,
  NAME_BY_ID,
  uuid,
  type ItemKind,
} from './simulation-scene-ops';
import { createShowcaseScene } from './showcase-scene';

/** Smallest authored water level we let the slider reach (mm). */
const MIN_WATER_MM = 40;

interface LivestockRow {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
}

interface SpeciesOption {
  readonly id: string;
  readonly name: string;
}

@Component({
  selector: 'aquascape-simulation-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tank(); as tank) {
      <section class="sim-controls" aria-label="Scene controls">
        <header class="sim-controls__head">
          <span class="sim-controls__badge">Controls</span>
        </header>

        <div class="sim-controls__group">
          <label class="sim-controls__label" for="demo-light">
            Lighting <span class="sim-controls__val">{{ phaseLabel() }}</span>
          </label>
          <input
            id="demo-light"
            type="range"
            min="0"
            max="0.999"
            step="0.01"
            [value]="dayNight.phase()"
            (input)="onPhase($event)"
            aria-label="Day/night phase"
          />
        </div>

        <div class="sim-controls__group">
          <label class="sim-controls__label" for="demo-water">
            Water level <span class="sim-controls__val">{{ waterMm() }} mm</span>
          </label>
          <input
            id="demo-water"
            type="range"
            [min]="minWater"
            [max]="tank.height"
            step="10"
            [value]="waterMm()"
            (input)="onWater($event)"
            aria-label="Water level in millimetres"
          />
        </div>

        <div class="sim-controls__group">
          <div class="sim-controls__group-title">Livestock</div>
          <ul class="sim-controls__list">
            @for (row of livestockRows(); track row.id) {
              <li class="sim-controls__row">
                <span class="sim-controls__name" [title]="row.name">{{ row.name }}</span>
                <span class="sim-controls__stepper">
                  <button
                    type="button"
                    [attr.aria-label]="'Remove one ' + row.name"
                    (click)="stepQuantity(row, -1)"
                  >
                    −
                  </button>
                  <span class="sim-controls__qty">{{ row.quantity }}</span>
                  <button
                    type="button"
                    [attr.aria-label]="'Add one ' + row.name"
                    (click)="stepQuantity(row, 1)"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    class="sim-controls__remove"
                    [attr.aria-label]="'Remove all ' + row.name"
                    (click)="removeSpecies(row)"
                  >
                    ✕
                  </button>
                </span>
              </li>
            } @empty {
              <li class="sim-controls__empty">No livestock</li>
            }
          </ul>
          <div class="sim-controls__add">
            <select #species aria-label="Species to add">
              @for (opt of speciesOptions; track opt.id) {
                <option [value]="opt.id">{{ opt.name }}</option>
              }
            </select>
            <button type="button" (click)="addSpecies(species.value)">Add</button>
          </div>
        </div>

        <div class="sim-controls__group">
          <div class="sim-controls__group-title">Add items</div>
          <div class="sim-controls__items">
            <button type="button" (click)="addItem('rock')">+ Rock</button>
            <button type="button" (click)="addItem('wood')">+ Wood</button>
            <button type="button" (click)="addItem('plant')">+ Plant</button>
            <button type="button" (click)="addItem('decor')">+ Decor</button>
          </div>
        </div>

        <button type="button" class="sim-controls__reset" (click)="reset()">Reset scene</button>
      </section>
    }
  `,
  styles: [
    `
      :host {
        position: absolute;
        top: 16px;
        left: 16px;
        z-index: 6;
        pointer-events: none;
        max-width: 270px;
      }
      .sim-controls {
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px 16px;
        max-height: calc(100vh - 32px);
        overflow-y: auto;
        background: rgba(10, 16, 22, 0.72);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(120, 200, 230, 0.28);
        border-radius: 12px;
        color: #eaf4f8;
        font-size: 12px;
        line-height: 1.4;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
      }
      .sim-controls__badge {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(90, 200, 240, 0.18);
        color: #9fe0f5;
        border: 1px solid rgba(120, 200, 230, 0.4);
      }
      .sim-controls__group {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }
      .sim-controls__group:first-of-type {
        border-top: none;
        padding-top: 0;
      }
      .sim-controls__group-title {
        font-weight: 600;
      }
      .sim-controls__label {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        opacity: 0.85;
      }
      .sim-controls__val {
        color: #9fe0f5;
        font-variant-numeric: tabular-nums;
      }
      input[type='range'] {
        width: 100%;
        accent-color: #5ac8f0;
        cursor: pointer;
      }
      .sim-controls__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
        max-height: 168px;
        overflow-y: auto;
      }
      .sim-controls__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .sim-controls__name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sim-controls__stepper {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        flex: none;
      }
      .sim-controls__qty {
        min-width: 22px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .sim-controls button {
        font: inherit;
        color: #eaf4f8;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 6px;
        padding: 2px 7px;
        cursor: pointer;
        line-height: 1.2;
      }
      .sim-controls button:hover {
        background: rgba(120, 200, 230, 0.22);
      }
      .sim-controls__remove {
        color: #ff9a9a !important;
      }
      .sim-controls__empty {
        opacity: 0.5;
      }
      .sim-controls__add {
        display: flex;
        gap: 6px;
      }
      .sim-controls__add select {
        flex: 1 1 auto;
        min-width: 0;
        font: inherit;
        color: #eaf4f8;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 6px;
        padding: 2px 4px;
      }
      .sim-controls__items {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      .sim-controls__reset {
        margin-top: 2px;
      }
    `,
  ],
})
export class SimulationControlsComponent {
  private readonly store = inject(Store);
  readonly dayNight = inject(DayNightService);

  private readonly sceneSig = signal<Scene | null>(null);

  /** Live scene to read current values from. The host keeps it in sync. */
  @Input() set scene(value: Scene | null) {
    this.sceneSig.set(value);
  }

  readonly minWater = MIN_WATER_MM;

  /** Species pickable in the "add" dropdown. */
  readonly speciesOptions: readonly SpeciesOption[] = coreCatalog
    .byKind('livestock')
    .map((e) => ({ id: e.id, name: e.name }));

  readonly tank = computed(() => this.sceneSig()?.tank ?? null);

  readonly waterMm = computed(() => {
    const tank = this.tank();
    return tank === null ? 0 : effectiveWaterLevelMm(tank);
  });

  readonly livestockRows = computed<LivestockRow[]>(() =>
    (this.sceneSig()?.livestock ?? []).map((l) => ({
      id: l.id,
      name: NAME_BY_ID.get(l.ref.id) ?? l.ref.id,
      quantity: l.quantity,
    })),
  );

  /** Coarse day-phase label for the lighting slider. */
  readonly phaseLabel = computed(() => {
    const p = this.dayNight.phase();
    if (p < 0.2 || p >= 0.85) return 'Night';
    if (p < 0.35) return 'Dawn';
    if (p < 0.65) return 'Day';
    return 'Dusk';
  });

  // ── Lighting ─────────────────────────────────────────────────────────────

  onPhase(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.dayNight.setMode('manual');
    this.dayNight.setPhase(value);
  }

  // ── Water level ──────────────────────────────────────────────────────────

  onWater(event: Event): void {
    const tank = this.tank();
    if (tank === null) return;
    const value = Number((event.target as HTMLInputElement).value);
    const clamped = Math.min(tank.height, Math.max(MIN_WATER_MM, value));
    this.dispatch(setWaterLevel(clamped));
  }

  // ── Livestock ────────────────────────────────────────────────────────────

  stepQuantity(row: LivestockRow, delta: number): void {
    const next = row.quantity + delta;
    if (next < 1) {
      this.removeSpecies(row);
      return;
    }
    this.dispatch(updateLivestockQuantity(row.id, next));
  }

  removeSpecies(row: LivestockRow): void {
    this.dispatch(removeLivestockEntry(row.id));
  }

  addSpecies(catalogId: string): void {
    const entry = this.speciesOptions.find((o) => o.id === catalogId) ?? this.speciesOptions[0];
    if (entry === undefined) return;
    addSpeciesOp(this.store, entry.id, 5, uuid);
  }

  // ── Items ────────────────────────────────────────────────────────────────

  addItem(kind: ItemKind): void {
    const scene = this.sceneSig();
    if (scene === null) return;
    addRandomItem(this.store, scene, kind);
  }

  // ── Reset ────────────────────────────────────────────────────────────────

  reset(): void {
    this.store.dispatch(SceneActions.setScene({ scene: createShowcaseScene() }));
  }

  private dispatch(command: Parameters<typeof SceneActions.dispatchCommand>[0]['command']): void {
    this.store.dispatch(SceneActions.dispatchCommand({ command }));
  }
}
