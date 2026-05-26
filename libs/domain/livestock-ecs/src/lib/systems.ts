/**
 * Per-tick ECS systems (Stage 11 F11.1).
 *
 * F11.1 ships only Kinematic + Animation. Schooling, depth preference,
 * territory, nipping, fear, feeding, curiosity, flow-field sampling, steering
 * integration, and collision all arrive in F11.2–F11.5 and slot in *before*
 * Kinematic (so they accumulate steering force into `Velocity`; Kinematic
 * commits that to `Position`).
 */
import { defineQuery, type IWorld } from 'bitecs';
import { AnimationPhase, Position, Velocity } from './components';

const TWO_PI = Math.PI * 2;

const kinematicQuery = defineQuery([Position, Velocity]);
const animationQuery = defineQuery([AnimationPhase]);

/**
 * Integrate `Position += Velocity * dt`. F11.1 leaves Velocity at zero on
 * every entity (no steering systems run yet), so this is effectively a no-op
 * for the foundation substage. We still run it — and test it — so the loop
 * pattern is locked before F11.4 starts writing into `Velocity`.
 */
export function kinematicSystem(world: IWorld, dt: number): void {
  // `for...of` narrows the element to `number` (vs. `for (let i…)` indexing
  // which, with `noUncheckedIndexedAccess`, yields `number | undefined`).
  for (const eid of kinematicQuery(world)) {
    Position.x[eid] = (Position.x[eid] as number) + (Velocity.x[eid] as number) * dt;
    Position.y[eid] = (Position.y[eid] as number) + (Velocity.y[eid] as number) * dt;
    Position.z[eid] = (Position.z[eid] as number) + (Velocity.z[eid] as number) * dt;
  }
}

/**
 * Advance the tail-beat phase by `freq * 2π * dt` radians per entity and
 * wrap into `[0, 2π)`. The renderer's vertex shader consumes this scalar to
 * drive the carangiform sine-spine deformation (Gates 2001, Liu & Hu 2010);
 * we deliberately do NOT apply vertex displacement here — that's a GPU job.
 *
 * Wrapping uses a modulo so phase never grows unbounded over long runs.
 * `((phase % 2π) + 2π) % 2π` handles negative inputs defensively even though
 * F11.1 only advances forward.
 */
export function animationSystem(world: IWorld, dt: number): void {
  for (const eid of animationQuery(world)) {
    const phase = AnimationPhase.phase[eid] as number;
    const freq = AnimationPhase.freq[eid] as number;
    const next = phase + freq * TWO_PI * dt;
    AnimationPhase.phase[eid] = ((next % TWO_PI) + TWO_PI) % TWO_PI;
  }
}
