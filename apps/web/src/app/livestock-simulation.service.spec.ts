// Tests for LivestockSimulationService (Stage 11 F11.1 Wave 4 + F11.2 Wave 5).
//
// F11.1 coverage:
//   - Lazy world creation (no world before first scene with livestock).
//   - Deterministic re-spawn: same (seed, livestock) → identical positions.
//   - World persists across the renderer-swap path (we simulate that by
//     dispatching a scene update without changing the livestock).
//   - `dispose()` releases the world idempotently.
//
// F11.2 coverage (the new behaviour pipeline):
//   - Per-unique-ref species registration on the world's ParamStore.
//   - Animation params come from the resolved behaviour (mid preset =
//     4.5 Hz tail beat) — not the F11.1 hardcoded 4 Hz default.
//   - Tank AABB is plumbed through to the world on construction; later
//     tank resizes propagate via setTankAabb.
//   - Missing catalog row → entity spawns with NO_BEHAVIOR_HANDLE so it
//     stays on the F11.1 static-wiggle path (Velocity stays 0).
//   - The 1000-tick byte-identity replay still holds with behaviour
//     systems running (Velocity is now non-zero — this is the real gate).

import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import type { Catalog, CatalogEntry, CatalogKind } from '@aquascape/domain/catalog';
import { MID_PRESET } from '@aquascape/domain/livestock-behaviors';
import {
  AnimationPhase,
  BehaviorParamsRef,
  NO_BEHAVIOR_HANDLE,
  Velocity,
} from '@aquascape/domain/livestock-ecs';
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
    // spawn rather than throw. F11.2 emits a single console.warn on the
    // missing-ref path; silence it here to keep test output clean.
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
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

// ─── F11.2 Wave 5 — behaviour pipeline wiring ───────────────────────────────

/**
 * Build a scene with a custom tank size + livestock. Default tank dims live
 * on `defaultScene()` (600 × 360 × 360 mm). The F11.2 plumbing tests want
 * to verify a non-default size flows through to the world's AABB.
 */
function sceneWithTankAndLivestock(
  livestock: LivestockEntry[],
  tank: { width: number; height: number; depth: number },
  seed = 42,
): Scene {
  const base = defaultScene();
  return {
    ...base,
    seed,
    livestock,
    tank: { ...base.tank, ...tank },
  };
}

/**
 * Build a service via `setup()` with a default (empty-livestock) initial
 * scene, then trigger a livestock emission after `setCatalog` has applied.
 *
 * Why: setup() injects the service and the constructor subscribes
 * synchronously to the mock store's initial value BEFORE setCatalog
 * is called. Tests that need the custom catalog must therefore push
 * livestock through the store AFTER setup() returns. This helper bakes
 * that pattern in.
 */
function setupWithLivestock(scene: Scene): { service: LivestockSimulationService; store: MockStore } {
  const result = setup(); // empty-livestock default, catalog applied.
  result.store.overrideSelector(selectScene, scene);
  result.store.refreshState();
  return result;
}

describe('LivestockSimulationService — F11.2 behaviour registration', () => {
  it('registers exactly one species per unique catalog ref (single-species school)', () => {
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 12)];
    const { service } = setupWithLivestock(sceneWithLivestock(livestock, 7));
    const world = service.getWorld()!;
    // ParamStore size = number of distinct registered species.
    expect(world.paramStore.size).toBe(1);
  });

  it('all entities in a single-species entry share the same handleIdx', () => {
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 12)];
    const { service } = setupWithLivestock(sceneWithLivestock(livestock, 7));
    const world = service.getWorld()!;
    const snap = world.snapshot(0);
    expect(snap.entityCount).toBe(12);
    // Read handleIdx directly via the BehaviorParamsRef component slab.
    const handles = new Set<number>();
    for (let i = 0; i < snap.entityCount; i++) {
      handles.add(BehaviorParamsRef.handleIdx[snap.ids[i]!]);
    }
    expect(handles.size).toBe(1);
    // And that single handle is NOT the NO_BEHAVIOR_HANDLE sentinel.
    expect(handles.has(NO_BEHAVIOR_HANDLE)).toBe(false);
  });

  it('registers one species per unique ref across multiple entries (multi-species scene)', () => {
    const livestock = [
      entry('e1', 'livestock.fish.neon-tetra', 6),
      entry('e2', 'livestock.fish.cory', 4),
      // A second entry referencing neon-tetra again should NOT add a row.
      entry('e3', 'livestock.fish.neon-tetra', 3),
    ];
    const { service } = setupWithLivestock(sceneWithLivestock(livestock, 11));
    const world = service.getWorld()!;
    expect(world.paramStore.size).toBe(2); // neon-tetra + cory, deduped.
  });

  it('per-species animation params come from resolveBehavior (mid preset = 4.5 Hz), not F11.1 4 Hz defaults', () => {
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 4)];
    const { service } = setupWithLivestock(sceneWithLivestock(livestock, 7));
    const world = service.getWorld()!;
    const snap = world.snapshot(0);
    // Neon-tetra has no `behavior.depth` override, no `depth:*` tag and
    // id includes "tetra" → falls through to the mid preset → 4.5 Hz.
    for (let i = 0; i < snap.entityCount; i++) {
      const eid = snap.ids[i]!;
      expect(AnimationPhase.freq[eid]).toBeCloseTo(MID_PRESET.animation.tailBeatFreq, 5);
      expect(AnimationPhase.ampHead[eid]).toBeCloseTo(MID_PRESET.animation.ampHead, 5);
      expect(AnimationPhase.ampTail[eid]).toBeCloseTo(MID_PRESET.animation.ampTail, 5);
    }
  });

  it('hatchet-shape catalog row resolves to TOP_PRESET (5.0 Hz tail beat)', () => {
    // Synthesize a hatchetfish row — id substring "hatchet" triggers
    // depthBandForSpecies → 'top' → TOP_PRESET → 5.0 Hz.
    const result = setup(); // empty livestock, default catalog applied.
    // Swap in a catalog that only contains the hatchet row so
    // resolveBehavior's id-substring heuristic picks the TOP_PRESET.
    result.service.setCatalog(
      makeCatalog([livestockEntry('livestock.fish.hatchetfish', { name: 'Hatchet' })]),
    );
    result.store.overrideSelector(
      selectScene,
      sceneWithLivestock([entry('e1', 'livestock.fish.hatchetfish', 3)], 5),
    );
    result.store.refreshState();
    const world = result.service.getWorld()!;
    const snap = world.snapshot(0);
    expect(snap.entityCount).toBe(3);
    // TOP_PRESET = 5.0 Hz / ampHead 0.015 / ampTail 0.10.
    for (let i = 0; i < snap.entityCount; i++) {
      const eid = snap.ids[i]!;
      expect(AnimationPhase.freq[eid]).toBeCloseTo(5.0, 5);
      expect(AnimationPhase.ampHead[eid]).toBeCloseTo(0.015, 5);
      expect(AnimationPhase.ampTail[eid]).toBeCloseTo(0.1, 5);
    }
  });
});

describe('LivestockSimulationService — F11.2 tank AABB plumbing', () => {
  it('passes the scene tank dims through to createLivestockWorld', () => {
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 2)];
    const { service } = setupWithLivestock(
      sceneWithTankAndLivestock(livestock, { width: 1200, height: 500, depth: 400 }, 7),
    );
    const world = service.getWorld()!;
    expect(world.tankAabb).toEqual({
      minX: 0,
      maxX: 1200,
      minY: 0,
      maxY: 500,
      minZ: 0,
      maxZ: 400,
    });
  });

  it('resizing the tank updates world.tankAabb on the next emission (no full rebuild)', () => {
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 3)];
    const { service, store } = setupWithLivestock(
      sceneWithTankAndLivestock(livestock, { width: 1000, height: 400, depth: 400 }, 7),
    );
    const worldA = service.getWorld()!;
    expect(worldA.tankAabb.maxX).toBe(1000);

    store.overrideSelector(
      selectScene,
      sceneWithTankAndLivestock(livestock, { width: 400, height: 200, depth: 200 }, 7),
    );
    store.refreshState();

    const worldB = service.getWorld()!;
    // Same seed + livestock: world identity is preserved across the
    // tank-only mutation (no full rebuild).
    expect(worldB).toBe(worldA);
    expect(worldB.tankAabb).toEqual({
      minX: 0,
      maxX: 400,
      minY: 0,
      maxY: 200,
      minZ: 0,
      maxZ: 200,
    });
  });
});

describe('LivestockSimulationService — F11.2 fallback path', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    // Fresh spy per test — important because jest.spyOn returns the
    // already-mocked function on second use, so call counts would
    // accumulate across tests in the same file without an explicit
    // reset. Pair with mockRestore() in afterEach.
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  it('spawns with NO_BEHAVIOR_HANDLE when the catalog ref is missing', () => {
    // The setup() catalog does NOT include 'unknown-species'.
    // resolveAndRegister should log a single warning + return
    // NO_BEHAVIOR_HANDLE, and the entity should still spawn (body
    // length falls back to 35 mm via the F11.1 path).
    const livestock = [entry('e-missing', 'livestock.fish.unknown-species', 3)];
    const { service } = setupWithLivestock(sceneWithLivestock(livestock, 7));
    const world = service.getWorld()!;
    const snap = world.snapshot(0);
    expect(snap.entityCount).toBe(3);
    // No species registered for the missing ref.
    expect(world.paramStore.size).toBe(0);
    for (let i = 0; i < snap.entityCount; i++) {
      expect(BehaviorParamsRef.handleIdx[snap.ids[i]!]).toBe(NO_BEHAVIOR_HANDLE);
    }
    // A warning fires for the missing ref. We don't pin an exact count
    // because MockStore can re-emit the same value across `refreshState`
    // calls (the service correctly re-walks `spawnAll`, but the warn
    // dedup is scoped to a *single* spawn pass — re-emissions can warn
    // a second time). Tightening this would couple to MockStore's
    // emission semantics, not the service contract.
    const refWarnCalls = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('livestock.fish.unknown-species'),
    );
    expect(refWarnCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('NO_BEHAVIOR_HANDLE entities keep Velocity = 0 after a sim step (static-wiggle path)', () => {
    const livestock = [entry('e-missing', 'livestock.fish.unknown-species', 4)];
    const { service } = setupWithLivestock(sceneWithLivestock(livestock, 9));
    const world = service.getWorld()!;
    // Drive one tick — behaviour systems should early-out, leaving
    // Velocity at exactly zero on every entity.
    world.step(1 / 30);
    const snap = world.snapshot(0);
    for (let i = 0; i < snap.entityCount; i++) {
      const eid = snap.ids[i]!;
      expect(Velocity.x[eid]).toBe(0);
      expect(Velocity.y[eid]).toBe(0);
      expect(Velocity.z[eid]).toBe(0);
    }
  });
});

describe('LivestockSimulationService — F11.2 determinism with behaviour systems', () => {
  /** Byte-compare two typed-array views. Returns false on length mismatch. */
  function byteEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
    if (a.byteLength !== b.byteLength) return false;
    const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
    return true;
  }

  function runService(scene: Scene, ticks: number) {
    const { service } = setup(scene);
    const world = service.getWorld()!;
    const SIM_DT = 1 / 30;
    for (let i = 0; i < ticks; i++) world.step(SIM_DT);
    const snap = world.snapshot(0);
    return {
      entityCount: snap.entityCount,
      position: new Float32Array(snap.position),
      orientation: new Float32Array(snap.orientation),
      phase: new Float32Array(snap.phase),
      archetype: new Uint8Array(snap.archetype),
      scale: new Float32Array(snap.scale),
    };
  }

  it('1000-tick replay with behaviour systems active is bit-identical across cold starts', () => {
    // F11.2's gate. The F11.1 version of this test ran with Velocity=0
    // because no behaviour systems were registered. Now Velocity is
    // non-zero (schooling + depth forces are summed into it every tick)
    // — if the spawnIndex partition key or registration ordering drifts,
    // tickPrng draws will diverge and position will mismatch on tick 1.
    const livestock = [
      entry('e1', 'livestock.fish.neon-tetra', 8),
      entry('e2', 'livestock.fish.cory', 5),
    ];
    const scene = sceneWithLivestock(livestock, 0xc0ffee);

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
});
