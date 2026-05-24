// Scene reducer tests. The reducer is data-in/data-out — it never calls
// `applyCommand`. These tests verify that the reducer:
//   - bootstraps to the default scene + empty history
//   - commits `applyCommandSucceeded` payloads atomically
//   - drives history.undo / history.redo
//   - sets / clears `tank.presetRef` metadata directly
//   - is a no-op on `dispatchCommand` (intent-only) and `commandRejected`.

import {
  applyCommand,
  createHistory,
  invertCommand,
  setTankDimensions,
} from '@aquascape/domain/scene-model';
import type { Scene } from '@aquascape/domain/scene-model';

import { defaultScene } from './default-scene';
import { SceneActions } from './scene.actions';
import {
  SCENE_FEATURE_KEY,
  initialSceneState,
  sceneFeature,
} from './scene.reducer';

const reduce = sceneFeature.reducer;

describe('sceneFeature', () => {
  it('registers under the SCENE_FEATURE_KEY', () => {
    expect(sceneFeature.name).toBe(SCENE_FEATURE_KEY);
    expect(SCENE_FEATURE_KEY).toBe('scene');
  });
});

describe('initialSceneState', () => {
  it('returns the default scene + empty history', () => {
    const state = initialSceneState();
    expect(state.scene).toEqual(defaultScene());
    expect(state.history.past).toEqual([]);
    expect(state.history.future).toEqual([]);
  });

  it('returns a fresh object each call', () => {
    const a = initialSceneState();
    const b = initialSceneState();
    expect(a).not.toBe(b);
    expect(a.scene).not.toBe(b.scene);
  });
});

describe('sceneFeature.reducer', () => {
  const init = initialSceneState();

  it('returns state unchanged for dispatchCommand (intent-only)', () => {
    const command = setTankDimensions({ width: 800, height: 400, depth: 400 });
    const next = reduce(init, SceneActions.dispatchCommand({ command }));
    expect(next).toBe(init);
  });

  it('commits the scene + history pair on applyCommandSucceeded', () => {
    const command = setTankDimensions({ width: 800, height: 400, depth: 400 });
    const pushed = init.history.push(command, init.scene);
    if (pushed === null) throw new Error('expected push to succeed');

    const next = reduce(
      init,
      SceneActions.applyCommandSucceeded({
        scene: pushed.scene,
        history: pushed.history,
      }),
    );

    expect(next.scene).toBe(pushed.scene);
    expect(next.history).toBe(pushed.history);
    expect(next.scene.tank.width).toBe(800);
  });

  it('is a no-op on commandRejected', () => {
    const next = reduce(
      init,
      SceneActions.commandRejected({ reason: 'invalid', message: 'nope' }),
    );
    expect(next).toBe(init);
  });

  describe('undo', () => {
    it('reverses the most recent command and is a no-op when history is empty', () => {
      const command = setTankDimensions({ width: 800, height: 400, depth: 400 });
      const pushed = init.history.push(command, init.scene);
      if (pushed === null) throw new Error('push failed');
      const after = reduce(
        init,
        SceneActions.applyCommandSucceeded({
          scene: pushed.scene,
          history: pushed.history,
        }),
      );

      const undone = reduce(after, SceneActions.undo());
      expect(undone.scene.tank.width).toBe(init.scene.tank.width);
      expect(undone.history.past.length).toBe(0);
      expect(undone.history.future.length).toBe(1);

      // Undo against empty past is a no-op.
      const noop = reduce(init, SceneActions.undo());
      expect(noop).toBe(init);
    });

    it('clamps placed objects when shrinking the tank, then restores them via undo', () => {
      // Build a scene with one object near the right-back-top corner.
      const baseScene: Scene = {
        ...defaultScene(),
        layers: [
          {
            id: 'layer-1' as never,
            name: 'L',
            opacity: 1,
            visible: true,
            locked: false,
            objects: [
              {
                id: 'obj-1' as never,
                kind: 'hardscape',
                ref: { catalog: 'core', id: 'rock.x', version: 1 },
                transform: {
                  position: { x: 590, y: 350, z: 300 },
                  rotation: { x: 0, y: 0, z: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                },
              },
            ],
          },
        ],
      };
      const state0 = { scene: baseScene, history: createHistory() };

      // Shrink to 300×200×200 — every dimension is smaller than the
      // object's position. The command must clamp; the object must remain.
      const shrink = setTankDimensions({ width: 300, height: 200, depth: 200 });
      const pushed = state0.history.push(shrink, state0.scene);
      if (pushed === null) throw new Error('push failed');
      const state1 = reduce(
        state0,
        SceneActions.applyCommandSucceeded({
          scene: pushed.scene,
          history: pushed.history,
        }),
      );

      const layer1 = state1.scene.layers[0];
      expect(layer1).toBeDefined();
      const obj1 = layer1!.objects[0];
      expect(obj1).toBeDefined();
      expect(obj1!.transform.position).toEqual({ x: 300, y: 200, z: 200 });

      // Undo: dimensions restored AND the object's original position
      // restored exactly (the `inverse.restoredPositions` envelope).
      const state2 = reduce(state1, SceneActions.undo());
      expect(state2.scene.tank.width).toBe(600);
      const layer2 = state2.scene.layers[0];
      expect(layer2).toBeDefined();
      const obj2 = layer2!.objects[0];
      expect(obj2).toBeDefined();
      expect(obj2!.transform.position).toEqual({ x: 590, y: 350, z: 300 });
    });
  });

  describe('redo', () => {
    it('replays an undone command and is a no-op when future is empty', () => {
      const command = setTankDimensions({ width: 800, height: 400, depth: 400 });
      const pushed = init.history.push(command, init.scene);
      if (pushed === null) throw new Error('push failed');
      const applied = reduce(
        init,
        SceneActions.applyCommandSucceeded({
          scene: pushed.scene,
          history: pushed.history,
        }),
      );
      const undone = reduce(applied, SceneActions.undo());
      const redone = reduce(undone, SceneActions.redo());

      expect(redone.scene.tank.width).toBe(800);
      expect(redone.history.future.length).toBe(0);

      // Redo against empty future is a no-op.
      const noop = reduce(init, SceneActions.redo());
      expect(noop).toBe(init);
    });
  });

  describe('setTankPresetRef', () => {
    it('stamps presetRef on the tank', () => {
      const presetRef = { catalog: 'core', id: 'ada.mini-m', version: 1 };
      const next = reduce(
        init,
        SceneActions.setTankPresetRef({ presetRef }),
      );
      expect(next.scene.tank.presetRef).toEqual(presetRef);
      // Other tank fields untouched.
      expect(next.scene.tank.width).toBe(init.scene.tank.width);
      expect(next.scene.tank.style).toEqual(init.scene.tank.style);
    });

    it('clears presetRef when passed null (field removed entirely)', () => {
      const stamped = reduce(
        init,
        SceneActions.setTankPresetRef({
          presetRef: { catalog: 'core', id: 'ada.mini-m', version: 1 },
        }),
      );
      expect(stamped.scene.tank.presetRef).toBeDefined();
      const cleared = reduce(
        stamped,
        SceneActions.setTankPresetRef({ presetRef: null }),
      );
      expect('presetRef' in cleared.scene.tank).toBe(false);
    });

    it('does not push to history (metadata-only edit)', () => {
      const presetRef = { catalog: 'core', id: 'ada.mini-m', version: 1 };
      const next = reduce(
        init,
        SceneActions.setTankPresetRef({ presetRef }),
      );
      expect(next.history.past.length).toBe(0);
    });
  });

  describe('invariant: applyCommandSucceeded does not lose JSON shape', () => {
    it('a SetTankDimensions round-trip stays JSON-clean', () => {
      const command = setTankDimensions({ width: 800, height: 400, depth: 400 });
      const result = applyCommand(init.scene, command);
      if (!result.ok) throw new Error('apply failed');
      const inverse = invertCommand(init.scene, command);
      void inverse;

      const next = reduce(
        init,
        SceneActions.applyCommandSucceeded({
          scene: result.scene,
          history: init.history.push(command, init.scene)!.history,
        }),
      );

      const cloned = JSON.parse(JSON.stringify(next.scene));
      expect(cloned).toEqual(next.scene);
    });
  });
});
