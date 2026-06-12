import type { Catalog, CatalogEntry, CatalogKind, DecorEntry } from '@aquascape/domain/catalog';
import type { DecorObject, Layer, ObjectId, Scene } from '@aquascape/domain/scene-model';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
} from 'three';

import { ModelCache, type ModelLoadFn } from '../model-cache';
import { CAUSTIC_MATERIALS_KEY, CAUSTIC_UNIFORMS_KEY } from './caustics';
import { buildDecorMeshes, MODEL_FACES_VIEWER_SCALE_Z, prepareLoadedModel } from './decor-mesh';

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

function chestEntry(color = '#8a6d3b'): DecorEntry {
  return {
    catalog: 'core',
    id: 'decor.treasure-chest',
    version: 1,
    name: 'Treasure chest',
    kind: 'decor',
    category: 'wreck',
    naturalSize: { width: 120, height: 90, depth: 80 },
    color,
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
    model: 'decor/treasure-chest.glb',
  };
}

function decorObj(overrides: Partial<DecorObject> = {}): DecorObject {
  return {
    id: 'd1' as DecorObject['id'],
    kind: 'decor',
    ref: { catalog: 'core', id: 'decor.treasure-chest', version: 1 },
    transform: {
      position: { x: 200, y: 50, z: 100 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      flipX: false,
      flipY: false,
    },
    ...overrides,
  };
}

function sceneWithLayer(objs: DecorObject[], visible = true, zone?: Layer['zone']): Scene {
  const layer: Layer = {
    id: 'l1' as Layer['id'],
    name: 'L',
    opacity: 1,
    visible,
    locked: false,
    objects: objs,
    ...(zone !== undefined ? { zone } : {}),
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

/** Fake GLB loader resolving to one physical-material mesh. */
function makeFakeLoader(): {
  load: ModelLoadFn;
  calls: string[];
  resolve: () => Mesh;
  reject: () => void;
} {
  const calls: string[] = [];
  let onLoad: ((gltf: { scene: Object3D }) => void) | null = null;
  let onError: (() => void) | null = null;
  return {
    calls,
    load: (url, loadCb, errorCb) => {
      calls.push(url);
      onLoad = loadCb;
      onError = errorCb;
    },
    resolve: () => {
      const mesh = new Mesh(new BoxGeometry(10, 10, 10), new MeshPhysicalMaterial());
      const scene = new Group();
      scene.add(mesh);
      onLoad?.({ scene });
      return mesh;
    },
    reject: () => onError?.(),
  };
}

const findFallback = (root: Object3D): Mesh | null => {
  let found: Mesh | null = null;
  root.traverse((node) => {
    if (node.name.startsWith('aquascape:decor-fallback/')) found = node as Mesh;
  });
  return found;
};

const findModel = (root: Object3D): Object3D | null => {
  let found: Object3D | null = null;
  root.traverse((node) => {
    if (node.name === 'aquascape:decor-model') found = node;
  });
  return found;
};

describe('decor-mesh builder — fallback path (no catalogModelBaseUrl)', () => {
  it('builds one extruded-silhouette node per decor object, no network', () => {
    const catalog = makeCatalog([chestEntry()]);
    const group = buildDecorMeshes(
      sceneWithLayer([decorObj(), decorObj({ id: 'd2' as ObjectId })]),
      catalog,
    );
    expect(group.children.length).toBe(2);
    const fallback = findFallback(group.children[0]!);
    expect(fallback).not.toBeNull();
    expect((fallback!.material as MeshStandardMaterial).color.getHexString()).toBe('8a6d3b');
  });

  it('skips invisible layers', () => {
    const catalog = makeCatalog([chestEntry()]);
    const group = buildDecorMeshes(sceneWithLayer([decorObj()], false), catalog);
    expect(group.children.length).toBe(0);
  });

  it('falls back to the hardscape grey + square footprint when the catalog entry is missing', () => {
    const group = buildDecorMeshes(sceneWithLayer([decorObj()]), undefined);
    expect(group.children.length).toBe(1);
    const fallback = findFallback(group.children[0]!);
    expect((fallback!.material as MeshStandardMaterial).color.getHexString()).toBe('7a7d84');
  });

  it('rests on the substrate: y = substrateHeightAt(x), ignoring transform.position.y', () => {
    const catalog = makeCatalog([chestEntry()]);
    const scene = sceneWithLayer([decorObj()]);
    const withSubstrate: Scene = {
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
              { x: 0, y: 40 },
              { x: 1, y: 40 },
            ],
          },
        ],
      },
    };
    const group = buildDecorMeshes(withSubstrate, catalog);
    const node = group.children[0]!;
    expect(node.position.x).toBe(200);
    expect(node.position.y).toBeCloseTo(40, 5);
    expect(node.position.z).toBe(100);
  });

  it('clamps X / Z so the scaled AABB stays inside the glass', () => {
    // naturalSize 120 wide → halfW 60. Position x = 590 in a 600-wide tank
    // → bbox 530..650 pokes 50 mm past the right pane → clamped to 540.
    // depth 80 → halfD 40; z = 290 in a 300-deep tank → clamped to 260.
    const catalog = makeCatalog([chestEntry()]);
    const obj = decorObj({
      transform: {
        position: { x: 590, y: 0, z: 290 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        flipX: false,
        flipY: false,
      },
    });
    const group = buildDecorMeshes(sceneWithLayer([obj]), catalog);
    const node = group.children[0]!;
    expect(node.position.x).toBe(540);
    expect(node.position.z).toBe(260);
  });

  it('overrides Z via the layer zone band (same computeZonedZ path as hardscape)', () => {
    // Tank depth 300 → foreground band [0, 100]. Two chests at z 200, 280
    // min-max remap to 0, 100 — then the AABB clamp pulls them to halfD=40.
    const catalog = makeCatalog([chestEntry()]);
    const a = decorObj({ id: 'a' as ObjectId });
    a.transform.position = { x: 100, y: 0, z: 200 };
    const b = decorObj({ id: 'b' as ObjectId });
    b.transform.position = { x: 400, y: 0, z: 280 };
    const group = buildDecorMeshes(sceneWithLayer([a, b], true, 'foreground'), catalog);
    expect(group.children[0]!.position.z).toBeCloseTo(40, 5); // clamped to halfD
    expect(group.children[1]!.position.z).toBeCloseTo(100, 5);
  });

  it('absorbs flipX / flipY into negative scale (hardscape convention) and applies scale only', () => {
    const catalog = makeCatalog([chestEntry()]);
    const obj = decorObj({
      transform: {
        position: { x: 200, y: 0, z: 100 },
        rotation: { x: 0, y: 0, z: 0.5 },
        scale: { x: 2, y: 1.5, z: 1 },
        flipX: true,
        flipY: false,
      },
    });
    const group = buildDecorMeshes(sceneWithLayer([obj]), catalog);
    const node = group.children[0]!;
    expect(node.scale.x).toBe(-2);
    expect(node.scale.y).toBe(1.5);
    expect(node.scale.z).toBe(1);
    expect(node.rotation.z).toBeCloseTo(0.5, 8);
  });

  it('fallback casts + receives shadows and is caustic-patched (live array on userData)', () => {
    const catalog = makeCatalog([chestEntry()]);
    const group = buildDecorMeshes(sceneWithLayer([decorObj()]), catalog);
    const fallback = findFallback(group.children[0]!)!;
    expect(fallback.castShadow).toBe(true);
    expect(fallback.receiveShadow).toBe(true);
    const mats = group.userData[CAUSTIC_MATERIALS_KEY] as MeshStandardMaterial[];
    expect(mats.length).toBe(1);
    expect(mats[0]!.userData[CAUSTIC_UNIFORMS_KEY]).toBeDefined();
  });

  it('skips a decor object whose silhouette is degenerate (< 3 points) on the no-model path', () => {
    const degenerate: DecorEntry = {
      ...chestEntry(),
      silhouette: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    };
    const group = buildDecorMeshes(sceneWithLayer([decorObj()]), makeCatalog([degenerate]));
    expect(group.children.length).toBe(0);
  });

  it('is idempotent — two builds with the same input produce the same node shape', () => {
    const catalog = makeCatalog([chestEntry()]);
    const a = buildDecorMeshes(sceneWithLayer([decorObj()]), catalog);
    const b = buildDecorMeshes(sceneWithLayer([decorObj()]), catalog);
    expect(a.children.length).toBe(b.children.length);
    expect(a.children[0]!.position).toEqual(b.children[0]!.position);
  });
});

describe('decor-mesh builder — GLB model path', () => {
  it('shows the fallback while loading, then attaches the model in place and hides the fallback', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const catalog = makeCatalog([chestEntry()]);
    const group = buildDecorMeshes(sceneWithLayer([decorObj()]), catalog, {
      cache,
      baseUrl: 'assets/catalog-models/',
    });
    expect(loader.calls).toEqual(['assets/catalog-models/decor/treasure-chest.glb']);
    const fallback = findFallback(group)!;
    expect(fallback.visible).toBe(true);
    expect(findModel(group)).toBeNull();

    loader.resolve();
    expect(findModel(group)).not.toBeNull(); // attached in place, no rebuild
    expect(fallback.visible).toBe(false); // hidden, still owned by the tree
  });

  it('a failed load leaves the fallback permanently', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const catalog = makeCatalog([chestEntry()]);
    const group = buildDecorMeshes(sceneWithLayer([decorObj()]), catalog, {
      cache,
      baseUrl: 'assets/catalog-models/',
    });
    loader.reject();
    expect(findModel(group)).toBeNull();
    expect(findFallback(group)!.visible).toBe(true);
    // A rebuild (new render) does not retry the URL.
    buildDecorMeshes(sceneWithLayer([decorObj()]), catalog, {
      cache,
      baseUrl: 'assets/catalog-models/',
    });
    expect(loader.calls.length).toBe(1);
  });

  it('Z-flips the model container (front-+Z GLB faces the doc −Z viewer, authored +X stays on screen-right)', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const catalog = makeCatalog([chestEntry()]);
    const group = buildDecorMeshes(sceneWithLayer([decorObj()]), catalog, {
      cache,
      baseUrl: 'assets/catalog-models/',
    });
    const container = group.children[0]!.children[0]!;
    // scale.z = −1, NOT rotation.y = π — a yaw would mirror the model's
    // authored left-right relative to its own 2D silhouette (see the
    // ORIENTATION section in decor-mesh.ts).
    expect(container.scale.z).toBe(MODEL_FACES_VIEWER_SCALE_Z);
    expect(container.rotation.y).toBe(0);
    expect(container.scale.x).toBe(1);
    const fallback = findFallback(group)!;
    // The z-symmetric extrusion needs NO compensation under the Z-flip —
    // its silhouette keeps the exact hardscape/2D left-right reading.
    expect(fallback.rotation.y).toBe(0);
    expect(fallback.scale.z).toBe(1);
  });

  it('a second object for the same entry reuses the single load and gets its own clone', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const catalog = makeCatalog([chestEntry()]);
    const group = buildDecorMeshes(
      sceneWithLayer([decorObj({ id: 'a' as ObjectId }), decorObj({ id: 'b' as ObjectId })]),
      catalog,
      { cache, baseUrl: 'assets/catalog-models/' },
    );
    expect(loader.calls.length).toBe(1);
    loader.resolve();
    const modelA = findModel(group.children[0]!);
    const modelB = findModel(group.children[1]!);
    expect(modelA).not.toBeNull();
    expect(modelB).not.toBeNull();
    expect(modelA).not.toBe(modelB);
  });

  it('sets shadow flags + pushes caustic-patched materials into the LIVE group array on late attach', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const catalog = makeCatalog([chestEntry()]);
    const group = buildDecorMeshes(sceneWithLayer([decorObj()]), catalog, {
      cache,
      baseUrl: 'assets/catalog-models/',
    });
    const liveArray = group.userData[CAUSTIC_MATERIALS_KEY] as MeshStandardMaterial[];
    const beforeLoad = liveArray.length; // the fallback's material
    loader.resolve();
    const model = findModel(group)!;
    const modelMesh = model.children[0] as Mesh;
    expect(modelMesh.castShadow).toBe(true);
    expect(modelMesh.receiveShadow).toBe(true);
    // The clone's material was patched + pushed into the SAME array the
    // renderer holds — late loads animate without a rebuild.
    expect(liveArray.length).toBe(beforeLoad + 1);
    expect(liveArray[liveArray.length - 1]!.userData[CAUSTIC_UNIFORMS_KEY]).toBeDefined();
  });
});

describe('prepareLoadedModel — caustics on GLB materials', () => {
  it('patches non-transmissive standard/physical materials', () => {
    const mats: MeshStandardMaterial[] = [];
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshPhysicalMaterial());
    const root = new Group();
    root.add(mesh);
    prepareLoadedModel(root, 360, mats);
    expect(mats.length).toBe(1);
    expect(mats[0]!.userData[CAUSTIC_UNIFORMS_KEY]).toBeDefined();
  });

  it('SKIPS transmissive materials (additive caustics over a transmission pass reads milky)', () => {
    const mats: MeshStandardMaterial[] = [];
    const glassy = new MeshPhysicalMaterial();
    glassy.transmission = 0.9;
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), glassy);
    const root = new Group();
    root.add(mesh);
    prepareLoadedModel(root, 360, mats);
    expect(mats.length).toBe(0);
    expect(mesh.castShadow).toBe(true); // shadow flags still applied
  });

  it('skips non-standard materials entirely', () => {
    const mats: MeshStandardMaterial[] = [];
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const root = new Group();
    root.add(mesh);
    prepareLoadedModel(root, 360, mats);
    expect(mats.length).toBe(0);
  });
});
