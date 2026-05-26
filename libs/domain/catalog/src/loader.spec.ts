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

describe('loadCatalog — schemaVersion 3 forward-compat (F11.2)', () => {
  // A "v2-shaped" livestock manifest: every existing required field, NO
  // `behavior` block. The schemaVersion 2 → 3 bump is additive — these
  // manifests must continue to load with zero errors and zero warnings.
  const v2ShapedLivestock = {
    catalog: 'core',
    id: 'livestock.fish.legacy',
    version: 1,
    name: 'Legacy fish manifest (no behavior block)',
    kind: 'livestock' as const,
    group: 'fish' as const,
    adultSize: 30,
    temperament: 'peaceful' as const,
    temperatureRange: { minC: 22, maxC: 26 },
    pHRange: { min: 6.0, max: 7.5 },
    schoolingMin: 6,
    bioloadClass: 'low' as const,
    color: '#abcdef',
  };

  // A "v3-shaped" livestock manifest: same as above plus a partial behavior
  // override. Both must coexist in a single catalog load.
  const v3ShapedLivestock = {
    ...v2ShapedLivestock,
    id: 'livestock.fish.modern',
    name: 'Modern fish manifest (with behavior block)',
    behavior: { schooling: { wCoh: 1.5 } },
  };

  it('accepts a v2-shaped livestock manifest with no behavior block', () => {
    const result = loadCatalog([v2ShapedLivestock]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.catalog.entries.length).toBe(1);
  });

  it('accepts a v3-shaped livestock manifest with a partial behavior block', () => {
    const result = loadCatalog([v3ShapedLivestock]);
    expect(result.errors).toEqual([]);
    expect(result.catalog.entries.length).toBe(1);
  });

  it('co-loads v2 and v3 livestock manifests in the same catalog', () => {
    const result = loadCatalog([v2ShapedLivestock, v3ShapedLivestock]);
    expect(result.errors).toEqual([]);
    expect(result.catalog.entries.length).toBe(2);
  });

  it('rejects a behavior block with an unknown subkey (typo guard)', () => {
    const broken = {
      ...v2ShapedLivestock,
      id: 'livestock.fish.broken',
      // typo: should be `schooling`.
      behavior: { schoolign: { wCoh: 1.5 } },
    };
    const result = loadCatalog([broken]);
    expect(result.errors.length).toBe(1);
    expect(result.catalog.entries.length).toBe(0);
  });
});

describe('loadCatalog — hardscape coverScore default-fill (F11.3)', () => {
  // F11.3 FearSystem reads `coverScore` to pick refuges. JSON Schema's
  // `default` is metadata only, so the loader populates the field when a
  // manifest omits it. The original manifest object must stay untouched —
  // only the loaded `CoreCatalog` entry sees the populated value.
  const baseHardscape = {
    catalog: 'core',
    version: 1,
    name: 'Test',
    kind: 'hardscape' as const,
    naturalSize: { width: 100, height: 80, depth: 60 },
    color: '#abcdef',
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 0, y: 1 },
    ],
  };
  const woodEntry = { ...baseHardscape, id: 'wood.test', category: 'wood' as const };
  const rockEntry = { ...baseHardscape, id: 'rock.test', category: 'rock' as const };
  const otherEntry = { ...baseHardscape, id: 'other.test', category: 'other' as const };

  it('fills coverScore = 0.6 for a wood hardscape with no coverScore', () => {
    const { catalog } = loadCatalog([woodEntry]);
    const entry = catalog.get({ catalog: 'core', id: 'wood.test' });
    expect(entry?.kind).toBe('hardscape');
    if (entry?.kind !== 'hardscape') return;
    expect(entry.coverScore).toBe(0.6);
  });

  it('fills coverScore = 0.4 for a rock hardscape with no coverScore', () => {
    const { catalog } = loadCatalog([rockEntry]);
    const entry = catalog.get({ catalog: 'core', id: 'rock.test' });
    if (entry?.kind !== 'hardscape') return;
    expect(entry.coverScore).toBe(0.4);
  });

  it('fills coverScore = 0 for an `other` hardscape with no coverScore', () => {
    const { catalog } = loadCatalog([otherEntry]);
    const entry = catalog.get({ catalog: 'core', id: 'other.test' });
    if (entry?.kind !== 'hardscape') return;
    expect(entry.coverScore).toBe(0);
  });

  it('preserves an explicit coverScore on a hardscape entry (no overwrite)', () => {
    const { catalog } = loadCatalog([{ ...woodEntry, coverScore: 0.85 }]);
    const entry = catalog.get({ catalog: 'core', id: 'wood.test' });
    if (entry?.kind !== 'hardscape') return;
    expect(entry.coverScore).toBe(0.85);
  });

  it('preserves an explicit coverScore = 0 (not treated as missing)', () => {
    const { catalog } = loadCatalog([{ ...rockEntry, coverScore: 0 }]);
    const entry = catalog.get({ catalog: 'core', id: 'rock.test' });
    if (entry?.kind !== 'hardscape') return;
    expect(entry.coverScore).toBe(0);
  });

  it('does not mutate the original manifest object', () => {
    const manifest = { ...rockEntry };
    expect(manifest.coverScore).toBeUndefined();
    loadCatalog([manifest]);
    expect(manifest.coverScore).toBeUndefined();
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
