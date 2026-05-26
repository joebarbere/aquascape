import { Mesh, MeshStandardMaterial } from 'three';
import type {
  Catalog,
  CatalogEntry,
  CatalogKind,
  HardscapeEntry,
} from '@aquascape/domain/catalog';
import type { HardscapeObject, Layer, ObjectId, Scene } from '@aquascape/domain/scene-model';
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

  it('places the mesh at (x, substrateHeight, z) — y is snapped to the substrate floor regardless of transform.position.y', () => {
    // The 2D renderer treats transform.position.y as the silhouette
    // centre; in 3D we override it so the rock rests on the substrate.
    // With an empty substrate, the floor is y = 0.
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
    expect(mesh.position.y).toBe(0); // floor (empty substrate)
    expect(mesh.position.z).toBe(90);
  });

  it('snaps Y to the substrate top profile when a region covers the rock', () => {
    const catalog = makeCatalog([rockEntry()]);
    const scene = sceneWithLayer([
      rockObj({
        transform: {
          position: { x: 200, y: 0, z: 100 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          flipX: false,
          flipY: false,
        },
      }),
    ]);
    // Inject a substrate region with a flat 50 mm profile at the rock's X.
    const sceneWithSubstrate: Scene = {
      ...scene,
      substrate: {
        regions: [
          {
            id: '11111111-1111-4111-8111-111111111111' as never,
            material: { catalog: 'core', id: 's', version: 1 },
            fromX: 0,
            toX: 1,
            blend: 0,
            profile: [
              { x: 0, y: 50 },
              { x: 1, y: 50 },
            ],
          },
        ],
      },
    };
    const group = buildHardscapeMeshes(sceneWithSubstrate, catalog);
    const mesh = group.children[0] as Mesh;
    expect(mesh.position.y).toBeCloseTo(50, 5);
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

  it('clamps X / Z so the rock\'s bbox stays inside the tank interior', () => {
    // Rock natural size 100 × 80 × 60. Tank 360 × 360 × 300.
    // halfW = 50; position x = 340 → bbox 290 .. 390 → would stick 30 mm
    // past the right wall (360). Expect clamped x = 310.
    const catalog = makeCatalog([rockEntry()]);
    const obj = rockObj({
      transform: {
        position: { x: 340, y: 0, z: 30 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        flipX: false,
        flipY: false,
      },
    });
    const scene = sceneWithLayer([obj]);
    // Use a tank with width 360 to make the math sharp.
    const narrow: Scene = {
      ...scene,
      tank: { ...scene.tank, width: 360, depth: 300 },
    };
    const group = buildHardscapeMeshes(narrow, catalog);
    const mesh = group.children[0] as Mesh;
    expect(mesh.position.x).toBe(310);
  });

  it('overrides Z based on the containing layer\'s zone (foreground band)', () => {
    // Tank depth 300 → foreground band [0, 100]. Two rocks at z = 200, 280.
    // After min-max remap: 200 → 0, 280 → 100.
    const catalog = makeCatalog([rockEntry()]);
    const objA: HardscapeObject = rockObj({
      id: 'a' as ObjectId,
      transform: {
        position: { x: 100, y: 0, z: 200 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        flipX: false,
        flipY: false,
      },
    });
    const objB: HardscapeObject = rockObj({
      id: 'b' as ObjectId,
      transform: {
        position: { x: 200, y: 0, z: 280 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        flipX: false,
        flipY: false,
      },
    });
    const layer: Layer = {
      id: 'L' as Layer['id'],
      name: 'fg',
      opacity: 1,
      visible: true,
      locked: false,
      objects: [objA, objB],
      zone: 'foreground',
    };
    const scene: Scene = {
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
    const group = buildHardscapeMeshes(scene, catalog);
    // halfD = 30 → clamp lower bound is 30 (objA at zone-z 0 → clamped 30).
    const meshA = group.children[0] as Mesh;
    const meshB = group.children[1] as Mesh;
    expect(meshA.position.z).toBeCloseTo(30, 5); // clamped to halfD
    expect(meshB.position.z).toBeCloseTo(100, 5);
  });
});

describe('hardscape noise displacement', () => {
  const cat = (): Catalog =>
    makeCatalog([rockEntry()]);

  it('produces byte-identical position buffers across two builds with the same input (idempotency)', () => {
    const sceneA = sceneWithLayer([rockObj()]);
    const sceneB = sceneWithLayer([rockObj()]);
    const groupA = buildHardscapeMeshes(sceneA, cat());
    const groupB = buildHardscapeMeshes(sceneB, cat());
    const arrA = (groupA.children[0] as Mesh).geometry.attributes['position']!
      .array as Float32Array;
    const arrB = (groupB.children[0] as Mesh).geometry.attributes['position']!
      .array as Float32Array;
    expect(Array.from(arrA)).toEqual(Array.from(arrB));
  });

  it('produces DIFFERENT vertex buffers for two rocks with the SAME catalog entry but different object ids', () => {
    const scene = sceneWithLayer([
      rockObj({ id: 'h1' as ObjectId }),
      rockObj({ id: 'h2' as ObjectId }),
    ]);
    const group = buildHardscapeMeshes(scene, cat());
    const arr1 = (group.children[0] as Mesh).geometry.attributes['position']!
      .array as Float32Array;
    const arr2 = (group.children[1] as Mesh).geometry.attributes['position']!
      .array as Float32Array;
    // Same length (same silhouette + extrusion), but the contents differ.
    expect(arr1.length).toBe(arr2.length);
    expect(Array.from(arr1)).not.toEqual(Array.from(arr2));
  });

  it('recomputes vertex normals after displacement (non-empty + not all zeros)', () => {
    const scene = sceneWithLayer([rockObj()]);
    const group = buildHardscapeMeshes(scene, cat());
    const mesh = group.children[0] as Mesh;
    const normalAttr = mesh.geometry.attributes['normal'];
    expect(normalAttr).toBeDefined();
    const arr = normalAttr!.array as Float32Array;
    let nonZeroCount = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== 0) nonZeroCount++;
    }
    expect(nonZeroCount).toBeGreaterThan(0);
  });
});
