// Memoized NgRx selectors for the scene feature. F1.1 Phase B.
//
// Wraps the base selectors `createFeature` generates for us. Pure selector
// logic that already lives in `@aquascape/domain/scene-model` (e.g.
// `getLayerById`) is NOT re-implemented here — projects that need a derived
// view import the pure selector directly. NgRx selectors exist for
// memoization across `store.select()` subscriptions, not as a second source
// of truth.
//
// `selectCanUndo` / `selectCanRedo` is a derived boolean over the history's
// own stacks. The `History.undo` / `History.redo` methods return `null` when
// nothing is available; that's the runtime check the reducer uses. Here we
// peek at the stack lengths instead so consumers can disable buttons without
// dispatching speculatively.

import { coreCatalog } from '@aquascape/domain/catalog';
import type { LivestockEntry } from '@aquascape/domain/scene-model';
import { evaluateStocking, type StockingWarning } from '@aquascape/domain/stocking';
import { createSelector } from '@ngrx/store';

import { sceneFeature } from './scene.reducer';

/** Selects the whole `{ scene, history }` feature state. */
export const selectSceneState = sceneFeature.selectSceneState;

/** Selects the `Scene` document. */
export const selectScene = sceneFeature.selectScene;

/** Selects the undo/redo `History`. */
export const selectHistory = sceneFeature.selectHistory;

/** Selects `scene.tank`. */
export const selectTank = createSelector(selectScene, (scene) => scene.tank);

/** Selects `scene.tank.presetRef`, or `null` if unset. */
export const selectTankPresetRef = createSelector(
  selectTank,
  (tank) => tank.presetRef ?? null,
);

/** Selects `scene.substrate`. Stage 2 F2.2. */
export const selectSubstrate = createSelector(selectScene, (scene) => scene.substrate);

/** Convenience: just the substrate regions array. */
export const selectSubstrateRegions = createSelector(
  selectSubstrate,
  (substrate) => substrate.regions,
);

/**
 * Selects the scene's livestock entries (Stage 7 F7.1). Returns an empty
 * array when `scene.livestock` is undefined so consumers don't need to
 * guard. NgRx memoizes the projection so the returned reference is stable
 * across subscriptions when the underlying array is unchanged.
 */
export const selectLivestock = createSelector(
  selectScene,
  (scene): LivestockEntry[] => scene?.livestock ?? [],
);

/**
 * Build a memoized selector for a single livestock entry by id (Stage 7
 * F7.1). Follows the "entity selector factory" pattern in NgRx — pass an
 * id, get back a `Selector` you can `store.select` against. Returns `null`
 * when no entry has that id, mirroring `selectLivestockById` from
 * `@aquascape/domain/scene-model`.
 */
export const selectLivestockById = (id: string) =>
  createSelector(
    selectLivestock,
    (livestock): LivestockEntry | null => livestock.find((e) => e.id === id) ?? null,
  );

/**
 * Selects the current stocking-guidance warnings (Stage 7 F7.2). Runs the
 * pure rules engine in `@aquascape/domain/stocking` against the whole
 * scene + the bundled core catalog. NgRx memoizes the result, so the
 * returned array reference is stable while the scene's tank/livestock
 * don't change. The output ordering is deterministic — see
 * `evaluateStocking` for the sort key.
 *
 * Why selectScene (not finer-grained inputs): evaluateStocking only reads
 * `scene.tank` + `scene.livestock`, but exposing both via composed
 * selectors would just wrap two already-memoized selectors. The rules
 * engine runs in < 1 ms on realistic inputs; recomputing on unrelated
 * scene changes (substrate, layers) is cheap.
 */
export const selectStockingWarnings = createSelector(
  selectScene,
  (scene): StockingWarning[] => evaluateStocking(scene, coreCatalog),
);

/** True when there is at least one entry in the history's `past` stack. */
export const selectCanUndo = createSelector(
  selectHistory,
  (history) => history.past.length > 0,
);

/** True when there is at least one entry in the history's `future` stack. */
export const selectCanRedo = createSelector(
  selectHistory,
  (history) => history.future.length > 0,
);
