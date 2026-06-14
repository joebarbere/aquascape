import { CURRENT_SCHEMA_VERSION, type Migration } from './aqua-document';
import { AQUA_MIGRATIONS, runMigrations } from './migrations';

describe('runMigrations', () => {
  it('no-ops on a current-version document (no migration steps applied)', () => {
    const doc = { schemaVersion: CURRENT_SCHEMA_VERSION, payload: 'unchanged' };
    const result = runMigrations(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual(doc);
    expect(result.appliedSteps).toEqual([]);
  });

  it('walks a v1 → v2 step on a mocked chain', () => {
    const migrations: Migration[] = [
      {
        from: 1,
        to: 2,
        migrate: (d) => ({ ...(d as object), schemaVersion: 2, added: true }),
      },
    ];
    const result = runMigrations({ schemaVersion: 1 }, migrations, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual({ schemaVersion: 2, added: true });
    expect(result.appliedSteps).toEqual([{ from: 1, to: 2 }]);
  });

  it('walks multi-step v1 → v3 in order', () => {
    const migrations: Migration[] = [
      { from: 2, to: 3, migrate: (d) => ({ ...(d as object), schemaVersion: 3, c: 3 }) },
      { from: 1, to: 2, migrate: (d) => ({ ...(d as object), schemaVersion: 2, b: 2 }) },
    ];
    const result = runMigrations({ schemaVersion: 1, a: 1 }, migrations, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual({ schemaVersion: 3, a: 1, b: 2, c: 3 });
    expect(result.appliedSteps).toEqual([
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ]);
  });

  it('refuses to downgrade a future-version document', () => {
    const result = runMigrations({ schemaVersion: 5 }, [], 1);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'unsupported-future-version', documentVersion: 5, readerVersion: 1 },
    });
  });

  it('reports a missing migration when there is a gap in the chain', () => {
    const migrations: Migration[] = [
      { from: 2, to: 3, migrate: (d) => ({ ...(d as object), schemaVersion: 3 }) },
    ];
    const result = runMigrations({ schemaVersion: 1 }, migrations, 3);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'missing-migration', from: 1, to: 2 },
    });
  });

  it('rejects a migration whose `to` is not `from + 1`', () => {
    const migrations: Migration[] = [
      { from: 1, to: 3, migrate: (d) => ({ ...(d as object), schemaVersion: 3 }) },
    ];
    const result = runMigrations({ schemaVersion: 1 }, migrations, 3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-step');
  });

  it('rejects a migration that does not actually advance schemaVersion', () => {
    const migrations: Migration[] = [
      // Claims from:1 to:2 but the produced doc still says schemaVersion: 1.
      { from: 1, to: 2, migrate: (d) => ({ ...(d as object), schemaVersion: 1 }) },
    ];
    const result = runMigrations({ schemaVersion: 1 }, migrations, 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-step');
  });

  it('wraps a throwing migration in a structured error', () => {
    const migrations: Migration[] = [
      {
        from: 1,
        to: 2,
        migrate: () => {
          throw new Error('boom');
        },
      },
    ];
    const result = runMigrations({ schemaVersion: 1 }, migrations, 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('migration-threw');
  });

  it('treats a missing schemaVersion as 0 and reports a missing migration', () => {
    const result = runMigrations({}, [], 1);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'missing-migration', from: 0, to: 1 },
    });
  });

  it('exports a frozen migration list with the v1→v2, v2→v3, v3→v4 no-op steps and the v4→v5 renderHistory-strip step', () => {
    expect(AQUA_MIGRATIONS).toHaveLength(4);
    expect(AQUA_MIGRATIONS[0]?.from).toBe(1);
    expect(AQUA_MIGRATIONS[0]?.to).toBe(2);
    expect(AQUA_MIGRATIONS[1]?.from).toBe(2);
    expect(AQUA_MIGRATIONS[1]?.to).toBe(3);
    expect(AQUA_MIGRATIONS[2]?.from).toBe(3);
    expect(AQUA_MIGRATIONS[2]?.to).toBe(4);
    expect(AQUA_MIGRATIONS[3]?.from).toBe(4);
    expect(AQUA_MIGRATIONS[3]?.to).toBe(5);
    expect(Object.isFrozen(AQUA_MIGRATIONS)).toBe(true);
  });

  it('v1 → v2 step is an identity that only bumps schemaVersion (additive Layer.zone)', () => {
    const v1 = {
      format: 'aquascape',
      schemaVersion: 1,
      meta: { id: 'x', title: 't', createdAt: 'c', updatedAt: 'u', appVersion: '1.0.0', seed: 1 },
      tank: { width: 600, height: 360, depth: 360, style: { frame: 'rimless', background: { kind: 'none' } } },
      substrate: { regions: [] },
      layers: [{ id: 'l1', name: 'L1', opacity: 1, visible: true, locked: false, objects: [] }],
    };
    const step = AQUA_MIGRATIONS[0]!;
    const v2 = step.migrate(v1) as typeof v1;
    expect(v2.schemaVersion).toBe(2);
    // No layer should have gained a zone field — the migration must NOT invent values.
    for (const layer of v2.layers) {
      expect('zone' in layer).toBe(false);
    }
    // Every other field is preserved unchanged.
    expect({ ...v2, schemaVersion: 1 }).toEqual(v1);
  });

  it('v2 → v3 step is an identity that only bumps schemaVersion (additive Tank.waterLevelMm)', () => {
    const v2 = {
      format: 'aquascape',
      schemaVersion: 2,
      meta: { id: 'x', title: 't', createdAt: 'c', updatedAt: 'u', appVersion: '1.0.0', seed: 1 },
      tank: { width: 600, height: 360, depth: 360, style: { frame: 'rimless', background: { kind: 'none' } } },
      substrate: { regions: [] },
      layers: [{ id: 'l1', name: 'L1', opacity: 1, visible: true, locked: false, objects: [], zone: 'midground' }],
    };
    const step = AQUA_MIGRATIONS[1]!;
    const v3 = step.migrate(v2) as typeof v2;
    expect(v3.schemaVersion).toBe(3);
    // The tank must NOT gain a waterLevelMm — absent means "default fill",
    // derived at render time; the migration has no authority to invent it.
    expect('waterLevelMm' in v3.tank).toBe(false);
    // Every other field is preserved unchanged (incl. the v2 layer zone).
    expect({ ...v3, schemaVersion: 2 }).toEqual(v2);
  });

  it('v3 → v4 step is an identity that only bumps schemaVersion (additive Tank.waterChemistry)', () => {
    const v3 = {
      format: 'aquascape',
      schemaVersion: 3,
      meta: { id: 'x', title: 't', createdAt: 'c', updatedAt: 'u', appVersion: '1.0.0', seed: 1 },
      tank: {
        width: 600,
        height: 360,
        depth: 360,
        waterLevelMm: 320,
        style: { frame: 'rimless', background: { kind: 'none' } },
      },
      substrate: { regions: [] },
      layers: [{ id: 'l1', name: 'L1', opacity: 1, visible: true, locked: false, objects: [], zone: 'midground' }],
    };
    const step = AQUA_MIGRATIONS[2]!;
    const v4 = step.migrate(v3) as typeof v3;
    expect(v4.schemaVersion).toBe(4);
    // The tank must NOT gain a waterChemistry — absent means "no chemistry
    // recorded"; the migration has no authority to invent a cycle history.
    expect('waterChemistry' in v4.tank).toBe(false);
    // The v3 waterLevelMm survives untouched.
    expect(v4.tank.waterLevelMm).toBe(320);
    // Every other field is preserved unchanged.
    expect({ ...v4, schemaVersion: 3 }).toEqual(v3);
  });

  it('v4 → v5 step strips renderHistory and bumps schemaVersion (no other change)', () => {
    const v4 = {
      format: 'aquascape',
      schemaVersion: 4,
      meta: { id: 'x', title: 't', createdAt: 'c', updatedAt: 'u', appVersion: '1.0.0', seed: 1 },
      tank: { width: 600, height: 360, depth: 360, style: { frame: 'rimless', background: { kind: 'none' } } },
      substrate: { regions: [] },
      layers: [{ id: 'l1', name: 'L1', opacity: 1, visible: true, locked: false, objects: [] }],
      // A doc that somehow carried the (now-retired) AI-render history field.
      renderHistory: [
        {
          id: 'r1',
          createdAt: 'c',
          provider: { kind: 'local', name: 'sdxl-local' },
          request: { prompt: 'a tank' },
          resultAsset: { id: 'a1', uri: 'assets/r1.png', mimeType: 'image/png' },
        },
      ],
    };
    const step = AQUA_MIGRATIONS[3]!;
    const v5 = step.migrate(v4) as Record<string, unknown>;
    expect(v5.schemaVersion).toBe(5);
    // renderHistory is GONE (the dropped key, not present-with-undefined).
    expect('renderHistory' in v5).toBe(false);
    // Every other field is preserved unchanged.
    const { renderHistory: _dropped, ...v4WithoutHistory } = v4;
    expect({ ...v5, schemaVersion: 4 }).toEqual(v4WithoutHistory);
  });

  it('v4 → v5 step is a no-op (apart from the version stamp) when renderHistory is absent', () => {
    const v4 = {
      format: 'aquascape',
      schemaVersion: 4,
      meta: { id: 'x', title: 't', createdAt: 'c', updatedAt: 'u', appVersion: '1.0.0', seed: 1 },
      tank: { width: 600, height: 360, depth: 360, style: { frame: 'rimless', background: { kind: 'none' } } },
      substrate: { regions: [] },
      layers: [{ id: 'l1', name: 'L1', opacity: 1, visible: true, locked: false, objects: [] }],
    };
    const step = AQUA_MIGRATIONS[3]!;
    const v5 = step.migrate(v4) as typeof v4;
    expect(v5.schemaVersion).toBe(5);
    expect('renderHistory' in v5).toBe(false);
    expect({ ...v5, schemaVersion: 4 }).toEqual(v4);
  });

  it('v4 → v5 step does not mutate its input (purity)', () => {
    const v4 = {
      schemaVersion: 4,
      renderHistory: [{ id: 'r1' }],
    };
    const step = AQUA_MIGRATIONS[3]!;
    step.migrate(v4);
    // Input is untouched — the migration builds a fresh object.
    expect(v4.schemaVersion).toBe(4);
    expect('renderHistory' in v4).toBe(true);
  });

  it('treats null and non-object inputs as version 0', () => {
    expect(runMigrations(null, [], 1)).toEqual({
      ok: false,
      error: { kind: 'missing-migration', from: 0, to: 1 },
    });
    expect(runMigrations('not-an-object', [], 1)).toEqual({
      ok: false,
      error: { kind: 'missing-migration', from: 0, to: 1 },
    });
  });

  it('treats a non-integer schemaVersion as version 0', () => {
    expect(runMigrations({ schemaVersion: 1.5 }, [], 1)).toEqual({
      ok: false,
      error: { kind: 'missing-migration', from: 0, to: 1 },
    });
  });
});
