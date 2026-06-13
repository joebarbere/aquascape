import { coreCatalog } from '@aquascape/domain/catalog';
import { iterateObjects } from '@aquascape/domain/scene-model';
import type { CatalogRef } from '@aquascape/domain/scene-model';

import { createShowcaseScene } from './showcase-scene';

/** Every id present in the bundled core catalog. */
const CATALOG_IDS = new Set(coreCatalog.entries.map((e) => e.id));

describe('createShowcaseScene', () => {
  it('is deterministic — two calls produce a structurally identical scene', () => {
    expect(createShowcaseScene()).toEqual(createShowcaseScene());
  });

  it('builds a large show tank with an explicit water level', () => {
    const { tank } = createShowcaseScene();
    expect(tank.width).toBe(1500);
    expect(tank.height).toBe(600);
    expect(tank.depth).toBe(600);
    expect(tank.waterLevelMm).toBeLessThan(tank.height);
    expect(tank.waterLevelMm).toBeGreaterThan(0);
  });

  it('has every layer populated, including a scatter-carpet foreground', () => {
    const scene = createShowcaseScene();
    expect(scene.layers.length).toBeGreaterThanOrEqual(5);
    for (const layer of scene.layers) {
      expect(layer.objects.length).toBeGreaterThan(0);
    }
    const carpet = scene.layers.find((l) => l.name === 'Carpet');
    expect(carpet).toBeDefined();
    expect(carpet?.objects.every((o) => o.kind === 'plant' && o.scatter !== undefined)).toBe(true);
  });

  it('references only real catalog ids for every object, livestock + equipment', () => {
    const scene = createShowcaseScene();
    const refs: CatalogRef[] = [];
    for (const { object } of iterateObjects(scene)) refs.push(object.ref);
    refs.push(scene.substrate.regions[0].material);
    for (const ls of scene.livestock ?? []) refs.push(ls.ref);
    for (const eq of scene.equipment ?? []) refs.push(eq.ref);

    const unknown = refs.filter((r) => !CATALOG_IDS.has(r.id));
    expect(unknown).toEqual([]);
    expect(refs.every((r) => r.catalog === 'core' && r.version === 1)).toBe(true);
  });

  it('stocks the four mid-water schooling shoals', () => {
    const scene = createShowcaseScene();
    const livestock = scene.livestock ?? [];
    expect(livestock.map((l) => l.ref.id)).toEqual([
      'livestock.fish.neon-tetra',
      'livestock.fish.cardinal-tetra',
      'livestock.fish.ember-tetra',
      'livestock.fish.harlequin-rasbora',
    ]);
    const total = livestock.reduce((n, l) => n + l.quantity, 0);
    expect(total).toBe(108);
    expect(livestock.every((l) => l.quantity > 0)).toBe(true);
    // Unique entry ids (no accidental collisions from the id derivation).
    expect(new Set(livestock.map((l) => l.id)).size).toBe(livestock.length);
  });

  it('includes lighting, a filter and an air source in its equipment', () => {
    const ids = (createShowcaseScene().equipment ?? []).map((e) => e.ref.id);
    expect(ids.some((id) => id.startsWith('equipment.light.'))).toBe(true);
    expect(ids.some((id) => id.startsWith('equipment.filter.'))).toBe(true);
    // The sponge filter is what produces the bubble eye-candy in 3D.
    expect(ids).toContain('equipment.filter.aquaneat-triple-sponge');
  });

  it('mints unique object ids across all layers', () => {
    const scene = createShowcaseScene();
    const ids = [...iterateObjects(scene)].map(({ object }) => object.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
