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

  it('exports a frozen migration list with the v1 → v2 and v2 → v3 no-op steps', () => {
    expect(AQUA_MIGRATIONS).toHaveLength(2);
    expect(AQUA_MIGRATIONS[0]?.from).toBe(1);
    expect(AQUA_MIGRATIONS[0]?.to).toBe(2);
    expect(AQUA_MIGRATIONS[1]?.from).toBe(2);
    expect(AQUA_MIGRATIONS[1]?.to).toBe(3);
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
