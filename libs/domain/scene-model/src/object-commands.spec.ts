// Stage 3 F3.3 / F3.4 object commands: MirrorObject + ReorderObjectInLayer.
//
// Lives in its own spec file (not commands.spec.ts) to keep the new test
// set discoverable. Uses the existing test-fixtures helpers.

import { applyCommand, invertCommand, mirrorObject, reorderObjectInLayer } from './commands';
import { asObjectId } from './ids';
import { makeHardscape, makeLayer, makePlant, makeScene } from './test-fixtures';
import type { Scene } from './types';

function sceneWithObjects(...ids: string[]): Scene {
  return {
    ...makeScene(),
    layers: [
      makeLayer(
        'layer-1',
        'Hardscape',
        ids.map((id) => makeHardscape(id)),
      ),
    ],
  };
}

describe('MirrorObject', () => {
  it('toggles flipX when axis = "x"', () => {
    const scene = sceneWithObjects('obj-a');
    const result = applyCommand(scene, mirrorObject(asObjectId('obj-a'), 'x'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.layers[0]!.objects[0]!.transform.flipX).toBe(true);
    expect(result.scene.layers[0]!.objects[0]!.transform.flipY).toBe(false);
  });

  it('toggles flipY when axis = "y"', () => {
    const scene = sceneWithObjects('obj-a');
    const result = applyCommand(scene, mirrorObject(asObjectId('obj-a'), 'y'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.layers[0]!.objects[0]!.transform.flipY).toBe(true);
  });

  it('twice = identity (self-inverse)', () => {
    const scene = sceneWithObjects('obj-a');
    const r1 = applyCommand(scene, mirrorObject(asObjectId('obj-a'), 'x'));
    if (!r1.ok) throw new Error('first apply failed');
    const r2 = applyCommand(r1.scene, mirrorObject(asObjectId('obj-a'), 'x'));
    if (!r2.ok) throw new Error('second apply failed');
    expect(r2.scene.layers[0]!.objects[0]!.transform.flipX).toBe(false);
  });

  it('invertCommand returns the same MirrorObject (self-inverse semantics)', () => {
    const scene = sceneWithObjects('obj-a');
    const cmd = mirrorObject(asObjectId('obj-a'), 'x');
    const inv = invertCommand(scene, cmd);
    expect(inv).toEqual(cmd);
  });

  it('reports not-found for unknown object id', () => {
    const scene = sceneWithObjects('obj-a');
    const result = applyCommand(scene, mirrorObject(asObjectId('nope'), 'x'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('blocked by layer.locked', () => {
    const scene = {
      ...makeScene(),
      layers: [makeLayer('l', 'L', [makeHardscape('obj-a')], true)],
    };
    const result = applyCommand(scene, mirrorObject(asObjectId('obj-a'), 'x'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('locked');
  });

  it('invertCommand of a not-found mirror returns Noop', () => {
    const scene = sceneWithObjects('obj-a');
    expect(invertCommand(scene, mirrorObject(asObjectId('nope'), 'y'))).toEqual({
      kind: 'Noop',
    });
  });

  it('rejects axis="y" on plant objects (plants always grow up from the substrate)', () => {
    const plantId = '11111111-1111-4000-8000-000000000001';
    const scene: Scene = {
      ...makeScene(),
      layers: [makeLayer('layer-plants', 'Plants', [makePlant(plantId)])],
    };
    const result = applyCommand(scene, mirrorObject(asObjectId(plantId), 'y'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
    expect(result.message).toContain('plant');
  });

  it('still allows axis="x" on plant objects (horizontal mirror is fine)', () => {
    const plantId = '11111111-1111-4000-8000-000000000002';
    const scene: Scene = {
      ...makeScene(),
      layers: [makeLayer('layer-plants', 'Plants', [makePlant(plantId)])],
    };
    const result = applyCommand(scene, mirrorObject(asObjectId(plantId), 'x'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.layers[0]!.objects[0]!.transform.flipX).toBe(true);
    expect(result.scene.layers[0]!.objects[0]!.transform.flipY).toBe(false);
  });
});

describe('ReorderObjectInLayer', () => {
  it('moves an object from front to back within its layer', () => {
    const scene = sceneWithObjects('a', 'b', 'c');
    const result = applyCommand(scene, reorderObjectInLayer(asObjectId('c'), 0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.layers[0]!.objects.map((o) => o.id)).toEqual(['c', 'a', 'b']);
  });

  it('moves an object from back to front within its layer', () => {
    const scene = sceneWithObjects('a', 'b', 'c');
    const result = applyCommand(scene, reorderObjectInLayer(asObjectId('a'), 2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.layers[0]!.objects.map((o) => o.id)).toEqual(['b', 'c', 'a']);
  });

  it('no-ops when toIndex equals fromIndex', () => {
    const scene = sceneWithObjects('a', 'b');
    const result = applyCommand(scene, reorderObjectInLayer(asObjectId('a'), 0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene).toBe(scene);
  });

  it('rejects toIndex < 0', () => {
    const scene = sceneWithObjects('a', 'b');
    const result = applyCommand(scene, reorderObjectInLayer(asObjectId('a'), -1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('rejects toIndex >= length', () => {
    const scene = sceneWithObjects('a', 'b');
    const result = applyCommand(scene, reorderObjectInLayer(asObjectId('a'), 99));
    expect(result.ok).toBe(false);
  });

  it('reports not-found for an unknown object id', () => {
    const scene = sceneWithObjects('a');
    const result = applyCommand(scene, reorderObjectInLayer(asObjectId('nope'), 0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('blocked by layer.locked', () => {
    const scene = {
      ...makeScene(),
      layers: [makeLayer('l', 'L', [makeHardscape('a'), makeHardscape('b')], true)],
    };
    const result = applyCommand(scene, reorderObjectInLayer(asObjectId('a'), 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('locked');
  });

  it('invertCommand restores the previous index (apply ∘ invert = identity)', () => {
    const scene = sceneWithObjects('a', 'b', 'c');
    const cmd = reorderObjectInLayer(asObjectId('a'), 2);
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('restore failed');
    expect(restored.scene.layers[0]!.objects.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('invertCommand of an unknown object id is Noop', () => {
    const scene = sceneWithObjects('a');
    expect(invertCommand(scene, reorderObjectInLayer(asObjectId('nope'), 0))).toEqual({
      kind: 'Noop',
    });
  });
});
