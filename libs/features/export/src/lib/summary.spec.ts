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
