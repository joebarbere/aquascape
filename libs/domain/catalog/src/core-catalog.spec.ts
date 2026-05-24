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

  it('ships substrate (Stage 2), hardscape (Stage 3), and plant (Stage 4) kinds', () => {
    expect(coreCatalog.byKind('substrate').length).toBeGreaterThan(0);
    expect(coreCatalog.byKind('hardscape').length).toBeGreaterThan(0);
    expect(coreCatalog.byKind('plant').length).toBeGreaterThan(0);
    expect(
      coreCatalog.byKind('substrate').length +
        coreCatalog.byKind('hardscape').length +
        coreCatalog.byKind('plant').length,
    ).toBe(coreCatalog.entries.length);
  });

  it('every substrate entry carries an sRGB hex color', () => {
    for (const entry of coreCatalog.byKind('substrate')) {
      expect(entry.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
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
});
