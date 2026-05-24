// Tank-setup feature component. F1.1 Phase B.
//
// Standalone Angular component. Dispatches into the scene store; never
// mutates the scene directly. The component holds two pieces of UI state:
//   1. A reactive form for custom dimensions (always kept in **mm** —
//      conversion happens on input/blur so dispatch is always integer mm).
//   2. The currently selected display unit (cm / in / mm), persisted via
//      `StorageService` under `tank-setup.units`.
//
// Selecting a preset triggers two actions:
//   - `dispatchCommand(setTankDimensions(...))` — the structural edit.
//   - `setTankPresetRef({ presetRef: ... })` — the metadata side-edit.
//
// Submitting custom dimensions:
//   - `dispatchCommand(setTankDimensions(...))`
//   - `setTankPresetRef({ presetRef: null })` — clears the preset because
//     the dimensions no longer originate from one.
//
// Validation rules (UI-layer floor; the domain layer enforces the looser
// 0 < n ≤ 10_000 mm):
//   - 100 mm ≤ each axis ≤ 3_000 mm
//   - aspect-ratio warning (non-blocking) outside [0.3, 4.0] W/H
//   - aria-describedby links errors + the warning to the inputs

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { setTankDimensions } from '@aquascape/domain/scene-model';
import {
  STORAGE_SERVICE,
} from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';
import {
  SceneActions,
  selectTank,
  selectTankPresetRef,
} from '@aquascape/state';
import { Store } from '@ngrx/store';

import {
  TANK_PRESET_CATALOG,
  TANK_PRESET_VERSION,
  tankPresets,
} from './tank-presets';
import type { TankPreset } from './tank-presets';
import {
  DISPLAY_UNIT_STORAGE_KEY,
  formatForDisplay,
  parseToMm,
} from './units';
import type { DisplayUnit } from './units';

/** UI-layer dimension floor (mm). The domain layer allows down to > 0. */
export const MIN_DIM_MM = 100;
/** UI-layer dimension ceiling (mm). The domain layer allows up to 10 000. */
export const MAX_DIM_MM = 3_000;

/** Lower bound of the non-warning aspect-ratio band (W / H). */
export const ASPECT_MIN = 0.3;
/** Upper bound of the non-warning aspect-ratio band (W / H). */
export const ASPECT_MAX = 4.0;

interface CustomFormShape {
  width: number | null;
  height: number | null;
  depth: number | null;
}

interface DisplayBand {
  min: number;
  max: number;
}

/**
 * Display min/max for a given unit. Computed from `MIN_DIM_MM` /
 * `MAX_DIM_MM` so the UI and the validators are guaranteed consistent.
 */
function displayBand(unit: DisplayUnit): DisplayBand {
  switch (unit) {
    case 'mm':
      return { min: MIN_DIM_MM, max: MAX_DIM_MM };
    case 'cm':
      return { min: MIN_DIM_MM / 10, max: MAX_DIM_MM / 10 };
    case 'in':
      // Numbers chosen to match the published guideline ("min 4 in, max
      // 120 in"). Round to whole inches.
      return {
        min: Math.ceil(MIN_DIM_MM / 25.4), // 4 in (≈ 100 mm)
        max: Math.floor(MAX_DIM_MM / 25.4), // 118 in (≈ 3_000 mm)
      };
  }
}

@Component({
  selector: 'aquascape-tank-setup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './tank-setup.component.html',
  styleUrls: ['./tank-setup.component.css'],
})
export class TankSetupComponent {
  // ── DI ────────────────────────────────────────────────────────────────
  private readonly fb = inject(FormBuilder);
  private readonly store = inject(Store);
  private readonly storage = inject<StorageService>(STORAGE_SERVICE);
  private readonly destroyRef = inject(DestroyRef);

  // ── Constants exposed to the template ─────────────────────────────────
  readonly tankPresets: ReadonlyArray<TankPreset> = tankPresets;
  readonly presetGroups: ReadonlyArray<{
    brand: TankPreset['brand'];
    items: ReadonlyArray<TankPreset>;
  }> = [
    { brand: 'ADA', items: tankPresets.filter((p) => p.brand === 'ADA') },
    {
      brand: 'Standard',
      items: tankPresets.filter((p) => p.brand === 'Standard'),
    },
  ];
  readonly MIN_DIM_MM = MIN_DIM_MM;
  readonly MAX_DIM_MM = MAX_DIM_MM;
  readonly ASPECT_MIN = ASPECT_MIN;
  readonly ASPECT_MAX = ASPECT_MAX;

  // ── Reactive UI state ─────────────────────────────────────────────────
  // The form **always** stores integer mm internally. The cm / in conversion
  // happens on input handlers, so the underlying form value is canonical.
  readonly customForm: FormGroup = this.fb.group({
    width: this.fb.control<number | null>(null, [
      Validators.required,
      Validators.min(MIN_DIM_MM),
      Validators.max(MAX_DIM_MM),
    ]),
    height: this.fb.control<number | null>(null, [
      Validators.required,
      Validators.min(MIN_DIM_MM),
      Validators.max(MAX_DIM_MM),
    ]),
    depth: this.fb.control<number | null>(null, [
      Validators.required,
      Validators.min(MIN_DIM_MM),
      Validators.max(MAX_DIM_MM),
    ]),
  });

  /** Signal-projected view of the current tank from the store. */
  readonly tank = toSignal(this.store.select(selectTank));
  readonly presetRef = toSignal(this.store.select(selectTankPresetRef));

  /** The current display unit. Defaults to cm; restored from storage on init. */
  readonly displayUnit = signal<DisplayUnit>('cm');

  /** Current display-unit min/max for the inputs (driven by `displayUnit`). */
  readonly band = signal<DisplayBand>(displayBand('cm'));

  /** Aspect-ratio warning text or null when within band. Computed on change. */
  readonly aspectWarning = signal<string | null>(null);

  constructor() {
    // Restore the persisted display unit. Failures here are non-fatal — the
    // form still works in mm. We deliberately don't await before rendering;
    // the form simply re-formats once the value arrives.
    this.storage
      .get<DisplayUnit>(DISPLAY_UNIT_STORAGE_KEY)
      .then((stored) => {
        if (stored === 'cm' || stored === 'in' || stored === 'mm') {
          this.displayUnit.set(stored);
          this.band.set(displayBand(stored));
        }
      })
      .catch(() => {
        // Swallow — storage failure shouldn't break the form.
      });

    // Seed the form from the current tank, then keep it in sync with the
    // store while the component is alive.
    this.store
      .select(selectTank)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tank) => {
        // Don't clobber user input while they're actively editing a dirty
        // form. If the form is pristine, sync from the scene.
        if (this.customForm.pristine) {
          this.customForm.setValue(
            {
              width: tank.width,
              height: tank.height,
              depth: tank.depth,
            },
            { emitEvent: false },
          );
          this.updateAspectWarning();
        }
      });

    this.customForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateAspectWarning());
  }

  // ── Public template handlers ──────────────────────────────────────────

  /** Format a stored integer-mm value for display in the current unit. */
  display(mm: number | null): string {
    if (mm === null) return '';
    return formatForDisplay(mm, this.displayUnit());
  }

  /**
   * Handle a unit-toggle button press. Persists the choice via
   * `StorageService` (best-effort) and re-derives the display band.
   */
  setUnit(unit: DisplayUnit): void {
    this.displayUnit.set(unit);
    this.band.set(displayBand(unit));
    this.storage.set(DISPLAY_UNIT_STORAGE_KEY, unit).catch(() => {
      // Best-effort; storage failures shouldn't break the toggle.
    });
  }

  /**
   * Handle a numeric input for a dimension axis. Reads the displayed value,
   * converts it back to integer mm, and writes it into the form control.
   */
  onAxisInput(axis: 'width' | 'height' | 'depth', value: string): void {
    const mm = parseToMm(value, this.displayUnit());
    const control = this.customForm.get(axis);
    if (control === null) return;
    if (mm === null) {
      control.setValue(null);
    } else {
      control.setValue(mm);
    }
    control.markAsDirty();
    control.markAsTouched();
  }

  /** Pick a preset. Dispatches the structural edit + stamps `presetRef`. */
  selectPreset(preset: TankPreset): void {
    this.store.dispatch(
      SceneActions.dispatchCommand({
        command: setTankDimensions({
          width: preset.width,
          height: preset.height,
          depth: preset.depth,
        }),
      }),
    );
    this.store.dispatch(
      SceneActions.setTankPresetRef({
        presetRef: {
          catalog: TANK_PRESET_CATALOG,
          id: preset.id,
          version: TANK_PRESET_VERSION,
        },
      }),
    );
    // After a preset is chosen, the form becomes pristine again so the
    // store-sync subscription re-mirrors the new tank into it.
    this.customForm.markAsPristine();
  }

  /** Submit the custom-dimensions form. Clears any active `presetRef`. */
  applyCustom(): void {
    if (this.customForm.invalid) return;
    const value = this.customForm.value as CustomFormShape;
    if (value.width === null || value.height === null || value.depth === null) {
      return;
    }
    this.store.dispatch(
      SceneActions.dispatchCommand({
        command: setTankDimensions({
          width: value.width,
          height: value.height,
          depth: value.depth,
        }),
      }),
    );
    // User-typed dimensions break any active preset binding.
    this.store.dispatch(SceneActions.setTankPresetRef({ presetRef: null }));
    this.customForm.markAsPristine();
  }

  /** True if the currently selected preset id matches `id`. */
  isPresetActive(id: string): boolean {
    return this.presetRef()?.id === id;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private updateAspectWarning(): void {
    const value = this.customForm.value as CustomFormShape;
    if (
      value.width === null ||
      value.height === null ||
      value.width <= 0 ||
      value.height <= 0
    ) {
      this.aspectWarning.set(null);
      return;
    }
    const ratio = value.width / value.height;
    if (ratio < ASPECT_MIN || ratio > ASPECT_MAX) {
      this.aspectWarning.set(
        `Unusual width-to-height ratio (${ratio.toFixed(
          2,
        )}). The tank can still be applied.`,
      );
    } else {
      this.aspectWarning.set(null);
    }
  }

}
