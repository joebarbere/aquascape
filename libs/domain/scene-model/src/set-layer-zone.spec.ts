// SetLayerZone — layer-metadata command. Layer.zone (schema v2) is the
// per-layer "foreground/midground/background" hint that Stage 10's 3D
// renderer consumes; the 2D renderer ignores it. Mirrors the
// property-absent-vs-null contract from SetObjectGroupId.

import { applyCommand, invertCommand, setLayerLocked, setLayerZone } from './commands';
import { asLayerId } from './ids';
import { makeScene } from './test-fixtures';
import type { Layer, LayerId, Scene } from './types';

const LAYER_A = asLayerId('11111111-0000-4000-8000-000000000001');
const LAYER_B = asLayerId('11111111-0000-4000-8000-000000000002');
const UNKNOWN = asLayerId('99999999-0000-4000-8000-000000000099');

function findLayer(scene: Scene, id: LayerId): Layer {
  const layer = scene.layers.find((l) => l.id === id);
  if (!layer) throw new Error(`fixture missing layer ${id}`);
  return layer;
}

describe('SetLayerZone — apply', () => {
  it('adds the zone property to a layer that has none', () => {
    const scene = makeScene();
    expect('zone' in findLayer(scene, LAYER_A)).toBe(false);
    const result = applyCommand(scene, setLayerZone(LAYER_A, 'foreground'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findLayer(result.scene, LAYER_A).zone).toBe('foreground');
  });

  it('replaces the zone property when the layer already has one', () => {
    const scene = makeScene();
    const first = applyCommand(scene, setLayerZone(LAYER_A, 'foreground'));
    if (!first.ok) throw new Error('precondition');
    const second = applyCommand(first.scene, setLayerZone(LAYER_A, 'background'));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(findLayer(second.scene, LAYER_A).zone).toBe('background');
  });

  it('REMOVES the zone property entirely when zone is null (round-trips as absent)', () => {
    const scene = makeScene();
    const set = applyCommand(scene, setLayerZone(LAYER_A, 'midground'));
    if (!set.ok) throw new Error('precondition');
    expect(findLayer(set.scene, LAYER_A).zone).toBe('midground');
    const cleared = applyCommand(set.scene, setLayerZone(LAYER_A, null));
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const layer = findLayer(cleared.scene, LAYER_A);
    expect('zone' in layer).toBe(false);
    // Confirm round-trip through JSON also has the field absent.
    const reparsed = JSON.parse(JSON.stringify(cleared.scene)) as Scene;
    expect('zone' in findLayer(reparsed, LAYER_A)).toBe(false);
  });

  it('rejects not-found when the target layer does not exist', () => {
    const scene = makeScene();
    const result = applyCommand(scene, setLayerZone(UNKNOWN, 'foreground'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('rejects invalid for a non-zone string value (defensive guard)', () => {
    const scene = makeScene();
    // The TS signature blocks this for normal callers; cast to exercise the
    // defensive runtime branch.
    const result = applyCommand(
      scene,
      setLayerZone(LAYER_A, 'banana' as unknown as 'foreground'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('is NOT blocked by layer.locked (metadata, not content)', () => {
    const scene = makeScene();
    const locked = applyCommand(scene, setLayerLocked(LAYER_A, true));
    if (!locked.ok) throw new Error('precondition');
    const result = applyCommand(locked.scene, setLayerZone(LAYER_A, 'background'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findLayer(result.scene, LAYER_A).zone).toBe('background');
  });

  it('returns the same layer reference when setting an unchanged zone (allocation-free no-op)', () => {
    const scene = makeScene();
    const set = applyCommand(scene, setLayerZone(LAYER_A, 'foreground'));
    if (!set.ok) throw new Error('precondition');
    const again = applyCommand(set.scene, setLayerZone(LAYER_A, 'foreground'));
    if (!again.ok) throw new Error('precondition');
    expect(findLayer(again.scene, LAYER_A)).toBe(findLayer(set.scene, LAYER_A));
  });

  it('clearing an already-absent zone is a no-op (returns the same layer reference)', () => {
    const scene = makeScene();
    expect('zone' in findLayer(scene, LAYER_A)).toBe(false);
    const result = applyCommand(scene, setLayerZone(LAYER_A, null));
    if (!result.ok) throw new Error('precondition');
    expect(findLayer(result.scene, LAYER_A)).toBe(findLayer(scene, LAYER_A));
  });
});

describe('SetLayerZone — invert (apply ∘ invert = id)', () => {
  it('round-trips a set-from-absent: invert REMOVES the property again', () => {
    const scene = makeScene();
    const cmd = setLayerZone(LAYER_A, 'foreground');
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('precondition');
    const inverse = invertCommand(scene, cmd);
    const restored = applyCommand(applied.scene, inverse);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect('zone' in findLayer(restored.scene, LAYER_A)).toBe(false);
    // Deep equality on the affected layer.
    expect(findLayer(restored.scene, LAYER_A)).toEqual(findLayer(scene, LAYER_A));
  });

  it('round-trips a replace: invert restores the previous zone string', () => {
    const scene = makeScene();
    const seeded = applyCommand(scene, setLayerZone(LAYER_A, 'foreground'));
    if (!seeded.ok) throw new Error('precondition');
    const cmd = setLayerZone(LAYER_A, 'background');
    const applied = applyCommand(seeded.scene, cmd);
    if (!applied.ok) throw new Error('precondition');
    const inverse = invertCommand(seeded.scene, cmd);
    const restored = applyCommand(applied.scene, inverse);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(findLayer(restored.scene, LAYER_A).zone).toBe('foreground');
    expect(findLayer(restored.scene, LAYER_A)).toEqual(findLayer(seeded.scene, LAYER_A));
  });

  it('round-trips a clear: invert reinstates the captured zone string', () => {
    const scene = makeScene();
    const seeded = applyCommand(scene, setLayerZone(LAYER_A, 'midground'));
    if (!seeded.ok) throw new Error('precondition');
    const cmd = setLayerZone(LAYER_A, null);
    const applied = applyCommand(seeded.scene, cmd);
    if (!applied.ok) throw new Error('precondition');
    expect('zone' in findLayer(applied.scene, LAYER_A)).toBe(false);
    const inverse = invertCommand(seeded.scene, cmd);
    const restored = applyCommand(applied.scene, inverse);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(findLayer(restored.scene, LAYER_A).zone).toBe('midground');
  });

  it('invert is Noop when the target layer does not exist (replay-safe)', () => {
    const scene = makeScene();
    const inverse = invertCommand(scene, setLayerZone(UNKNOWN, 'foreground'));
    expect(inverse.kind).toBe('Noop');
  });

  it('does not touch other layers (precise per-layer effect)', () => {
    const scene = makeScene();
    const cmd = setLayerZone(LAYER_A, 'foreground');
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('precondition');
    expect(findLayer(applied.scene, LAYER_B)).toBe(findLayer(scene, LAYER_B));
    const inverse = invertCommand(scene, cmd);
    const restored = applyCommand(applied.scene, inverse);
    if (!restored.ok) throw new Error('precondition');
    expect(findLayer(restored.scene, LAYER_B)).toBe(findLayer(scene, LAYER_B));
  });

  it('is JSON-serializable (no closures, no class instances)', () => {
    const cmd = setLayerZone(LAYER_A, 'midground');
    const round = JSON.parse(JSON.stringify(cmd));
    expect(round).toEqual(cmd);
  });
});
