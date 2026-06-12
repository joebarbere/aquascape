// Tank-setup feature component. F1.1 Phase B.
//
// Standalone Angular component. Dispatches into the scene store; never
// mutates the scene directly. The component holds three pieces of UI state:
//   1. A reactive form for custom dimensions (always kept in **mm** —
//      conversion happens on input/blur so dispatch is always integer mm).
//   2. The currently selected display unit (cm / in / mm), persisted via
//      `StorageService` under `tank-setup.units`.
//   3. **Two-step picker navigation state** (`view` + `activeBrand`) — pure
//      UI navigation, NOT persisted. Hydrated from the store's `presetRef`
//      on init so reopening a document drops the user back on the brand of
//      the active preset.
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
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { setTankDimensions } from '@aquascape/domain/scene-model';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';
import { SceneActions, selectTank, selectTankPresetRef } from '@aquascape/state';
import { Store } from '@ngrx/store';

import { TANK_PRESET_CATALOG, TANK_PRESET_VERSION, tankPresets } from './tank-presets';
import type { TankBrand, TankPreset } from './tank-presets';
import { TankStylingComponent } from './tank-styling.component';
import { WaterFillComponent } from './water-fill.component';
import { DISPLAY_UNIT_STORAGE_KEY, formatForDisplay, parseToMm } from './units';
import type { DisplayUnit } from './units';

/** StorageService key for the collapsed-state flag (Task A). */
export const TANK_SETUP_COLLAPSED_KEY = 'aquascape.ui.collapsed.tank-setup';

/** UI-layer dimension floor (mm). The domain layer allows down to > 0. */
export const MIN_DIM_MM = 100;
/** UI-layer dimension ceiling (mm). The domain layer allows up to 10 000. */
export const MAX_DIM_MM = 3_000;

/** Lower bound of the non-warning aspect-ratio band (W / H). */
export const ASPECT_MIN = 0.3;
/** Upper bound of the non-warning aspect-ratio band (W / H). */
export const ASPECT_MAX = 4.0;

/**
 * A brand "card" the user clicks in Step 1. `'Custom'` is the synthetic
 * 5th card; it has no preset count.
 */
export type BrandChoice = TankBrand | 'Custom';

/** Brand-card metadata used by the template. */
export interface BrandSummary {
  readonly brand: BrandChoice;
  /** Display label (currently the same as `brand`). */
  readonly label: string;
  /** Number of presets in this brand. `null` for `'Custom'`. */
  readonly count: number | null;
}

/** Tank-shape inference for the small chip on each size card. */
export type TankShape = 'Cube' | 'Long' | 'Shallow' | null;

/**
 * Infer a tank-shape chip from the integer-mm dimensions:
 *   - **Cube**: all three axes within 10% of one another.
 *   - **Long**: width ≥ 2× height.
 *   - **Shallow**: depth (front-back) > height (bottom-top).
 *   - Otherwise: no chip.
 *
 * Cube is checked first so a perfect cube doesn't accidentally read as
 * "shallow" through floating-point drift in the depth-vs-height test.
 */
export function inferTankShape(p: Pick<TankPreset, 'width' | 'height' | 'depth'>): TankShape {
  const dims = [p.width, p.height, p.depth];
  const max = Math.max(...dims);
  const min = Math.min(...dims);
  if (max - min <= 0.1 * max) return 'Cube';
  if (p.width >= 2 * p.height) return 'Long';
  if (p.depth > p.height) return 'Shallow';
  return null;
}

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

/** Ordered list of real brands; `'Custom'` is always appended last. */
const BRAND_ORDER: ReadonlyArray<TankBrand> = ['ADA', 'UNS', 'Waterbox', 'Standard'];

/**
 * Maximum side of the silhouette SVG painted on a size card, in CSS px.
 * Chosen to fit comfortably alongside the name/dimensions/chip stack at
 * 220 px min sidebar width without forcing horizontal overflow.
 */
export const MAX_SILHOUETTE_PX = 56;

@Component({
  selector: 'aquascape-tank-setup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, TankStylingComponent, WaterFillComponent],
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
  // Brand ordering is deliberate: ADA first (the historic baseline), then
  // UNS (the most-requested addition), then Waterbox, then US framed
  // standards. The groups are derived from `tankPresets` so adding a new
  // entry never requires also editing this list.
  readonly presetGroups: ReadonlyArray<{
    brand: TankPreset['brand'];
    items: ReadonlyArray<TankPreset>;
  }> = BRAND_ORDER.map((brand) => ({
    brand,
    items: tankPresets.filter((p) => p.brand === brand),
  })).filter((group) => group.items.length > 0);

  /**
   * Brand summaries powering the Step-1 picker grid. Always five entries
   * (four real brands + `'Custom'`); the count is the number of presets
   * for that brand, `null` for `'Custom'`.
   */
  readonly brandSummaries: ReadonlyArray<BrandSummary> = [
    ...this.presetGroups.map<BrandSummary>((g) => ({
      brand: g.brand,
      label: g.brand,
      count: g.items.length,
    })),
    { brand: 'Custom', label: 'Custom', count: null },
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

  /** Collapsed-panel state. Hydrated from StorageService on construct. */
  readonly collapsed = signal<boolean>(false);

  /**
   * Two-step picker view. `'brands'` shows the 5 big brand cards; `'sizes'`
   * shows the selected brand's size grid OR the custom form. Transient —
   * deliberately NOT persisted; the persisted state is the preset ref +
   * display unit + collapsed flag.
   */
  readonly view = signal<'brands' | 'sizes'>('brands');

  /**
   * The brand the user clicked into. `null` on first load with no preset.
   * Kept in sync with the store's `presetRef` so external picks (e.g.
   * opening a doc) land the user on the right brand.
   */
  readonly activeBrand = signal<BrandChoice | null>(null);

  /** Convenience derived view: the size-card list for `activeBrand`. */
  readonly activePresets = computed<ReadonlyArray<TankPreset>>(() => {
    const brand = this.activeBrand();
    if (brand === null || brand === 'Custom') return [];
    // `brand` is one of the four real `TankBrand`s; `presetGroups` covers
    // every brand with ≥ 1 preset (constructed from the same enum), so the
    // find always hits. The non-null assertion is paid back by every
    // call-site reading from a Step-2 view that the template only enters
    // when activeBrand is a real brand.
    return this.presetGroups.find((g) => g.brand === brand)!.items;
  });

  /**
   * Largest dimension across the active brand. Used to scale the size-card
   * silhouettes so the biggest tank fills the silhouette box and smaller
   * tanks shrink proportionally. Returns 1 as a divide-by-zero guard for
   * the "no brand picked" case; once a brand is picked it always contains
   * ≥ 1 preset with strictly-positive width/height.
   */
  readonly activeBrandMaxDim = computed<number>(() => {
    const presets = this.activePresets();
    if (presets.length === 0) return 1;
    // Branchless max-of-(width,height) across the brand. The two-line
    // version with separate `if` checks branch-explodes in coverage even
    // though no real preset in our catalog has height > width.
    return presets.reduce((acc, p) => Math.max(acc, p.width, p.height), 0);
  });

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  /** Switch to Step 2 for a given brand. Pure navigation; no dispatch. */
  pickBrand(brand: BrandChoice): void {
    this.activeBrand.set(brand);
    this.view.set('sizes');
  }

  /** Return to Step 1 from any Step-2 view. */
  backToBrands(): void {
    this.view.set('brands');
  }

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

    // Hydrate collapsed state (Task A). Failures non-fatal — panel stays open.
    this.storage
      .get<boolean>(TANK_SETUP_COLLAPSED_KEY)
      .then((stored) => {
        if (typeof stored === 'boolean') {
          this.collapsed.set(stored);
        }
      })
      .catch(() => {
        // Best-effort.
      });

    // Persist collapsed state on every change. `effect()` runs an initial
    // synchronous pass that we skip so the seeded `false` doesn't overwrite
    // the hydrate.
    let firstCollapseRun = true;
    effect(() => {
      const value = this.collapsed();
      if (firstCollapseRun) {
        firstCollapseRun = false;
        return;
      }
      this.storage.set(TANK_SETUP_COLLAPSED_KEY, value).catch(() => {
        // Best-effort.
      });
    });

    // Keep `activeBrand` in sync with the store's `presetRef`. On init this
    // also drops the user on the brand of the existing preset (the `view`
    // signal stays on 'brands' though — they get a one-click jump from the
    // highlighted card without being teleported past it).
    //
    // We subscribe directly to the store's BehaviorSubject (instead of
    // routing through `toSignal` + `effect`) so the initial value lands
    // SYNCHRONOUSLY during construction. `toSignal` defaults to
    // `requireSync: false` and returns `undefined` until the next tick,
    // which would race component tests asserting the active brand right
    // after construction.
    //
    // Setting presetRef → null does NOT clear `activeBrand` — once the
    // user has navigated into Custom (which clears the ref), we want to
    // keep them on Custom rather than jumping back to a blank Step 1.
    this.store
      .select(selectTankPresetRef)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ref) => {
        if (ref === null || ref === undefined) return;
        const matched = tankPresets.find((p) => p.id === ref.id);
        if (matched) {
          this.activeBrand.set(matched.brand);
        }
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
    // The form is constructed with all three controls in the constructor;
    // `get(axis)` for any of the three axis literals always returns a
    // non-null control. The non-null assertion lets us skip a defensive
    // branch that's impossible to exercise.
    const control = this.customForm.get(axis)!;
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

  /** Inferred shape chip (`'Cube' | 'Long' | 'Shallow' | null`) for a preset. */
  shapeChip(preset: TankPreset): TankShape {
    return inferTankShape(preset);
  }

  /**
   * Silhouette dimensions in CSS pixels for the SVG viewBox-less inline
   * render on each size card. Scaled so the biggest tank in the active
   * brand fills `MAX_SILHOUETTE_PX`; everything else shrinks proportionally
   * by `width / activeBrandMaxDim` and `height / activeBrandMaxDim`.
   */
  silhouetteDims(preset: TankPreset): { w: number; h: number } {
    const max = this.activeBrandMaxDim();
    return {
      w: Math.max(8, (preset.width / max) * MAX_SILHOUETTE_PX),
      h: Math.max(6, (preset.height / max) * MAX_SILHOUETTE_PX),
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private updateAspectWarning(): void {
    const value = this.customForm.value as CustomFormShape;
    if (value.width === null || value.height === null || value.width <= 0 || value.height <= 0) {
      this.aspectWarning.set(null);
      return;
    }
    const ratio = value.width / value.height;
    if (ratio < ASPECT_MIN || ratio > ASPECT_MAX) {
      this.aspectWarning.set(
        `Unusual width-to-height ratio (${ratio.toFixed(2)}). The tank can still be applied.`,
      );
    } else {
      this.aspectWarning.set(null);
    }
  }
}
