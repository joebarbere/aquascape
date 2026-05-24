import { CURRENT_SCHEMA_VERSION, type Migration } from './aqua-document';
import { AQUA_MIGRATIONS, runMigrations } from './migrations';

describe('runMigrations', () => {
  it('no-ops on a current-version document with the baseline (empty) chain', () => {
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

  it('exports a frozen baseline migration list', () => {
    expect(AQUA_MIGRATIONS).toEqual([]);
    expect(Object.isFrozen(AQUA_MIGRATIONS)).toBe(true);
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
