// Scene feature barrel. F1.1 Phase B.

export { SceneActions } from './scene.actions';
export {
  SCENE_FEATURE_KEY,
  initialSceneState,
  sceneFeature,
} from './scene.reducer';
export type { SceneState } from './scene.reducer';
export { SceneEffects } from './scene.effects';
export {
  selectSceneState,
  selectScene,
  selectHistory,
  selectTank,
  selectTankPresetRef,
  selectSubstrate,
  selectSubstrateRegions,
  selectCanUndo,
  selectCanRedo,
} from './scene.selectors';
export {
  defaultScene,
  DEFAULT_TANK_WIDTH_MM,
  DEFAULT_TANK_HEIGHT_MM,
  DEFAULT_TANK_DEPTH_MM,
} from './default-scene';
