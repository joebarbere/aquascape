// Summary-aggregation tests. Stage 6 F6.2.

import type { Catalog } from '@aquascape/domain/catalog';
import type { Scene, SceneObject } from '@aquascape/domain/scene-model';

import {
  formatSummaryJson,
  formatSummaryMarkdown,
  summarizeScene,
} from './summary';

// ─── Catalog stub ─────────────────────────────────────────────────────────

const fakeCatalog: Catalog = {
  entries: [] as never,
  get({ catalog, id }: { catalog: string; id: string }) {
    if (catalog !== 'core') return null;
    if (id === 'plant.hc') {
      return { kind: 'plant', name: 'HC Cuba', id: 'plant.hc', catalog: 'core', version: 1 } as never;
    }
    if (id === 'plant.anubias') {
      return { kind: 'plant', name: 'Anubias', id: 'plant.anubias', catalog: 'core', version: 1 } as never;
    }
    if (id === 'rock.seiryu') {
      return { kind: 'hardscape', name: 'Seiryu Stone', id: 'rock.seiryu', catalog: 'core', version: 1 } as never;
    }
    if (id === 'wood.spider') {
      return { kind: 'hardscape', name: 'Spiderwood', id: 'wood.spider', catalog: 'core', version: 1 } as never;
    }
    return null;
  },
  byKind() {
    return [] as never;
  },
} as never;

// ─── Scene fixtures ───────────────────────────────────────────────────────

function makeScene(opts: { layers?: ReadonlyArray<Partial<{ visible: boolean; objects: ReadonlyArray<SceneObject> }>> } = {}): Scene {
  const layers = (opts.layers ?? []).map((l, i) => ({
    id: `L-${i}` as never,
    name: `Layer ${i}`,
    opacity: 1,
    visible: l.visible ?? true,
    locked: false,
    objects: l.objects ?? [],
  }));
  return {
    tank: {
      width: 600,
      height: 360,
      depth: 360,
      glassThickness: 5,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: [] },
    layers,
    seed: 1,
  } as Scene;
}

function plant(id: string, catalogId: string, scatter?: { density: number; size: number }): SceneObject {
  const base = {
    kind: 'plant' as const,
    id: id as never,
    ref: { catalog: 'core', id: catalogId, version: 1 },
    zone: 'midground' as const,
    transform: {
      position: { x: 100, y: 100, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      flipX: false,
      flipY: false,
    },
    growth: { ageWeeks: 4, vigor: 1 },
  };
  if (scatter !== undefined) {
    const half = scatter.size / 2;
    return {
      ...base,
      scatter: {
        polygon: [
          { x: -half, y: -half },
          { x: half, y: -half },
          { x: half, y: half },
          { x: -half, y: half },
        ],
        density: scatter.density,
        seed: 1,
      },
    } as SceneObject;
  }
  return base as SceneObject;
}

function hardscape(id: string, catalogId: string): SceneObject {
  return {
    kind: 'hardscape' as const,
    id: id as never,
    ref: { catalog: 'core', id: catalogId, version: 1 },
    transform: {
      position: { x: 100, y: 100, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      flipX: false,
      flipY: false,
    },
  } as SceneObject;
}

// ─── Aggregation ──────────────────────────────────────────────────────────

describe('summarizeScene — counts', () => {
  it('groups plants + hardscape by catalog ref', () => {
    const s = makeScene({
      layers: [
        {
          objects: [
            plant('p1', 'plant.hc'),
            plant('p2', 'plant.hc'),
            plant('p3', 'plant.anubias'),
            hardscape('h1', 'rock.seiryu'),
            hardscape('h2', 'rock.seiryu'),
            hardscape('h3', 'wood.spider'),
          ],
        },
      ],
    });
    const sum = summarizeScene(s, fakeCatalog);
    expect(sum.plants).toEqual([
      { catalogId: 'plant.hc', name: 'HC Cuba', count: 2 },
      { catalogId: 'plant.anubias', name: 'Anubias', count: 1 },
    ]);
    expect(sum.hardscape).toEqual([
      { catalogId: 'rock.seiryu', name: 'Seiryu Stone', count: 2 },
      { catalogId: 'wood.spider', name: 'Spiderwood', count: 1 },
    ]);
    expect(sum.totalPlantInstances).toBe(3);
    expect(sum.totalHardscapePieces).toBe(3);
  });

  it('falls back to catalog id when catalog cannot resolve the name', () => {
    const s = makeScene({ layers: [{ objects: [plant('p1', 'plant.unknown')] }] });
    const sum = summarizeScene(s, fakeCatalog);
    expect(sum.plants[0]?.name).toBe('plant.unknown');
  });

  it('handles a null catalog without throwing', () => {
    const s = makeScene({ layers: [{ objects: [plant('p1', 'plant.hc')] }] });
    const sum = summarizeScene(s, null);
    expect(sum.plants[0]?.name).toBe('plant.hc');
  });

  it('skips invisible layers', () => {
    const s = makeScene({
      layers: [
        { visible: false, objects: [plant('p1', 'plant.hc')] },
        { objects: [hardscape('h1', 'rock.seiryu')] },
      ],
    });
    const sum = summarizeScene(s, fakeCatalog);
    expect(sum.plants).toEqual([]);
    expect(sum.hardscape).toHaveLength(1);
    expect(sum.layerCount).toBe(1);
  });

  it('sorts results by descending count then name', () => {
    const s = makeScene({
      layers: [
        {
          objects: [
            plant('p1', 'plant.anubias'),
            plant('p2', 'plant.hc'),
            plant('p3', 'plant.hc'),
            plant('p4', 'plant.hc'),
          ],
        },
      ],
    });
    const sum = summarizeScene(s, fakeCatalog);
    expect(sum.plants.map((p) => p.name)).toEqual(['HC Cuba', 'Anubias']);
  });

  it('scatter patches contribute their derived instance count', () => {
    const s = makeScene({
      layers: [
        {
          objects: [
            // 1000mm × 1000mm polygon × density 20² / 1_000_000 = 400 instances.
            plant('carpet', 'plant.hc', { density: 20, size: 1000 }),
          ],
        },
      ],
    });
    const sum = summarizeScene(s, fakeCatalog);
    expect(sum.plants[0]?.count).toBe(400);
  });

  it('scatter polygon with degenerate area falls back to 0', () => {
    const s = makeScene({
      layers: [
        { objects: [plant('zero', 'plant.hc', { density: 20, size: 0 })] },
      ],
    });
    const sum = summarizeScene(s, fakeCatalog);
    expect(sum.plants[0]?.count).toBe(0);
  });
});

describe('summarizeScene — tank + volume', () => {
  it('passes tank dimensions through unchanged', () => {
    const s = makeScene();
    const sum = summarizeScene(s, fakeCatalog);
    expect(sum.tank).toEqual({ widthMm: 600, heightMm: 360, depthMm: 360 });
  });

  it('embeds the volume breakdown', () => {
    const s = makeScene();
    const sum = summarizeScene(s, fakeCatalog);
    expect(sum.volume.grossLitres).toBeCloseTo(77.76, 2);
  });
});

// ─── Markdown formatter ───────────────────────────────────────────────────

describe('formatSummaryMarkdown', () => {
  it('includes a top heading + every section', () => {
    const md = formatSummaryMarkdown(
      summarizeScene(makeScene({ layers: [{ objects: [plant('p', 'plant.hc')] }] }), fakeCatalog),
    );
    expect(md).toContain('# Aquascape layout summary');
    expect(md).toContain('## Tank');
    expect(md).toContain('## Hardscape');
    expect(md).toContain('## Plants');
    expect(md).toContain('## Layers');
  });

  it('renders dimensions as integers', () => {
    const s = makeScene();
    const md = formatSummaryMarkdown(summarizeScene(s, fakeCatalog));
    expect(md).toContain('600 × 360 × 360 mm');
  });

  it('renders litres + gallons to one decimal', () => {
    const s = makeScene();
    const md = formatSummaryMarkdown(summarizeScene(s, fakeCatalog));
    expect(md).toMatch(/Gross volume: 77\.8 L \(20\.5 US gal\)/);
  });

  it('says "None." when there is no hardscape / plants', () => {
    const md = formatSummaryMarkdown(summarizeScene(makeScene(), fakeCatalog));
    expect(md.match(/_None\._/g)?.length).toBe(2);
  });

  it('lists each item as a bullet with bolded name + count', () => {
    const s = makeScene({
      layers: [
        {
          objects: [
            hardscape('h1', 'rock.seiryu'),
            hardscape('h2', 'rock.seiryu'),
          ],
        },
      ],
    });
    const md = formatSummaryMarkdown(summarizeScene(s, fakeCatalog));
    expect(md).toContain('- **Seiryu Stone** × 2');
    expect(md).toContain('Total pieces: 2');
  });
});

// ─── F7.4 — livestock + equipment + stocking ──────────────────────────────

const livestockCatalog: Catalog = {
  entries: [] as never,
  get({ catalog, id }: { catalog: string; id: string }) {
    if (catalog !== 'core') return null;
    if (id === 'livestock.fish.neon-tetra') {
      return {
        kind: 'livestock',
        name: 'Neon Tetra (Paracheirodon innesi)',
        id: 'livestock.fish.neon-tetra',
        catalog: 'core',
        version: 1,
        group: 'fish',
        adultSize: 35,
        temperament: 'peaceful',
        temperatureRange: { minC: 20, maxC: 26 },
        pHRange: { min: 5.5, max: 7.5 },
        schoolingMin: 10,
        bioloadClass: 'low',
        color: '#3aa6c8',
      } as never;
    }
    if (id === 'livestock.fish.betta') {
      return {
        kind: 'livestock',
        name: 'Betta',
        id: 'livestock.fish.betta',
        catalog: 'core',
        version: 1,
        group: 'fish',
        adultSize: 60,
        temperament: 'aggressive',
        temperatureRange: { minC: 24, maxC: 28 },
        pHRange: { min: 6.5, max: 7.5 },
        schoolingMin: 1,
        bioloadClass: 'medium',
        color: '#c84a4a',
      } as never;
    }
    if (id === 'equipment.filter.fluval-207') {
      return {
        kind: 'equipment',
        name: 'Fluval 207 Canister',
        id: 'equipment.filter.fluval-207',
        catalog: 'core',
        version: 1,
        category: 'filter',
        subcategory: 'canister',
        wattage: 11,
        flowRateLph: 780,
        coverageLitres: { min: 100, max: 220 },
        color: '#3a6ec8',
      } as never;
    }
    if (id === 'equipment.heater.no-stats') {
      return {
        kind: 'equipment',
        name: 'Bare Heater',
        id: 'equipment.heater.no-stats',
        catalog: 'core',
        version: 1,
        category: 'heater',
        color: '#c87a3a',
      } as never;
    }
    return null;
  },
  byKind() {
    return [] as never;
  },
} as never;

function sceneWithLivestockEquipment(opts: {
  livestock?: ReadonlyArray<{ id: string; refId: string; quantity: number }>;
  equipment?: ReadonlyArray<{ id: string; refId: string; note?: string; settings?: Record<string, number | string | boolean> }>;
} = {}): Scene {
  const livestock = (opts.livestock ?? []).map((l) => ({
    id: l.id as never,
    ref: { catalog: 'core', id: l.refId, version: 1 },
    quantity: l.quantity,
  }));
  const equipment = (opts.equipment ?? []).map((e) => ({
    id: e.id as never,
    ref: { catalog: 'core', id: e.refId, version: 1 },
    ...(e.note !== undefined ? { note: e.note } : {}),
    ...(e.settings !== undefined ? { settings: e.settings } : {}),
  }));
  return {
    ...makeScene(),
    livestock,
    equipment,
  } as Scene;
}

describe('summarizeScene — livestock (F7.4)', () => {
  it('returns empty arrays when scene has no livestock or equipment', () => {
    const sum = summarizeScene(makeScene(), livestockCatalog);
    expect(sum.livestock).toEqual([]);
    expect(sum.equipment).toEqual([]);
    expect(sum.totalLivestock).toBe(0);
    expect(sum.totalWattage).toBe(0);
  });

  it('aggregates livestock with resolved catalog stats', () => {
    const scene = sceneWithLivestockEquipment({
      livestock: [{ id: 'L1', refId: 'livestock.fish.neon-tetra', quantity: 12 }],
    });
    const sum = summarizeScene(scene, livestockCatalog);
    expect(sum.livestock).toHaveLength(1);
    expect(sum.livestock[0]).toMatchObject({
      entryId: 'L1',
      catalogId: 'livestock.fish.neon-tetra',
      name: 'Neon Tetra (Paracheirodon innesi)',
      quantity: 12,
      group: 'fish',
      adultSizeMm: 35,
      temperament: 'peaceful',
      schoolingMin: 10,
      bioloadClass: 'low',
    });
    expect(sum.livestock[0]?.temperatureRangeC).toEqual({ min: 20, max: 26 });
    expect(sum.livestock[0]?.pHRange).toEqual({ min: 5.5, max: 7.5 });
    expect(sum.totalLivestock).toBe(12);
  });

  it('falls back to catalog id with null stats when catalog entry missing', () => {
    const scene = sceneWithLivestockEquipment({
      livestock: [{ id: 'L1', refId: 'livestock.fish.unknown', quantity: 5 }],
    });
    const sum = summarizeScene(scene, livestockCatalog);
    expect(sum.livestock[0]).toMatchObject({
      entryId: 'L1',
      catalogId: 'livestock.fish.unknown',
      name: 'livestock.fish.unknown',
      quantity: 5,
      group: null,
      adultSizeMm: null,
      temperatureRangeC: null,
      pHRange: null,
      schoolingMin: null,
      bioloadClass: null,
    });
    expect(sum.totalLivestock).toBe(5);
  });

  it('null catalog → all stats null but entry still represented', () => {
    const scene = sceneWithLivestockEquipment({
      livestock: [{ id: 'L1', refId: 'livestock.fish.neon-tetra', quantity: 5 }],
    });
    const sum = summarizeScene(scene, null);
    expect(sum.livestock[0]?.name).toBe('livestock.fish.neon-tetra');
    expect(sum.livestock[0]?.group).toBeNull();
    expect(sum.stockingWarnings).toEqual([]); // engine needs a catalog
  });
});

describe('summarizeScene — equipment (F7.4)', () => {
  it('aggregates equipment + sums published wattage', () => {
    const scene = sceneWithLivestockEquipment({
      equipment: [
        { id: 'E1', refId: 'equipment.filter.fluval-207', note: 'Pre-filter sponge added' },
        { id: 'E2', refId: 'equipment.heater.no-stats', settings: { targetTemperatureC: 24 } },
      ],
    });
    const sum = summarizeScene(scene, livestockCatalog);
    expect(sum.equipment).toHaveLength(2);
    expect(sum.equipment[0]).toMatchObject({
      entryId: 'E1',
      name: 'Fluval 207 Canister',
      category: 'filter',
      subcategory: 'canister',
      wattage: 11,
      flowRateLph: 780,
      note: 'Pre-filter sponge added',
    });
    expect(sum.equipment[0]?.coverageLitres).toEqual({ min: 100, max: 220 });
    expect(sum.equipment[1]).toMatchObject({
      entryId: 'E2',
      name: 'Bare Heater',
      category: 'heater',
      wattage: null,
      flowRateLph: null,
      coverageLitres: null,
      settings: { targetTemperatureC: 24 },
    });
    expect(sum.totalWattage).toBe(11);
  });
});

describe('summarizeScene — stocking warnings (F7.4)', () => {
  it('runs the rules engine + resolves species names', () => {
    // 200 neon tetras in the default 77.76L tank → bioload-severely-overstocked
    const scene = sceneWithLivestockEquipment({
      livestock: [{ id: 'L1', refId: 'livestock.fish.neon-tetra', quantity: 200 }],
    });
    const sum = summarizeScene(scene, livestockCatalog);
    expect(sum.stockingWarnings.length).toBeGreaterThan(0);
    const bioload = sum.stockingWarnings.find((w) =>
      w.code === 'bioload-severely-overstocked',
    );
    expect(bioload).toBeDefined();
    expect(bioload?.relatedEntryNames).toContain('Neon Tetra (Paracheirodon innesi)');
  });

  it('schooling-below-minimum fires when quantity is below schoolingMin', () => {
    // Neon tetra schoolingMin = 10; quantity 2 fires the rule.
    const scene = sceneWithLivestockEquipment({
      livestock: [{ id: 'L1', refId: 'livestock.fish.neon-tetra', quantity: 2 }],
    });
    const sum = summarizeScene(scene, livestockCatalog);
    expect(sum.stockingWarnings.some((w) => w.code === 'schooling-below-minimum')).toBe(true);
  });

  it('null catalog → no warnings (engine needs catalog to resolve refs)', () => {
    const scene = sceneWithLivestockEquipment({
      livestock: [{ id: 'L1', refId: 'livestock.fish.neon-tetra', quantity: 200 }],
    });
    const sum = summarizeScene(scene, null);
    expect(sum.stockingWarnings).toEqual([]);
  });

  it('empty livestock → no warnings', () => {
    const sum = summarizeScene(makeScene(), livestockCatalog);
    expect(sum.stockingWarnings).toEqual([]);
  });
});

describe('formatSummaryMarkdown — F7.4 sections', () => {
  it('omits all three sections when livestock + equipment empty', () => {
    const md = formatSummaryMarkdown(summarizeScene(makeScene(), livestockCatalog));
    expect(md).not.toContain('## Livestock');
    expect(md).not.toContain('## Equipment');
    expect(md).not.toContain('## Stocking guidance');
  });

  it('renders the livestock section with per-species stats + sub-bullets', () => {
    const scene = sceneWithLivestockEquipment({
      livestock: [{ id: 'L1', refId: 'livestock.fish.neon-tetra', quantity: 12 }],
    });
    const md = formatSummaryMarkdown(summarizeScene(scene, livestockCatalog));
    expect(md).toContain('## Livestock');
    expect(md).toContain('**Neon Tetra (Paracheirodon innesi)** × 12');
    expect(md).toContain('_(fish, 35 mm, peaceful, bioload: low)_');
    expect(md).toContain('Temp 20–26 °C');
    expect(md).toContain('pH 5.5–7.5');
    expect(md).toContain('Schools in groups of 10+');
    expect(md).toContain('Total individuals: 12');
  });

  it('omits the schooling sub-bullet for solitary species', () => {
    const scene = sceneWithLivestockEquipment({
      livestock: [{ id: 'L1', refId: 'livestock.fish.betta', quantity: 1 }],
    });
    const md = formatSummaryMarkdown(summarizeScene(scene, livestockCatalog));
    expect(md).toContain('**Betta** × 1');
    expect(md).not.toContain('Schools in groups of');
  });

  it('renders the equipment section with note + settings + coverage', () => {
    const scene = sceneWithLivestockEquipment({
      equipment: [
        {
          id: 'E1',
          refId: 'equipment.filter.fluval-207',
          note: 'Pre-filter sponge added',
          settings: { intensityPct: 80, photoperiodHours: 8 },
        },
      ],
    });
    const md = formatSummaryMarkdown(summarizeScene(scene, livestockCatalog));
    expect(md).toContain('## Equipment');
    expect(md).toContain('**Fluval 207 Canister** _(filter, canister, 11 W, 780 L/h)_');
    expect(md).toContain('Recommended for 100–220 L');
    expect(md).toContain('Note: Pre-filter sponge added');
    expect(md).toContain('Settings: intensityPct: 80, photoperiodHours: 8');
    expect(md).toContain('Total wattage (published): 11 W');
  });

  it('omits Total wattage when no equipment publishes a wattage', () => {
    const scene = sceneWithLivestockEquipment({
      equipment: [{ id: 'E1', refId: 'equipment.heater.no-stats' }],
    });
    const md = formatSummaryMarkdown(summarizeScene(scene, livestockCatalog));
    expect(md).toContain('**Bare Heater**');
    expect(md).not.toContain('Total wattage');
  });

  it('renders the stocking-guidance section with severity icons + explanations', () => {
    // 200 neon tetras → fires bioload error.
    const scene = sceneWithLivestockEquipment({
      livestock: [{ id: 'L1', refId: 'livestock.fish.neon-tetra', quantity: 200 }],
    });
    const md = formatSummaryMarkdown(summarizeScene(scene, livestockCatalog));
    expect(md).toContain('## Stocking guidance');
    expect(md).toContain('❌');
    expect(md).toContain('Affects: Neon Tetra (Paracheirodon innesi)');
  });

  it('coverage-only-max equipment renders "up to N L"', () => {
    // Inject a synthetic catalog entry with just `coverageLitres.max`.
    const onlyMaxCatalog: Catalog = {
      entries: [] as never,
      get({ catalog, id }) {
        if (catalog === 'core' && id === 'equipment.light.clip') {
          return {
            kind: 'equipment',
            name: 'Nano Clip Light',
            id: 'equipment.light.clip',
            catalog: 'core',
            version: 1,
            category: 'light',
            coverageLitres: { max: 30 },
            color: '#ffffff',
          } as never;
        }
        return null;
      },
      byKind() {
        return [] as never;
      },
    } as never;
    const scene = sceneWithLivestockEquipment({
      equipment: [{ id: 'E1', refId: 'equipment.light.clip' }],
    });
    const md = formatSummaryMarkdown(summarizeScene(scene, onlyMaxCatalog));
    expect(md).toContain('Recommended for up to 30 L');
  });

  it('coverage-only-min equipment renders "N L+"', () => {
    const onlyMinCatalog: Catalog = {
      entries: [] as never,
      get({ catalog, id }) {
        if (catalog === 'core' && id === 'equipment.filter.huge') {
          return {
            kind: 'equipment',
            name: 'Huge Filter',
            id: 'equipment.filter.huge',
            catalog: 'core',
            version: 1,
            category: 'filter',
            coverageLitres: { min: 400 },
            color: '#3a6ec8',
          } as never;
        }
        return null;
      },
      byKind() {
        return [] as never;
      },
    } as never;
    const scene = sceneWithLivestockEquipment({
      equipment: [{ id: 'E1', refId: 'equipment.filter.huge' }],
    });
    const md = formatSummaryMarkdown(summarizeScene(scene, onlyMinCatalog));
    expect(md).toContain('Recommended for 400 L+');
  });
});

// ─── JSON formatter ───────────────────────────────────────────────────────

describe('formatSummaryJson', () => {
  it('produces parseable, pretty-printed JSON', () => {
    const sum = summarizeScene(makeScene(), fakeCatalog);
    const json = formatSummaryJson(sum);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain('\n  '); // two-space indent
  });

  it('round-trips: parse(format(sum)) === sum (for plain JSON values)', () => {
    const sum = summarizeScene(makeScene(), fakeCatalog);
    const round = JSON.parse(formatSummaryJson(sum));
    expect(round).toEqual(sum);
  });
});
