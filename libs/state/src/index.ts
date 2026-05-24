// Public API for @aquascape/state.
//
// NgRx-based store layer. Stage 0 was a stub; F1.1 Phase B introduces the
// first feature (`scene`) and the `provideSceneStore()` composition helper
// that the app shells call at bootstrap.

import type { Provider, EnvironmentProviders } from '@angular/core';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';

import { sceneFeature, SceneEffects } from './scene';

/**
 * Compose the scene-feature providers (state slice + effects) for a
 * bootstrap providers array. Call alongside `provideStore({})` /
 * `provideEffects()` at the app's composition root.
 *
 * Returns an `EnvironmentProviders` so the caller spreads it in directly:
 *
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     provideStore({}),
 *     provideEffects(),
 *     provideSceneStore(),
 *   ],
 * });
 * ```
 */
export function provideSceneStore(): Array<Provider | EnvironmentProviders> {
  return [provideState(sceneFeature), provideEffects(SceneEffects)];
}

// Feature surface — actions, selectors, and the default-scene factory.
export {
  SceneActions,
  SCENE_FEATURE_KEY,
  initialSceneState,
  sceneFeature,
  SceneEffects,
  selectSceneState,
  selectScene,
  selectHistory,
  selectTank,
  selectTankPresetRef,
  selectCanUndo,
  selectCanRedo,
  defaultScene,
  DEFAULT_TANK_WIDTH_MM,
  DEFAULT_TANK_HEIGHT_MM,
  DEFAULT_TANK_DEPTH_MM,
} from './scene';
export type { SceneState } from './scene';
