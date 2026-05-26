/**
 * bitECS component schemas for the livestock world (Stage 11 F11.1).
 *
 * Each `defineComponent({ ... })` call allocates a Struct-of-Arrays slab of
 * typed arrays keyed by entity id. Reading `Position.x[eid]` is a flat array
 * lookup — no per-entity object allocation, no GC pressure inside the hot loop.
 *
 * For F11.1 the world only exercises `Position`, `Orientation`, `Archetype`,
 * `BodyLength`, and `AnimationPhase`. The other components are wired up now
 * because F11.2 (schooling), F11.3 (behavior modes), and F11.4 (steering)
 * will start populating them — landing the SoA layout up-front prevents a
 * cross-substage churn of the component set later.
 */
import { defineComponent, Types } from 'bitecs';

/** Position in canonical tank-millimetre coordinates (origin = front-bottom-left). */
export const Position = defineComponent({ x: Types.f32, y: Types.f32, z: Types.f32 });

/** Velocity in mm/s. Integrated by KinematicSystem each sim tick. */
export const Velocity = defineComponent({ x: Types.f32, y: Types.f32, z: Types.f32 });

/** Unit quaternion (right-handed). Identity = `(0,0,0,1)`. */
export const Orientation = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
  w: Types.f32,
});

/** Hashed catalog id (16-bit folded). Used by behavior dispatch in F11.3. */
export const SpeciesId = defineComponent({ id: Types.ui16 });

/** Body length in mm. Drives per-instance scale on the renderer side. */
export const BodyLength = defineComponent({ mm: Types.f32 });

/** Procedural mesh archetype id — see `FISH_ARCHETYPE`. */
export const Archetype = defineComponent({ id: Types.ui8 });

/**
 * Tail-beat animation state.
 * - `phase`: current radians in `[0, 2π)`. Advanced by AnimationSystem.
 * - `freq`: tail-beat frequency in Hz (cycles per second).
 * - `ampHead`, `ampTail`: amplitudes consumed by the renderer's vertex shader
 *   to drive the carangiform sine-spine deformation.
 */
export const AnimationPhase = defineComponent({
  phase: Types.f32,
  freq: Types.f32,
  ampHead: Types.f32,
  ampTail: Types.f32,
});

/** Coarse behavior FSM. F11.1 leaves every entity in `FORAGE`. */
export const BehaviorMode = defineComponent({ mode: Types.ui8 });

/**
 * Enum of procedural fish archetypes (F11.1 fish-anatomy library). Stored as
 * a `ui8` on the entity so the renderer can branch its InstancedMesh
 * selection from a flat lookup.
 */
export const FISH_ARCHETYPE = {
  SLIM_TETRA: 0,
  DEEP_BODIED: 1,
  BARB: 2,
  CORY_CYLINDER: 3,
  EEL: 4,
  HATCHET_WEDGE: 5,
} as const;

export type FishArchetypeId = (typeof FISH_ARCHETYPE)[keyof typeof FISH_ARCHETYPE];

/**
 * Coarse behavior modes. Reserved for F11.3 — F11.1 spawns every entity in
 * `FORAGE` and never transitions.
 */
export const BEHAVIOR_MODE = {
  FORAGE: 0,
  REFUGE: 1,
  PURSUE: 2,
} as const;

export type BehaviorModeId = (typeof BEHAVIOR_MODE)[keyof typeof BEHAVIOR_MODE];
