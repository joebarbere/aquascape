import { emptyCatalog, loadCatalog } from './loader';
import type { SubstrateEntry } from './types';

const sand: SubstrateEntry = {
  catalog: 'core',
  id: 'substrate.sand.x',
  version: 1,
  name: 'Sand',
  kind: 'substrate',
  material: 'sand',
  color: '#eeeeee',
};

const soil: SubstrateEntry = {
  catalog: 'core',
  id: 'substrate.soil.y',
  version: 1,
  name: 'Soil',
  kind: 'substrate',
  material: 'soil',
  color: '#2c1d12',
};

describe('loadCatalog', () => {
  it('builds a catalog with valid entries in input order', () => {
    const result = loadCatalog([sand, soil]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.catalog.entries).toEqual([sand, soil]);
  });

  it('reports invalid entries by index and excludes them from the catalog', () => {
    const result = loadCatalog([sand, { not: 'valid' }, soil]);
    expect(result.errors.map((e) => e.index)).toEqual([1]);
    expect(result.catalog.entries).toEqual([sand, soil]);
  });

  it('reports duplicate (catalog, id) pairs as warnings, first one wins', () => {
    const dupe: SubstrateEntry = { ...sand, name: 'Other Sand' };
    const result = loadCatalog([sand, dupe]);
    expect(result.warnings).toEqual([
      { kind: 'duplicate-id', catalog: sand.catalog, id: sand.id, indices: [0, 1] },
    ]);
    expect(result.catalog.entries).toEqual([sand]);
  });

  it('catalog.get returns the entry for a known pair, null otherwise', () => {
    const { catalog } = loadCatalog([sand, soil]);
    expect(catalog.get({ catalog: 'core', id: sand.id })).toEqual(sand);
    expect(catalog.get({ catalog: 'core', id: 'missing' })).toBeNull();
    expect(catalog.get({ catalog: 'community:x', id: sand.id })).toBeNull();
  });

  it('catalog.byKind filters and narrows the entry type', () => {
    const { catalog } = loadCatalog([sand, soil]);
    const substrates = catalog.byKind('substrate');
    expect(substrates.length).toBe(2);
    // Type-level: every element has kind 'substrate', material accessible.
    expect(substrates.every((e) => e.kind === 'substrate')).toBe(true);
  });
});

describe('emptyCatalog', () => {
  it('returns a usable empty catalog', () => {
    const empty = emptyCatalog();
    expect(empty.entries).toEqual([]);
    expect(empty.get({ catalog: 'core', id: 'anything' })).toBeNull();
    expect(empty.byKind('substrate')).toEqual([]);
  });
});
