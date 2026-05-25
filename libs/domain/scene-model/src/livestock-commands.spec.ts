/**
 * Stage 7 F7.1 livestock command tests.
 *
 * Covers each of the three livestock commands plus their `apply ∘ invert =
 * id` invariants. Uses a tiny hand-rolled scene fixture (livestock-empty by
 * default) so the tests are self-contained.
 *
 * The reject paths (not-found, invalid) are exercised explicitly because
 * the locked-layer guard does NOT apply to livestock — they're scene-level,
 * not layer-level, so the existing object-level lock tests don't cover this
 * area.
 */

import { applyCommand, invertCommand } from './commands';
import {
  addLivestockEntry,
  removeLivestockEntry,
  updateLivestockQuantity,
} from './livestock-commands';
import { makeScene } from './test-fixtures';
import type { LivestockEntry, Scene } from './types';

const entryA: LivestockEntry = {
  id: 'a0000000-0000-4000-8000-000000000001',
  ref: { catalog: 'core', id: 'fish.boraras.brigittae', version: 1 },
  quantity: 12,
};

const entryB: LivestockEntry = {
  id: 'b0000000-0000-4000-8000-000000000002',
  ref: { catalog: 'core', id: 'shrimp.neocaridina.davidi', version: 1 },
  quantity: 6,
};

function emptyLivestockScene(): Scene {
  // makeScene() has no livestock; start from there to keep object/layer
  // shape realistic in case any cross-pollination appears later.
  return makeScene();
}

function sceneWithLivestock(entries: LivestockEntry[]): Scene {
  return { ...emptyLivestockScene(), livestock: entries };
}

describe('AddLivestockEntry', () => {
  it('appends to an undefined livestock array (initializing it)', () => {
    const scene = emptyLivestockScene();
    const result = applyCommand(scene, addLivestockEntry(entryA));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.livestock).toEqual([entryA]);
  });

  it('appends to an existing livestock array', () => {
    const scene = sceneWithLivestock([entryA]);
    const result = applyCommand(scene, addLivestockEntry(entryB));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.livestock?.map((e) => e.id)).toEqual([entryA.id, entryB.id]);
  });

  it('rejects when an entry with the same id already exists', () => {
    const scene = sceneWithLivestock([entryA]);
    const result = applyCommand(scene, addLivestockEntry(entryA));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('rejects an entry with quantity 0', () => {
    const bad: LivestockEntry = { ...entryA, quantity: 0 };
    const result = applyCommand(emptyLivestockScene(), addLivestockEntry(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('rejects an entry with a non-integer quantity', () => {
    const bad: LivestockEntry = { ...entryA, quantity: 2.5 };
    const result = applyCommand(emptyLivestockScene(), addLivestockEntry(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('ignores locked layers (livestock are not in any layer)', () => {
    // Lock every layer; the livestock command must still succeed.
    const scene: Scene = {
      ...emptyLivestockScene(),
      layers: emptyLivestockScene().layers.map((l) => ({ ...l, locked: true })),
    };
    const result = applyCommand(scene, addLivestockEntry(entryA));
    expect(result.ok).toBe(true);
  });

  it('does not mutate the input scene', () => {
    const scene = sceneWithLivestock([entryA]);
    const before = JSON.stringify(scene);
    applyCommand(scene, addLivestockEntry(entryB));
    expect(JSON.stringify(scene)).toBe(before);
  });

  it('inverse + apply restores the original scene (apply ∘ invert = id)', () => {
    const scene = sceneWithLivestock([entryA]);
    const cmd = addLivestockEntry(entryB);
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    expect(restored.scene).toEqual(scene);
  });
});

describe('RemoveLivestockEntry', () => {
  it('removes the entry by id', () => {
    const scene = sceneWithLivestock([entryA, entryB]);
    const result = applyCommand(scene, removeLivestockEntry(entryA.id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.livestock?.map((e) => e.id)).toEqual([entryB.id]);
  });

  it('reports not-found when no entry has that id', () => {
    const scene = sceneWithLivestock([entryA]);
    const result = applyCommand(scene, removeLivestockEntry('nope'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('reports not-found when livestock is undefined', () => {
    const scene = emptyLivestockScene();
    const result = applyCommand(scene, removeLivestockEntry(entryA.id));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('leaves the scene unchanged on not-found', () => {
    const scene = sceneWithLivestock([entryA]);
    const before = JSON.stringify(scene);
    applyCommand(scene, removeLivestockEntry('nope'));
    expect(JSON.stringify(scene)).toBe(before);
  });

  it('inverse + apply restores the original ordering (apply ∘ invert = id)', () => {
    const scene = sceneWithLivestock([entryA, entryB]);
    const cmd = removeLivestockEntry(entryA.id);
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    // Ordering preserved — A is back at index 0, not appended after B.
    expect(restored.scene.livestock).toEqual([entryA, entryB]);
    expect(restored.scene).toEqual(scene);
  });

  it('inverse of removing a middle entry restores its position', () => {
    const entryC: LivestockEntry = {
      id: 'c0000000-0000-4000-8000-000000000003',
      ref: { catalog: 'core', id: 'snail.neritina', version: 1 },
      quantity: 2,
    };
    const scene = sceneWithLivestock([entryA, entryB, entryC]);
    const cmd = removeLivestockEntry(entryB.id);
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    expect(restored.scene.livestock).toEqual([entryA, entryB, entryC]);
  });

  it('removing the last entry drops the livestock field (absent stays absent on undo)', () => {
    const scene = sceneWithLivestock([entryA]);
    const cmd = removeLivestockEntry(entryA.id);
    const result = applyCommand(scene, cmd);
    if (!result.ok) throw new Error('apply failed');
    expect('livestock' in result.scene).toBe(false);
  });

  it('invertCommand of a not-found remove returns Noop', () => {
    const scene = sceneWithLivestock([entryA]);
    expect(invertCommand(scene, removeLivestockEntry('nope'))).toEqual({ kind: 'Noop' });
  });

  it('invertCommand on an empty scene returns Noop (livestock undefined)', () => {
    const scene = emptyLivestockScene();
    expect(invertCommand(scene, removeLivestockEntry(entryA.id))).toEqual({ kind: 'Noop' });
  });
});

describe('UpdateLivestockQuantity', () => {
  it('replaces the entry quantity', () => {
    const scene = sceneWithLivestock([entryA]);
    const result = applyCommand(scene, updateLivestockQuantity(entryA.id, 7));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.livestock?.[0]?.quantity).toBe(7);
  });

  it('rejects quantity = 0 with reason "invalid"', () => {
    const scene = sceneWithLivestock([entryA]);
    const result = applyCommand(scene, updateLivestockQuantity(entryA.id, 0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('rejects negative quantity with reason "invalid"', () => {
    const scene = sceneWithLivestock([entryA]);
    const result = applyCommand(scene, updateLivestockQuantity(entryA.id, -3));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('rejects non-integer quantity with reason "invalid"', () => {
    const scene = sceneWithLivestock([entryA]);
    const result = applyCommand(scene, updateLivestockQuantity(entryA.id, 3.5));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('rejects NaN quantity with reason "invalid"', () => {
    const scene = sceneWithLivestock([entryA]);
    const result = applyCommand(scene, updateLivestockQuantity(entryA.id, Number.NaN));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('reports not-found when no entry has that id', () => {
    const scene = sceneWithLivestock([entryA]);
    const result = applyCommand(scene, updateLivestockQuantity('nope', 5));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('reports not-found when livestock is undefined', () => {
    const scene = emptyLivestockScene();
    const result = applyCommand(scene, updateLivestockQuantity(entryA.id, 5));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('does not mutate the input scene on success', () => {
    const scene = sceneWithLivestock([entryA]);
    const before = JSON.stringify(scene);
    applyCommand(scene, updateLivestockQuantity(entryA.id, 99));
    expect(JSON.stringify(scene)).toBe(before);
  });

  it('inverse + apply restores the original quantity', () => {
    const scene = sceneWithLivestock([entryA]);
    const cmd = updateLivestockQuantity(entryA.id, 99);
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    expect(restored.scene).toEqual(scene);
  });

  it('inverse captures the would-be-applied quantity in its envelope', () => {
    const scene = sceneWithLivestock([entryA]);
    const cmd = updateLivestockQuantity(entryA.id, 99);
    const inv = invertCommand(scene, cmd);
    expect(inv).toEqual({
      kind: 'UpdateLivestockQuantity',
      entryId: entryA.id,
      quantity: entryA.quantity,
      inverse: { previousQuantity: 99 },
    });
  });

  it('invertCommand of an unknown id is Noop', () => {
    const scene = sceneWithLivestock([entryA]);
    expect(invertCommand(scene, updateLivestockQuantity('nope', 5))).toEqual({
      kind: 'Noop',
    });
  });
});

describe('Composed livestock chains', () => {
  it('Add → Update → invert chain returns to the original scene', () => {
    const scene = emptyLivestockScene();
    const add = addLivestockEntry(entryA);
    const r1 = applyCommand(scene, add);
    if (!r1.ok) throw new Error('add failed');

    const upd = updateLivestockQuantity(entryA.id, 25);
    const r2 = applyCommand(r1.scene, upd);
    if (!r2.ok) throw new Error('update failed');

    const invUpd = invertCommand(r1.scene, upd);
    const r3 = applyCommand(r2.scene, invUpd);
    if (!r3.ok) throw new Error('invert update failed');
    expect(r3.scene).toEqual(r1.scene);

    const invAdd = invertCommand(scene, add);
    const r4 = applyCommand(r3.scene, invAdd);
    if (!r4.ok) throw new Error('invert add failed');
    expect(r4.scene).toEqual(scene);
  });
});
