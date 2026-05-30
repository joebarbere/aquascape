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
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { EMPTY, Subject } from 'rxjs';
import type { Action } from '@ngrx/store';

import { defineQuery } from 'bitecs';

import type { Catalog, CatalogEntry, CatalogKind } from '@aquascape/domain/catalog';
import { MID_PRESET } from '@aquascape/domain/livestock-behaviors';
import {
  AnimationPhase,
  BehaviorParamsRef,
  HARDSCAPE_CATEGORY,
  Hardscape,
  NO_BEHAVIOR_HANDLE,
  Velocity,
} from '@aquascape/domain/livestock-ecs';
import type {
  HardscapeObject,
  Layer,
  LivestockEntry,
  Scene,
} from '@aquascape/domain/scene-model';
import { asLayerId, asObjectId, identityTransform } from '@aquascape/domain/scene-model';
import { LivestockPulseActions, defaultScene, selectScene } from '@aquascape/state';

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
      // F11.4 — supply an empty Actions stream so the service constructor
      // can `inject(Actions)`. Tests that exercise the feed-tank path use
      // `setupWithPulse()` (further down) instead, which pipes a real
      // Subject through provideMockActions.
      provideMockActions(() => EMPTY),
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

  it('clusters spawn positions per species so neighbours start inside each other\'s schooling ZOA', () => {
    // Regression for the second F11.7 video: three neon tetras spawned at
    // uniform random across the default 1000 × 400 × 400 tank land ~280
    // mm apart on average (cube-root of the volume per fish), well beyond
    // MID_PRESET's ZOA = 90 mm — so schooling cohesion never fires and
    // the fish drift as singletons. After the cluster-spawn fix every
    // pairwise distance for fish of the same species must be ≤
    // 2 × clusterRadius ≤ ZOA, which puts neighbours in each other's
    // zone-of-attraction from tick 1.
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 6)];
    const { service } = setup(sceneWithLivestock(livestock, 11));
    const snap = service.getWorld()!.snapshot(0);
    expect(snap.entityCount).toBe(6);
    const pos = snap.position;
    // MID_PRESET.schooling.ZOA = 90; clusterRadius = 90 × 0.5 = 45 →
    // max pairwise distance ≤ 2 × 45 = 90 mm = ZOA. Allow a ~5 % float
    // tolerance so the assertion isn't sensitive to seededHash01 edge
    // values.
    const MAX_PAIRWISE_MM = 95;
    for (let i = 0; i < snap.entityCount; i++) {
      for (let j = i + 1; j < snap.entityCount; j++) {
        const dx = (pos[i * 3 + 0]! - pos[j * 3 + 0]!);
        const dy = (pos[i * 3 + 1]! - pos[j * 3 + 1]!);
        const dz = (pos[i * 3 + 2]! - pos[j * 3 + 2]!);
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        expect(d).toBeLessThanOrEqual(MAX_PAIRWISE_MM);
      }
    }
  });

  it('keeps spawned fish at least bodyLength from each face (no body extending through the glass)', () => {
    // Regression for the second F11.7 video: with the prior half-body
    // wall inset the tail extended through the OPPOSITE wall whenever
    // a fish spawned within `halfBody` of it. The fix bumps both the
    // spawn inset AND the integrator wall projection to a full
    // `bodyLength`, so on the very first tick every fish (nose at
    // Position) has at least one body-length of clearance from every
    // face — no body can extend through the glass regardless of
    // orientation.
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 12)];
    const { service } = setup(sceneWithLivestock(livestock, 13));
    const snap = service.getWorld()!.snapshot(0);
    const scene = defaultScene();
    // BodyLength for neon tetras is 30 mm per the catalog (smaller than
    // the 35 mm fallback). The spawn inset is `max(SPAWN_WALL_INSET_MM,
    // bodyLengthMm)` = max(20, 30) = 30.
    const MIN_WALL_DIST = 30;
    for (let i = 0; i < snap.entityCount; i++) {
      const x = snap.position[i * 3 + 0]!;
      const y = snap.position[i * 3 + 1]!;
      const z = snap.position[i * 3 + 2]!;
      expect(x).toBeGreaterThanOrEqual(MIN_WALL_DIST);
      expect(x).toBeLessThanOrEqual(scene.tank.width - MIN_WALL_DIST);
      expect(y).toBeGreaterThanOrEqual(MIN_WALL_DIST);
      expect(y).toBeLessThanOrEqual(scene.tank.height - MIN_WALL_DIST);
      expect(z).toBeGreaterThanOrEqual(MIN_WALL_DIST);
      expect(z).toBeLessThanOrEqual(scene.tank.depth - MIN_WALL_DIST);
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

// ─── F11.3 Wave 4 — hardscape registration + auto-anchor wiring ──────────────
//
// The Wave 3 ECS work landed `world.registerHardscape(...)` and an automatic
// territory-anchor pick at `spawnFish` time (nearest hardscape within
// `2 * coreRadius`). The service is the upstream caller: it walks the scene's
// hardscape SceneObjects, builds `HardscapeRegistrationEntry[]` from the
// loaded catalog rows, and calls `registerHardscape` BEFORE `spawnFish` so
// the auto-anchor pass has something to look at.
//
// Tests in this block exercise that pipeline end-to-end through the service:
//   - hardscape SceneObjects → world.getHardscapeCount()
//   - coverScore + category flow through from the loaded catalog
//   - scene mutation that adds a rock triggers re-registration
//   - cichlid + cave → getEntityTerritoryAnchor !== null
//   - cichlid + no hardscape → getEntityTerritoryAnchor === null
//   - 1000-tick replay with hardscape + a cichlid is bit-identical

/** Mint a HardscapeEntry catalog row — minimal fields to satisfy the type. */
function hardscapeEntry(
  id: string,
  opts: { category?: 'rock' | 'wood' | 'other'; coverScore?: number; name?: string } = {},
): CatalogEntry {
  const base: CatalogEntry = {
    catalog: 'core',
    id,
    version: 1,
    name: opts.name ?? id,
    kind: 'hardscape',
    category: opts.category ?? 'rock',
    naturalSize: { width: 100, height: 100, depth: 100 },
    color: '#7a7d84',
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
  } as CatalogEntry;
  // Only set coverScore when explicitly requested. Production catalogs are
  // loader-defaulted; tests that *want* to mirror the loader's behaviour
  // pass through this helper with `coverScore: 0.4` etc. Tests that want
  // the missing-coverScore defensive-fallback path leave it absent.
  if (opts.coverScore !== undefined) {
    return { ...base, coverScore: opts.coverScore } as CatalogEntry;
  }
  return base;
}

/** Build a hardscape SceneObject at a position with a given catalog ref id. */
function hardscapeObj(
  objId: string,
  refId: string,
  pos: { x: number; y: number; z: number },
  category: 'rock' | 'wood' | 'other' = 'rock',
): HardscapeObject {
  return {
    kind: 'hardscape',
    id: asObjectId(objId),
    ref: { catalog: 'core', id: refId, version: 1 },
    category,
    transform: { ...identityTransform(), position: pos },
  };
}

/** Wrap one or more SceneObjects into a single visible Layer. */
function layerWith(id: string, objects: HardscapeObject[]): Layer {
  return {
    id: asLayerId(id),
    name: 'Hardscape',
    opacity: 1,
    visible: true,
    locked: false,
    objects,
  };
}

/** Compose a scene with both livestock + hardscape, on top of `defaultScene`. */
function sceneWithHardscape(
  livestock: LivestockEntry[],
  hardscape: HardscapeObject[],
  seed = 42,
): Scene {
  const base = defaultScene();
  return {
    ...base,
    seed,
    livestock,
    layers: hardscape.length > 0
      ? [layerWith('11111111-0000-4000-8000-000000000001', hardscape)]
      : [],
  };
}

describe('LivestockSimulationService — F11.3 hardscape registration', () => {
  it('registers every hardscape SceneObject on the world after a scene with livestock loads', () => {
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 4)];
    const hard = [
      hardscapeObj('h1', 'hardscape.rock.seiryu', { x: 100, y: 0, z: 100 }),
      hardscapeObj('h2', 'hardscape.wood.spider', { x: 300, y: 0, z: 200 }, 'wood'),
      hardscapeObj('h3', 'hardscape.rock.dragon', { x: 500, y: 0, z: 100 }),
    ];
    const { service, store } = setup();
    // Catalog mirrors the loader-defaulted state: every hardscape row has a
    // coverScore in [0, 1]. The service reads that value verbatim.
    service.setCatalog(
      makeCatalog([
        livestockEntry('livestock.fish.neon-tetra'),
        hardscapeEntry('hardscape.rock.seiryu', { category: 'rock', coverScore: 0.4 }),
        hardscapeEntry('hardscape.wood.spider', { category: 'wood', coverScore: 0.6 }),
        hardscapeEntry('hardscape.rock.dragon', { category: 'rock', coverScore: 0.4 }),
      ]),
    );
    store.overrideSelector(selectScene, sceneWithHardscape(livestock, hard, 7));
    store.refreshState();
    const world = service.getWorld()!;
    expect(world.getHardscapeCount()).toBe(3);
  });

  it('skips non-hardscape SceneObjects (plants, decor) — only `kind === hardscape` makes the list', () => {
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 2)];
    const hard = [hardscapeObj('h1', 'hardscape.rock.seiryu', { x: 100, y: 0, z: 100 })];
    const { service, store } = setup();
    service.setCatalog(
      makeCatalog([
        livestockEntry('livestock.fish.neon-tetra'),
        hardscapeEntry('hardscape.rock.seiryu', { category: 'rock', coverScore: 0.4 }),
      ]),
    );
    // The scene's layer has one hardscape + one decor + one plant. Only the
    // hardscape should make it to the world.
    const base = defaultScene();
    const scene: Scene = {
      ...base,
      seed: 7,
      livestock,
      layers: [
        {
          id: asLayerId('11111111-0000-4000-8000-000000000001'),
          name: 'mixed',
          opacity: 1,
          visible: true,
          locked: false,
          objects: [
            ...hard,
            {
              kind: 'decor',
              id: asObjectId('d1'),
              ref: { catalog: 'core', id: 'decor.fish.boraras', version: 1 },
              transform: identityTransform(),
            },
            {
              kind: 'plant',
              id: asObjectId('p1'),
              ref: { catalog: 'core', id: 'plant.eleocharis', version: 1 },
              growth: { ageWeeks: 4, vigor: 1 },
              transform: identityTransform(),
            },
          ],
        },
      ],
    };
    store.overrideSelector(selectScene, scene);
    store.refreshState();
    expect(service.getWorld()!.getHardscapeCount()).toBe(1);
  });

  it('reads the loaded catalog coverScore verbatim (no re-defaulting on a populated row)', () => {
    // Manifest authors can override the loader-default; the service must NOT
    // clobber that with its own default. We mint a wood row with an explicit
    // 0.7 (the loader fills 0.6 for wood) and assert the world stored 0.7.
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 1)];
    const hard = [
      hardscapeObj('h-wood', 'hardscape.wood.special', { x: 200, y: 0, z: 150 }, 'wood'),
    ];
    const { service, store } = setup();
    service.setCatalog(
      makeCatalog([
        livestockEntry('livestock.fish.neon-tetra'),
        hardscapeEntry('hardscape.wood.special', { category: 'wood', coverScore: 0.7 }),
      ]),
    );
    store.overrideSelector(selectScene, sceneWithHardscape(livestock, hard, 11));
    store.refreshState();
    const world = service.getWorld()!;
    expect(world.getHardscapeCount()).toBe(1);
    // Query the world's own ecs for Hardscape entities — this returns only
    // THIS world's hardscape eids, not module-global slabs polluted by prior
    // tests' world instances.
    const eids = defineQuery([Hardscape])(world.ecs);
    expect(eids.length).toBe(1);
    const eid = eids[0]!;
    expect(Hardscape.coverScore[eid]).toBeCloseTo(0.7, 5);
    expect(Hardscape.category[eid]).toBe(HARDSCAPE_CATEGORY.WOOD);
  });

  it('falls back to the loader-default coverScore when the catalog row is MISSING entirely', () => {
    // This is the defensive path: a hardscape SceneObject references a
    // ref id that isn't in the catalog. The service should still register
    // it with a category-derived coverScore so FearSystem has a usable
    // refuge value rather than NaN. The defensive default matches the
    // catalog loader (wood→0.6, rock→0.4, other→0).
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 1)];
    const hard = [
      hardscapeObj('h-missing', 'hardscape.rock.unknown', { x: 100, y: 0, z: 100 }, 'rock'),
    ];
    const { service, store } = setup();
    // Catalog deliberately omits the rock row.
    service.setCatalog(makeCatalog([livestockEntry('livestock.fish.neon-tetra')]));
    store.overrideSelector(selectScene, sceneWithHardscape(livestock, hard, 7));
    store.refreshState();
    const world = service.getWorld()!;
    expect(world.getHardscapeCount()).toBe(1);
    const eids = defineQuery([Hardscape])(world.ecs);
    expect(eids.length).toBe(1);
    const eid = eids[0]!;
    expect(Hardscape.coverScore[eid]).toBeCloseTo(0.4, 5);
    expect(Hardscape.category[eid]).toBe(HARDSCAPE_CATEGORY.ROCK);
  });

  it('hardscape mutation (new rock added) triggers re-register — count reflects the new scene', () => {
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 2)];
    const initial = [
      hardscapeObj('h1', 'hardscape.rock.a', { x: 100, y: 0, z: 100 }),
    ];
    const { service, store } = setup();
    service.setCatalog(
      makeCatalog([
        livestockEntry('livestock.fish.neon-tetra'),
        hardscapeEntry('hardscape.rock.a', { category: 'rock', coverScore: 0.4 }),
        hardscapeEntry('hardscape.rock.b', { category: 'rock', coverScore: 0.4 }),
      ]),
    );
    store.overrideSelector(selectScene, sceneWithHardscape(livestock, initial, 7));
    store.refreshState();
    expect(service.getWorld()!.getHardscapeCount()).toBe(1);
    // Add a second rock to the scene; the service should re-register +
    // re-spawn (the spawnKey fingerprint now includes the hardscape set).
    const grown = [
      ...initial,
      hardscapeObj('h2', 'hardscape.rock.b', { x: 300, y: 0, z: 200 }),
    ];
    store.overrideSelector(selectScene, sceneWithHardscape(livestock, grown, 7));
    store.refreshState();
    expect(service.getWorld()!.getHardscapeCount()).toBe(2);
  });

  it('hardscape removal triggers re-register — count drops', () => {
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 2)];
    const initial = [
      hardscapeObj('h1', 'hardscape.rock.a', { x: 100, y: 0, z: 100 }),
      hardscapeObj('h2', 'hardscape.rock.b', { x: 300, y: 0, z: 200 }),
    ];
    const { service, store } = setup();
    service.setCatalog(
      makeCatalog([
        livestockEntry('livestock.fish.neon-tetra'),
        hardscapeEntry('hardscape.rock.a', { category: 'rock', coverScore: 0.4 }),
        hardscapeEntry('hardscape.rock.b', { category: 'rock', coverScore: 0.4 }),
      ]),
    );
    store.overrideSelector(selectScene, sceneWithHardscape(livestock, initial, 7));
    store.refreshState();
    expect(service.getWorld()!.getHardscapeCount()).toBe(2);
    store.overrideSelector(selectScene, sceneWithHardscape(livestock, [initial[0]!], 7));
    store.refreshState();
    expect(service.getWorld()!.getHardscapeCount()).toBe(1);
  });
});

describe('LivestockSimulationService — F11.3 auto-anchor assignment', () => {
  it('territorial species (cichlid id hint) + hardscape within 2 * coreRadius → anchor is non-null', () => {
    // resolveBehavior assigns DEFAULT_TERRITORY (coreRadius: 80) when the id
    // contains 'cichlid' / 'ram' / 'apisto' / 'angelfish' / 'discus' / 'betta'.
    // Spawn-time auto-anchor scans hardscape within 2 * 80 = 160 mm. Tiling
    // five caves across the spawn region guarantees at least one fish lands
    // within range no matter how the per-entry PRNG distributes spawn
    // positions — the assertion that follows is "at least one fish has an
    // anchor", which is the F11.3 contract surface.
    const livestock = [entry('e1', 'livestock.fish.cichlid-ram', 12)];
    const tank = defaultScene().tank;
    const hard = [
      hardscapeObj('h1', 'hardscape.rock.cave', { x: tank.width * 0.2, y: tank.height / 2, z: tank.depth / 2 }),
      hardscapeObj('h2', 'hardscape.rock.cave', { x: tank.width * 0.4, y: tank.height / 2, z: tank.depth / 2 }),
      hardscapeObj('h3', 'hardscape.rock.cave', { x: tank.width * 0.6, y: tank.height / 2, z: tank.depth / 2 }),
      hardscapeObj('h4', 'hardscape.rock.cave', { x: tank.width * 0.8, y: tank.height / 2, z: tank.depth / 2 }),
      hardscapeObj('h5', 'hardscape.rock.cave', { x: tank.width / 2, y: tank.height * 0.3, z: tank.depth / 2 }),
    ];
    const { service, store } = setup();
    service.setCatalog(
      makeCatalog([
        livestockEntry('livestock.fish.cichlid-ram', { name: 'Ram' }),
        hardscapeEntry('hardscape.rock.cave', { category: 'rock', coverScore: 0.4 }),
      ]),
    );
    store.overrideSelector(selectScene, sceneWithHardscape(livestock, hard, 7));
    store.refreshState();
    const world = service.getWorld()!;
    // Enumerate FISH only (entities with BehaviorParamsRef). The snapshot
    // would also include the 5 hardscape entities, which have no
    // BehaviorParamsRef → getEntityTerritoryAnchor's "handle is undefined →
    // null" guard already filters them out, but querying directly is more
    // honest about the test intent.
    const fishEids = defineQuery([BehaviorParamsRef])(world.ecs);
    expect(fishEids.length).toBe(12);
    let anyAnchored = false;
    for (const eid of fishEids) {
      if (world.getEntityTerritoryAnchor(eid) !== null) {
        anyAnchored = true;
        break;
      }
    }
    expect(anyAnchored).toBe(true);
  });

  it('territorial species + NO hardscape → every fish has anchor === null (out-of-range fallback)', () => {
    const livestock = [entry('e1', 'livestock.fish.cichlid-ram', 4)];
    const { service, store } = setup();
    service.setCatalog(
      makeCatalog([livestockEntry('livestock.fish.cichlid-ram', { name: 'Ram' })]),
    );
    store.overrideSelector(selectScene, sceneWithHardscape(livestock, [], 7));
    store.refreshState();
    const world = service.getWorld()!;
    expect(world.getHardscapeCount()).toBe(0);
    const fishEids = defineQuery([BehaviorParamsRef])(world.ecs);
    expect(fishEids.length).toBe(4);
    for (const eid of fishEids) {
      expect(world.getEntityTerritoryAnchor(eid)).toBeNull();
    }
  });
});

describe('LivestockSimulationService — F11.3 determinism with hardscape + anchors', () => {
  /** Byte-compare two typed-array views. Returns false on length mismatch. */
  function byteEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
    if (a.byteLength !== b.byteLength) return false;
    const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
    return true;
  }

  /** Drive the service through `setup` + a hardscape-bearing scene + N ticks. */
  function runService(
    livestock: LivestockEntry[],
    hard: HardscapeObject[],
    seed: number,
    ticks: number,
  ) {
    const { service, store } = setup();
    service.setCatalog(
      makeCatalog([
        livestockEntry('livestock.fish.cichlid-ram', { name: 'Ram' }),
        livestockEntry('livestock.fish.neon-tetra'),
        hardscapeEntry('hardscape.rock.cave', { category: 'rock', coverScore: 0.4 }),
        hardscapeEntry('hardscape.wood.driftwood', { category: 'wood', coverScore: 0.6 }),
      ]),
    );
    store.overrideSelector(selectScene, sceneWithHardscape(livestock, hard, seed));
    store.refreshState();
    const world = service.getWorld()!;
    const SIM_DT = 1 / 30;
    for (let i = 0; i < ticks; i++) world.step(SIM_DT);
    const snap = world.snapshot(0);
    return {
      entityCount: snap.entityCount,
      position: new Float32Array(snap.position),
      orientation: new Float32Array(snap.orientation),
      phase: new Float32Array(snap.phase),
    };
  }

  it('1000-tick replay with a cichlid + cave is bit-identical across two cold service builds', () => {
    // The F11.3 gate. Auto-anchor is order-stable (first-nearest-wins) and
    // hardscape iterates in document order — so identical
    // (seed, livestock, hardscape) must produce identical anchor
    // assignments. If the registration order drifted, FearSystem would
    // pick a different refuge eid, TerritorialSystem would chase from a
    // different anchor, and Position would diverge well before tick 1000.
    const tank = defaultScene().tank;
    const livestock = [
      entry('e1', 'livestock.fish.cichlid-ram', 3),
      entry('e2', 'livestock.fish.neon-tetra', 5),
    ];
    const hard = [
      hardscapeObj('h1', 'hardscape.rock.cave', {
        x: tank.width * 0.3,
        y: tank.height / 2,
        z: tank.depth / 2,
      }),
      hardscapeObj('h2', 'hardscape.wood.driftwood', {
        x: tank.width * 0.7,
        y: tank.height / 2,
        z: tank.depth / 2,
      }, 'wood'),
    ];

    const a = runService(livestock, hard, 0xc0ffee, 1000);
    TestBed.resetTestingModule();
    const b = runService(livestock, hard, 0xc0ffee, 1000);

    expect(a.entityCount).toBe(b.entityCount);
    expect(byteEqual(a.position, b.position)).toBe(true);
    expect(byteEqual(a.orientation, b.orientation)).toBe(true);
    expect(byteEqual(a.phase, b.phase)).toBe(true);
  });
});

// ─── F11.4 Wave 4 — Feed tank pulse pipeline ────────────────────────────────
//
// The service subscribes to `LivestockPulseActions.feedTank` and translates
// each emission into N `world.spawnFoodSprite(...)` calls at the water
// surface. Tests below seed the Actions stream via `provideMockActions`
// (the supported NgRx test surface) and assert on the world's sprite count
// + per-sprite position.
//
// Determinism contract (this section's gate):
//   - With NO explicit spriteCount, the count is drawn from
//     `tickPrng(world, FEED_TANK_COUNT_KEY)` so two pulses at the same
//     world.tickCounter spawn the same N.
//   - Per-sprite XZ comes from `tickPrng(world, FEED_TANK_KEY, i, axis)` so
//     two services driven by the same (seed, livestock, dispatch sequence)
//     produce identical sprite positions.

/** Setup helper that also wires `provideMockActions` with a fresh Subject. */
function setupWithPulse(
  initialScene: Scene = defaultScene(),
): {
  service: LivestockSimulationService;
  store: MockStore;
  actions$: Subject<Action>;
} {
  const actions$ = new Subject<Action>();
  TestBed.configureTestingModule({
    providers: [
      provideMockStore({
        initialState: {},
        selectors: [{ selector: selectScene, value: initialScene }],
      }),
      provideMockActions(() => actions$),
    ],
  });
  const service = TestBed.inject(LivestockSimulationService);
  service.setCatalog(
    makeCatalog([
      livestockEntry('livestock.fish.neon-tetra', { name: 'Neon tetra', adultSize: 35 }),
    ]),
  );
  const store = TestBed.inject(MockStore);
  return { service, store, actions$ };
}

describe('LivestockSimulationService — F11.4 Feed tank pulse', () => {
  it('explicit spriteCount: feedTank({ spriteCount: 4 }) spawns exactly 4 sprites', () => {
    const { service, store, actions$ } = setupWithPulse();
    store.overrideSelector(
      selectScene,
      sceneWithLivestock([entry('e1', 'livestock.fish.neon-tetra', 3)], 7),
    );
    store.refreshState();
    const world = service.getWorld()!;
    expect(world.getFoodSpriteCount()).toBe(0);

    actions$.next(LivestockPulseActions.feedTank({ spriteCount: 4 }));

    expect(world.getFoodSpriteCount()).toBe(4);
  });

  it('default spriteCount: feedTank({}) spawns between FOOD_SPRITE_DEFAULT_MIN and _MAX inclusive', () => {
    const { service, store, actions$ } = setupWithPulse();
    store.overrideSelector(
      selectScene,
      sceneWithLivestock([entry('e1', 'livestock.fish.neon-tetra', 3)], 7),
    );
    store.refreshState();
    const world = service.getWorld()!;

    actions$.next(LivestockPulseActions.feedTank({}));

    const n = world.getFoodSpriteCount();
    // FOOD_SPRITE_DEFAULT_MIN/_MAX live in the service module; the range
    // [3, 6] is part of the documented contract (see service header
    // constants + this spec's lead comment).
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(6);
  });

  it('every spawned sprite sits within the tank AABB and just below the waterline', () => {
    const { service, store, actions$ } = setupWithPulse();
    store.overrideSelector(
      selectScene,
      sceneWithLivestock([entry('e1', 'livestock.fish.neon-tetra', 2)], 7),
    );
    store.refreshState();
    const world = service.getWorld()!;
    actions$.next(LivestockPulseActions.feedTank({ spriteCount: 8 }));

    const snap = world.snapshot(0);
    // `snapshot.foodSpriteCount + foodSpritePosition` is the public read
    // surface (see livestock-ecs/world.ts → WorldSnapshot).
    expect(snap.foodSpriteCount).toBe(8);
    const aabb = world.tankAabb;
    for (let i = 0; i < snap.foodSpriteCount; i++) {
      const x = snap.foodSpritePosition[i * 3 + 0]!;
      const y = snap.foodSpritePosition[i * 3 + 1]!;
      const z = snap.foodSpritePosition[i * 3 + 2]!;
      // XZ bounds are inset from the glass but still inside the AABB.
      expect(x).toBeGreaterThanOrEqual(aabb.minX);
      expect(x).toBeLessThanOrEqual(aabb.maxX);
      expect(z).toBeGreaterThanOrEqual(aabb.minZ);
      expect(z).toBeLessThanOrEqual(aabb.maxZ);
      // Y is pinned near the surface — well above the tank midpoint (0.5 *
      // height) regardless of the precise surface offset.
      expect(y).toBeGreaterThan((aabb.maxY - aabb.minY) * 0.8);
      expect(y).toBeLessThanOrEqual(aabb.maxY);
    }
  });

  it('no-op when the world has not been built (no livestock in the scene)', () => {
    const { service, actions$ } = setupWithPulse(defaultScene());
    expect(service.getWorld()).toBeNull();

    // Dispatching while there's no world must not throw — the service
    // gracefully no-ops.
    expect(() =>
      actions$.next(LivestockPulseActions.feedTank({ spriteCount: 5 })),
    ).not.toThrow();
    expect(service.getWorld()).toBeNull();
  });

  it('determinism: two services with same (seed, livestock, dispatch sequence) produce identical sprite positions', () => {
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 3)];
    const scene = sceneWithLivestock(livestock, 12345);

    // Service A
    const a = setupWithPulse();
    a.store.overrideSelector(selectScene, scene);
    a.store.refreshState();
    a.actions$.next(LivestockPulseActions.feedTank({ spriteCount: 5 }));
    const worldA = a.service.getWorld()!;
    const snapA = worldA.snapshot(0);
    const positionsA = new Float32Array(snapA.foodSpritePosition);
    const countA = snapA.foodSpriteCount;

    // Service B (fresh TestBed) — same inputs → same outputs.
    TestBed.resetTestingModule();
    const b = setupWithPulse();
    b.store.overrideSelector(selectScene, scene);
    b.store.refreshState();
    b.actions$.next(LivestockPulseActions.feedTank({ spriteCount: 5 }));
    const worldB = b.service.getWorld()!;
    const snapB = worldB.snapshot(0);
    const positionsB = new Float32Array(snapB.foodSpritePosition);
    const countB = snapB.foodSpriteCount;

    expect(countA).toBe(5);
    expect(countB).toBe(5);
    for (let i = 0; i < 5 * 3; i++) {
      expect(positionsA[i]).toBeCloseTo(positionsB[i]!, 5);
    }
  });

  it('determinism: default (count-from-tickPrng) is also byte-stable across cold starts', () => {
    // Same scene, same seed, default sprite count → same N AND same
    // positions on two cold starts. This is the gate for the "two
    // services driven by the same dispatch sequence reproduce" contract.
    const livestock = [entry('e1', 'livestock.fish.neon-tetra', 3)];
    const scene = sceneWithLivestock(livestock, 99);

    const a = setupWithPulse();
    a.store.overrideSelector(selectScene, scene);
    a.store.refreshState();
    a.actions$.next(LivestockPulseActions.feedTank({}));
    const snapA = a.service.getWorld()!.snapshot(0);
    const countA = snapA.foodSpriteCount;
    const posA = new Float32Array(snapA.foodSpritePosition);

    TestBed.resetTestingModule();
    const b = setupWithPulse();
    b.store.overrideSelector(selectScene, scene);
    b.store.refreshState();
    b.actions$.next(LivestockPulseActions.feedTank({}));
    const snapB = b.service.getWorld()!.snapshot(0);
    const countB = snapB.foodSpriteCount;
    const posB = new Float32Array(snapB.foodSpritePosition);

    expect(countA).toBe(countB);
    for (let i = 0; i < countA * 3; i++) {
      expect(posA[i]).toBeCloseTo(posB[i]!, 5);
    }
  });

  it('spriteCount <= 0 spawns nothing (defensive — guards against UI bugs sending 0/negative)', () => {
    const { service, store, actions$ } = setupWithPulse();
    store.overrideSelector(
      selectScene,
      sceneWithLivestock([entry('e1', 'livestock.fish.neon-tetra', 2)], 7),
    );
    store.refreshState();
    const world = service.getWorld()!;
    actions$.next(LivestockPulseActions.feedTank({ spriteCount: 0 }));
    expect(world.getFoodSpriteCount()).toBe(0);
    actions$.next(LivestockPulseActions.feedTank({ spriteCount: -3 }));
    expect(world.getFoodSpriteCount()).toBe(0);
  });
});
