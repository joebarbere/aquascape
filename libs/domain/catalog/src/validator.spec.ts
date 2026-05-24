import { CATALOG_ENTRY_JSON_SCHEMA, formatError, validateCatalogEntry } from './validator';

describe('validateCatalogEntry', () => {
  it('accepts a well-formed substrate entry', () => {
    expect(
      validateCatalogEntry({
        catalog: 'core',
        id: 'substrate.x.y',
        version: 1,
        name: 'X',
        kind: 'substrate',
        material: 'soil',
        color: '#abcdef',
        grainSize: 3,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects missing required fields', () => {
    const result = validateCatalogEntry({ catalog: 'core' });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown kind (no matching oneOf branch)', () => {
    const result = validateCatalogEntry({
      catalog: 'core',
      id: 'x',
      version: 1,
      name: 'X',
      kind: 'rainbow',
      material: 'soil',
      color: '#abcdef',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid color', () => {
    const result = validateCatalogEntry({
      catalog: 'core',
      id: 'x',
      version: 1,
      name: 'X',
      kind: 'substrate',
      material: 'soil',
      color: 'not-a-color',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path.includes('color'))).toBe(true);
  });

  it('rejects an invalid material enum', () => {
    const result = validateCatalogEntry({
      catalog: 'core',
      id: 'x',
      version: 1,
      name: 'X',
      kind: 'substrate',
      material: 'lava',
      color: '#abcdef',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects extraneous properties (additionalProperties: false)', () => {
    const result = validateCatalogEntry({
      catalog: 'core',
      id: 'x',
      version: 1,
      name: 'X',
      kind: 'substrate',
      material: 'soil',
      color: '#abcdef',
      surprise: true,
    });
    expect(result.ok).toBe(false);
  });

  it('exposes the schema for tooling', () => {
    expect(CATALOG_ENTRY_JSON_SCHEMA).toMatchObject({ title: 'CatalogEntry' });
  });

  it('uses "<root>" as the path when AJV reports a root-level error', () => {
    // A non-object input fails at the root with an empty instancePath.
    const result = validateCatalogEntry(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path === '<root>')).toBe(true);
  });
});

describe('formatError (defensive fallbacks)', () => {
  it('falls back to "invalid" when an AJV error lacks a message field', () => {
    const out = formatError({
      keyword: 'custom',
      instancePath: '/x',
      schemaPath: '#',
      params: {},
      // message intentionally absent
    } as never);
    expect(out.message).toBe('invalid');
    expect(out.path).toBe('/x');
  });

  it('falls back to "<root>" when instancePath is empty', () => {
    const out = formatError({
      keyword: 'type',
      instancePath: '',
      schemaPath: '#',
      params: {},
      message: 'expected object',
    } as never);
    expect(out.path).toBe('<root>');
  });
});
