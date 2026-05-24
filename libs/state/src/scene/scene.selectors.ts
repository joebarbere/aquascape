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
