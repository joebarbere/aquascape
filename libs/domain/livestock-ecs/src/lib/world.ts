/**
 * Livestock ECS world factory — the single object the renderer's RAF loop
 * pokes each frame (Stage 11 F11.1).
 *
 * The accumulator + interpolation logic that drives `step()` lives in the
 * *caller* (the renderer's RAF loop in Wave 4). Reason: the renderer knows
 * how many sim ticks elapsed since the last frame, so it must own that
 * outer loop. The ECS lib just exposes a single fixed-dt `step()` and a
 * snapshot taker — both stateless w.r.t. real time.
 */
import {
  addComponent,
  addEntity,
  createWorld,
  defineQuery,
  removeEntity,
  type IWorld,
} from 'bitecs';
import {
  AnimationPhase,
  Archetype,
  BehaviorMode,
  BEHAVIOR_MODE,
  BodyLength,
  Orientation,
  Position,
  SpeciesId,
  Velocity,
} from './components';
import { animationSystem, kinematicSystem } from './systems';

/** Fixed simulation time-step, in seconds. 30 Hz — matches the plan. */
export const SIM_DT = 1 / 30;
/** Convenience reciprocal of `SIM_DT`. */
export const SIM_HZ = 30;

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
  /** Add a new fish entity. Returns the bitECS entity id. */
  spawnFish(opts: SpawnOpts): number;
  /** Remove an entity. No-op if the id is unknown. */
  despawn(eid: number): void;
  /** Run one sim tick of duration `dt` (callers pass `SIM_DT`). */
  step(dt: number): void;
  /**
   * Build a renderer snapshot. `alpha` is the accumulator/SIM_DT
   * interpolation factor (reserved for Wave 4; F11.1 leaves Velocity = 0 so
   * the returned positions are identical regardless of `alpha`).
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
 * Build a fresh ECS world. The same `seed` must reproduce the same snapshot
 * given the same `SpawnOpts` and `step()` count — this is the load-bearing
 * invariant for the entire stage.
 */
export function createLivestockWorld(seed: number): LivestockWorld {
  const ecs = createWorld();
  let pool = makeSnapshotPool(64);

  // `tickCounter` and `seed` live on the world object so `tickPrng(world,…)`
  // can read them without a closure variable per tick.
  const world: LivestockWorld = {
    ecs,
    seed: seed | 0,
    tickCounter: 0,

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

      return eid;
    },

    despawn(eid: number): void {
      removeEntity(ecs, eid);
    },

    step(dt: number): void {
      // Schooling / depth / territory / steering systems land in F11.2–F11.4
      // ahead of these two — write back to Velocity and let Kinematic commit.
      kinematicSystem(ecs, dt);
      animationSystem(ecs, dt);
      this.tickCounter += 1;
    },

    snapshot(_alpha: number): WorldSnapshot {
      // F11.1 has no steering, so we copy the integrated state straight out.
      // Wave 4 (steering) will use `_alpha` to lerp Position between the last
      // two ticks; the API takes it now so the contract is stable.
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
      // bitECS has no explicit world destructor in 0.3 — dropping the
      // reference lets the typed-array slabs GC. We reset the tickCounter
      // so any leaked reference at least produces a defensible value.
      this.tickCounter = 0;
    },
  };

  return world;
}
