// Scene feature reducer + state shape. F1.1 Phase B.
//
// Holds the authoritative `{ scene, history }` pair. The reducer is
// **pure-data-in/data-out**: every transformation that needs to call
// `applyCommand` happens in the effect (see `scene.effects.ts`), which
// dispatches `applyCommandSucceeded({ scene, history })` once it has both.
// The reducer then commits the pair atomically.
//
// Why two halves and not "reducer does it all"? Two reasons:
//   1. `applyCommand` already returns a typed `CommandResult` — running
//      it inside the reducer would force every reducer call to branch on
//      success/failure, and we'd need a separate `commandRejected`
//      effect-side dispatch anyway. Splitting at the effect boundary
//      keeps the reducer's signature trivially testable (data → data) and
//      lets the effect log rejections without rerunning the work.
//   2. The History primitive's `push` API takes the **pre-apply** scene,
//      not the next one. Running it in the reducer is awkward; the effect
//      has clean access to both.

import type { Scene } from '@aquascape/domain/scene-model';
import type { History } from '@aquascape/domain/scene-model';
import { createHistory } from '@aquascape/domain/scene-model';
import { createFeature, createReducer, on } from '@ngrx/store';

import { defaultScene } from './default-scene';
import { SceneActions } from './scene.actions';

export const SCENE_FEATURE_KEY = 'scene';

export interface SceneState {
  readonly scene: Scene;
  readonly history: History;
}

/**
 * Build the initial scene state. Exported so tests (and the eventual
 * "new document" command) can produce a fresh state without reaching
 * into private internals.
 */
export function initialSceneState(): SceneState {
  return {
    scene: defaultScene(),
    history: createHistory(),
  };
}

const reducer = createReducer<SceneState>(
  initialSceneState(),

  // `Dispatch Command` is intent only — the effect does the work and
  // emits `Apply Command Succeeded` / `Command Rejected`. Reducer is a
  // no-op here on purpose.
  on(SceneActions.dispatchCommand, (state) => state),

  on(SceneActions.applyCommandSucceeded, (_state, { scene, history }) => ({
    scene,
    history,
  })),

  on(SceneActions.commandRejected, (state) => state),

  on(SceneActions.undo, (state) => {
    const next = state.history.undo(state.scene);
    if (next === null) return state;
    return { scene: next.scene, history: next.history };
  }),

  on(SceneActions.redo, (state) => {
    const next = state.history.redo(state.scene);
    if (next === null) return state;
    return { scene: next.scene, history: next.history };
  }),

  on(SceneActions.setTankPresetRef, (state, { presetRef }) => {
    // Strip the field entirely when clearing, so `JSON.parse(JSON.stringify(
    // state.scene))` matches a freshly-built scene (round-trip parity with
    // `exactOptionalPropertyTypes`).
    const { presetRef: _previous, ...tankWithoutPresetRef } = state.scene.tank;
    const nextTank =
      presetRef === null
        ? tankWithoutPresetRef
        : { ...tankWithoutPresetRef, presetRef };
    return {
      ...state,
      scene: { ...state.scene, tank: nextTank },
    };
  }),
);

/**
 * Scene feature. Registered via `provideState(sceneFeature)` at the app's
 * composition root (see `provideSceneStore()` in the lib's public API).
 *
 * `createFeature` also generates the base selectors
 * (`selectSceneState`, `selectScene`, `selectHistory`) used by the
 * hand-rolled selectors in `scene.selectors.ts`.
 */
export const sceneFeature = createFeature({
  name: SCENE_FEATURE_KEY,
  reducer,
});
