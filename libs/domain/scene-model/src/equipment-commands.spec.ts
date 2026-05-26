/**
 * Stage 7 F7.3 equipment command tests.
 *
 * Mirrors `livestock-commands.spec.ts`. Covers each of the four equipment
 * commands plus their `apply ∘ invert = id` invariants in every state path
 * (note present / absent / cleared; settings present / absent / replaced /
 * cleared). The reject paths (not-found, invalid) are exercised explicitly
 * because the locked-layer guard does NOT apply to equipment.
 */

import { applyCommand, invertCommand } from './commands';
import {
  addEquipmentEntry,
  removeEquipmentEntry,
  setEquipmentNote,
  updateEquipmentSettings,
} from './equipment-commands';
import { makeScene } from './test-fixtures';
import type { EquipmentEntry, Scene } from './types';

const entryA: EquipmentEntry = {
  id: 'e0000000-0000-4000-8000-000000000001',
  ref: { catalog: 'core', id: 'filter.canister.eheim-2217', version: 1 },
  settings: { wattage: 20 },
};

const entryB: EquipmentEntry = {
  id: 'e0000000-0000-4000-8000-000000000002',
  ref: { catalog: 'core', id: 'heater.eheim-jager-100', version: 1 },
  settings: { wattage: 100, targetTempC: 24 },
  note: 'Set to 24C for shrimp',
};

function emptyEquipmentScene(): Scene {
  return makeScene();
}

function sceneWithEquipment(entries: EquipmentEntry[]): Scene {
  return { ...emptyEquipmentScene(), equipment: entries };
}

describe('AddEquipmentEntry', () => {
  it('appends to an undefined equipment array (initializing it)', () => {
    const scene = emptyEquipmentScene();
    const result = applyCommand(scene, addEquipmentEntry(entryA));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.equipment).toEqual([entryA]);
  });

  it('appends to an existing equipment array', () => {
    const scene = sceneWithEquipment([entryA]);
    const result = applyCommand(scene, addEquipmentEntry(entryB));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.equipment?.map((e) => e.id)).toEqual([entryA.id, entryB.id]);
  });

  it('rejects when an entry with the same id already exists', () => {
    const scene = sceneWithEquipment([entryA]);
    const result = applyCommand(scene, addEquipmentEntry(entryA));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('rejects an entry with a non-primitive setting value', () => {
    const bad: EquipmentEntry = {
      ...entryA,
      settings: { nested: { wattage: 1 } as unknown as number },
    };
    const result = applyCommand(emptyEquipmentScene(), addEquipmentEntry(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('ignores locked layers (equipment is not in any layer)', () => {
    const scene: Scene = {
      ...emptyEquipmentScene(),
      layers: emptyEquipmentScene().layers.map((l) => ({ ...l, locked: true })),
    };
    const result = applyCommand(scene, addEquipmentEntry(entryA));
    expect(result.ok).toBe(true);
  });

  it('does not mutate the input scene', () => {
    const scene = sceneWithEquipment([entryA]);
    const before = JSON.stringify(scene);
    applyCommand(scene, addEquipmentEntry(entryB));
    expect(JSON.stringify(scene)).toBe(before);
  });

  it('inverse + apply restores the original scene (apply ∘ invert = id)', () => {
    const scene = sceneWithEquipment([entryA]);
    const cmd = addEquipmentEntry(entryB);
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    expect(restored.scene).toEqual(scene);
  });
});

describe('RemoveEquipmentEntry', () => {
  it('removes the entry by id', () => {
    const scene = sceneWithEquipment([entryA, entryB]);
    const result = applyCommand(scene, removeEquipmentEntry(entryA.id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.equipment?.map((e) => e.id)).toEqual([entryB.id]);
  });

  it('reports not-found when no entry has that id', () => {
    const scene = sceneWithEquipment([entryA]);
    const result = applyCommand(scene, removeEquipmentEntry('nope'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('reports not-found when equipment is undefined', () => {
    const scene = emptyEquipmentScene();
    const result = applyCommand(scene, removeEquipmentEntry(entryA.id));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('leaves the scene unchanged on not-found', () => {
    const scene = sceneWithEquipment([entryA]);
    const before = JSON.stringify(scene);
    applyCommand(scene, removeEquipmentEntry('nope'));
    expect(JSON.stringify(scene)).toBe(before);
  });

  it('inverse + apply restores the original ordering (apply ∘ invert = id)', () => {
    const scene = sceneWithEquipment([entryA, entryB]);
    const cmd = removeEquipmentEntry(entryA.id);
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    expect(restored.scene.equipment).toEqual([entryA, entryB]);
    expect(restored.scene).toEqual(scene);
  });

  it('inverse of removing a middle entry restores its position', () => {
    const entryC: EquipmentEntry = {
      id: 'e0000000-0000-4000-8000-000000000003',
      ref: { catalog: 'core', id: 'co2.reg.test', version: 1 },
    };
    const scene = sceneWithEquipment([entryA, entryB, entryC]);
    const cmd = removeEquipmentEntry(entryB.id);
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    expect(restored.scene.equipment).toEqual([entryA, entryB, entryC]);
  });

  it('removing the last entry drops the equipment field (absent stays absent on undo)', () => {
    const scene = sceneWithEquipment([entryA]);
    const cmd = removeEquipmentEntry(entryA.id);
    const result = applyCommand(scene, cmd);
    if (!result.ok) throw new Error('apply failed');
    expect('equipment' in result.scene).toBe(false);
  });

  it('invertCommand of a not-found remove returns Noop', () => {
    const scene = sceneWithEquipment([entryA]);
    expect(invertCommand(scene, removeEquipmentEntry('nope'))).toEqual({ kind: 'Noop' });
  });

  it('invertCommand on an empty scene returns Noop (equipment undefined)', () => {
    const scene = emptyEquipmentScene();
    expect(invertCommand(scene, removeEquipmentEntry(entryA.id))).toEqual({ kind: 'Noop' });
  });
});

describe('SetEquipmentNote', () => {
  it('sets a note on an entry that has none', () => {
    const scene = sceneWithEquipment([entryA]);
    const result = applyCommand(scene, setEquipmentNote(entryA.id, 'Replaced impeller'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.equipment?.[0]?.note).toBe('Replaced impeller');
  });

  it('replaces an existing note', () => {
    const scene = sceneWithEquipment([entryB]);
    const result = applyCommand(scene, setEquipmentNote(entryB.id, 'Bumped to 25C'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.equipment?.[0]?.note).toBe('Bumped to 25C');
  });

  it('clears a note via null — the property is REMOVED entirely', () => {
    const scene = sceneWithEquipment([entryB]);
    const result = applyCommand(scene, setEquipmentNote(entryB.id, null));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cleared = result.scene.equipment?.[0] as EquipmentEntry;
    expect('note' in cleared).toBe(false);
    // JSON should have no "note": key at all on the cleared entry.
    expect(JSON.stringify(cleared)).not.toContain('"note"');
  });

  it('rejects empty-string note with reason "invalid"', () => {
    const scene = sceneWithEquipment([entryA]);
    const result = applyCommand(scene, setEquipmentNote(entryA.id, ''));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('reports not-found when no entry has that id', () => {
    const scene = sceneWithEquipment([entryA]);
    const result = applyCommand(scene, setEquipmentNote('nope', 'hi'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('reports not-found when equipment is undefined', () => {
    const scene = emptyEquipmentScene();
    const result = applyCommand(scene, setEquipmentNote(entryA.id, 'hi'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('does not mutate the input scene', () => {
    const scene = sceneWithEquipment([entryA]);
    const before = JSON.stringify(scene);
    applyCommand(scene, setEquipmentNote(entryA.id, 'mutate-check'));
    expect(JSON.stringify(scene)).toBe(before);
  });

  // ── apply ∘ invert = id for every state path ───────────────────────────

  it('apply ∘ invert = id when setting a note on an entry that had none', () => {
    const scene = sceneWithEquipment([entryA]); // entryA has no note
    const cmd = setEquipmentNote(entryA.id, 'first note');
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    expect(restored.scene).toEqual(scene);
    // Specifically: the restored entry has NO `note` property at all.
    expect('note' in (restored.scene.equipment?.[0] as EquipmentEntry)).toBe(false);
  });

  it('apply ∘ invert = id when replacing an existing note', () => {
    const scene = sceneWithEquipment([entryB]); // entryB.note === 'Set to 24C for shrimp'
    const cmd = setEquipmentNote(entryB.id, 'new note');
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    expect(restored.scene).toEqual(scene);
    expect(restored.scene.equipment?.[0]?.note).toBe(entryB.note);
  });

  it('apply ∘ invert = id when clearing an existing note via null', () => {
    const scene = sceneWithEquipment([entryB]);
    const cmd = setEquipmentNote(entryB.id, null);
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    expect(restored.scene).toEqual(scene);
    expect(restored.scene.equipment?.[0]?.note).toBe(entryB.note);
  });

  it('apply set-then-clear-then-undo restores the originally-absent note', () => {
    const scene = sceneWithEquipment([entryA]); // no note
    // 1. set a note
    const setCmd = setEquipmentNote(entryA.id, 'temp');
    const r1 = applyCommand(scene, setCmd);
    if (!r1.ok) throw new Error('apply set failed');
    // 2. clear it
    const clearCmd = setEquipmentNote(entryA.id, null);
    const r2 = applyCommand(r1.scene, clearCmd);
    if (!r2.ok) throw new Error('apply clear failed');
    expect('note' in (r2.scene.equipment?.[0] as EquipmentEntry)).toBe(false);
    // 3. invert clear → should restore note
    const invClear = invertCommand(r1.scene, clearCmd);
    const r3 = applyCommand(r2.scene, invClear);
    if (!r3.ok) throw new Error('invert clear failed');
    expect(r3.scene).toEqual(r1.scene);
    // 4. invert set → should remove note again
    const invSet = invertCommand(scene, setCmd);
    const r4 = applyCommand(r3.scene, invSet);
    if (!r4.ok) throw new Error('invert set failed');
    expect(r4.scene).toEqual(scene);
  });

  it('invertCommand of an unknown id is Noop', () => {
    const scene = sceneWithEquipment([entryA]);
    expect(invertCommand(scene, setEquipmentNote('nope', 'x'))).toEqual({ kind: 'Noop' });
  });
});

describe('UpdateEquipmentSettings', () => {
  it('wholesale-replaces the settings (no merge)', () => {
    const scene = sceneWithEquipment([entryB]); // settings: { wattage: 100, targetTempC: 24 }
    const result = applyCommand(
      scene,
      updateEquipmentSettings(entryB.id, { wattage: 50 }), // ONLY wattage
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.equipment?.[0]?.settings).toEqual({ wattage: 50 });
    // targetTempC is gone — wholesale replace, not merge.
    expect((result.scene.equipment?.[0]?.settings ?? {}).targetTempC).toBeUndefined();
  });

  it('sets settings on an entry that has none', () => {
    const noSettingsEntry: EquipmentEntry = {
      id: 'e0000000-0000-4000-8000-000000000099',
      ref: { catalog: 'core', id: 'air.pump.test', version: 1 },
    };
    const scene = sceneWithEquipment([noSettingsEntry]);
    const result = applyCommand(
      scene,
      updateEquipmentSettings(noSettingsEntry.id, { flowRate: 30 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.equipment?.[0]?.settings).toEqual({ flowRate: 30 });
  });

  it('clears settings via null — the property is REMOVED entirely', () => {
    const scene = sceneWithEquipment([entryA]);
    const result = applyCommand(scene, updateEquipmentSettings(entryA.id, null));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cleared = result.scene.equipment?.[0] as EquipmentEntry;
    expect('settings' in cleared).toBe(false);
    expect(JSON.stringify(cleared)).not.toContain('"settings"');
  });

  it('accepts mixed primitive types (number / string / boolean)', () => {
    const scene = sceneWithEquipment([entryA]);
    const result = applyCommand(
      scene,
      updateEquipmentSettings(entryA.id, {
        wattage: 30,
        mode: 'high',
        enabled: true,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.equipment?.[0]?.settings).toEqual({
      wattage: 30,
      mode: 'high',
      enabled: true,
    });
  });

  it('rejects a non-primitive setting value (nested object)', () => {
    const scene = sceneWithEquipment([entryA]);
    const result = applyCommand(
      scene,
      updateEquipmentSettings(entryA.id, {
        nested: { wattage: 1 } as unknown as number,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('rejects a non-primitive setting value (array)', () => {
    const scene = sceneWithEquipment([entryA]);
    const result = applyCommand(
      scene,
      updateEquipmentSettings(entryA.id, {
        modes: ['high', 'low'] as unknown as string,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('rejects a non-primitive setting value (null)', () => {
    const scene = sceneWithEquipment([entryA]);
    const result = applyCommand(
      scene,
      updateEquipmentSettings(entryA.id, {
        wattage: null as unknown as number,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('reports not-found when no entry has that id', () => {
    const scene = sceneWithEquipment([entryA]);
    const result = applyCommand(scene, updateEquipmentSettings('nope', { wattage: 5 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('reports not-found when equipment is undefined', () => {
    const scene = emptyEquipmentScene();
    const result = applyCommand(scene, updateEquipmentSettings(entryA.id, { wattage: 5 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('does not mutate the input scene on success', () => {
    const scene = sceneWithEquipment([entryA]);
    const before = JSON.stringify(scene);
    applyCommand(scene, updateEquipmentSettings(entryA.id, { wattage: 99 }));
    expect(JSON.stringify(scene)).toBe(before);
  });

  // ── apply ∘ invert = id for every state path ───────────────────────────

  it('apply ∘ invert = id when setting settings on an entry that had none', () => {
    const noSettingsEntry: EquipmentEntry = {
      id: 'e0000000-0000-4000-8000-000000000099',
      ref: { catalog: 'core', id: 'air.pump.test', version: 1 },
    };
    const scene = sceneWithEquipment([noSettingsEntry]);
    const cmd = updateEquipmentSettings(noSettingsEntry.id, { flowRate: 30 });
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    expect(restored.scene).toEqual(scene);
    expect('settings' in (restored.scene.equipment?.[0] as EquipmentEntry)).toBe(false);
  });

  it('apply ∘ invert = id when replacing existing settings', () => {
    const scene = sceneWithEquipment([entryB]);
    const cmd = updateEquipmentSettings(entryB.id, { wattage: 50 });
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    expect(restored.scene).toEqual(scene);
    expect(restored.scene.equipment?.[0]?.settings).toEqual(entryB.settings);
  });

  it('apply ∘ invert = id when clearing existing settings via null', () => {
    const scene = sceneWithEquipment([entryA]);
    const cmd = updateEquipmentSettings(entryA.id, null);
    const inv = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    if (!applied.ok) throw new Error('apply failed');
    const restored = applyCommand(applied.scene, inv);
    if (!restored.ok) throw new Error('inverse failed');
    expect(restored.scene).toEqual(scene);
    expect(restored.scene.equipment?.[0]?.settings).toEqual(entryA.settings);
  });

  it('apply set-then-clear-then-undo restores originally-absent settings', () => {
    const noSettingsEntry: EquipmentEntry = {
      id: 'e0000000-0000-4000-8000-000000000099',
      ref: { catalog: 'core', id: 'air.pump.test', version: 1 },
    };
    const scene = sceneWithEquipment([noSettingsEntry]);
    const setCmd = updateEquipmentSettings(noSettingsEntry.id, { flowRate: 30 });
    const r1 = applyCommand(scene, setCmd);
    if (!r1.ok) throw new Error('apply set failed');
    const clearCmd = updateEquipmentSettings(noSettingsEntry.id, null);
    const r2 = applyCommand(r1.scene, clearCmd);
    if (!r2.ok) throw new Error('apply clear failed');
    expect('settings' in (r2.scene.equipment?.[0] as EquipmentEntry)).toBe(false);
    const invClear = invertCommand(r1.scene, clearCmd);
    const r3 = applyCommand(r2.scene, invClear);
    if (!r3.ok) throw new Error('invert clear failed');
    expect(r3.scene).toEqual(r1.scene);
    const invSet = invertCommand(scene, setCmd);
    const r4 = applyCommand(r3.scene, invSet);
    if (!r4.ok) throw new Error('invert set failed');
    expect(r4.scene).toEqual(scene);
  });

  it('invertCommand of an unknown id is Noop', () => {
    const scene = sceneWithEquipment([entryA]);
    expect(invertCommand(scene, updateEquipmentSettings('nope', { wattage: 5 }))).toEqual({
      kind: 'Noop',
    });
  });
});

describe('Composed equipment chains', () => {
  it('Add → SetNote → UpdateSettings → invert chain returns to the original scene', () => {
    const scene = emptyEquipmentScene();
    const add = addEquipmentEntry({
      id: 'e0000000-0000-4000-8000-0000000000aa',
      ref: { catalog: 'core', id: 'light.led.test', version: 1 },
    });
    const r1 = applyCommand(scene, add);
    if (!r1.ok) throw new Error('add failed');

    const setN = setEquipmentNote(
      'e0000000-0000-4000-8000-0000000000aa',
      'Photoperiod 7h',
    );
    const r2 = applyCommand(r1.scene, setN);
    if (!r2.ok) throw new Error('set note failed');

    const setS = updateEquipmentSettings(
      'e0000000-0000-4000-8000-0000000000aa',
      { intensity: 80 },
    );
    const r3 = applyCommand(r2.scene, setS);
    if (!r3.ok) throw new Error('set settings failed');

    const invS = invertCommand(r2.scene, setS);
    const r4 = applyCommand(r3.scene, invS);
    if (!r4.ok) throw new Error('invert settings failed');
    expect(r4.scene).toEqual(r2.scene);

    const invN = invertCommand(r1.scene, setN);
    const r5 = applyCommand(r4.scene, invN);
    if (!r5.ok) throw new Error('invert note failed');
    expect(r5.scene).toEqual(r1.scene);

    const invAdd = invertCommand(scene, add);
    const r6 = applyCommand(r5.scene, invAdd);
    if (!r6.ok) throw new Error('invert add failed');
    expect(r6.scene).toEqual(scene);
  });
});
