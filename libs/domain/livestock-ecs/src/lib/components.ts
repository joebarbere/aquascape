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
 * Per-tick force accumulator (mm/s²). Behaviour systems (Schooling, Depth,
 * Flow, …) sum into this; SteeringIntegrator drains it into `Velocity` and
 * resets it to (0,0,0) before the next tick. Keeping the accumulator on a
 * dedicated component (rather than overwriting Velocity directly) lets the
 * integrator clamp `|Velocity|`, enforce `turnMax`, and project against the
 * tank AABB in a single pass after every force is in.
 */
export const Force = defineComponent({ x: Types.f32, y: Types.f32, z: Types.f32 });

/**
 * Indirection from an entity to its species-level `ResolvedBehavior`
 * bundle. The behaviour data itself lives on the world's `ParamStore` —
 * one shared row per species, referenced by every entity of that species
 * via `handleIdx`. This keeps a 200-fish school from carrying 200 copies
 * of the same 11-float SchoolingParams. Handle 0xffff (= 65535) is treated
 * as "no behaviour registered" — equivalent to F11.1's static-wiggle path.
 *
 * `spawnIndex` is the 0-based, monotonic order in which `spawnFish` was
 * called for the owning world. Stable across two worlds built from the
 * same seed + same `SpawnOpts` sequence — used as the key for `tickPrng`
 * draws so the per-tick RNG stream is reproducible across cold restarts
 * (bitECS allocates entity ids from a module-global cursor, so the raw
 * eid is NOT stable across two cold worlds in the same process).
 */
export const BehaviorParamsRef = defineComponent({
  handleIdx: Types.ui16,
  spawnIndex: Types.ui32,
});

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
  // F11.6 Wave 2 — shrimp + snail share this archetype. Stubby
  // substrate-hugging silhouette with antennae instead of fins; the
  // renderer suppresses the carangiform tail-beat for crawler-tagged
  // entities and the kinematic system caps their vertical velocity so
  // they stay glued to the substrate.
  CRAWLER: 6,
} as const;

export type FishArchetypeId = (typeof FISH_ARCHETYPE)[keyof typeof FISH_ARCHETYPE];

/**
 * Coarse behavior modes. F11.1 spawned every entity in `FORAGE`; F11.3 flips
 * into `REFUGE` (FearSystem — fleeing toward a hardscape cover anchor) or
 * `PURSUE` (NippingSystem / TerritorialSystem — brief chase override).
 */
export const BEHAVIOR_MODE = {
  FORAGE: 0,
  REFUGE: 1,
  PURSUE: 2,
} as const;

export type BehaviorModeId = (typeof BEHAVIOR_MODE)[keyof typeof BEHAVIOR_MODE];

/**
 * Sentinel stored in `Territory.anchorEid` / `FearState.refugeEid` to mean
 * "no anchor / no refuge". bitECS allocates entity ids starting at 0, so a
 * zero would collide with a legitimately-picked entity — we use the max
 * ui32 value instead. Pick is the same as `0xffffffff >>> 0`; the typed-
 * array slab is `Types.ui32` so the value round-trips losslessly.
 */
export const NO_ENTITY_REF = 0xffffffff;

/**
 * Territorial anchor + fatigue state (F11.3 TerritorialSystem).
 *
 * Attached to every fish whose `ResolvedBehavior.territory !== null`. The
 * anchor is auto-assigned at spawn time: the nearest hardscape entity within
 * `2 * coreRadius` of the spawn position. If no hardscape is in range,
 * `anchorEid = NO_ENTITY_REF` and TerritorialSystem skips the fish.
 *
 * Fatigue accumulates while the fish is actively chasing (Adams 2001 +
 * Brown 1964 — territorial defense is metabolically expensive and aggression
 * fades over 5–15 seconds of sustained contest). The `fatigueScale =
 * exp(-fatigue * 0.3)` multiplier on chase magnitude implements the decay.
 */
export const Territory = defineComponent({
  /** bitECS entity id of the defended hardscape entity. `NO_ENTITY_REF` = none. */
  anchorEid: Types.ui32,
  /** Accumulated chase fatigue. Recovers when not chasing. */
  fatigue: Types.f32,
});

/**
 * Per-entity nipping drive (F11.3 NippingSystem).
 *
 * Attached to fish whose `ResolvedBehavior.nipping !== null` (tiger barbs,
 * rosy barbs). `cooldownSec` ticks down after each nip attempt — while
 * positive, the system skips the fish so successive darts don't chain
 * back-to-back.
 */
export const NippingDrive = defineComponent({
  /** Seconds remaining before the next nip attempt is allowed. */
  cooldownSec: Types.f32,
});

/**
 * Anti-predator / fear state (F11.3 FearSystem).
 *
 * Attached to *every* fish — `ResolvedBehavior.fear` is required, not
 * optional, so every entity carries an integrated risk level. `risk` decays
 * exponentially each tick (half-life ~1.4 s) so old startles don't echo
 * forever; once `risk > params.threshold` the mode flips to REFUGE and the
 * fish steers toward `refugeEid`'s position.
 *
 * `emergenceTimer` counts down only once risk has dropped below threshold —
 * while above threshold, FearSystem resets the timer to `params.emergenceDelay`
 * each tick. The fish flips back to FORAGE only after the timer reaches 0.
 */
export const FearState = defineComponent({
  /** Integrated risk level. Decays each tick via `exp(-decayRate * dt)`. */
  risk: Types.f32,
  /** bitECS entity id of the target hardscape when in REFUGE. `NO_ENTITY_REF` = none. */
  refugeEid: Types.ui32,
  /** Seconds remaining until FORAGE re-engages after risk drops. */
  emergenceTimer: Types.f32,
});

/**
 * Tag for hardscape entities (rocks, wood, plants — anything fish navigate
 * around or hide behind). Lives in the same bitECS world as the fish but on
 * a separate query. Populated by `world.registerHardscape(...)` and torn
 * down on the next call. `coverScore` ∈ [0, 1] gates which hardscape entries
 * are usable refuges; `category` matches `HARDSCAPE_CATEGORY.*` so
 * FearSystem can honour species `coverPreference`.
 *
 * F11.4 — `algaeScore ∈ [0, 1]` is the per-hardscape algae stock that
 * algae-grazer fish (otos, plecos) rasp down. The score regenerates over
 * sim-time (see `FeedingSystem` regrowth rate). Initialised by
 * `registerHardscape`: rocks + wood start at 1.0 (algae naturally grows on
 * porous surfaces); plant + other start at 0.0 (no algae on synthetic decor
 * or live plants — those are handled by the plant-eater branch).
 * F11.3 hardscape.spec.ts is binary-compatible — adding fields to a bitECS
 * `defineComponent` only widens the SoA struct; existing slabs keep their
 * shape and existing tests pass without modification.
 */
export const Hardscape = defineComponent({
  coverScore: Types.f32,
  category: Types.ui8,
  algaeScore: Types.f32,
});

/**
 * Tag for predator fish (fidelity pass). A predator is an ordinary fish
 * entity — it lives in the same `Position` / `Velocity` / `Archetype` slabs
 * and is drawn like any other fish — but FearSystem treats it as a roaming
 * RISK SOURCE: prey within `PREDATOR_FEAR_RADIUS_MM` accumulate risk
 * proportional to proximity, which drives the existing fear → refuge →
 * startle-wave pipeline. Predators don't fear other predators (or
 * themselves). Set via `spawnFish({ predator: true })`; the
 * `LivestockSimulationService` flags it from the catalog row's `predator`.
 *
 * Because a predator is just a tagged fish (no new snapshot slab), the
 * `WorldSnapshot` shape is unchanged and the byte-identical replay holds.
 */
export const Predator = defineComponent();

/**
 * Tag for the single player-controlled fish (Stage 16 F16.1 — game modes).
 *
 * A player fish is an ordinary fish entity (same Position / Velocity /
 * Orientation / Archetype slabs, same snapshot slot) but its velocity is
 * INJECTED from live input each tick instead of being produced by the AI
 * steering integrator. The world's `step()` writes the injected velocity
 * onto the player's `Velocity` BEFORE the systems run, and `SteeringIntegrator`
 * skips any `Player`-tagged entity so the AI behaviour forces never overwrite
 * the player's input. KinematicSystem then integrates the injected velocity
 * exactly like any other fish, and the AABB clamp keeps the player in the tank.
 *
 * DETERMINISM BOUNDARY (load-bearing): this is the ONE place a live,
 * non-deterministic signal (keyboard / gamepad input) enters the otherwise
 * byte-identical world. The player ENTITY is spawned deterministically (same
 * seed → same spawn); only the per-tick injected velocity is live. A world
 * with NO player marked never touches the injection path, so the 1000-tick
 * replay stays byte-identical for non-game worlds. See
 * `docs/caveats/livestock-ecs.md` → "Player-control seam".
 */
export const Player = defineComponent();

/**
 * Per-fish body colour (fidelity pass — enhancement). Linear-ish RGB in
 * `[0, 1]`, set at spawn from the catalog row's display colour
 * (`spawnFish({ colorRgb })`). Surfaced in `WorldSnapshot.color` so the
 * renderer can drive a per-instance colour attribute — previously every fish
 * of an archetype shared ONE body colour, so a neon tetra and a cardinal
 * tetra (both SLIM_TETRA) were indistinguishable. Static per fish → the
 * byte-identical replay holds.
 */
export const BodyColor = defineComponent({ r: Types.f32, g: Types.f32, b: Types.f32 });

/**
 * Hardscape category enum. Mirrors the catalog's `HardscapeEntry.category`
 * (wood/rock/plant/other); the loader maps catalog rows to these integers
 * before calling `world.registerHardscape`.
 */
export const HARDSCAPE_CATEGORY = {
  WOOD: 0,
  ROCK: 1,
  PLANT: 2,
  OTHER: 3,
} as const;

export type HardscapeCategoryId =
  (typeof HARDSCAPE_CATEGORY)[keyof typeof HARDSCAPE_CATEGORY];

/**
 * Per-fish hunger state (F11.4 FeedingSystem).
 *
 * `hunger` integrates from `FeedingParams.hungerRatePerSec` each tick.
 * Once it exceeds `FeedingParams.threshold` the fish seeks food per its
 * category (food sprite / algae / detritus). `lastFedAt` is the
 * `world.tickCounter * SIM_DT` timestamp at the last satisfaction event;
 * test + diagnostics surface, not consulted by the system itself.
 */
export const FeedingDrive = defineComponent({
  /** Hunger accumulator in `[0, ∞)`. Crosses `threshold` → seek food. */
  hunger: Types.f32,
  /** Sim-time seconds at the last satisfaction event. */
  lastFedAt: Types.f32,
});

/**
 * Sentinel stored in `Curiosity.interestX` when no interest point is
 * active. We use a large negative number (well outside any tank's
 * canonical mm bounds) so the check is a single < comparison instead of a
 * NaN-aware predicate. `Number.NaN` would also work but typed-array NaN
 * round-tripping has odd corner cases (`f32` payload truncation, signed-
 * NaN vs. quiet-NaN) — `-1e30` is unambiguous and stable across engines.
 */
export const NO_INTEREST = -1e30;

/**
 * Per-fish curiosity / glass-surfing state (F11.4 CuriositySystem).
 *
 * The fish drifts toward `(interestX, interestY, interestZ)` while
 * `dwellRemaining > 0`. When the dwell timer hits 0 the interest point
 * is cleared via the `NO_INTEREST` sentinel; on each subsequent tick a
 * Poisson draw (gated by `boldness`) may re-arm it at the front pane
 * glass for another `dwellSec`.
 */
export const Curiosity = defineComponent({
  /** Current attraction point in mm. `NO_INTEREST` sentinel = inactive. */
  interestX: Types.f32,
  interestY: Types.f32,
  interestZ: Types.f32,
  /** Seconds remaining on the current interest dwell. 0 = inactive. */
  dwellRemaining: Types.f32,
});

/**
 * Physical form of a food sprite (Stage 14 F14.1). Mirrors the catalog's
 * `FoodEntry.type` ('flake' | 'pellet' | 'wafer' | 'live'); the host maps
 * the string form to one of these integers before calling `spawnFoodSprite`.
 * Drives the per-type sink kinematics in `foodSpriteKinematicSystem` and the
 * band-matching in `feedingSystem` (surface feeders prefer drifting flakes,
 * substrate feeders prefer settled wafers).
 *
 * Stored as a `ui8` on the FoodSprite slab so the renderer can branch a
 * per-sprite billboard size/colour from a flat lookup WITHOUT a new vertex
 * attribute — the livestock fish program sits at the 16-attribute ANGLE
 * ceiling, but food sprites are a SEPARATE billboard mesh, so packing food
 * type into the snapshot's existing sprite slab is free of that budget.
 */
export const FOOD_TYPE = {
  FLAKE: 0,
  PELLET: 1,
  WAFER: 2,
  LIVE: 3,
} as const;

export type FoodTypeId = (typeof FOOD_TYPE)[keyof typeof FOOD_TYPE];

/**
 * Tag component — entity is a food sprite, not a fish or a hardscape.
 * Food sprites are spawned by `world.spawnFoodSprite`; FeedingSystem
 * picks them up as targets for surface / midwater / substrate feeders.
 * `lifetime` decrements each tick (FoodSpriteLifetimeSystem); when it
 * reaches 0 the sprite despawns.
 *
 * F14.1 adds typed-food fields:
 *   - `foodType` is a `FOOD_TYPE.*` code driving the per-type sink model.
 *   - `vy` is the sprite's current vertical velocity (mm/s), integrated by
 *     `foodSpriteKinematicSystem` each tick. Initialised per type at spawn
 *     (flakes start with a brief positive float, pellets a fast sink, …).
 *   - `floatRemaining` counts down the seconds a flake stays buoyant before
 *     it transitions from floating to slow-sinking. Zero for non-flakes.
 *   - `spawnIndex` is the monotonic 0-based order the sprite was spawned in
 *     (a separate counter from the fish spawnIndex). It's the STABLE
 *     `tickPrng` key for the live-food erratic dart AND the cross-world
 *     stable sort key for the snapshot's food slab — bitECS eids come from a
 *     module-global cursor, so raw query order would break byte-identical
 *     replay (same fix the fish slab uses with `BehaviorParamsRef.spawnIndex`
 *     and the bubble slab uses with `(sourceEid, spawnSeq)`).
 */
export const FoodSprite = defineComponent({
  /** Seconds remaining before the sprite auto-despawns. */
  lifetime: Types.f32,
  /** Satiation contribution per nibble. Decremented as the fish feeds. */
  calories: Types.f32,
  /** Physical form — `FOOD_TYPE.*`. Drives sink kinematics + band-matching. */
  foodType: Types.ui8,
  /** Current vertical velocity in mm/s (signed; negative = sinking). */
  vy: Types.f32,
  /** Seconds a flake stays buoyant before transitioning to slow sink. */
  floatRemaining: Types.f32,
  /** Monotonic 0-based spawn order — stable tickPrng key + snapshot sort key. */
  spawnIndex: Types.ui32,
});

/**
 * Tag component — entity is a rising air-stone bubble (Stage 11 F11.5
 * Wave 5).
 *
 * Spawned by `bubbleSourceSpawnSystem` at the registered air-stone position
 * (with small per-spawn jitter from `tickPrng`); advected upward each tick
 * by `bubbleLifetimeSystem` at a fixed `velocityY` mm/sec. Despawned when
 * the bubble crosses the waterline (`tankAabb.maxY - BUBBLE_WATERLINE_INSET_MM`)
 * OR its `lifetimeSec` reaches 0 — whichever fires first.
 *
 * Note: this is the **particle-only simplification** of the plan's
 * `BubbleStableFluids2D` advect/diffuse/project loop. The fluid-sim lib
 * still ships `BubbleStableFluids2D` for future fidelity passes; F11.5
 * ships particles because they're deterministic, allocation-free in the
 * hot loop, and render-cheap (one InstancedMesh, billboards).
 *
 * The renderer (parallel agent's `livestock-renderer-3d/`) reads
 * `WorldSnapshot.bubbleCount + bubblePosition` to drive an InstancedMesh
 * billboard count + per-instance translate attribute.
 */
export const BubbleParticle = defineComponent({
  /** Rise speed in mm/sec. Typically ~150 (gentle air-stone column). */
  velocityY: Types.f32,
  /** Seconds remaining before auto-despawn (independent of waterline cap). */
  lifetimeSec: Types.f32,
  /**
   * Source index (0-based into the registered bubble sources). Surfaces
   * for tests + diagnostics — the system itself doesn't read it after
   * spawn, but a future per-source colour/scale variation would.
   */
  sourceEid: Types.ui32,
  /**
   * Per-source monotonic spawn sequence at spawn time. Combined with
   * `sourceEid` it forms a stable cross-world sort key for the bubble
   * snapshot slab — bitECS allocates eids from a module-global cursor, so
   * two cold worlds get different eid ranges and the raw query order
   * would silently break byte-identical determinism replay. `snapshot()`
   * uses `(sourceEid, spawnSeq)` lexicographic ordering to neutralise
   * that. Mirrors the same fix the fish snapshot uses with
   * `BehaviorParamsRef.spawnIndex`.
   */
  spawnSeq: Types.ui32,
});
