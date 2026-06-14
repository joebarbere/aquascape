// Stage 15 F15.2 — the water-change tool's OUT/IN execution seam.
//
// Owns the *effect* of the siphon steps: dispatching the undoable Commands
// (WaterChange + SetWaterLevel) through the NgRx pipeline AND driving the live
// runtime (`WaterChemistryService.applyWaterChange`) so the readout + fish
// respond immediately. The action HUD's OUT/IN buttons + the app's siphon
// handlers call into this; the tool's *state machine* lives in
// `SimulationActionService` (kept separate so the flow is pure UI state and the
// effects — store + chemistry service — live here).
//
// Both paths reuse the single source of dilution truth: the persisted Command's
// `applyWaterChange` (in `domain/scene-model`) and the live service's
// `applyWaterChange` (which imports the same helper). The level <-> fraction +
// replacement-param mapping is the pure `water-change-flow` helper — no math
// is re-implemented here.
//
// Undo: each OUT and IN dispatches one WaterChange + one SetWaterLevel command,
// so a single undo reverses the level mutation and a second reverses the
// chemistry dilution (both are capture-and-restore inverts).

import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import {
  effectiveWaterLevelMm,
  setWaterLevel,
  waterChange,
  type Scene,
} from '@aquascape/domain/scene-model';
import { SceneActions } from '@aquascape/state';

import { WaterChemistryService } from '../water-chemistry.service';

import {
  inFraction,
  levelAfterIn,
  levelAfterOut,
  outFraction,
  toReplacementWater,
  type ReplacementParams,
} from './water-change-flow';

/** What an OUT/IN step did, for the HUD status line + tests. */
export interface WaterChangeStepResult {
  /** The dilution fraction handed to `applyWaterChange`. */
  readonly fraction: number;
  /** The new water level (mm) dispatched via SetWaterLevel. */
  readonly newLevelMm: number;
  /** The level (mm) before the step — captured for the IN restore. */
  readonly previousLevelMm: number;
}

@Injectable({ providedIn: 'root' })
export class WaterChangeService {
  private readonly store = inject(Store);
  private readonly chemistry = inject(WaterChemistryService);

  /**
   * The water level (mm) captured right before the OUT drain, so the IN step
   * can restore exactly back to it. Null until an OUT runs.
   */
  private preDrainLevelMm: number | null = null;

  /**
   * Siphon OUT — drain a slice of the column. Lowers the water level
   * (`SetWaterLevel`) and dilutes ammonia/nitrite/nitrate with clean source
   * water (`WaterChange` Command + the live `WaterChemistryService`). Captures
   * the pre-drain level for the matching IN. Returns the step result (null when
   * the scene is absent).
   */
  siphonOut(scene: Scene | null, fraction?: number): WaterChangeStepResult | null {
    if (scene === null) return null;
    const f = outFraction(fraction);
    const previousLevelMm = effectiveWaterLevelMm(scene.tank);
    this.preDrainLevelMm = previousLevelMm;
    const newLevelMm = levelAfterOut(previousLevelMm, f);

    // Persisted/undoable: dilute the water column (clean source) + drop level.
    // The WaterChange command only applies when chemistry is being tracked; the
    // live path always runs so the runtime readout drops regardless.
    if (scene.tank.waterChemistry !== undefined) {
      this.dispatch(waterChange(f));
    }
    this.dispatch(setWaterLevel(newLevelMm));
    this.chemistry.applyWaterChange(f);

    return { fraction: f, newLevelMm, previousLevelMm };
  }

  /**
   * Siphon IN — refill the drained slice with replacement water. Raises the
   * level back to the captured pre-drain height (`SetWaterLevel`) and lerps the
   * chemistry toward the replacement params (`WaterChange` Command + live
   * service). No-op returning null when no OUT has run yet.
   */
  siphonIn(
    scene: Scene | null,
    replacement: ReplacementParams,
    fraction?: number,
  ): WaterChangeStepResult | null {
    if (scene === null || this.preDrainLevelMm === null) return null;
    const f = inFraction(fraction);
    const previousLevelMm = effectiveWaterLevelMm(scene.tank);
    const newLevelMm = levelAfterIn(this.preDrainLevelMm, scene.tank.height);
    const replacementWater = toReplacementWater(replacement);

    if (scene.tank.waterChemistry !== undefined) {
      this.dispatch(waterChange(f, replacementWater));
    }
    this.dispatch(setWaterLevel(newLevelMm));
    this.chemistry.applyWaterChange(f, replacementWater);

    // One OUT pairs with one IN; clear the capture so a stray IN can't re-fire.
    this.preDrainLevelMm = null;
    return { fraction: f, newLevelMm, previousLevelMm };
  }

  /** Forget any pending OUT capture (on tool exit / reset). */
  clear(): void {
    this.preDrainLevelMm = null;
  }

  private dispatch(command: Parameters<typeof SceneActions.dispatchCommand>[0]['command']): void {
    this.store.dispatch(SceneActions.dispatchCommand({ command }));
  }
}
