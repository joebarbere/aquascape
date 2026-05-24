# `@aquascape/state`

NgRx stores, selectors, and effects for the editor. **Tags:** `scope:state`.

## Stage 1 status (F1.1 Phase B)

First feature lands: the `scene` slice (`SceneState = { scene, history }`).

## Public surface

- `provideSceneStore()` — composition helper. Returns the state + effects
  providers for `bootstrapApplication`. Call alongside `provideStore({})` /
  `provideEffects()`.
- `SceneActions` — typed action group. The four pipelines:
  - `dispatchCommand({ command })` — the only way new structural edits
    enter the document. The effect (`SceneEffects.dispatchCommand$`) runs
    `History.push(command, scene)` and emits `applyCommandSucceeded`
    (or `commandRejected` with the typed reason).
  - `applyCommandSucceeded({ scene, history })` — effect → reducer.
  - `commandRejected({ reason, message })` — effect → UI (toast).
  - `undo()` / `redo()` — drive `History.undo/redo` in the reducer.
  - `setTankPresetRef({ presetRef })` — **metadata-only** edit;
    bypasses the Command pipeline by design.
- `selectScene`, `selectTank`, `selectTankPresetRef`, `selectHistory`,
  `selectCanUndo`, `selectCanRedo`.
- `defaultScene()` — the canonical first-boot tank
  (60 cm × 36 cm × 36 cm, rimless, no background).

## Why some edits skip the Command pipeline

`setTankPresetRef` is the canonical example. Stamping or clearing
`scene.tank.presetRef` is metadata: it does not change the document's
structural graph, does not need to participate in undo/redo, and the
domain-layer `SetTankDimensions` command intentionally leaves
`presetRef` alone (per Phase A of F1.1). Routing such edits through the
Command pipeline would force the scene-model to grow a metadata-only
command kind for every analogous case; instead the reducer writes the
field directly. This decision is documented in `scene.actions.ts` so
the next pair of eyes sees the rationale.

## Coverage

The local Jest threshold is **90%** on lines / branches / statements /
functions. The CI coverage gate's tag filter does not currently include
`scope:state`; this threshold catches regressions locally regardless.
