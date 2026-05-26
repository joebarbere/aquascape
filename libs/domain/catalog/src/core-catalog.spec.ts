import { CORE_CATALOG_MANIFESTS, CORE_CATALOG_RESULT, coreCatalog } from './core-catalog';

describe('core catalog (bundled substrates + hardscape + plants)', () => {
  it('loads cleanly — no validation errors', () => {
    expect(CORE_CATALOG_RESULT.errors).toEqual([]);
  });

  it('has no duplicate (catalog, id) pairs', () => {
    expect(CORE_CATALOG_RESULT.warnings).toEqual([]);
  });

  it('exposes every manifest in the loaded catalog', () => {
    expect(coreCatalog.entries.length).toBe(CORE_CATALOG_MANIFESTS.length);
  });

  it('ships substrate (Stage 2), hardscape (Stage 3), plant (Stage 4), livestock (Stage 7 F7.1), and equipment (Stage 7 F7.3) kinds', () => {
    expect(coreCatalog.byKind('substrate').length).toBeGreaterThan(0);
    expect(coreCatalog.byKind('hardscape').length).toBeGreaterThan(0);
    expect(coreCatalog.byKind('plant').length).toBeGreaterThan(0);
    expect(coreCatalog.byKind('livestock').length).toBeGreaterThan(0);
    expect(coreCatalog.byKind('equipment').length).toBeGreaterThan(0);
    expect(
      coreCatalog.byKind('substrate').length +
        coreCatalog.byKind('hardscape').length +
        coreCatalog.byKind('plant').length +
        coreCatalog.byKind('livestock').length +
        coreCatalog.byKind('equipment').length,
    ).toBe(coreCatalog.entries.length);
  });

  it('every substrate entry carries an sRGB hex color', () => {
    for (const entry of coreCatalog.byKind('substrate')) {
      expect(entry.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('every hardscape entry exposes a coverScore in [0, 1] after load (F11.3 loader fill)', () => {
    for (const entry of coreCatalog.byKind('hardscape')) {
      // Loader fills the default from `category` when the manifest omits the
      // field, so every entry in the loaded catalog must have a number here.
      expect(typeof entry.coverScore).toBe('number');
      expect(entry.coverScore!).toBeGreaterThanOrEqual(0);
      expect(entry.coverScore!).toBeLessThanOrEqual(1);
      // Category-derived defaults: wood → 0.6, rock → 0.4, other → 0.
      // The annotated Seiryu medium overrides its rock default with 0.5 —
      // both cases satisfy the assertion below.
      if (entry.coverScore === undefined) continue;
    }
  });

  it('the annotated Seiryu (medium) hardscape entry keeps its explicit coverScore', () => {
    const entry = coreCatalog.get({ catalog: 'core', id: 'rock.seiryu.medium' });
    expect(entry).not.toBeNull();
    if (entry?.kind !== 'hardscape') return;
    expect(entry.coverScore).toBe(0.5);
  });

  it('a representative wood hardscape gets the loader-filled coverScore = 0.6', () => {
    const entry = coreCatalog.get({ catalog: 'core', id: 'wood.spiderwood.medium' });
    if (entry?.kind !== 'hardscape') return;
    // Spiderwood manifest doesn't declare coverScore — loader fills 0.6 for wood.
    expect(entry.coverScore).toBe(0.6);
  });

  it('every hardscape entry has a silhouette polygon and natural size', () => {
    for (const entry of coreCatalog.byKind('hardscape')) {
      expect(entry.silhouette.length).toBeGreaterThanOrEqual(3);
      expect(entry.naturalSize.width).toBeGreaterThan(0);
      expect(entry.naturalSize.height).toBeGreaterThan(0);
      expect(entry.naturalSize.depth).toBeGreaterThan(0);
      for (const p of entry.silhouette) {
        expect(p.x).toBeGreaterThanOrEqual(-1);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(-1);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('covers all three planting zones', () => {
    const zones = new Set(coreCatalog.byKind('plant').map((p) => p.zone));
    expect(zones).toEqual(new Set(['foreground', 'midground', 'background']));
  });

  it('every plant entry has a valid silhouette, natural size, color, and growth model', () => {
    for (const entry of coreCatalog.byKind('plant')) {
      expect(entry.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(entry.silhouette.length).toBeGreaterThanOrEqual(3);
      expect(entry.naturalSize.width).toBeGreaterThan(0);
      expect(entry.naturalSize.height).toBeGreaterThan(0);
      expect(entry.naturalSize.depth).toBeGreaterThan(0);
      expect(entry.growth.weeksToMature).toBeGreaterThan(0);
      expect(entry.growth.sizeAtZero).toBeGreaterThanOrEqual(0);
      expect(entry.growth.sizeAtZero).toBeLessThanOrEqual(1);
      for (const p of entry.silhouette) {
        expect(p.x).toBeGreaterThanOrEqual(-1);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(-1);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the ADA Aqua Soil Amazonia entry is reachable by id', () => {
    const entry = coreCatalog.get({
      catalog: 'core',
      id: 'substrate.aquasoil.amazonia',
    });
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe('substrate');
  });

  it('the Seiryu Stone (large) hardscape entry is reachable by id', () => {
    const entry = coreCatalog.get({ catalog: 'core', id: 'rock.seiryu.large' });
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe('hardscape');
    if (entry?.kind !== 'hardscape') return;
    expect(entry.category).toBe('rock');
  });

  it('the Hairgrass plant entry is reachable by id with carpet defaults', () => {
    const entry = coreCatalog.get({ catalog: 'core', id: 'plant.eleocharis.acicularis' });
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe('plant');
    if (entry?.kind !== 'plant') return;
    expect(entry.zone).toBe('foreground');
    // Carpet plants should specify a default scatter density; the planting
    // tool's brush relies on this when no override is supplied.
    expect(entry.defaultDensity).toBeGreaterThan(0);
  });

  it('ships exactly the 8 seeded livestock species (4 fish + 2 shrimp + 2 snails)', () => {
    const livestock = coreCatalog.byKind('livestock');
    expect(livestock.length).toBe(8);
    const groups = livestock.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.group] = (acc[entry.group] ?? 0) + 1;
      return acc;
    }, {});
    expect(groups).toEqual({ fish: 4, shrimp: 2, snail: 2 });
  });

  it('every livestock entry has a valid swatch color, plausible ranges, and a positive adult size', () => {
    for (const entry of coreCatalog.byKind('livestock')) {
      expect(entry.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(entry.adultSize).toBeGreaterThan(0);
      expect(entry.schoolingMin).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(entry.schoolingMin)).toBe(true);
      // Manifest-author contract: min < max for both windows.
      expect(entry.temperatureRange.minC).toBeLessThan(entry.temperatureRange.maxC);
      expect(entry.pHRange.min).toBeLessThan(entry.pHRange.max);
    }
  });

  it('the Neon Tetra livestock entry is reachable and shaped like a schooling community fish', () => {
    const entry = coreCatalog.get({ catalog: 'core', id: 'livestock.fish.neon-tetra' });
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe('livestock');
    if (entry?.kind !== 'livestock') return;
    expect(entry.group).toBe('fish');
    expect(entry.temperament).toBe('peaceful');
    expect(entry.schoolingMin).toBeGreaterThanOrEqual(6);
    expect(entry.bioloadClass).toBe('low');
  });

  it('the Neon Tetra entry carries its F11.2 behavior override (tighter cohesion than the mid preset)', () => {
    const entry = coreCatalog.get({ catalog: 'core', id: 'livestock.fish.neon-tetra' });
    expect(entry).not.toBeNull();
    if (entry?.kind !== 'livestock') return;
    expect(entry.behavior?.schooling?.wCoh).toBe(1.5);
  });

  it('the Apistogramma entry carries its F11.3 territory override', () => {
    const entry = coreCatalog.get({
      catalog: 'core',
      id: 'livestock.fish.apistogramma-cacatuoides',
    });
    expect(entry).not.toBeNull();
    if (entry?.kind !== 'livestock') return;
    expect(entry.behavior?.territory).toEqual({
      coreRadius: 60,
      displayRadius: 120,
      aggression: 80,
      fatigueRate: 0.1,
    });
  });

  it('only a small handful of livestock entries declare a behavior block (defaults still exercise resolveBehavior)', () => {
    const annotated = coreCatalog
      .byKind('livestock')
      .filter((e) => e.behavior !== undefined);
    // F11.2 + F11.3 plan: ~2 explicit overrides total (neon-tetra + apistogramma);
    // F11.6 will broaden this. If this count creeps up before F11.6 lands, the
    // wiring tests for the default `resolveBehavior` path lose their coverage.
    expect(annotated.length).toBeLessThanOrEqual(2);
  });

  it('the Cherry Shrimp livestock entry is reachable and grouped as shrimp', () => {
    const entry = coreCatalog.get({ catalog: 'core', id: 'livestock.shrimp.neocaridina-davidi' });
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe('livestock');
    if (entry?.kind !== 'livestock') return;
    expect(entry.group).toBe('shrimp');
    expect(entry.temperament).toBe('peaceful');
  });

  it('ships exactly the 12 seeded equipment items (4 filters + 3 heaters + 3 lights + 2 CO2)', () => {
    const equipment = coreCatalog.byKind('equipment');
    expect(equipment.length).toBe(12);
    const categories = equipment.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.category] = (acc[entry.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(categories).toEqual({ filter: 4, heater: 3, light: 3, co2: 2 });
  });

  it('every equipment entry has a valid swatch color and positive optional metrics when set', () => {
    for (const entry of coreCatalog.byKind('equipment')) {
      expect(entry.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      if (entry.wattage !== undefined) {
        expect(entry.wattage).toBeGreaterThan(0);
      }
      if (entry.flowRateLph !== undefined) {
        expect(entry.flowRateLph).toBeGreaterThan(0);
      }
      if (entry.coverageLitres?.min !== undefined) {
        expect(entry.coverageLitres.min).toBeGreaterThan(0);
      }
      if (entry.coverageLitres?.max !== undefined) {
        expect(entry.coverageLitres.max).toBeGreaterThan(0);
      }
      if (entry.coverageLitres?.min !== undefined && entry.coverageLitres?.max !== undefined) {
        // Manifest-author contract: min <= max for the coverage window.
        expect(entry.coverageLitres.min).toBeLessThanOrEqual(entry.coverageLitres.max);
      }
    }
  });

  it('the Eheim Pro 4+ 350 filter entry is reachable and shaped like a high-flow canister', () => {
    const entry = coreCatalog.get({
      catalog: 'core',
      id: 'equipment.filter.eheim-pro-4-plus-350',
    });
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe('equipment');
    if (entry?.kind !== 'equipment') return;
    expect(entry.category).toBe('filter');
    expect(entry.subcategory).toBe('canister');
    expect(entry.flowRateLph).toBeGreaterThan(500);
  });

  it('the CO2Art SE pressurised system entry is reachable as a CO2 equipment item', () => {
    const entry = coreCatalog.get({
      catalog: 'core',
      id: 'equipment.co2.co2art-se-pressurised',
    });
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe('equipment');
    if (entry?.kind !== 'equipment') return;
    expect(entry.category).toBe('co2');
    expect(entry.subcategory).toBe('pressurised');
  });
});
