// Preview-time water-chemistry service. Plan Stage 13 F13.3 (editor path).
//
// The editor sibling of the live `WaterChemistryService` (apps/web). Where the
// runtime service ticks chemistry forward off accumulated sim-time, THIS one
// evaluates the chemistry the tank WOULD reach after N weeks of cycling, driven
// by the `PreviewTimeService` week the user scrubs to — exactly how growth-sim
// previews plant size at a future age. Deterministic + pure-derived from the
// scene seed + stocking-derived source term (no clock, no random).
//
// It's a thin reactive wrapper: a `computed` signal folds the current scene
// (from the store) + the preview week into a `WaterState` + `CycleStage` via
// the framework-free `evaluateSceneChemistryAtWeek` helper. Nothing here
// mutates the document — like the time slider, scrubbing must never dirty the
// undo stack or autosave (the chemistry the editor SHOWS is a projection, not a
// persisted write). The persistent snapshot is `Tank.waterChemistry`, owned by
// save-time code; this service READS it as the starting state when present.
//
// Source term: `bioloadSourceN(scene, catalog)` — the SAME helper the live
// `WaterChemistryService` agrees with (a medium-class fish = the ECS per-fish
// baseline). So a tank previewed in the editor and the same tank ticked live
// in simulation mode tell a consistent cycling story.

import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { Catalog } from '@aquascape/domain/catalog';
import {
  bioloadSourceN,
  cycleProgress,
  evaluateSceneChemistryAtWeek,
  freshWaterState,
  type CycleStage,
  type WaterState,
} from '@aquascape/domain/water-sim';
import type { Scene } from '@aquascape/domain/scene-model';
import { selectScene } from '@aquascape/state';

import { PreviewTimeService } from './preview-time.service';

/** The chemistry the editor surfaces for the current scene + preview week. */
export interface PreviewChemistry {
  /** The evaluated water state at the preview week (or the live snapshot). */
  readonly state: WaterState;
  /** Denormalized cycle stage (`cycleProgress(state)`). */
  readonly cycle: CycleStage;
  /**
   * The week this chemistry was evaluated at — the preview-slider week, or the
   * persisted/initial age when the slider is in "Now" mode (null).
   */
  readonly week: number;
  /** The stocking-derived ammonia source term (mg-N/day) driving the cycle. */
  readonly sourceN: number;
}

/** Empty/inert chemistry shown when no scene is loaded. */
const EMPTY: PreviewChemistry = {
  state: freshWaterState(),
  cycle: 'uncycled',
  week: 0,
  sourceN: 0,
};

@Injectable({ providedIn: 'root' })
export class PreviewChemistryService {
  private readonly store = inject(Store);
  private readonly previewTime = inject(PreviewTimeService);

  /** Catalog used to resolve bioload class. Overridable for tests. */
  private catalog: Catalog = coreCatalog;

  /** The store scene as a signal (null until the first scene loads). */
  private readonly scene = toSignal<Scene | null, Scene | null>(this.store.select(selectScene), {
    initialValue: null,
  });

  /**
   * The chemistry for the current scene at the current preview week. Recomputes
   * whenever the scene OR the preview-slider week changes — a pure projection,
   * so it's safe to read from a HUD/indicator without side effects.
   *
   * When the slider is in "Now" mode (`null`) we evaluate at the scene's
   * persisted/initial age (`initial.ageWeeks`) so "Now" shows the stored
   * chemistry rather than re-cycling from week 0. Scrubbing forward projects
   * the cycle; scrubbing back below the persisted age clamps (the model is
   * monotonic-forward — see `evaluateChemistryAtWeek`).
   */
  readonly chemistry = computed<PreviewChemistry>(() => {
    const scene = this.scene();
    if (scene === null) return EMPTY;

    const sourceN = bioloadSourceN(scene, this.catalog);
    const sliderWeek = this.previewTime.previewAgeWeeks();
    // "Now" → use the persisted snapshot's age (so we show stored chemistry,
    // not a fresh cycle); the helper clamps a target below the initial age.
    const persistedAge = scene.tank.waterChemistry?.chemistry.ageWeeks ?? 0;
    const week = sliderWeek ?? persistedAge;

    const state = evaluateSceneChemistryAtWeek(scene, week, sourceN);
    return { state, cycle: cycleProgress(state), week, sourceN };
  });

  /** Inject an alternate catalog (tests). Production uses `coreCatalog`. */
  setCatalog(catalog: Catalog): void {
    this.catalog = catalog;
  }
}
