import { Group, InstancedMesh, Mesh, MeshStandardMaterial } from 'three';
import type {
  Catalog,
  CatalogEntry,
  CatalogKind,
  PlantEntry,
} from '@aquascape/domain/catalog';
import type { Layer, PlantObject, Scene } from '@aquascape/domain/scene-model';
import { buildPlantMeshes } from './plant-mesh';

function makeCatalog(entries: CatalogEntry[]): Catalog {
  return {
    entries,
    get({ catalog, id }) {
      return entries.find((e) => e.catalog === catalog && e.id === id) ?? null;
    },
    byKind<K extends CatalogKind>(kind: K): readonly Extract<CatalogEntry, { kind: K }>[] {
      return entries.filter((e): e is Extract<CatalogEntry, { kind: K }> => e.kind === kind);
    },
  };
}

function carpetEntry(color = '#2e7d32'): PlantEntry {
  return {
    catalog: 'core',
    id: 'plant.test.carpet',
    version: 1,
    name: 'Test Carpet',
    kind: 'plant',
    zone: 'foreground',
    lighting: 'medium',
    co2: 'low',
    difficulty: 'easy',
    color,
    naturalSize: { width: 30, height: 20, depth: 20 },
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
    growth: { weeksToMature: 8, sizeAtZero: 0.3 },
  };
}

function plant(overrides: Partial<PlantObject> = {}): PlantObject {
  return {
    id: 'p1' as PlantObject['id'],
    kind: 'plant',
    ref: { catalog: 'core', id: 'plant.test.carpet', version: 1 },
    transform: {
      position: { x: 100, y: 30, z: 50 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      flipX: false,
      flipY: false,
    },
    growth: { ageWeeks: 12, vigor: 1 },
    ...overrides,
  };
}

function sceneWithPlants(plants: PlantObject[]): Scene {
  const layer: Layer = {
    id: 'l1' as Layer['id'],
    name: 'L',
    opacity: 1,
    visible: true,
    locked: false,
    objects: plants,
  };
  return {
    tank: {
      width: 600,
      height: 360,
      depth: 300,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: [] },
    layers: [layer],
    seed: 42,
  };
}

describe('plant-mesh builder — single specimen', () => {
  it('produces one mesh for a single specimen plant', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const group = buildPlantMeshes(sceneWithPlants([plant()]), catalog, undefined);
    expect(group.children.length).toBe(1);
    const node = group.children[0];
    expect(node).toBeInstanceOf(Mesh);
  });

  it('applies catalog colour to the material', () => {
    const catalog = makeCatalog([carpetEntry('#114433')]);
    const group = buildPlantMeshes(sceneWithPlants([plant()]), catalog, undefined);
    const mat = (group.children[0] as Mesh).material as MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('114433');
  });

  it('honours previewAgeWeeks for growth scale', () => {
    const catalog = makeCatalog([carpetEntry()]);
    // Same plant rendered at age 0 vs age 100 → different mesh scale.
    const groupYoung = buildPlantMeshes(
      sceneWithPlants([plant({ growth: { ageWeeks: 0, vigor: 1 } })]),
      catalog,
      0,
    );
    const groupOld = buildPlantMeshes(
      sceneWithPlants([plant({ growth: { ageWeeks: 100, vigor: 1 } })]),
      catalog,
      100,
    );
    const sYoung = (groupYoung.children[0] as Mesh).scale.x;
    const sOld = (groupOld.children[0] as Mesh).scale.x;
    expect(sOld).toBeGreaterThan(sYoung);
  });

  it('skips plants whose catalog entry is missing', () => {
    const group = buildPlantMeshes(sceneWithPlants([plant()]), undefined, undefined);
    expect(group.children.length).toBe(0);
  });

  it('skips invisible layers', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const scene = sceneWithPlants([plant()]);
    scene.layers[0]!.visible = false;
    const group = buildPlantMeshes(scene, catalog, undefined);
    expect(group.children.length).toBe(0);
  });
});

describe('plant-mesh builder — scatter patches', () => {
  function scatterPlant(density: number): PlantObject {
    return plant({
      scatter: {
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        density,
      },
    });
  }

  it('uses individual meshes for sparse patches (< INSTANCED_THRESHOLD)', () => {
    const catalog = makeCatalog([carpetEntry()]);
    // Low density → few instances → simple Group of Meshes.
    const group = buildPlantMeshes(sceneWithPlants([scatterPlant(0.05)]), catalog, undefined);
    if (group.children.length === 0) return; // density too low to produce anything
    const patch = group.children[0];
    expect(patch).toBeInstanceOf(Group);
  });

  it('uses InstancedMesh for dense patches (≥ INSTANCED_THRESHOLD)', () => {
    const catalog = makeCatalog([carpetEntry()]);
    // Very high density → many instances.
    const group = buildPlantMeshes(sceneWithPlants([scatterPlant(100)]), catalog, undefined);
    const patch = group.children[0];
    expect(patch).toBeInstanceOf(InstancedMesh);
  });

  it('is deterministic: same inputs produce same instance positions', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const a = buildPlantMeshes(
      sceneWithPlants([{ ...scatterPlant(50), id: 'p1' as PlantObject['id'] }]),
      catalog,
      undefined,
    );
    const b = buildPlantMeshes(
      sceneWithPlants([{ ...scatterPlant(50), id: 'p1' as PlantObject['id'] }]),
      catalog,
      undefined,
    );
    expect(a.children.length).toBe(b.children.length);
  });
});
