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

describe('loadCatalog — F11.4 feeding / curiosity forward-compat', () => {
  // Same v3 manifest schema as F11.2 — feeding + curiosity were added
  // additively under the existing `behavior` block. A manifest without
  // them must keep loading; a manifest with them must round-trip the
  // values to the loaded catalog so downstream resolveBehavior() sees them.
  const baseLivestock = {
    catalog: 'core',
    id: 'livestock.fish.legacy-no-feeding',
    version: 1,
    name: 'Legacy fish manifest (no feeding/curiosity)',
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

  it('accepts a manifest without behavior.feeding / curiosity (default-fallback path)', () => {
    const result = loadCatalog([baseLivestock]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.catalog.entries.length).toBe(1);
  });

  it('preserves behavior.feeding.category on a manifest that declares it', () => {
    const annotated = {
      ...baseLivestock,
      id: 'livestock.fish.annotated-feeding',
      behavior: { feeding: { category: 'algae-grazer' as const } },
    };
    const { catalog } = loadCatalog([annotated]);
    const entry = catalog.get({ catalog: 'core', id: annotated.id });
    expect(entry?.kind).toBe('livestock');
    if (entry?.kind !== 'livestock') return;
    expect(entry.behavior?.feeding?.category).toBe('algae-grazer');
  });

  it('preserves a fully-specified behavior.curiosity block on a manifest that declares it', () => {
    const annotated = {
      ...baseLivestock,
      id: 'livestock.fish.annotated-curiosity',
      behavior: { curiosity: { boldness: 0.6, ratePerSec: 0.02, dwellSec: 5 } },
    };
    const { catalog } = loadCatalog([annotated]);
    const entry = catalog.get({ catalog: 'core', id: annotated.id });
    if (entry?.kind !== 'livestock') return;
    expect(entry.behavior?.curiosity).toEqual({
      boldness: 0.6,
      ratePerSec: 0.02,
      dwellSec: 5,
    });
  });

  it('rejects a manifest with an unknown feeding.category enum value', () => {
    const broken = {
      ...baseLivestock,
      id: 'livestock.fish.broken-feeding',
      behavior: { feeding: { category: 'omnivore' as unknown as 'midwater' } },
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

describe('loadCatalog — F11.5 equipment flow / airRateMl forward-compat', () => {
  // Same v3 manifest schema — flow + airRateMl were added additively under
  // the existing equipment branch. A manifest without them must keep
  // loading; a manifest with them must round-trip the values so downstream
  // FlowFieldSystem + BubbleParticleSystem see them.
  const baseFilter = {
    catalog: 'core',
    id: 'equipment.filter.legacy-no-flow',
    version: 1,
    name: 'Legacy filter manifest (no flow)',
    kind: 'equipment' as const,
    category: 'filter' as const,
    color: '#1f5b8a',
  };

  it('accepts an equipment manifest without flow / airRateMl', () => {
    const result = loadCatalog([baseFilter]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.catalog.entries.length).toBe(1);
  });

  it('preserves a fully-specified flow block on a manifest that declares it', () => {
    const annotated = {
      ...baseFilter,
      id: 'equipment.filter.annotated-flow',
      flow: {
        outflowPos: { x: 550, y: 320, z: 40 },
        outflowVec: { x: -1, y: 0, z: 0 },
        intakePos: { x: 50, y: 80, z: 40 },
        flowRate: 700,
      },
    };
    const { catalog } = loadCatalog([annotated]);
    const entry = catalog.get({ catalog: 'core', id: annotated.id });
    expect(entry?.kind).toBe('equipment');
    if (entry?.kind !== 'equipment') return;
    expect(entry.flow).toEqual(annotated.flow);
  });

  it('preserves airRateMl on a manifest that declares it', () => {
    const annotated = {
      ...baseFilter,
      id: 'equipment.filter.annotated-airstone',
      airRateMl: 800,
    };
    const { catalog } = loadCatalog([annotated]);
    const entry = catalog.get({ catalog: 'core', id: annotated.id });
    if (entry?.kind !== 'equipment') return;
    expect(entry.airRateMl).toBe(800);
  });

  it('rejects a manifest with a negative flow.flowRate', () => {
    const broken = {
      ...baseFilter,
      id: 'equipment.filter.broken-flow',
      flow: { flowRate: -10 },
    };
    const result = loadCatalog([broken]);
    expect(result.errors.length).toBe(1);
    expect(result.catalog.entries.length).toBe(0);
  });

  it('rejects a manifest with a typo inside the flow block', () => {
    const broken = {
      ...baseFilter,
      id: 'equipment.filter.broken-flow-typo',
      // typo: should be outflowVec
      flow: { outflowVc: { x: 0, y: 0, z: 1 } },
    };
    const result = loadCatalog([broken]);
    expect(result.errors.length).toBe(1);
    expect(result.catalog.entries.length).toBe(0);
  });
});

describe('loadCatalog — F11.7 equipment photoperiodHours forward-compat', () => {
  // photoperiodHours was added additively under the existing equipment
  // branch. A manifest without it must keep loading; a manifest with it
  // must round-trip the value so the DayNightService "equipment" mode sees it.
  const baseLight = {
    catalog: 'core',
    id: 'equipment.light.legacy-no-photoperiod',
    version: 1,
    name: 'Legacy lighting manifest (no photoperiodHours)',
    kind: 'equipment' as const,
    category: 'light' as const,
    color: '#fff2c0',
  };

  it('accepts an equipment manifest without photoperiodHours', () => {
    const result = loadCatalog([baseLight]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.catalog.entries.length).toBe(1);
  });

  it('preserves photoperiodHours on a manifest that declares it', () => {
    const annotated = {
      ...baseLight,
      id: 'equipment.light.annotated-photoperiod',
      photoperiodHours: 10,
    };
    const { catalog } = loadCatalog([annotated]);
    const entry = catalog.get({ catalog: 'core', id: annotated.id });
    expect(entry?.kind).toBe('equipment');
    if (entry?.kind !== 'equipment') return;
    expect(entry.photoperiodHours).toBe(10);
  });

  it('rejects a manifest with photoperiodHours outside [0, 24]', () => {
    const broken = {
      ...baseLight,
      id: 'equipment.light.broken-photoperiod',
      photoperiodHours: 30,
    };
    const result = loadCatalog([broken]);
    expect(result.errors.length).toBe(1);
    expect(result.catalog.entries.length).toBe(0);
  });
});

describe('loadCatalog — F11.6 per-species manifest smoke (each new fish loads clean)', () => {
  // Each id below corresponds to an F11.6 species manifest under
  // libs/domain/catalog/src/data/livestock/. The full core-catalog spec
  // already counts the total + asserts behaviour resolution; this set is the
  // narrower per-row smoke that catches schema-level regressions on each new
  // entry in isolation.
  const F11_6_FISH_IDS = [
    'livestock.fish.cardinal-tetra',
    'livestock.fish.ember-tetra',
    'livestock.fish.harlequin-rasbora',
    'livestock.fish.cherry-barb',
    'livestock.fish.tiger-barb',
    'livestock.fish.marbled-hatchetfish',
    'livestock.fish.dwarf-gourami',
    'livestock.fish.pearl-gourami',
    'livestock.fish.angelfish',
    'livestock.fish.discus',
    'livestock.fish.german-blue-ram',
    'livestock.fish.kuhli-loach',
    'livestock.fish.bronze-cory',
    'livestock.fish.otocinclus',
    'livestock.fish.bristlenose-pleco',
    'livestock.fish.common-pleco',
  ];

  it.each(F11_6_FISH_IDS)('the %s manifest is reachable through coreCatalog without warnings', (id) => {
    // Re-export of coreCatalog is in core-catalog.ts; importing here would
    // double-load and risk cycles. Lazy require via a dynamic import keeps the
    // top-level loader spec isolated to the in-test fixtures above while still
    // letting us assert on the production load result.
    const { coreCatalog, CORE_CATALOG_RESULT } = require('./core-catalog') as typeof import('./core-catalog');
    expect(CORE_CATALOG_RESULT.errors).toEqual([]);
    const entry = coreCatalog.get({ catalog: 'core', id });
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe('livestock');
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
