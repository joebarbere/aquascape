/**
 * Livestock ECS world factory — the single object the renderer's RAF loop
 * pokes each frame (Stage 11 F11.1 + F11.2).
 *
 * The accumulator + interpolation logic that drives `step()` lives in the
 * *caller* (the renderer's RAF loop). Reason: the renderer knows how many
 * sim ticks elapsed since the last frame, so it must own that outer loop.
 * The ECS lib just exposes a single fixed-dt `step()` and a snapshot
 * taker — both stateless w.r.t. real time.
 *
 * F11.2 adds three pieces to the world:
 *   1. A `ParamStore` of per-species `ResolvedBehavior` rows.
 *   2. A `tankAabb` describing the interior box (mm), so DepthSystem can
 *      scale `preferredY` and SteeringIntegrator can clamp Velocity at
 *      the glass.
 *   3. A `SpatialGrid` rebuilt by PerceptionSystem each tick. Its cell
 *      size tracks `paramStore.maxNeighbourRadius()`.
 */
import {
  addComponent,
  addEntity,
  createWorld,
  defineQuery,
  removeEntity,
  type IWorld,
} from 'bitecs';
import type { ResolvedBehavior } from '@aquascape/domain/livestock-behaviors';
import {
  AnimationPhase,
  Archetype,
  BehaviorMode,
  BehaviorParamsRef,
  BEHAVIOR_MODE,
  BodyLength,
  Force,
  Orientation,
  Position,
  SpeciesId,
  Velocity,
} from './components';
import { NO_BEHAVIOR_HANDLE, ParamStore } from './param-store';
import { SpatialGrid } from './spatial-grid';
import {
  animationSystem,
  depthSystem,
  kinematicSystem,
  perceptionSystem,
  schoolingSystem,
  steeringIntegrator,
} from './systems';

/** Fixed simulation time-step, in seconds. 30 Hz — matches the plan. */
export const SIM_DT = 1 / 30;
/** Convenience reciprocal of `SIM_DT`. */
export const SIM_HZ = 30;

/**
 * Floor for the SpatialGrid cell size. The grid throws on `cellSize <= 0`,
 * so when no species has been registered yet (maxNeighbourRadius = 0) we
 * still need a positive cell. 50 mm is a sensible "no school yet, single
 * fish meandering" default — small enough that any future registration
 * with a real ZOA will tighten it.
 */
const FALLBACK_GRID_CELL_MM = 50;

/**
 * Tank interior axis-aligned bounding box (canonical mm coords —
 * front-bottom-left = origin, +x right, +y up, +z back). Carried by the
 * world so DepthSystem + SteeringIntegrator + KinematicSystem can read it
 * without a per-entity closure.
 */
export interface TankAabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Default AABB used when the caller didn't pass one (tests, mostly). */
const DEFAULT_TANK_AABB: TankAabb = {
  minX: 0,
  maxX: 1000,
  minY: 0,
  maxY: 400,
  minZ: 0,
  maxZ: 400,
};

export interface SpawnOpts {
  /** `FISH_ARCHETYPE.*` — drives renderer InstancedMesh selection. */
  archetype: number;
  /** Hashed catalog id (fits in `ui16`). Used by F11.3 behavior dispatch. */
  speciesId: number;
  /** Body length in mm. Drives per-instance render scale. */
  bodyLengthMm: number;
  /** Spawn position in canonical mm coordinates. */
  position: { x: number; y: number; z: number };
  /** Initial orientation. Default = identity quaternion `(0,0,0,1)`. */
  orientation?: { x: number; y: number; z: number; w: number };
  /** Tail-beat frequency in Hz. Default 4 (a calm tetra cruise). */
  tailBeatFreq?: number;
  /** Carangiform head amplitude. Default 0.02 (body-lengths). */
  ampHead?: number;
  /** Carangiform tail amplitude. Default 0.12 (body-lengths). */
  ampTail?: number;
  /** Initial phase offset in radians. Default 0. */
  phaseOffset?: number;
  /**
   * Behaviour-params handle from `registerSpeciesBehavior`. Default
   * `NO_BEHAVIOR_HANDLE` → behaviour systems skip this entity (degenerate
   * static-Velocity-0 path that preserves F11.1's wiggle-in-place
   * acceptance criteria).
   */
  behaviorHandleIdx?: number;
}

/**
 * Renderer-facing snapshot of the world. The returned typed arrays may be
 * *pooled* (recycled on the next `snapshot()` call) — consumers that need
 * the data outside a single InstancedMesh upload must copy.
 */
export interface WorldSnapshot {
  entityCount: number;
  /** Length = `entityCount`. */
  ids: Uint32Array;
  /** Stride 3 — x,y,z per entity. Length = `entityCount * 3`. */
  position: Float32Array;
  /** Stride 4 — x,y,z,w quaternion per entity. Length = `entityCount * 4`. */
  orientation: Float32Array;
  /** Length = `entityCount`. Just `AnimationPhase.phase` (no interpolation). */
  phase: Float32Array;
  /** Length = `entityCount`. */
  archetype: Uint8Array;
  /** Body length per entity in mm. Length = `entityCount`. */
  scale: Float32Array;
}

export interface LivestockWorld {
  /** Underlying bitECS world. Exposed for tests + future system additions. */
  readonly ecs: IWorld;
  /** Caller-supplied PRNG seed (typically `document.seed`). Frozen at creation. */
  readonly seed: number;
  /** Increments by 1 on every `step()` call. */
  tickCounter: number;
  /**
   * Per-species `ResolvedBehavior` rows. Behaviour systems read via
   * `BehaviorParamsRef.handleIdx`; populated through
   * `registerSpeciesBehavior`.
   */
  readonly paramStore: ParamStore;
  /** Spatial broad-phase rebuilt by PerceptionSystem each tick. */
  spatialGrid: SpatialGrid;
  /**
   * Mutable tank interior AABB (canonical mm coords). DepthSystem reads
   * the height; SteeringIntegrator + KinematicSystem clamp Position
   * inside the box. Update via `setTankAabb`.
   */
  tankAabb: TankAabb;
  /** Add a new fish entity. Returns the bitECS entity id. */
  spawnFish(opts: SpawnOpts): number;
  /** Remove an entity. No-op if the id is unknown. */
  despawn(eid: number): void;
  /** Replace the tank AABB; future ticks read the new bounds. */
  setTankAabb(aabb: TankAabb): void;
  /**
   * Register (or re-register) a species' ResolvedBehavior. Returns the
   * stable handle index to pass back via `SpawnOpts.behaviorHandleIdx`.
   */
  registerSpeciesBehavior(speciesId: number, behavior: ResolvedBehavior): number;
  /** Run one sim tick of duration `dt` (callers pass `SIM_DT`). */
  step(dt: number): void;
  /**
   * Build a renderer snapshot. `alpha` is the accumulator/SIM_DT
   * interpolation factor (reserved for future sub-tick lerping; F11.2's
   * snapshot still copies the post-step Position directly).
   */
  snapshot(alpha: number): WorldSnapshot;
  /** Tear down the world. Currently drops references; pooled arrays are GC'd. */
  dispose(): void;
}

const ALL_ENTITIES = defineQuery([Position]);

/** Cheap mutable scratch struct passed to `addComponent` paths. */
interface SnapshotPool {
  ids: Uint32Array;
  position: Float32Array;
  orientation: Float32Array;
  phase: Float32Array;
  archetype: Uint8Array;
  scale: Float32Array;
  capacity: number;
}

function makeSnapshotPool(capacity: number): SnapshotPool {
  return {
    ids: new Uint32Array(capacity),
    position: new Float32Array(capacity * 3),
    orientation: new Float32Array(capacity * 4),
    phase: new Float32Array(capacity),
    archetype: new Uint8Array(capacity),
    scale: new Float32Array(capacity),
    capacity,
  };
}

function growPool(pool: SnapshotPool, needed: number): SnapshotPool {
  let cap = pool.capacity;
  while (cap < needed) cap *= 2;
  return makeSnapshotPool(cap);
}

/**
 * Pick a SpatialGrid cell size from the paramStore's current max
 * neighbour radius. Falls back to a default when nothing is registered
 * yet (the grid constructor rejects cellSize ≤ 0).
 */
function pickCellSize(store: ParamStore): number {
  const max = store.maxNeighbourRadius();
  return max > 0 ? max : FALLBACK_GRID_CELL_MM;
}

/**
 * Optional construction flags. Currently only `tankAabb`; left as an
 * options bag so future fields (e.g. F11.5 SDF) don't require breaking
 * changes again.
 */
export interface CreateLivestockWorldOpts {
  tankAabb?: TankAabb;
}

/**
 * Build a fresh ECS world. The same `seed` must reproduce the same snapshot
 * given the same `SpawnOpts` and `step()` count — this is the load-bearing
 * invariant for the entire stage.
 *
 * The `opts.tankAabb` defaults to a generic 1000 × 400 × 400 mm interior;
 * the `LivestockSimulationService` always passes a real one derived from
 * `scene.tank`. Tests that don't care about boundary behaviour can omit it.
 */
export function createLivestockWorld(
  seed: number,
  opts: CreateLivestockWorldOpts = {},
): LivestockWorld {
  const ecs = createWorld();
  const paramStore = new ParamStore();
  let pool = makeSnapshotPool(64);
  // Monotonic spawn counter — stamped on every `spawnFish` call. The
  // determinism contract requires a stable per-entity key for tickPrng
  // draws, and bitECS' raw entity ids are module-global so two worlds
  // built in the same process get distinct id ranges. spawnIndex starts
  // at 0 in every fresh world.
  let nextSpawnIndex = 0;

  // `tickCounter` and `seed` live on the world object so `tickPrng(world,…)`
  // can read them without a closure variable per tick.
  const world: LivestockWorld = {
    ecs,
    seed: seed | 0,
    tickCounter: 0,
    paramStore,
    spatialGrid: new SpatialGrid(pickCellSize(paramStore)),
    tankAabb: opts.tankAabb ?? { ...DEFAULT_TANK_AABB },

    spawnFish(opts: SpawnOpts): number {
      const eid = addEntity(ecs);

      addComponent(ecs, Position, eid);
      Position.x[eid] = opts.position.x;
      Position.y[eid] = opts.position.y;
      Position.z[eid] = opts.position.z;

      addComponent(ecs, Velocity, eid);
      Velocity.x[eid] = 0;
      Velocity.y[eid] = 0;
      Velocity.z[eid] = 0;

      addComponent(ecs, Force, eid);
      Force.x[eid] = 0;
      Force.y[eid] = 0;
      Force.z[eid] = 0;

      addComponent(ecs, Orientation, eid);
      const q = opts.orientation ?? { x: 0, y: 0, z: 0, w: 1 };
      Orientation.x[eid] = q.x;
      Orientation.y[eid] = q.y;
      Orientation.z[eid] = q.z;
      Orientation.w[eid] = q.w;

      addComponent(ecs, SpeciesId, eid);
      SpeciesId.id[eid] = opts.speciesId & 0xffff;

      addComponent(ecs, BodyLength, eid);
      BodyLength.mm[eid] = opts.bodyLengthMm;

      addComponent(ecs, Archetype, eid);
      Archetype.id[eid] = opts.archetype & 0xff;

      addComponent(ecs, AnimationPhase, eid);
      AnimationPhase.phase[eid] = opts.phaseOffset ?? 0;
      AnimationPhase.freq[eid] = opts.tailBeatFreq ?? 4;
      AnimationPhase.ampHead[eid] = opts.ampHead ?? 0.02;
      AnimationPhase.ampTail[eid] = opts.ampTail ?? 0.12;

      addComponent(ecs, BehaviorMode, eid);
      BehaviorMode.mode[eid] = BEHAVIOR_MODE.FORAGE;

      addComponent(ecs, BehaviorParamsRef, eid);
      BehaviorParamsRef.handleIdx[eid] =
        opts.behaviorHandleIdx === undefined ? NO_BEHAVIOR_HANDLE : opts.behaviorHandleIdx & 0xffff;
      BehaviorParamsRef.spawnIndex[eid] = nextSpawnIndex;
      nextSpawnIndex = (nextSpawnIndex + 1) >>> 0;

      return eid;
    },

    despawn(eid: number): void {
      removeEntity(ecs, eid);
    },

    setTankAabb(aabb: TankAabb): void {
      // Defensive copy — callers that hold the prior reference don't need
      // to worry about us mutating it, and we don't want them mutating
      // our snapshot of the box behind our back.
      this.tankAabb = {
        minX: aabb.minX,
        maxX: aabb.maxX,
        minY: aabb.minY,
        maxY: aabb.maxY,
        minZ: aabb.minZ,
        maxZ: aabb.maxZ,
      };
    },

    registerSpeciesBehavior(speciesId: number, behavior: ResolvedBehavior): number {
      const handle = paramStore.registerSpecies(speciesId, behavior);
      // Rebuild the grid only if the cell size actually moved — the grid
      // is per-tick disposable (cleared every PerceptionSystem call), so
      // we can always lazily reallocate without losing inserted state.
      const newCellSize = pickCellSize(paramStore);
      if (newCellSize !== this.spatialGrid.cellSizeMm) {
        this.spatialGrid = new SpatialGrid(newCellSize);
      }
      return handle;
    },

    step(dt: number): void {
      // F11.2 system order — see docs/caveats/livestock-ecs.md
      // Perception → Schooling → Depth → SteeringIntegrator → Kinematic → Animation
      // F11.3+ slots in Fear/Nip/Territory/Feeding between Perception and
      // Schooling, and Flow/Collision between SteeringIntegrator and
      // Kinematic. The reserved seats line up with the table in the caveat.
      perceptionSystem(this);
      schoolingSystem(this, dt);
      depthSystem(this, dt);
      steeringIntegrator(this, dt);
      kinematicSystem(ecs, dt);
      // Clamp Position to tankAabb after Kinematic — SteeringIntegrator's
      // projection should prevent escapes, but rounding error can still
      // nudge a fish a fraction of a mm outside the box.
      clampPositionToAabb(ecs, this.tankAabb);
      animationSystem(ecs, dt);
      this.tickCounter += 1;
    },

    snapshot(_alpha: number): WorldSnapshot {
      const ents = ALL_ENTITIES(ecs);
      const n = ents.length;
      if (n > pool.capacity) pool = growPool(pool, n);

      // `for...of` narrows the element type to `number` (vs. `for (let i…)`
      // indexing which yields `number | undefined` under
      // `noUncheckedIndexedAccess`). The component reads below are explicitly
      // `as number` because the same TS option applies to TypedArray indexing,
      // and Uint8/Uint32Array assignment (unlike Float32Array's NaN-coercing
      // one) refuses `number | undefined`.
      let i = 0;
      for (const eid of ents) {
        pool.ids[i] = eid;
        pool.position[i * 3 + 0] = Position.x[eid] as number;
        pool.position[i * 3 + 1] = Position.y[eid] as number;
        pool.position[i * 3 + 2] = Position.z[eid] as number;
        pool.orientation[i * 4 + 0] = Orientation.x[eid] as number;
        pool.orientation[i * 4 + 1] = Orientation.y[eid] as number;
        pool.orientation[i * 4 + 2] = Orientation.z[eid] as number;
        pool.orientation[i * 4 + 3] = Orientation.w[eid] as number;
        pool.phase[i] = AnimationPhase.phase[eid] as number;
        pool.archetype[i] = Archetype.id[eid] as number;
        pool.scale[i] = BodyLength.mm[eid] as number;
        i++;
      }

      // Hand back *views* over the pool that match the live entity count.
      // The pool itself stays sized at `pool.capacity` so we don't reallocate
      // every frame.
      return {
        entityCount: n,
        ids: pool.ids.subarray(0, n),
        position: pool.position.subarray(0, n * 3),
        orientation: pool.orientation.subarray(0, n * 4),
        phase: pool.phase.subarray(0, n),
        archetype: pool.archetype.subarray(0, n),
        scale: pool.scale.subarray(0, n),
      };
    },

    dispose(): void {
      // bitECS has no explicit world destructor — dropping the reference
      // lets the typed-array slabs GC. We reset the tickCounter so any
      // leaked reference at least produces a defensible value, and clear
      // the param store + grid so the next world doesn't accidentally
      // alias a stale species table.
      this.tickCounter = 0;
      paramStore.clear();
      this.spatialGrid.clear();
    },
  };

  return world;
}

const positionQuery = defineQuery([Position]);

/**
 * Clamp every entity's Position to `aabb`. Called after KinematicSystem
 * so rounding error from the steering projection can't accumulate into
 * a real escape over many ticks.
 */
function clampPositionToAabb(ecs: IWorld, aabb: TankAabb): void {
  for (const eid of positionQuery(ecs)) {
    const x = Position.x[eid] as number;
    const y = Position.y[eid] as number;
    const z = Position.z[eid] as number;
    if (x < aabb.minX) Position.x[eid] = aabb.minX;
    else if (x > aabb.maxX) Position.x[eid] = aabb.maxX;
    if (y < aabb.minY) Position.y[eid] = aabb.minY;
    else if (y > aabb.maxY) Position.y[eid] = aabb.maxY;
    if (z < aabb.minZ) Position.z[eid] = aabb.minZ;
    else if (z > aabb.maxZ) Position.z[eid] = aabb.maxZ;
  }
}
