// Scene selector tests — verify the projections against a known state shape.

import { createHistory, setTankDimensions } from '@aquascape/domain/scene-model';

import { defaultScene } from './default-scene';
import {
  selectCanRedo,
  selectCanUndo,
  selectHistory,
  selectScene,
  selectSceneState,
  selectTank,
  selectTankPresetRef,
} from './scene.selectors';

function makeRoot(): {
  scene: ReturnType<typeof selectSceneState.projector>;
} {
  return {
    scene: { scene: defaultScene(), history: createHistory() },
  };
}

describe('scene.selectors', () => {
  it('selectScene returns the scene', () => {
    const root = makeRoot();
    expect(selectScene.projector(root.scene)).toBe(root.scene.scene);
  });

  it('selectTank returns the tank', () => {
    const root = makeRoot();
    const tank = selectTank.projector(root.scene.scene);
    expect(tank).toBe(root.scene.scene.tank);
  });

  it('selectTankPresetRef returns null when unset', () => {
    const root = makeRoot();
    expect(selectTankPresetRef.projector(root.scene.scene.tank)).toBeNull();
  });

  it('selectTankPresetRef returns the value when present', () => {
    const tank = {
      ...defaultScene().tank,
      presetRef: { catalog: 'core', id: 'ada.mini-m', version: 1 },
    };
    expect(selectTankPresetRef.projector(tank)).toEqual({
      catalog: 'core',
      id: 'ada.mini-m',
      version: 1,
    });
  });

  describe('selectCanUndo / selectCanRedo', () => {
    it('both false on a fresh history', () => {
      const history = createHistory();
      expect(selectCanUndo.projector(history)).toBe(false);
      expect(selectCanRedo.projector(history)).toBe(false);
    });

    it('canUndo true after a push; canRedo true after an undo', () => {
      const scene = defaultScene();
      const command = setTankDimensions({ width: 800, height: 400, depth: 400 });
      const pushed = createHistory().push(command, scene);
      if (pushed === null) throw new Error('push failed');
      expect(selectCanUndo.projector(pushed.history)).toBe(true);
      expect(selectCanRedo.projector(pushed.history)).toBe(false);

      const undone = pushed.history.undo(pushed.scene);
      if (undone === null) throw new Error('undo failed');
      expect(selectCanUndo.projector(undone.history)).toBe(false);
      expect(selectCanRedo.projector(undone.history)).toBe(true);
    });
  });

  it('selectHistory exposes the history value', () => {
    const root = makeRoot();
    expect(selectHistory.projector(root.scene)).toBe(root.scene.history);
  });

  it('selectSceneState exposes the whole feature slice', () => {
    const root = makeRoot();
    expect(selectSceneState.projector(root.scene)).toBe(root.scene);
  });
});
