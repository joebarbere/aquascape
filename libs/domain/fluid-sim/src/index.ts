// Public API for @aquascape/domain/fluid-sim.
//
// Fluid + flow primitives for animated livestock + bubble motion (Plan Stage 11
// — F11.5). Three deterministic pieces, all pure functions of their inputs:
//
//   1. FlowField — 32³ divergence-free velocity grid baked once per scene
//      from filter / pump sources. Sampled by the livestock FlowFieldSystem
//      so fish drift on tank current.
//
//   2. BubbleStableFluids2D — 32×32 vertical Stam 1999/2003 stable-fluids
//      slice per air-stone. Driven by external buoyancy forces injected by
//      the renderer's bubble-particle system.
//
//   3. HardscapeSdf — 64³ sphere-union signed-distance field of hardscape
//      geometry. Sampled by the livestock CollisionSystem so fish don't
//      swim through rocks.
//
// DETERMINISM
// -----------
// Every bake is a pure function: same inputs → byte-identical Float32Array
// outputs. No `Math.random`, no `Date.now`, no IEEE-754-order-dependent
// reductions. `stepBubbleSlice` is also pure of its arguments + slice state.
//
// DEPENDENCY BUDGET
// -----------------
// Pure TS + structural types from `domain/geometry` only. NO Angular, NgRx,
// RxJS, DOM, Electron, Three.js, bitecs.

// ─── Common types ─────────────────────────────────────────────────────────
export type { Aabb, Vec3 } from './lib/types';

// ─── FlowField (filter / pump current) ────────────────────────────────────
export type { FlowField, FlowSource, BakeFlowFieldOpts } from './lib/flow-field';
export { bakeFlowField, sampleFlowField } from './lib/flow-field';

// ─── BubbleStableFluids2D (air-stone bubble column) ───────────────────────
export type { BubbleSlice, CreateBubbleSliceOpts } from './lib/bubble-slice';
export { createBubbleSlice, stepBubbleSlice } from './lib/bubble-slice';

// ─── SDF bake (hardscape collision) ───────────────────────────────────────
export type { HardscapeSphere, HardscapeSdf, BakeHardscapeSdfOpts } from './lib/sdf';
export { bakeHardscapeSdf, sampleSdf, sampleSdfGradient } from './lib/sdf';
