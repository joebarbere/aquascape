import { Mesh, MeshStandardMaterial } from 'three';
import type {
  Catalog,
  CatalogEntry,
  CatalogKind,
  HardscapeEntry,
} from '@aquascape/domain/catalog';
import type { HardscapeObject, Layer, Scene } from '@aquascape/domain/scene-model';
import { buildHardscapeMesh, buildHardscapeMeshes } from './hardscape-mesh';

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

function rockEntry(color = '#445566'): HardscapeEntry {
  return {
    catalog: 'core',
    id: 'rock.test',
    version: 1,
    name: 'Test Rock',
    kind: 'hardscape',
    category: 'rock',
    naturalSize: { width: 100, height: 80, depth: 60 },
    color,
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
  };
}

function rockObj(overrides: Partial<HardscapeObject> = {}): HardscapeObject {
  return {
    id: 'h1' as HardscapeObject['id'],
    kind: 'hardscape',
    ref: { catalog: 'core', id: 'rock.test', version: 1 },
    transform: {
      position: { x: 100, y: 50, z: 75 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      flipX: false,
      flipY: false,
    },
    ...overrides,
  };
}

function sceneWithLayer(objs: HardscapeObject[], visible = true): Scene {
  const layer: Layer = {
    id: 'l1' as Layer['id'],
    name: 'L',
    opacity: 1,
    visible,
    locked: false,
    objects: objs,
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
    seed: 1,
  };
}

describe('hardscape-mesh builder', () => {
  it('builds one mesh per hardscape object in a visible layer', () => {
    const catalog = makeCatalog([rockEntry()]);
    const group = buildHardscapeMeshes(sceneWithLayer([rockObj(), rockObj({ id: 'h2' as HardscapeObject['id'] })]), catalog);
    expect(group.children.length).toBe(2);
    expect(group.children[0]).toBeInstanceOf(Mesh);
  });

  it('skips invisible layers', () => {
    const catalog = makeCatalog([rockEntry()]);
    const group = buildHardscapeMeshes(sceneWithLayer([rockObj()], false), catalog);
    expect(group.children.length).toBe(0);
  });

  it('applies transform position to the mesh', () => {
    const catalog = makeCatalog([rockEntry()]);
    const obj = rockObj({
      transform: {
        position: { x: 250, y: 120, z: 90 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        flipX: false,
        flipY: false,
      },
    });
    const group = buildHardscapeMeshes(sceneWithLayer([obj]), catalog);
    const mesh = group.children[0] as Mesh;
    expect(mesh.position.x).toBe(250);
    expect(mesh.position.y).toBe(120);
    expect(mesh.position.z).toBe(90);
  });

  it('absorbs flipX into negative X scale', () => {
    const catalog = makeCatalog([rockEntry()]);
    const obj = rockObj({
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 2, y: 1, z: 1 },
        flipX: true,
        flipY: false,
      },
    });
    const group = buildHardscapeMeshes(sceneWithLayer([obj]), catalog);
    const mesh = group.children[0] as Mesh;
    expect(mesh.scale.x).toBe(-2);
    expect(mesh.scale.y).toBe(1);
  });

  it('uses the catalog colour on the material', () => {
    const catalog = makeCatalog([rockEntry('#aabbcc')]);
    const group = buildHardscapeMeshes(sceneWithLayer([rockObj()]), catalog);
    const mesh = group.children[0] as Mesh;
    const mat = mesh.material as MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('aabbcc');
  });

  it('falls back to the default colour + size when no catalog entry exists', () => {
    const group = buildHardscapeMeshes(sceneWithLayer([rockObj()]), undefined);
    const mesh = group.children[0] as Mesh;
    const mat = mesh.material as MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('7a7d84');
  });

  it('returns null from the per-object builder when the silhouette is too small', () => {
    const tiny: HardscapeEntry = {
      ...rockEntry(),
      silhouette: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    };
    expect(buildHardscapeMesh(rockObj(), tiny)).toBeNull();
  });
});
