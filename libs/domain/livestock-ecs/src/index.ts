// Public API for @aquascape/domain/livestock-ecs.
//
// bitECS-backed Entity-Component-System world powering animated fish + shrimp
// + snail behaviour (Plan Stage 11 F11.1).
//
// F11.1 ships the foundation: components, world factory, Kinematic + Animation
// systems, fixed-dt scheduler, deterministic per-tick PRNG, and the spatial
// grid scaffold reserved for F11.2's schooling system. Fish wiggle in place
// at fixed positions — no schooling, no steering yet.
//
// DEPENDENCY BUDGET
// -----------------
// Pure TS. Allowed runtime deps: `bitecs` + `@aquascape/domain/geometry`.
// NO Angular, NgRx, RxJS, DOM, Electron, Three.js. The `framework:none`
// Nx tag enforces this (see workspace `eslint.config.cjs`). Additionally,
// `Math.random()` is forbidden here — use `tickPrng()` instead. Lint guard
// lives in this lib's local `eslint.config.cjs`.

// ─── Components (bitECS SoA slabs) ────────────────────────────────────────
export {
  Position,
  Velocity,
  Orientation,
  SpeciesId,
  BodyLength,
  Archetype,
  AnimationPhase,
  BehaviorMode,
  BehaviorParamsRef,
  BubbleParticle,
  Curiosity,
  FeedingDrive,
  HealthDrive,
  FoodSprite,
  BodyColor,
  Force,
  FearState,
  Hardscape,
  NippingDrive,
  Player,
  Predator,
  Territory,
  FISH_ARCHETYPE,
  BEHAVIOR_MODE,
  FOOD_TYPE,
  HARDSCAPE_CATEGORY,
  NO_ENTITY_REF,
  NO_INTEREST,
  type FishArchetypeId,
  type BehaviorModeId,
  type FoodTypeId,
  type HardscapeCategoryId,
} from './lib/components';

// ─── World factory + scheduler ────────────────────────────────────────────
export {
  createLivestockWorld,
  DEFAULT_FOOD_WASTE_FACTOR,
  SIM_DT,
  SIM_HZ,
  type BubbleSourceRegistration,
  type BubbleSourceStore,
  type CreateLivestockWorldOpts,
  type HardscapeRegistrationEntry,
  type LivestockWorld,
  type LivestockWorldInternals,
  type SpawnOpts,
  type TankAabb,
  type WaterQuality,
  type WorldSnapshot,
} from './lib/world';

// ─── Per-species behaviour table (F11.2) ──────────────────────────────────
export { ParamStore, NO_BEHAVIOR_HANDLE } from './lib/param-store';

// ─── Systems (exported for renderer / tests; normally run via world.step) ──
export {
  algaeGrowthSystem,
  animationSystem,
  collisionSystem,
  curiositySystem,
  depthSystem,
  fearSystem,
  feedingSystem,
  flowFieldSystem,
  foodSpriteKinematicSystem,
  foodSpriteLifetimeSystem,
  kinematicSystem,
  nippingSystem,
  perceptionSystem,
  schoolingSystem,
  steeringIntegrator,
  territorialSystem,
  vitalitySystem,
} from './lib/systems';

// ─── Per-type algae growth (Stage 13 F13.6) ───────────────────────────────
export {
  ALGAE_TYPE_FIELDS,
  DEFAULT_PHOTOPERIOD_HOURS,
  DEFAULT_ALGAE_SCALE,
  FLOW_NORMALISE_MM_PER_S,
  type AlgaeFieldKey,
  type AlgaeProfileScale,
} from './lib/algae-growth-system';

// ─── Vitality + waste (Stage 14 F14.2 + F14.4) ────────────────────────────
export {
  VITALITY_KEY,
  STARVE_HUNGER_THRESHOLD,
  STARVE_HEALTH_DECAY_PER_SEC,
  WATER_SAFE_AMMONIA_MG_L,
  WATER_SAFE_NITRITE_MG_L,
  AMMONIA_HEALTH_DECAY_PER_MG_PER_SEC,
  NITRITE_HEALTH_DECAY_PER_MG_PER_SEC,
  HEALTH_RECOVERY_PER_SEC,
} from './lib/vitality-system';
export {
  FISH_BASELINE_WASTE_N_MG_PER_DAY,
  UNEATEN_FOOD_WASTE_N_MG_PER_CALORIE,
  WASTE_RATE_EMA_PER_SEC,
  recordUneatenFood,
  wasteSystem,
  type WasteAccumulator,
} from './lib/waste-accumulator';

// ─── Bubble particles (F11.5 Wave 5) ──────────────────────────────────────
export {
  BUBBLE_DEFAULT_LIFETIME_SEC,
  BUBBLE_DEFAULT_VELOCITY_Y_MM_PER_S,
  BUBBLE_GLOBAL_CAP_COUNT,
  BUBBLE_HORIZONTAL_JITTER_MM,
  BUBBLE_SCALE,
  BUBBLE_WATERLINE_INSET_MM,
  bubbleLifetimeSystem,
  bubbleSourceSpawnSystem,
} from './lib/bubble-system';

// ─── Bubble fluid coupling (bubble fluid fidelity pass) ───────────────────
export {
  BUBBLE_FLUID_GRID,
  BUBBLE_FLUID_HALF_WIDTH_MM,
  bubbleFluidStepSystem,
  rebuildBubbleFluid,
  sampleBubbleFluid,
  type BubbleFluidState,
} from './lib/bubble-fluid';

// ─── Typed food sink kinematics (Stage 14 F14.1) ──────────────────────────
export {
  FLAKE_FLOAT_SECONDS,
  FLAKE_FLOAT_VY_MM_PER_S,
  FLAKE_SINK_VY_MM_PER_S,
  PELLET_SINK_VY_MM_PER_S,
  WAFER_SINK_VY_MM_PER_S,
  LIVE_DRIFT_VY_MM_PER_S,
  initialFoodKinematics,
} from './lib/food-kinematics';

// ─── Deterministic PRNG ──────────────────────────────────────────────────
export { tickPrng } from './lib/prng';

// ─── Spatial broad-phase (F11.2 schooling reserves this) ─────────────────
export { SpatialGrid } from './lib/spatial-grid';
