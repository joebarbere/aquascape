import {
  BoxGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
} from 'three';

import { ModelCache, type ModelLoadFn } from './model-cache';

/** Build a GLB-shaped source: a Group with one Mesh (geometry + material). */
function makeSource(): { scene: Group; mesh: Mesh } {
  const mesh = new Mesh(new BoxGeometry(10, 10, 10), new MeshPhysicalMaterial());
  const scene = new Group();
  scene.add(mesh);
  return { scene, mesh };
}

/**
 * A controllable fake loader: records calls, resolves / rejects manually so
 * specs exercise the placeholder → attach-in-place upgrade explicitly.
 */
function makeFakeLoader(): {
  load: ModelLoadFn;
  calls: string[];
  resolve: (scene: Object3D) => void;
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
    resolve: (scene) => onLoad?.({ scene }),
    reject: () => onError?.(),
  };
}

describe('ModelCache', () => {
  it('returns an EMPTY container synchronously while the URL is loading', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const container = cache.get('models/chest.glb');
    expect(container).toBeInstanceOf(Group);
    expect(container.children.length).toBe(0);
    expect(loader.calls).toEqual(['models/chest.glb']);
  });

  it('attaches a clone INTO the container in place when the load resolves', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const container = cache.get('models/chest.glb');
    const { scene } = makeSource();
    loader.resolve(scene);
    expect(container.children.length).toBe(1);
    expect(container.children[0]!.name).toBe('aquascape:decor-model');
  });

  it('hides pre-existing container children (the fallback) on model arrival instead of removing them', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const container = cache.get('models/chest.glb');
    const fallback = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    container.add(fallback);
    loader.resolve(makeSource().scene);
    // Fallback stays parented (the content tree still owns + disposes it)
    // but is invisible; the model clone is the visible child.
    expect(container.children).toContain(fallback);
    expect(fallback.visible).toBe(false);
    expect(container.children.some((c) => c.name === 'aquascape:decor-model')).toBe(true);
  });

  it('loads each URL exactly ONCE across multiple consumers and attaches a clone per container', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const a = cache.get('models/chest.glb');
    const b = cache.get('models/chest.glb');
    expect(loader.calls).toEqual(['models/chest.glb']);
    loader.resolve(makeSource().scene);
    expect(a.children.length).toBe(1);
    expect(b.children.length).toBe(1);
    expect(a.children[0]).not.toBe(b.children[0]);
    expect(cache.size()).toBe(1);
  });

  it('attaches immediately (synchronously) when the URL is already loaded', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    cache.get('models/chest.glb');
    loader.resolve(makeSource().scene);
    const late = cache.get('models/chest.glb');
    expect(late.children.length).toBe(1);
    expect(loader.calls.length).toBe(1);
  });

  it('SHARES geometries across clones but CLONES materials per consumer', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const a = cache.get('models/chest.glb');
    const b = cache.get('models/chest.glb');
    const { scene, mesh } = makeSource();
    loader.resolve(scene);
    const meshA = a.children[0]!.children[0] as Mesh;
    const meshB = b.children[0]!.children[0] as Mesh;
    expect(meshA.geometry).toBe(meshB.geometry); // shared — one upload per URL
    expect(meshA.material).not.toBe(meshB.material); // per-instance clone
    expect(meshA.material).not.toBe(mesh.material); // not the source's either
  });

  it('clones every entry of an ARRAY material', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const container = cache.get('models/multi.glb');
    const m1 = new MeshStandardMaterial();
    const m2 = new MeshPhysicalMaterial();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), [m1, m2]);
    const scene = new Group();
    scene.add(mesh);
    loader.resolve(scene);
    const cloned = (container.children[0]!.children[0] as Mesh).material as MeshStandardMaterial[];
    expect(Array.isArray(cloned)).toBe(true);
    expect(cloned.length).toBe(2);
    expect(cloned[0]).not.toBe(m1);
    expect(cloned[1]).not.toBe(m2);
  });

  it('a failed load leaves every container empty PERMANENTLY — no retry on later gets', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const a = cache.get('models/missing.glb');
    loader.reject();
    expect(a.children.length).toBe(0);
    const b = cache.get('models/missing.glb');
    expect(b.children.length).toBe(0);
    expect(loader.calls.length).toBe(1); // NO retry storm
  });

  it('without a DOM the default loader is absent — every URL fails immediately (headless-safe)', () => {
    // Node test env: `typeof document === 'undefined'`, so the no-arg
    // constructor builds no GLTFLoader and never attempts a network fetch.
    const cache = new ModelCache();
    const container = cache.get('models/chest.glb');
    expect(container.children.length).toBe(0);
    const again = cache.get('models/chest.glb');
    expect(again.children.length).toBe(0);
  });

  it('fires onAttached for both the async path and the already-loaded sync path', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const asyncAttached = jest.fn();
    cache.get('models/chest.glb', { onAttached: asyncAttached });
    expect(asyncAttached).not.toHaveBeenCalled();
    loader.resolve(makeSource().scene);
    expect(asyncAttached).toHaveBeenCalledTimes(1);

    const syncAttached = jest.fn();
    cache.get('models/chest.glb', { onAttached: syncAttached });
    expect(syncAttached).toHaveBeenCalledTimes(1);
  });

  it('dispose() disposes the source geometry + source material + every per-clone material', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const container = cache.get('models/chest.glb');
    const { scene, mesh } = makeSource();
    loader.resolve(scene);

    const sourceGeoDispose = jest.spyOn(mesh.geometry, 'dispose');
    const sourceMatDispose = jest.spyOn(mesh.material as MeshPhysicalMaterial, 'dispose');
    const clonedMat = (container.children[0]!.children[0] as Mesh).material as MeshPhysicalMaterial;
    const clonedMatDispose = jest.spyOn(clonedMat, 'dispose');

    cache.dispose();
    expect(sourceGeoDispose).toHaveBeenCalled();
    expect(sourceMatDispose).toHaveBeenCalled();
    expect(clonedMatDispose).toHaveBeenCalled();
    expect(cache.size()).toBe(0);
  });

  it('a load that resolves AFTER dispose() is ignored (no attach, no resource tracking)', () => {
    const loader = makeFakeLoader();
    const cache = new ModelCache(loader.load);
    const container = cache.get('models/chest.glb');
    cache.dispose();
    loader.resolve(makeSource().scene);
    expect(container.children.length).toBe(0);
  });
});
