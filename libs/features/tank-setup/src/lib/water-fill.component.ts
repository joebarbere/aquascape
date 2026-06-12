// Water-fill subcontrol. Lets the user author `Tank.waterLevelMm` — the
// water-surface height above the interior floor — in either millimetres or
// US gallons (display-only conversion; canonical storage is ALWAYS integer
// mm, mirroring the dimension inputs' mm/cm/in convention).
//
// Standalone Angular component embedded inside `TankSetupComponent`, next
// to the dimension picker. It holds no document state: it reads the tank
// from the store, shows the EFFECTIVE level via `effectiveWaterLevelMm`
// (so an untouched document displays its default fill instead of an empty
// box), and dispatches `SceneActions.dispatchCommand(setWaterLevel(...))`
// on commit (blur / Enter) — never mutating the scene directly.
//
// Clamping contract: the domain command REJECTS out-of-range values rather
// than clamping, so the UI clamps user input to [1, tank.height] before
// dispatch. Gallons input converts → clamps → rounds → dispatches mm.
//
// The "Auto" button dispatches `setWaterLevel(null)`, clearing the authored
// value back to the derived default (`height − 25 mm`); a status badge
// indicates whether the current level is authored ("Custom") or derived
// ("Auto"). The button is disabled when already on the default so it can't
// generate no-op history entries.

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { effectiveWaterLevelMm, setWaterLevel } from '@aquascape/domain/scene-model';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';
import { SceneActions, selectTank } from '@aquascape/state';
import { Store } from '@ngrx/store';
import { signal } from '@angular/core';

import {
  WATER_FILL_UNIT_STORAGE_KEY,
  formatWaterFill,
  mmLevelToGallons,
  parseWaterFillToMm,
} from './units';
import type { WaterFillUnit } from './units';

/** UI-layer floor for the water level (mm). Matches the domain's lower bound. */
export const MIN_WATER_LEVEL_MM = 1;

@Component({
  selector: 'aquascape-water-fill',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './water-fill.component.html',
  styleUrls: ['./water-fill.component.css'],
})
export class WaterFillComponent {
  // ── DI ────────────────────────────────────────────────────────────────
  private readonly store = inject(Store);
  private readonly storage = inject<StorageService>(STORAGE_SERVICE);

  // ── Reactive store state ──────────────────────────────────────────────
  // NgRx store selects emit synchronously (BehaviorSubject-backed), so
  // `requireSync` gives us a non-undefined tank from first render.
  readonly tank = toSignal(this.store.select(selectTank), { requireSync: true });

  /** The water-fill display unit. Defaults to mm; restored from storage. */
  readonly unit = signal<WaterFillUnit>('mm');

  /** The level actually rendered: authored value clamped, else the default fill. */
  readonly effectiveMm = computed(() => effectiveWaterLevelMm(this.tank()));

  /** True when the document authors an explicit `waterLevelMm`. */
  readonly isAuthored = computed(() => this.tank().waterLevelMm !== undefined);

  /** Canonical display string for the effective level in the active unit. */
  readonly displayValue = computed(() =>
    formatWaterFill(this.effectiveMm(), this.unit(), this.tank().width, this.tank().depth),
  );

  /** Input `min` attribute in the active display unit. */
  readonly minDisplay = computed(() =>
    this.unit() === 'mm'
      ? `${MIN_WATER_LEVEL_MM}`
      : mmLevelToGallons(MIN_WATER_LEVEL_MM, this.tank().width, this.tank().depth).toFixed(1),
  );

  /** Input `max` attribute in the active display unit (a brim-full tank). */
  readonly maxDisplay = computed(() =>
    this.unit() === 'mm'
      ? `${this.tank().height}`
      : mmLevelToGallons(this.tank().height, this.tank().width, this.tank().depth).toFixed(1),
  );

  constructor() {
    // Restore the persisted unit. Best-effort — the control works in mm
    // regardless; the input simply re-formats once the value arrives.
    this.storage
      .get<WaterFillUnit>(WATER_FILL_UNIT_STORAGE_KEY)
      .then((stored) => {
        if (stored === 'mm' || stored === 'gal') {
          this.unit.set(stored);
        }
      })
      .catch(() => {
        // Swallow — storage failure shouldn't break the control.
      });
  }

  // ── Public template handlers ──────────────────────────────────────────

  /** Switch the display unit. Persists the choice best-effort. */
  setUnit(unit: WaterFillUnit): void {
    this.unit.set(unit);
    this.storage.set(WATER_FILL_UNIT_STORAGE_KEY, unit).catch(() => {
      // Best-effort.
    });
  }

  /**
   * Commit the typed value (blur / Enter). Parses in the active unit,
   * clamps to [1, tank.height] mm, rounds to integer mm, and dispatches
   * `setWaterLevel`. Invalid input reverts the field to the canonical
   * display; committing the already-authored value is a no-op.
   */
  commit(input: HTMLInputElement): void {
    const tank = this.tank();
    const parsed = parseWaterFillToMm(input.value, this.unit(), tank.width, tank.depth);
    if (parsed === null) {
      input.value = this.displayValue();
      return;
    }
    const clamped = Math.min(tank.height, Math.max(MIN_WATER_LEVEL_MM, parsed));
    // Reflect the clamped/rounded canonical value immediately — the store
    // round-trip only refreshes the binding when the signal value changes.
    input.value = formatWaterFill(clamped, this.unit(), tank.width, tank.depth);
    if (tank.waterLevelMm === clamped) return;
    this.store.dispatch(SceneActions.dispatchCommand({ command: setWaterLevel(clamped) }));
  }

  /** Enter commits without submitting any surrounding form. */
  onEnter(event: Event): void {
    event.preventDefault();
    this.commit(event.target as HTMLInputElement);
  }

  /** Return to the default fill by clearing the authored level. */
  setAuto(): void {
    if (!this.isAuthored()) return;
    this.store.dispatch(SceneActions.dispatchCommand({ command: setWaterLevel(null) }));
  }
}
