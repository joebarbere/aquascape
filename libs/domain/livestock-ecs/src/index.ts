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
  Curiosity,
  FeedingDrive,
  FoodSprite,
  Force,
  FearState,
  Hardscape,
  NippingDrive,
  Territory,
  FISH_ARCHETYPE,
  BEHAVIOR_MODE,
  HARDSCAPE_CATEGORY,
  NO_INTEREST,
  type FishArchetypeId,
  type BehaviorModeId,
  type HardscapeCategoryId,
} from './lib/components';

// ─── World factory + scheduler ────────────────────────────────────────────
export {
  createLivestockWorld,
  SIM_DT,
  SIM_HZ,
  type CreateLivestockWorldOpts,
  type HardscapeRegistrationEntry,
  type LivestockWorld,
  type LivestockWorldInternals,
  type SpawnOpts,
  type TankAabb,
  type WorldSnapshot,
} from './lib/world';

// ─── Per-species behaviour table (F11.2) ──────────────────────────────────
export { ParamStore, NO_BEHAVIOR_HANDLE } from './lib/param-store';

// ─── Systems (exported for renderer / tests; normally run via world.step) ──
export {
  animationSystem,
  curiositySystem,
  depthSystem,
  fearSystem,
  feedingSystem,
  foodSpriteLifetimeSystem,
  kinematicSystem,
  nippingSystem,
  perceptionSystem,
  schoolingSystem,
  steeringIntegrator,
  territorialSystem,
} from './lib/systems';

// ─── Deterministic PRNG ──────────────────────────────────────────────────
export { tickPrng } from './lib/prng';

// ─── Spatial broad-phase (F11.2 schooling reserves this) ─────────────────
export { SpatialGrid } from './lib/spatial-grid';
