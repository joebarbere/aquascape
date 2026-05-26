// Scene selector tests — verify the projections against a known state shape.

import type { LivestockEntry, Scene } from '@aquascape/domain/scene-model';
import { createHistory, setTankDimensions } from '@aquascape/domain/scene-model';

import { defaultScene } from './default-scene';
import {
  selectCanRedo,
  selectCanUndo,
  selectHistory,
  selectLivestock,
  selectLivestockById,
  selectScene,
  selectStockingWarnings,
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

  describe('selectLivestock', () => {
    it('returns an empty array when scene.livestock is undefined', () => {
      const scene = defaultScene();
      expect(selectLivestock.projector(scene)).toEqual([]);
    });

    it('returns the array when present', () => {
      const livestock: LivestockEntry[] = [
        {
          id: 'a0000000-0000-4000-8000-000000000001',
          ref: { catalog: 'core', id: 'fish.boraras.brigittae', version: 1 },
          quantity: 12,
        },
      ];
      const scene: Scene = { ...defaultScene(), livestock };
      expect(selectLivestock.projector(scene)).toBe(livestock);
    });

    it('returns an empty array when scene is null (defensive)', () => {
      expect(selectLivestock.projector(null as unknown as Scene)).toEqual([]);
    });
  });

  describe('selectLivestockById', () => {
    const entry: LivestockEntry = {
      id: 'a0000000-0000-4000-8000-000000000001',
      ref: { catalog: 'core', id: 'fish.boraras.brigittae', version: 1 },
      quantity: 12,
    };

    it('finds an entry by id', () => {
      expect(selectLivestockById(entry.id).projector([entry])).toBe(entry);
    });

    it('returns null when no entry has the id', () => {
      expect(selectLivestockById('missing').projector([entry])).toBeNull();
    });

    it('returns null on an empty livestock array', () => {
      expect(selectLivestockById(entry.id).projector([])).toBeNull();
    });
  });

  describe('selectStockingWarnings', () => {
    it('returns no warnings on an empty default scene', () => {
      const scene = defaultScene();
      expect(selectStockingWarnings.projector(scene)).toEqual([]);
    });

    it('returns a bioload warning when overstocked', () => {
      // Default tank is 600 × 360 × 360 mm = 77.76 L. 200 neon tetras
      // (adult 35 mm, low bioload) → weighted body cm = 200 × 3.5 × 0.5 =
      // 350 cm; ratio = 350 / 77.76 ≈ 4.5 — well above the 2.5 floor for
      // "severely overstocked".
      const scene: Scene = {
        ...defaultScene(),
        livestock: [
          {
            id: 'a0000000-0000-4000-8000-000000000001',
            ref: { catalog: 'core', id: 'livestock.fish.neon-tetra', version: 1 },
            quantity: 200,
          },
        ],
      };
      const warnings = selectStockingWarnings.projector(scene);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.map((w) => w.code)).toContain('bioload-severely-overstocked');
    });
  });
});
