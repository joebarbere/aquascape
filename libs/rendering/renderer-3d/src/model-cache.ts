/**
 * Decor GLB model cache — the 3D half of the decor (classic ornament)
 * feature.
 *
 * One cache per `Three3DRenderer` LIFETIME (not per content rebuild) —
 * same philosophy as `texture-cache.ts`: the renderer rebuilds its content
 * group on every `render()` call, but the GLB bytes are immutable assets;
 * re-fetching + re-parsing them per rebuild would thrash both the network
 * and the GPU. The renderer disposes the cache exactly once, in `dispose()`.
 *
 * THE CONTAINER → ATTACH-IN-PLACE TRICK
 * -------------------------------------
 * `get(url)` returns a `THREE.Group` container SYNCHRONOUSLY. The builder
 * parks its extruded-silhouette fallback inside the container; when the
 * GLB resolves (async, via GLTFLoader), the loaded scene is cloned and
 * attached INTO the container in place — the next RAF frame simply shows
 * the model (no content rebuild, no flash). The previous children (the
 * fallback) are hidden, not removed, so they remain owned by the content
 * tree and are disposed by the renderer's normal `disposeNode` rebuild
 * walk.
 *
 * FAILURE POLICY — NO RETRY STORM
 * -------------------------------
 * A failed / 404'd load marks the URL `'failed'` permanently for the
 * cache's lifetime: the fallback stays in place and NO further network
 * attempt is made for that URL (every subsequent `get` returns an empty
 * container the builder fills with the fallback). Environments without a
 * DOM (jsdom-less unit tests) get no default loader at all, so every URL
 * is immediately `'failed'` — headless-test-safe by construction.
 *
 * SHARING + CLONING
 * -----------------
 * Multiple objects referencing the same URL trigger ONE load. Each
 * consumer container receives its own `.clone()` of the loaded scene —
 * geometries are SHARED across clones (one GPU upload per URL), but
 * MATERIALS are CLONED per instance so per-instance shader patches
 * (caustics) and dispose stay sound.
 *
 * DISPOSE DISCIPLINE
 * ------------------
 * The cache owns and disposes (a) every geometry + material of the loaded
 * SOURCE scenes (which never enter the renderer's content tree) and (b)
 * every per-clone material it created. Cloned MESHES live in the content
 * tree, so `disposeNode` also disposes their (shared) geometries +
 * (cloned) materials on every rebuild — that double-dispose is harmless
 * (Three.js `.dispose()` is idempotent; a disposed-but-referenced
 * geometry is transparently re-uploaded on next paint), and it means the
 * cache's own `dispose()` is the backstop that guarantees nothing
 * outlives the renderer.
 */

import { Group, Mesh, type BufferGeometry, type Material, type Object3D } from 'three';
// Note: `three/examples/jsm/loaders/GLTFLoader` (no `.js` extension) is the
// form that resolves under the workspace's classic `node` module resolution
// — same addon-wiring story as OrbitControls / the postprocessing passes.
// Jest redirects this import to a CJS stub via `moduleNameMapper`; see
// `src/__mocks__/gltf-loader-stub.ts`. The app's esbuild bundle resolves it
// via the tsconfig path-map + ambient shim in `apps/web`.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

/**
 * Injectable GLB-load function. The default (browser) implementation wraps
 * `GLTFLoader`; tests inject a synchronous fake to exercise the
 * container → attach-in-place upgrade without a DOM or network.
 */
export type ModelLoadFn = (
  url: string,
  onLoad: (gltf: { scene: Object3D }) => void,
  onError: () => void,
) => void;

/** Per-`get` options. */
export interface ModelCacheGetOptions {
  /**
   * Invoked whenever a model clone is attached to THIS container — either
   * synchronously during `get` (URL already loaded) or later when the
   * async load resolves. The builder uses it to apply renderer policy to
   * the freshly-attached subtree (shadow flags, caustic patches).
   */
  onAttached?: (model: Object3D) => void;
}

interface PendingConsumer {
  container: Group;
  onAttached: ((model: Object3D) => void) | undefined;
}

interface ModelEntry {
  status: 'loading' | 'loaded' | 'failed';
  /** The loaded GLB scene — kept OFF the content tree; clones go on it. */
  source: Object3D | null;
  /** Containers waiting for the load to resolve. Drained on load/fail. */
  pending: PendingConsumer[];
}

/** Default loader: `GLTFLoader` when a DOM exists, else null (test envs). */
function defaultModelLoader(): ModelLoadFn | null {
  if (typeof document === 'undefined') return null;
  const loader = new GLTFLoader();
  return (url, onLoad, onError) => {
    loader.load(url, onLoad, undefined, onError);
  };
}

/**
 * URL-keyed cache of decor GLB models. See the header for the container /
 * clone / dispose contracts.
 */
export class ModelCache {
  private readonly entries = new Map<string, ModelEntry>();
  private readonly loadModel: ModelLoadFn | null;
  /** Geometries the cache must dispose: the loaded sources' (shared by clones). */
  private readonly ownedGeometries = new Set<BufferGeometry>();
  /** Materials the cache must dispose: sources' + every per-clone clone. */
  private readonly ownedMaterials = new Set<Material>();
  /** Set by `dispose()` — a late async load resolution becomes a no-op. */
  private disposed = false;

  /**
   * @param loadModel injectable GLB loader — tests pass a fake; production
   * omits it and gets the `GLTFLoader`-backed default (null in jsdom-less
   * envs, where every URL immediately fails → permanent fallback).
   */
  constructor(loadModel?: ModelLoadFn) {
    this.loadModel = loadModel ?? defaultModelLoader();
  }

  /**
   * Return a fresh container `Group` for `url`. Synchronous. The container
   * is EMPTY unless the URL has already loaded (in which case a clone is
   * attached before returning). While the URL is loading, the container is
   * registered and upgraded in place when the GLB arrives; on failure it
   * stays empty forever (the builder's fallback shows permanently).
   */
  get(url: string, opts: ModelCacheGetOptions = {}): Group {
    const container = new Group();
    container.name = 'aquascape:decor-model-container';

    let entry = this.entries.get(url);
    if (entry === undefined) {
      const fresh: ModelEntry = {
        status: this.loadModel === null ? 'failed' : 'loading',
        source: null,
        pending: [],
      };
      this.entries.set(url, fresh);
      entry = fresh;
      if (this.loadModel !== null) {
        // ONE load per URL, ever. Note a synchronous fake loader may
        // resolve before this call returns — `onLoaded` flips the status
        // to 'loaded' and the branch below attaches immediately.
        this.loadModel(
          url,
          (gltf) => this.onLoaded(fresh, gltf.scene),
          () => {
            fresh.status = 'failed';
            fresh.pending = [];
          },
        );
      }
    }

    if (entry.status === 'loaded' && entry.source !== null) {
      this.attachClone(entry.source, container, opts.onAttached);
    } else if (entry.status === 'loading') {
      entry.pending.push({ container, onAttached: opts.onAttached });
    }
    // 'failed' → return the empty container; the builder's fallback stays.
    return container;
  }

  /** Number of distinct URLs currently tracked. Exposed for tests. */
  size(): number {
    return this.entries.size;
  }

  /**
   * Dispose every geometry + material the cache created (loaded sources +
   * per-clone material clones) and drop all entries. Late async loads that
   * resolve after this point are ignored.
   */
  dispose(): void {
    this.disposed = true;
    for (const geometry of this.ownedGeometries) geometry.dispose();
    this.ownedGeometries.clear();
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedMaterials.clear();
    this.entries.clear();
  }

  /** Async load resolution: register resources, drain pending consumers. */
  private onLoaded(entry: ModelEntry, source: Object3D): void {
    if (this.disposed || entry.status === 'failed') return;
    entry.status = 'loaded';
    entry.source = source;
    // Register the source's GPU resources for cache-owned disposal. The
    // source never enters the content tree, so `disposeNode` never sees it.
    source.traverse((node) => {
      if ((node as Mesh).isMesh) {
        const mesh = node as Mesh;
        const geometry = mesh.geometry as BufferGeometry | undefined;
        if (geometry !== undefined) this.ownedGeometries.add(geometry);
        for (const material of asMaterialArray(mesh.material)) {
          this.ownedMaterials.add(material);
        }
      }
    });
    const pending = entry.pending;
    entry.pending = [];
    for (const consumer of pending) {
      this.attachClone(source, consumer.container, consumer.onAttached);
    }
  }

  /**
   * Clone the loaded source into `container`: geometries SHARED, materials
   * CLONED per instance. Pre-existing children (the builder's fallback)
   * are hidden — not removed — so they stay owned by the content tree and
   * are disposed by the renderer's normal rebuild walk.
   */
  private attachClone(
    source: Object3D,
    container: Group,
    onAttached: ((model: Object3D) => void) | undefined,
  ): void {
    const clone = source.clone(true);
    clone.name = 'aquascape:decor-model';
    clone.traverse((node) => {
      if ((node as Mesh).isMesh) {
        const mesh = node as Mesh;
        const material = mesh.material;
        if (Array.isArray(material)) {
          mesh.material = material.map((m) => this.cloneMaterial(m));
        } else if (material !== undefined) {
          mesh.material = this.cloneMaterial(material as Material);
        }
      }
    });
    for (const child of container.children) child.visible = false;
    container.add(clone);
    onAttached?.(clone);
  }

  private cloneMaterial(material: Material): Material {
    const cloned = material.clone();
    this.ownedMaterials.add(cloned);
    return cloned;
  }
}

function asMaterialArray(material: Material | Material[] | undefined): Material[] {
  if (material === undefined) return [];
  return Array.isArray(material) ? material : [material];
}
