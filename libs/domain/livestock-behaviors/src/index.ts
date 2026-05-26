// Public API for @aquascape/domain/livestock-behaviors.
//
// Behaviour-parameter types, per-group presets, and the resolveBehavior()
// catalog resolver for animated livestock (Plan Stage 11 F11.2 — schooling +
// vertical stratification).
//
// DEPENDENCY BUDGET
// -----------------
// Pure TS. NO Angular, NgRx, RxJS, DOM, Electron, Three.js, bitecs, catalog.
// Catalog imports US (single source of truth for the param types); the edge
// runs catalog → behaviors, never the reverse.

export type {
  AnimationParams,
  DepthBand,
  DepthParams,
  ResolvedBehavior,
  SchoolingParams,
} from './lib/params';

export { BOTTOM_PRESET, MID_PRESET, TOP_PRESET } from './lib/presets';

export {
  depthBandForSpecies,
  resolveBehavior,
  type BehaviorResolutionInput,
} from './lib/resolve';
