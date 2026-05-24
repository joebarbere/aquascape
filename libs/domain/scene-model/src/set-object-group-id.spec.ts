// Stage 4 F4.3 — SetObjectGroupId batch command.

import { applyCommand, invertCommand, setLayerLocked, setObjectGroupId } from './commands';
import { asLayerId, asObjectId } from './ids';
import { makeHardscape, makeLayer, makeScene } from './test-fixtures';
import type { ObjectId, Scene } from './types';

const a = asObjectId('aaaaaaaa-0000-4000-8000-000000000001');
const b = asObjectId('bbbbbbbb-0000-4000-8000-000000000002');
const c = asObjectId('cccccccc-0000-4000-8000-000000000003');
const group = asObjectId('99999999-0000-4000-8000-000000000099');

function threeObjectScene(): Scene {
  return {
    ...makeScene(),
    layers: [
      makeLayer('layer-1', 'Hardscape', [makeHardscape(a), makeHardscape(b), makeHardscape(c)]),
    ],
  };
}

describe('SetObjectGroupId — apply', () => {
  it('sets groupId on every listed object in a single command', () => {
    const result = applyCommand(threeObjectScene(), setObjectGroupId([a, b], group));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const objs = result.scene.layers[0]!.objects;
    expect(objs.find((o) => o.id === a)!.groupId).toBe(group);
    expect(objs.find((o) => o.id === b)!.groupId).toBe(group);
    expect(objs.find((o) => o.id === c)!.groupId).toBeUndefined();
  });

  it('accepts a single object id (constructor wraps it in an array)', () => {
    const result = applyCommand(threeObjectScene(), setObjectGroupId(a, group));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.layers[0]!.objects[0]!.groupId).toBe(group);
  });

  it('REMOVES the groupId property entirely when groupId is null', () => {
    const grouped = applyCommand(threeObjectScene(), setObjectGroupId([a, b], group));
    if (!grouped.ok) throw new Error('precondition');
    const ungrouped = applyCommand(grouped.scene, setObjectGroupId([a, b], null));
    expect(ungrouped.ok).toBe(true);
    if (!ungrouped.ok) return;
    const ao = ungrouped.scene.layers[0]!.objects.find((o) => o.id === a)!;
    expect('groupId' in ao).toBe(false);
  });

  it('returns ok unchanged for an empty objectIds list (no-op)', () => {
    const scene = threeObjectScene();
    const result = applyCommand(scene, setObjectGroupId([], group));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene).toBe(scene);
  });

  it('rejects with not-found when any object id is unknown (atomic — no partial write)', () => {
    const scene = threeObjectScene();
    const result = applyCommand(
      scene,
      setObjectGroupId([a, asObjectId('00000000-0000-4000-8000-deaddeaddead')], group),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('rejects with locked when any affected layer is locked', () => {
    const scene = threeObjectScene();
    const lockResult = applyCommand(scene, setLayerLocked(asLayerId('layer-1'), true));
    if (!lockResult.ok) throw new Error('precondition');
    const result = applyCommand(lockResult.scene, setObjectGroupId([a, b], group));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('locked');
  });

  it('preserves untouched objects by reference (allocation-free for non-targets)', () => {
    const scene = threeObjectScene();
    const result = applyCommand(scene, setObjectGroupId([a], group));
    if (!result.ok) throw new Error('precondition');
    const original = scene.layers[0]!.objects.find((o) => o.id === c)!;
    const next = result.scene.layers[0]!.objects.find((o) => o.id === c)!;
    expect(next).toBe(original);
  });
});

describe('SetObjectGroupId — invert', () => {
  it('round-trips a homogeneous group → original (no groupId on any object)', () => {
    const scene = threeObjectScene();
    const cmd = setObjectGroupId([a, b, c], group);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('precondition');
    const inverse = invertCommand(scene, cmd);
    const restored = applyCommand(applied.scene, inverse);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    for (const obj of restored.scene.layers[0]!.objects) {
      expect('groupId' in obj).toBe(false);
    }
  });

  it('round-trips an UNGROUP back to the heterogeneous original groups', () => {
    const scene = threeObjectScene();
    const other = asObjectId('88888888-0000-4000-8000-000000000088');
    // Pre-state: a + b in `group`, c in `other`.
    const seed = applyCommand(
      applyCommand(scene, setObjectGroupId([a, b], group)).ok
        ? (applyCommand(scene, setObjectGroupId([a, b], group)) as { ok: true; scene: Scene }).scene
        : scene,
      setObjectGroupId([c], other),
    );
    if (!seed.ok) throw new Error('precondition');
    const ungroup = setObjectGroupId([a, b, c], null);
    const after = applyCommand(seed.scene, ungroup);
    if (!after.ok) throw new Error('precondition');
    const inverse = invertCommand(seed.scene, ungroup);
    const restored = applyCommand(after.scene, inverse);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const objs = restored.scene.layers[0]!.objects;
    expect(objs.find((o) => o.id === a)!.groupId).toBe(group);
    expect(objs.find((o) => o.id === b)!.groupId).toBe(group);
    expect(objs.find((o) => o.id === c)!.groupId).toBe(other);
  });

  it('inverse of an empty-list command is Noop (no-op replay-safe)', () => {
    const scene = threeObjectScene();
    const inverse = invertCommand(scene, setObjectGroupId([] as ObjectId[], group));
    expect(inverse.kind).toBe('Noop');
  });

  it('inverse of a command targeting a missing id is Noop (apply would reject)', () => {
    const scene = threeObjectScene();
    const inverse = invertCommand(
      scene,
      setObjectGroupId([asObjectId('00000000-0000-4000-8000-aaaaaaaaaaaa')], group),
    );
    expect(inverse.kind).toBe('Noop');
  });
});
