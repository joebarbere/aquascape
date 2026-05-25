import { identityTransform } from '@aquascape/domain/geometry';

import {
  addLayer,
  addObject,
  applyCommand,
  composite,
  invertCommand,
  moveObject,
  noop,
  removeLayer,
  removeObject,
  renameLayer,
  reorderLayers,
  reshapeObject,
  SET_TANK_DIMENSIONS_MAX_MM,
  setLayerLocked,
  setLayerOpacity,
  setLayerVisibility,
  setTankDimensions,
} from './commands';
import type { Command, SetTankDimensionsCommand } from './commands';
import { asLayerId, asObjectId } from './ids';
import { getLayerById, getObjectById, getObjectWithLayer } from './selectors';
import { makeHardscape, makeLayer, makePlant, makeScene } from './test-fixtures';
import type { Layer } from './types';

const layer1 = asLayerId('11111111-0000-4000-8000-000000000001');
const layer2 = asLayerId('11111111-0000-4000-8000-000000000002');
const obj1 = asObjectId('aaaaaaaa-0000-4000-8000-000000000001');
const obj2 = asObjectId('aaaaaaaa-0000-4000-8000-000000000002');
const plant1 = asObjectId('bbbbbbbb-0000-4000-8000-000000000001');

function applyOk(
  scene: Parameters<typeof applyCommand>[0],
  cmd: Command,
): ReturnType<typeof applyCommand> {
  const r = applyCommand(scene, cmd);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.message}`);
  return r;
}

describe('applyCommand', () => {
  describe('Noop', () => {
    it('returns the same scene reference', () => {
      const scene = makeScene();
      const result = applyCommand(scene, noop());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.scene).toBe(scene);
    });
  });

  describe('AddLayer', () => {
    it('appends when index is null', () => {
      const scene = makeScene();
      const newLayer: Layer = makeLayer('11111111-0000-4000-8000-00000000000a', 'New');
      const result = applyOk(scene, addLayer(newLayer, null));
      if (!result.ok) return;
      expect(result.scene.layers.map((l) => l.name)).toEqual(['Hardscape', 'Carpet', 'New']);
    });

    it('inserts at a specific index', () => {
      const scene = makeScene();
      const newLayer = makeLayer('11111111-0000-4000-8000-00000000000b', 'Mid');
      const result = applyOk(scene, addLayer(newLayer, 1));
      if (!result.ok) return;
      expect(result.scene.layers.map((l) => l.name)).toEqual(['Hardscape', 'Mid', 'Carpet']);
    });

    it('clamps out-of-range index to append', () => {
      const scene = makeScene();
      const newLayer = makeLayer('11111111-0000-4000-8000-00000000000c', 'End');
      const result = applyOk(scene, addLayer(newLayer, 99));
      if (!result.ok) return;
      expect(result.scene.layers[result.scene.layers.length - 1]?.name).toBe('End');
    });

    it('rejects when id already exists', () => {
      const scene = makeScene();
      const dupe = makeLayer('11111111-0000-4000-8000-000000000001', 'Dupe');
      const r = applyCommand(scene, addLayer(dupe));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid');
    });

    it('does not mutate the input scene', () => {
      const scene = makeScene();
      const before = JSON.stringify(scene);
      applyCommand(scene, addLayer(makeLayer('11111111-0000-4000-8000-00000000000d', 'X')));
      expect(JSON.stringify(scene)).toBe(before);
    });
  });

  describe('RemoveLayer', () => {
    it('removes the layer', () => {
      const scene = makeScene();
      const result = applyOk(scene, removeLayer(layer1));
      if (!result.ok) return;
      expect(result.scene.layers).toHaveLength(1);
      expect(result.scene.layers[0]?.id).toBe(layer2);
    });

    it('rejects unknown id', () => {
      const r = applyCommand(makeScene(), removeLayer(asLayerId('nope')));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not-found');
    });
  });

  describe('RenameLayer', () => {
    it('renames', () => {
      const r = applyOk(makeScene(), renameLayer(layer1, 'Renamed'));
      if (!r.ok) return;
      expect(getLayerById(r.scene, layer1)?.name).toBe('Renamed');
    });

    it('rejects unknown id', () => {
      const r = applyCommand(makeScene(), renameLayer(asLayerId('nope'), 'x'));
      expect(r.ok).toBe(false);
    });

    it('is NOT blocked by locked (metadata, not content)', () => {
      const scene = makeScene();
      scene.layers[0]!.locked = true;
      const r = applyCommand(scene, renameLayer(layer1, 'Still renamable'));
      expect(r.ok).toBe(true);
    });
  });

  describe('SetLayerOpacity', () => {
    it('sets and clamps to [0,1]', () => {
      const a = applyOk(makeScene(), setLayerOpacity(layer1, 0.5));
      if (!a.ok) return;
      expect(getLayerById(a.scene, layer1)?.opacity).toBe(0.5);

      const b = applyOk(makeScene(), setLayerOpacity(layer1, 1.7));
      if (!b.ok) return;
      expect(getLayerById(b.scene, layer1)?.opacity).toBe(1);

      const c = applyOk(makeScene(), setLayerOpacity(layer1, -0.3));
      if (!c.ok) return;
      expect(getLayerById(c.scene, layer1)?.opacity).toBe(0);
    });

    it('rejects non-finite opacity', () => {
      const r = applyCommand(makeScene(), setLayerOpacity(layer1, Number.NaN));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid');
    });

    it('rejects unknown layer', () => {
      const r = applyCommand(makeScene(), setLayerOpacity(asLayerId('nope'), 0.5));
      expect(r.ok).toBe(false);
    });

    it('is NOT blocked by locked', () => {
      const scene = makeScene();
      scene.layers[0]!.locked = true;
      const r = applyCommand(scene, setLayerOpacity(layer1, 0.2));
      expect(r.ok).toBe(true);
    });
  });

  describe('SetLayerVisibility', () => {
    it('toggles', () => {
      const r = applyOk(makeScene(), setLayerVisibility(layer1, false));
      if (!r.ok) return;
      expect(getLayerById(r.scene, layer1)?.visible).toBe(false);
    });

    it('rejects unknown layer', () => {
      const r = applyCommand(makeScene(), setLayerVisibility(asLayerId('nope'), false));
      expect(r.ok).toBe(false);
    });
  });

  describe('SetLayerLocked', () => {
    it('toggles', () => {
      const r = applyOk(makeScene(), setLayerLocked(layer1, true));
      if (!r.ok) return;
      expect(getLayerById(r.scene, layer1)?.locked).toBe(true);
    });

    it('rejects unknown layer', () => {
      const r = applyCommand(makeScene(), setLayerLocked(asLayerId('nope'), true));
      expect(r.ok).toBe(false);
    });

    it('can flip locked on an already-locked layer (metadata, not content)', () => {
      const scene = makeScene();
      scene.layers[0]!.locked = true;
      const r = applyCommand(scene, setLayerLocked(layer1, false));
      expect(r.ok).toBe(true);
    });
  });

  describe('ReorderLayers', () => {
    it('reorders by full permutation', () => {
      const r = applyOk(makeScene(), reorderLayers([layer2, layer1]));
      if (!r.ok) return;
      expect(r.scene.layers.map((l) => l.id)).toEqual([layer2, layer1]);
    });

    it('rejects wrong length', () => {
      const r = applyCommand(makeScene(), reorderLayers([layer1]));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid');
    });

    it('rejects duplicates', () => {
      const r = applyCommand(makeScene(), reorderLayers([layer1, layer1]));
      expect(r.ok).toBe(false);
    });

    it('rejects unknown id in order', () => {
      const r = applyCommand(makeScene(), reorderLayers([layer1, asLayerId('nope')]));
      expect(r.ok).toBe(false);
    });
  });

  describe('AddObject', () => {
    it('appends an object to the layer', () => {
      const scene = makeScene();
      const obj = makeHardscape('cccccccc-0000-4000-8000-000000000001');
      const r = applyOk(scene, addObject(layer1, obj));
      if (!r.ok) return;
      expect(getLayerById(r.scene, layer1)?.objects).toHaveLength(3);
      expect(getObjectById(r.scene, obj.id)?.id).toBe(obj.id);
    });

    it('inserts at index', () => {
      const obj = makeHardscape('cccccccc-0000-4000-8000-000000000002');
      const r = applyOk(makeScene(), addObject(layer1, obj, 0));
      if (!r.ok) return;
      expect(getLayerById(r.scene, layer1)?.objects[0]?.id).toBe(obj.id);
    });

    it('rejects when layer is locked', () => {
      const scene = makeScene();
      scene.layers[0]!.locked = true;
      const obj = makeHardscape('cccccccc-0000-4000-8000-000000000003');
      const r = applyCommand(scene, addObject(layer1, obj));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('locked');
    });

    it('rejects unknown layer', () => {
      const obj = makeHardscape('cccccccc-0000-4000-8000-000000000004');
      const r = applyCommand(makeScene(), addObject(asLayerId('nope'), obj));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not-found');
    });

    it('rejects duplicate id', () => {
      const scene = makeScene();
      const dupe = makeHardscape('aaaaaaaa-0000-4000-8000-000000000001');
      const r = applyCommand(scene, addObject(layer1, dupe));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid');
    });
  });

  describe('RemoveObject', () => {
    it('removes the object', () => {
      const r = applyOk(makeScene(), removeObject(obj1));
      if (!r.ok) return;
      expect(getObjectById(r.scene, obj1)).toBeNull();
    });

    it('rejects unknown id', () => {
      const r = applyCommand(makeScene(), removeObject(asObjectId('nope')));
      expect(r.ok).toBe(false);
    });

    it('rejects when layer is locked', () => {
      const scene = makeScene();
      scene.layers[0]!.locked = true;
      const r = applyCommand(scene, removeObject(obj1));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('locked');
    });
  });

  describe('MoveObject', () => {
    it('sets absolute position', () => {
      const r = applyOk(makeScene(), moveObject(obj1, { x: 5, y: 6, z: 7 }));
      if (!r.ok) return;
      const found = getObjectWithLayer(r.scene, obj1);
      expect(found?.object.transform.position).toEqual({ x: 5, y: 6, z: 7 });
    });

    it('preserves the rest of the transform', () => {
      const scene = makeScene();
      scene.layers[0]!.objects[0]!.transform.rotation = { x: 0, y: 0, z: 0.5 };
      scene.layers[0]!.objects[0]!.transform.scale = { x: 2, y: 2, z: 2 };
      const r = applyOk(scene, moveObject(obj1, { x: 0, y: 0, z: 0 }));
      if (!r.ok) return;
      const t = getObjectById(r.scene, obj1)?.transform;
      expect(t?.rotation.z).toBe(0.5);
      expect(t?.scale.x).toBe(2);
    });

    it('rejects non-finite position', () => {
      const r = applyCommand(
        makeScene(),
        moveObject(obj1, { x: Number.POSITIVE_INFINITY, y: 0, z: 0 }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid');
    });

    it('rejects when layer is locked', () => {
      const scene = makeScene();
      scene.layers[0]!.locked = true;
      const r = applyCommand(scene, moveObject(obj1, { x: 1, y: 2, z: 3 }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('locked');
    });

    it('rejects unknown id', () => {
      const r = applyCommand(makeScene(), moveObject(asObjectId('nope'), { x: 0, y: 0, z: 0 }));
      expect(r.ok).toBe(false);
    });

    // Scatter plants store their patch outline in absolute scene-space mm.
    // Without translating the polygon by the same delta as the position,
    // moving the plant (or nudging it with arrow keys) would shift the
    // transform anchor but leave the visible patch pinned to the original
    // place — the user sees nothing change.
    it("translates a scatter plant's polygon by the same delta as the position", () => {
      const plantId = asObjectId('cccccccc-0000-4000-8000-000000000099');
      const plant = {
        ...makePlant(plantId, 100, 100, 0),
        scatter: {
          polygon: [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
            { x: 200, y: 200 },
            { x: 100, y: 200 },
          ],
          density: 30,
          seed: 1,
        },
      };
      const scene = {
        ...makeScene(),
        layers: [makeLayer('layer-1', 'Carpet', [plant])],
      };
      const r = applyOk(scene, moveObject(plantId, { x: 130, y: 120, z: 0 }));
      if (!r.ok) return;
      const moved = r.scene.layers[0]!.objects[0] as typeof plant;
      // Position delta: dx=+30, dy=+20. Every polygon vertex shifts too.
      expect(moved.scatter.polygon).toEqual([
        { x: 130, y: 120 },
        { x: 230, y: 120 },
        { x: 230, y: 220 },
        { x: 130, y: 220 },
      ]);
    });

    it('leaves a single-specimen plant (no scatter) unchanged beyond the transform', () => {
      const plantId = asObjectId('cccccccc-0000-4000-8000-000000000098');
      const plant = makePlant(plantId, 100, 100, 0);
      const scene = {
        ...makeScene(),
        layers: [makeLayer('layer-1', 'Rosette', [plant])],
      };
      const r = applyOk(scene, moveObject(plantId, { x: 130, y: 120, z: 0 }));
      if (!r.ok) return;
      const moved = r.scene.layers[0]!.objects[0]!;
      expect(moved.transform.position).toEqual({ x: 130, y: 120, z: 0 });
      expect((moved as { scatter?: unknown }).scatter).toBeUndefined();
    });
  });

  describe('ReshapeObject', () => {
    it('replaces the transform', () => {
      const t = {
        ...identityTransform(),
        position: { x: 10, y: 20, z: 30 },
        rotation: { x: 0, y: 0, z: 1 },
      };
      const r = applyOk(makeScene(), reshapeObject(obj1, t));
      if (!r.ok) return;
      expect(getObjectById(r.scene, obj1)?.transform).toEqual(t);
    });

    it('rejects when layer is locked', () => {
      const scene = makeScene();
      scene.layers[0]!.locked = true;
      const r = applyCommand(scene, reshapeObject(obj1, identityTransform()));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('locked');
    });

    it('rejects unknown id', () => {
      const r = applyCommand(makeScene(), reshapeObject(asObjectId('nope'), identityTransform()));
      expect(r.ok).toBe(false);
    });
  });

  describe('SetTankDimensions', () => {
    it('updates width/height/depth and leaves style/glassThickness/presetRef alone', () => {
      const scene = makeScene();
      scene.tank.presetRef = { catalog: 'core', id: 'ada.mini-m', version: 1 };
      scene.tank.glassThickness = 5;
      const styleBefore = JSON.parse(JSON.stringify(scene.tank.style));

      const r = applyOk(scene, setTankDimensions({ width: 600, height: 360, depth: 300 }));
      if (!r.ok) return;
      expect(r.scene.tank.width).toBe(600);
      expect(r.scene.tank.height).toBe(360);
      expect(r.scene.tank.depth).toBe(300);
      expect(r.scene.tank.style).toEqual(styleBefore);
      expect(r.scene.tank.glassThickness).toBe(5);
      expect(r.scene.tank.presetRef).toEqual({ catalog: 'core', id: 'ada.mini-m', version: 1 });
    });

    it('rejects non-finite dimensions', () => {
      const scene = makeScene();
      const cases: Array<{ width: number; height: number; depth: number }> = [
        { width: Number.NaN, height: 200, depth: 200 },
        { width: 600, height: Number.POSITIVE_INFINITY, depth: 200 },
        { width: 600, height: 200, depth: Number.NEGATIVE_INFINITY },
      ];
      for (const dims of cases) {
        const r = applyCommand(scene, setTankDimensions(dims));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('invalid');
      }
    });

    it('rejects zero and negative dimensions', () => {
      const scene = makeScene();
      const r0 = applyCommand(scene, setTankDimensions({ width: 0, height: 200, depth: 200 }));
      expect(r0.ok).toBe(false);
      if (!r0.ok) expect(r0.reason).toBe('invalid');
      const rn = applyCommand(scene, setTankDimensions({ width: 200, height: -5, depth: 200 }));
      expect(rn.ok).toBe(false);
      if (!rn.ok) expect(rn.reason).toBe('invalid');
    });

    it('rejects dimensions exceeding the loose physical max', () => {
      const scene = makeScene();
      const r = applyCommand(
        scene,
        setTankDimensions({
          width: SET_TANK_DIMENSIONS_MAX_MM + 1,
          height: 200,
          depth: 200,
        }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid');
    });

    it('accepts a dimension exactly at the max', () => {
      const scene = makeScene();
      const r = applyCommand(
        scene,
        setTankDimensions({
          width: SET_TANK_DIMENSIONS_MAX_MM,
          height: 200,
          depth: 200,
        }),
      );
      expect(r.ok).toBe(true);
    });

    it('clamps object positions outside the new AABB', () => {
      const scene = makeScene();
      // Original tank is 360x220x220; objects in fixture are at (200,80,100)
      // and (110,50,90) for hardscape, and a plant at (50,30,60). Shrink the
      // tank so the first hardscape clamps on the x and y axes.
      const r = applyOk(scene, setTankDimensions({ width: 150, height: 60, depth: 80 }));
      if (!r.ok) return;
      const obj1Pos = getObjectById(r.scene, obj1)?.transform.position;
      expect(obj1Pos).toEqual({ x: 150, y: 60, z: 80 });
      // The second hardscape is at (110,50,90). x=110 stays, y=50 stays, z clamps.
      const obj2Pos = getObjectById(r.scene, obj2)?.transform.position;
      expect(obj2Pos).toEqual({ x: 110, y: 50, z: 80 });
    });

    it('does not move objects that are already inside the new AABB', () => {
      const scene = makeScene();
      // Grow the tank — every object remains in-bounds, positions unchanged.
      const r = applyOk(scene, setTankDimensions({ width: 1000, height: 800, depth: 600 }));
      if (!r.ok) return;
      const obj1Pos = getObjectById(r.scene, obj1)?.transform.position;
      expect(obj1Pos).toEqual({ x: 200, y: 80, z: 100 });
    });

    it('clamps negative positions up to 0', () => {
      const scene = makeScene();
      // Move an object to negative coords first.
      scene.layers[0]!.objects[0]!.transform.position = { x: -50, y: -10, z: -1 };
      const r = applyOk(scene, setTankDimensions({ width: 500, height: 300, depth: 250 }));
      if (!r.ok) return;
      const pos = getObjectById(r.scene, obj1)?.transform.position;
      expect(pos).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('deletes nothing — object count is preserved', () => {
      const scene = makeScene();
      const countBefore = scene.layers.reduce((n, l) => n + l.objects.length, 0);
      const r = applyOk(scene, setTankDimensions({ width: 50, height: 50, depth: 50 }));
      if (!r.ok) return;
      const countAfter = r.scene.layers.reduce((n, l) => n + l.objects.length, 0);
      expect(countAfter).toBe(countBefore);
    });

    it('works on a zero-object scene', () => {
      const scene = makeScene();
      // Strip all objects.
      scene.layers.forEach((l) => (l.objects = []));
      const r = applyOk(scene, setTankDimensions({ width: 800, height: 400, depth: 400 }));
      if (!r.ok) return;
      expect(r.scene.tank.width).toBe(800);
      expect(r.scene.layers.every((l) => l.objects.length === 0)).toBe(true);
    });

    it('clamps objects on locked layers — structural op, not object-level', () => {
      const scene = makeScene();
      scene.layers[0]!.locked = true;
      // The first hardscape is at (200,80,100); shrink to 100x60x80 so x and z clamp.
      const r = applyOk(scene, setTankDimensions({ width: 100, height: 60, depth: 80 }));
      if (!r.ok) return;
      expect(r.ok).toBe(true);
      const pos = getObjectById(r.scene, obj1)?.transform.position;
      expect(pos).toEqual({ x: 100, y: 60, z: 80 });
    });

    it('does not mutate the input scene', () => {
      const scene = makeScene();
      const before = JSON.stringify(scene);
      applyCommand(scene, setTankDimensions({ width: 100, height: 100, depth: 100 }));
      expect(JSON.stringify(scene)).toBe(before);
    });

    it('uses restoredPositions when present (skips clamp for listed objects)', () => {
      const scene = makeScene();
      // Build a command that ships an inverse envelope manually. Shrink the
      // tank, but tell apply to restore the first object to its original
      // (out-of-bounds) position.
      const cmd: SetTankDimensionsCommand = {
        kind: 'SetTankDimensions',
        dimensions: { width: 150, height: 60, depth: 80 },
        inverse: {
          previousDimensions: { width: 360, height: 220, depth: 220 },
          restoredPositions: {
            [obj1]: { x: 200, y: 80, z: 100 },
          },
        },
      };
      const r = applyOk(scene, cmd);
      if (!r.ok) return;
      // obj1 was restored to its pre-clamp position even though the new tank
      // would otherwise have clamped it.
      expect(getObjectById(r.scene, obj1)?.transform.position).toEqual({
        x: 200,
        y: 80,
        z: 100,
      });
      // obj2 had no entry, so it gets the usual clamp (was at 110,50,90).
      expect(getObjectById(r.scene, obj2)?.transform.position).toEqual({
        x: 110,
        y: 50,
        z: 80,
      });
    });
  });

  describe('Composite', () => {
    it('applies children in order', () => {
      const scene = makeScene();
      const layerNew = makeLayer('11111111-0000-4000-8000-00000000abcd', 'Z');
      const cmd = composite([addLayer(layerNew), renameLayer(layerNew.id, 'Final')]);
      const r = applyOk(scene, cmd);
      if (!r.ok) return;
      expect(getLayerById(r.scene, layerNew.id)?.name).toBe('Final');
    });

    it('rejects atomically on first failed child', () => {
      const scene = makeScene();
      const cmd = composite([
        renameLayer(layer1, 'first'),
        renameLayer(asLayerId('nope'), 'will-fail'),
      ]);
      const r = applyCommand(scene, cmd);
      expect(r.ok).toBe(false);
      // Original scene must be untouched.
      expect(getLayerById(scene, layer1)?.name).toBe('Hardscape');
    });

    it('empty composite is a no-op', () => {
      const scene = makeScene();
      const r = applyOk(scene, composite([]));
      if (!r.ok) return;
      expect(r.scene).toBe(scene);
    });
  });
});

describe('invertCommand', () => {
  it('Noop inverts to Noop', () => {
    const scene = makeScene();
    expect(invertCommand(scene, noop())).toEqual({ kind: 'Noop' });
  });

  it('AddLayer ∘ invert restores scene', () => {
    const scene = makeScene();
    const newLayer = makeLayer('11111111-0000-4000-8000-00000000feed', 'X');
    const cmd = addLayer(newLayer, 1);
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('RemoveLayer ∘ invert restores layer at same index', () => {
    const scene = makeScene();
    const cmd = removeLayer(layer1);
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('RenameLayer ∘ invert restores prior name', () => {
    const scene = makeScene();
    const cmd = renameLayer(layer1, 'Renamed!');
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('SetLayerOpacity ∘ invert restores prior opacity (when not clamped)', () => {
    const scene = makeScene();
    const cmd = setLayerOpacity(layer1, 0.4);
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('SetLayerVisibility ∘ invert restores', () => {
    const scene = makeScene();
    const cmd = setLayerVisibility(layer1, false);
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('SetLayerLocked ∘ invert restores', () => {
    const scene = makeScene();
    const cmd = setLayerLocked(layer1, true);
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('ReorderLayers ∘ invert restores order', () => {
    const scene = makeScene();
    const cmd = reorderLayers([layer2, layer1]);
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('AddObject ∘ invert removes the added object', () => {
    const scene = makeScene();
    const obj = makePlant('cccccccc-0000-4000-8000-000000000099');
    const cmd = addObject(layer2, obj, 0);
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('RemoveObject ∘ invert restores at original index', () => {
    const scene = makeScene();
    const cmd = removeObject(obj2);
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('MoveObject ∘ invert restores prior position', () => {
    const scene = makeScene();
    const cmd = moveObject(obj1, { x: 999, y: 999, z: 999 });
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('ReshapeObject ∘ invert restores prior transform', () => {
    const scene = makeScene();
    const cmd = reshapeObject(plant1, {
      ...identityTransform(),
      position: { x: 1, y: 2, z: 3 },
    });
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('SetTankDimensions ∘ invert restores (grow — no clamping)', () => {
    const scene = makeScene();
    const cmd = setTankDimensions({ width: 1000, height: 800, depth: 600 });
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('SetTankDimensions ∘ invert restores (shrink — clamps some objects)', () => {
    const scene = makeScene();
    // Capture the originals so we can verify exact restoration below.
    const originalObj1Position = JSON.parse(
      JSON.stringify(getObjectById(scene, obj1)?.transform.position),
    );
    const cmd = setTankDimensions({ width: 150, height: 60, depth: 80 });
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    // Confirm that apply actually clamped (sanity).
    expect(getObjectById(a.scene, obj1)?.transform.position).toEqual({ x: 150, y: 60, z: 80 });

    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
    expect(getObjectById(b.scene, obj1)?.transform.position).toEqual(originalObj1Position);
  });

  it('SetTankDimensions inverse-of-inverse round-trips', () => {
    const scene = makeScene();
    const cmd = setTankDimensions({ width: 150, height: 60, depth: 80 });
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    // Apply inverse to land back at the pre-apply scene.
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    // Now invert the inverse, against the scene the inverse saw (= a.scene).
    const invInv = invertCommand(a.scene, inv);
    // Apply inv-of-inv to b.scene (== scene), should yield a.scene again.
    const c = applyOk(b.scene, invInv);
    if (!c.ok) return;
    expect(c.scene).toEqual(a.scene);
  });

  it('SetTankDimensions invert populates restoredPositions for every object', () => {
    const scene = makeScene();
    const totalObjects = scene.layers.reduce((n, l) => n + l.objects.length, 0);
    const cmd = setTankDimensions({ width: 1000, height: 1000, depth: 1000 });
    const inv = invertCommand(scene, cmd);
    expect(inv.kind).toBe('SetTankDimensions');
    if (inv.kind !== 'SetTankDimensions') return;
    expect(inv.inverse).toBeDefined();
    expect(Object.keys(inv.inverse!.restoredPositions).length).toBe(totalObjects);
  });

  it('SetTankDimensions invert captures previous dimensions in `dimensions`', () => {
    const scene = makeScene();
    const cmd = setTankDimensions({ width: 1000, height: 1000, depth: 1000 });
    const inv = invertCommand(scene, cmd);
    if (inv.kind !== 'SetTankDimensions') {
      throw new Error('expected SetTankDimensions inverse');
    }
    expect(inv.dimensions).toEqual({
      width: scene.tank.width,
      height: scene.tank.height,
      depth: scene.tank.depth,
    });
    expect(inv.inverse?.previousDimensions).toEqual({ width: 1000, height: 1000, depth: 1000 });
  });

  it('Composite ∘ invert restores via reverse children', () => {
    const scene = makeScene();
    const newLayer = makeLayer('11111111-0000-4000-8000-0000000c0ff3', 'Tmp');
    const obj = makeHardscape('cccccccc-0000-4000-8000-0000000c0ff3');
    const cmd = composite([
      addLayer(newLayer),
      addObject(newLayer.id, obj),
      moveObject(obj.id, { x: 50, y: 60, z: 70 }),
    ]);
    const a = applyOk(scene, cmd);
    if (!a.ok) return;
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    if (!b.ok) return;
    expect(b.scene).toEqual(scene);
  });

  it('Composite that would reject inverts to Noop', () => {
    const scene = makeScene();
    const cmd = composite([renameLayer(asLayerId('nope'), 'x')]);
    expect(invertCommand(scene, cmd)).toEqual({ kind: 'Noop' });
  });

  it('inverts to Noop when target does not exist (graceful)', () => {
    const scene = makeScene();
    expect(invertCommand(scene, renameLayer(asLayerId('nope'), 'x'))).toEqual({
      kind: 'Noop',
    });
    expect(invertCommand(scene, removeLayer(asLayerId('nope')))).toEqual({
      kind: 'Noop',
    });
    expect(invertCommand(scene, setLayerOpacity(asLayerId('nope'), 0.5))).toEqual({
      kind: 'Noop',
    });
    expect(invertCommand(scene, setLayerVisibility(asLayerId('nope'), false))).toEqual({
      kind: 'Noop',
    });
    expect(invertCommand(scene, setLayerLocked(asLayerId('nope'), true))).toEqual({
      kind: 'Noop',
    });
    expect(invertCommand(scene, removeObject(asObjectId('nope')))).toEqual({
      kind: 'Noop',
    });
    expect(invertCommand(scene, moveObject(asObjectId('nope'), { x: 0, y: 0, z: 0 }))).toEqual({
      kind: 'Noop',
    });
    expect(invertCommand(scene, reshapeObject(asObjectId('nope'), identityTransform()))).toEqual({
      kind: 'Noop',
    });
  });
});

describe('locked-layer guard summary', () => {
  it('object commands are blocked; layer-metadata commands are not', () => {
    const scene = makeScene();
    scene.layers[0]!.locked = true;
    const obj = makeHardscape('cccccccc-0000-4000-8000-0000000000ab');

    // Blocked
    expect(applyCommand(scene, addObject(layer1, obj)).ok).toBe(false);
    expect(applyCommand(scene, removeObject(obj1)).ok).toBe(false);
    expect(applyCommand(scene, moveObject(obj1, { x: 0, y: 0, z: 0 })).ok).toBe(false);
    expect(applyCommand(scene, reshapeObject(obj1, identityTransform())).ok).toBe(false);

    // Not blocked
    expect(applyCommand(scene, renameLayer(layer1, 'Still')).ok).toBe(true);
    expect(applyCommand(scene, setLayerOpacity(layer1, 0.5)).ok).toBe(true);
    expect(applyCommand(scene, setLayerVisibility(layer1, false)).ok).toBe(true);
    expect(applyCommand(scene, setLayerLocked(layer1, false)).ok).toBe(true);
  });
});
