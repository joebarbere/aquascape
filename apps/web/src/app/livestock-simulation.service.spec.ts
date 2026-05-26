// Tests for LivestockSimulationService (Stage 11 F11.1 Wave 4).
//
// Covers:
//   - Lazy world creation (no world before first scene with livestock).
//   - Deterministic re-spawn: same (seed, livestock) → identical positions.
//   - World persists across the renderer-swap path (we simulate that by
//     dispatching a scene update without changing the livestock).
//   - `dispose()` releases the world idempotently.

import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import type { Catalog, CatalogEntry, CatalogKind } from '@aquascape/domain/catalog';
import type { LivestockEntry, Scene } from '@aquascape/domain/scene-model';
import { asObjectId } from '@aquascape/domain/scene-model';
import { defaultScene, selectScene } from '@aquascape/state';

import { LivestockSimulationService } from './livestock-simulation.service';

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

/** Minimal livestock catalog entry that satisfies the type without the
 *  full schema (tests don't go through AJV). */
function livestockEntry(id: string, opts: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    catalog: 'core',
    id,
    version: 1,
    name: id,
    kind: 'livestock',
    group: 'fish',
    adultSize: 35,
    temperament: 'peaceful',
    temperatureRange: { minC: 22, maxC: 27 },
    pHRange: { min: 6, max: 7.5 },
    schoolingMin: 6,
    bioloadClass: 'low',
    color: '#3aa6ff',
    ...opts,
  } as CatalogEntry;
}

function sceneWithLivestock(livestock: LivestockEntry[], seed = 42): Scene {
  return {
    ...defaultScene(),
    seed,
    livestock,
  };
}

function entry(id: string, refId: string, quantity: number): LivestockEntry {
  return {
    id: asObjectId(id),
    ref: { catalog: 'core', id: refId, version: 1 },
    quantity,
  };
}

function setup(initialScene: Scene = defaultScene()): {
  service: LivestockSimulationService;
  store: MockStore;
} {
  TestBed.configureTestingModule({
    providers: [
      provideMockStore({
        initialState: {},
        selectors: [{ selector: selectScene, value: initialScene }],
      }),
    ],
  });
  const service = TestBed.inject(LivestockSimulationService);
  service.setCatalog(
    makeCatalog([
      livestockEntry('livestock.fish.neon-tetra', { name: 'Neon tetra', adultSize: 35 }),
      livestockEntry('livestock.fish.cory', { name: 'Cory', adultSize: 50, tags: ['cory'] }),
    ]),
  );
  const store = TestBed.inject(MockStore);
  return { service, store };
}

describe('LivestockSimulationService — lifecycle', () => {
  it('does NOT build a world when the scene has no livestock', () => {
    const { service } = setup();
    expect(service.getWorld()).toBeNull();
  });

  it('builds a world lazily when the scene grows livestock', () => {
    const { service, store } = setup();
    expect(service.getWorld()).toBeNull();
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 4)];
    store.overrideSelector(selectScene, sceneWithLivestock(livestock));
    store.refreshState();
    const world = service.getWorld();
    expect(world).not.toBeNull();
    expect(world!.snapshot(0).entityCount).toBe(4);
  });

  it('does NOT rebuild the world on an unrelated scene change', () => {
    const { service, store } = setup();
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 3)];
    store.overrideSelector(selectScene, sceneWithLivestock(livestock));
    store.refreshState();
    const worldA = service.getWorld();
    // Re-emit the same scene shape (different object identity).
    store.overrideSelector(selectScene, { ...sceneWithLivestock(livestock) });
    store.refreshState();
    const worldB = service.getWorld();
    expect(worldB).toBe(worldA);
  });

  it('disposes the world when livestock is removed entirely', () => {
    const { service, store } = setup();
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 2)];
    store.overrideSelector(selectScene, sceneWithLivestock(livestock));
    store.refreshState();
    expect(service.getWorld()).not.toBeNull();
    store.overrideSelector(selectScene, sceneWithLivestock([]));
    store.refreshState();
    expect(service.getWorld()).toBeNull();
  });

  it('rebuilds the world from scratch when the document seed changes', () => {
    const { service, store } = setup();
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 3)];
    store.overrideSelector(selectScene, sceneWithLivestock(livestock, 1));
    store.refreshState();
    const worldA = service.getWorld();
    expect(worldA!.seed).toBe(1);
    store.overrideSelector(selectScene, sceneWithLivestock(livestock, 999));
    store.refreshState();
    const worldB = service.getWorld();
    expect(worldB!.seed).toBe(999);
    // Same livestock + new seed → distinct world (re-created).
    expect(worldB).not.toBe(worldA);
  });

  it('re-spawns deterministically on an entry-quantity change', () => {
    const { service, store } = setup();
    store.overrideSelector(selectScene, sceneWithLivestock([entry('e1', 'livestock.fish.neon-tetra', 2)]));
    store.refreshState();
    const worldA = service.getWorld()!;
    expect(worldA.snapshot(0).entityCount).toBe(2);
    // Bump to 5.
    store.overrideSelector(selectScene, sceneWithLivestock([entry('e1', 'livestock.fish.neon-tetra', 5)]));
    store.refreshState();
    expect(service.getWorld()!.snapshot(0).entityCount).toBe(5);
  });

  it('dispose() is idempotent', () => {
    const { service, store } = setup();
    store.overrideSelector(selectScene, sceneWithLivestock([entry('e1', 'livestock.fish.neon-tetra', 1)]));
    store.refreshState();
    expect(service.getWorld()).not.toBeNull();
    service.dispose();
    expect(service.getWorld()).toBeNull();
    expect(() => service.dispose()).not.toThrow();
  });
});

describe('LivestockSimulationService — determinism', () => {
  it('same (seed, livestock) reproduces identical entity positions across two service builds', () => {
    // Build a service, snapshot its world, tear down the TestBed, then
    // build a second service from the same input and compare the
    // position arrays — the F11.1 spawn contract requires bit-identical
    // results across two independent build cycles.
    const livestock = [
      entry('e1', 'livestock.fish.neon-tetra', 6),
      entry('e2', 'livestock.fish.cory', 4),
    ];
    const scene = sceneWithLivestock(livestock, 12345);

    const a = setup(scene).service;
    const posA = Array.from(a.getWorld()!.snapshot(0).position);
    const qA = Array.from(a.getWorld()!.snapshot(0).orientation);

    // Reset TestBed so the second `configureTestingModule` doesn't
    // collide with the first instantiation. `resetTestingModule` is
    // the supported handle for spinning up a fresh injector inside one
    // spec.
    TestBed.resetTestingModule();
    const b = setup(scene).service;
    const posB = Array.from(b.getWorld()!.snapshot(0).position);
    const qB = Array.from(b.getWorld()!.snapshot(0).orientation);

    expect(posA).toEqual(posB);
    expect(qA).toEqual(qB);
  });

  it('spawns fall inside the tank interior (no negative coords, no overshoot)', () => {
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 20)];
    const { service } = setup(sceneWithLivestock(livestock, 7));
    const snap = service.getWorld()!.snapshot(0);
    const scene = defaultScene();
    for (let i = 0; i < snap.entityCount; i++) {
      const x = snap.position[i * 3 + 0]!;
      const y = snap.position[i * 3 + 1]!;
      const z = snap.position[i * 3 + 2]!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(scene.tank.width);
      expect(y).toBeLessThanOrEqual(scene.tank.height);
      expect(z).toBeLessThanOrEqual(scene.tank.depth);
    }
  });

  it('falls back to a default archetype + body length when the catalog ref is unknown', () => {
    // Don't register the entry in the catalog — service should still
    // spawn rather than throw.
    const livestock = [entry('e-missing', 'livestock.fish.unknown-species', 3)];
    const { service } = setup();
    TestBed.inject(MockStore).overrideSelector(selectScene, sceneWithLivestock(livestock));
    TestBed.inject(MockStore).refreshState();
    const snap = service.getWorld()!.snapshot(0);
    expect(snap.entityCount).toBe(3);
    // Default body length is the fallback constant (35 mm).
    for (let i = 0; i < snap.entityCount; i++) {
      expect(snap.scale[i]).toBe(35);
    }
  });

  // ─── End-to-end determinism through the service (F11.1 contract) ─────
  //
  // The existing `libs/domain/livestock-ecs/.../determinism.spec.ts` proves
  // the ECS world is byte-identical for fixed SpawnOpts + N ticks. The
  // contract the F11.1 plan actually ships is the *scene-level* one:
  // identical `(Scene, scene.seed, livestock)` through the service should
  // produce identical entity sets AND identical post-N-tick snapshots.
  // This guards the spawn path (positions / orientations / phase / scale)
  // that the ECS-level test doesn't exercise.

  /** Byte-compare two typed-array views. Returns false on length mismatch. */
  function byteEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
    if (a.byteLength !== b.byteLength) return false;
    const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
    return true;
  }

  /** Drive a service end-to-end: seed the store, step N ticks, copy snap. */
  function runService(scene: Scene, ticks: number) {
    const { service } = setup(scene);
    const world = service.getWorld()!;
    // Drive `step()` directly — the test owns the tick cadence; we don't
    // need real RAF wall-time. SIM_DT matches the renderer's RAF loop
    // (`libs/domain/livestock-ecs/world.ts` → `SIM_DT = 1/30`).
    const SIM_DT = 1 / 30;
    for (let i = 0; i < ticks; i++) world.step(SIM_DT);
    const snap = world.snapshot(0);
    // Copy out — the snapshot's typed arrays are views into a pool the
    // next service build would clobber.
    return {
      entityCount: snap.entityCount,
      position: new Float32Array(snap.position),
      orientation: new Float32Array(snap.orientation),
      phase: new Float32Array(snap.phase),
      archetype: new Uint8Array(snap.archetype),
      scale: new Float32Array(snap.scale),
    };
  }

  it('two cold-start service builds with same (scene, scene.seed) spawn identical initial positions', () => {
    const livestock = [
      entry('e1', 'livestock.fish.neon-tetra', 8),
      entry('e2', 'livestock.fish.cory', 5),
    ];
    const scene = sceneWithLivestock(livestock, 0xc0ffee);

    const a = runService(scene, 0);
    TestBed.resetTestingModule();
    const b = runService(scene, 0);

    expect(a.entityCount).toBe(b.entityCount);
    expect(byteEqual(a.position, b.position)).toBe(true);
    expect(byteEqual(a.orientation, b.orientation)).toBe(true);
    expect(byteEqual(a.scale, b.scale)).toBe(true);
    expect(byteEqual(a.archetype, b.archetype)).toBe(true);
  });

  it('1000-tick replay: same (scene, scene.seed) → bit-identical WorldSnapshot fields', () => {
    // N = 1000 matches the F11.1 plan's "1000-tick replay" determinism
    // contract. Two service instantiations, two parallel worlds, same
    // tick count — the byte-comparable fields of the snapshot must match.
    const livestock = [
      entry('e1', 'livestock.fish.neon-tetra', 6),
      entry('e2', 'livestock.fish.cory', 4),
    ];
    const scene = sceneWithLivestock(livestock, 12345);

    const a = runService(scene, 1000);
    TestBed.resetTestingModule();
    const b = runService(scene, 1000);

    expect(a.entityCount).toBe(b.entityCount);
    expect(byteEqual(a.position, b.position)).toBe(true);
    expect(byteEqual(a.orientation, b.orientation)).toBe(true);
    expect(byteEqual(a.phase, b.phase)).toBe(true);
    expect(byteEqual(a.archetype, b.archetype)).toBe(true);
    expect(byteEqual(a.scale, b.scale)).toBe(true);
  });

  it('different scene.seed values yield different initial positions through the service', () => {
    // Sanity-pin the *other* direction of determinism: the seed actually
    // moves the spawn distribution. If two seeds gave identical positions
    // the test above would be vacuous.
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 12)];

    const a = runService(sceneWithLivestock(livestock, 1), 0);
    TestBed.resetTestingModule();
    const b = runService(sceneWithLivestock(livestock, 2), 0);

    expect(a.entityCount).toBe(b.entityCount);
    expect(byteEqual(a.position, b.position)).toBe(false);
  });
});
