/**
 * Per-tick ECS systems (Stage 11 F11.1 + F11.2).
 *
 * This module hosts the two terminal systems — `kinematicSystem` and
 * `animationSystem` — that every behaviour pipeline must end with. F11.2
 * added four behaviour systems (Perception, Schooling, Depth, Steering)
 * which live in their own files and are re-exported below so the public
 * surface stays a single `./lib/systems` import path.
 *
 * F11.1 leaves Velocity at zero on every entity; F11.2 starts populating
 * it via `SteeringIntegrator`. KinematicSystem still just integrates
 * `Position += Velocity * dt` — the only change is that Velocity is now
 * typically non-zero by the time we run.
 */
import { defineQuery, hasComponent, type IWorld } from 'bitecs';
import { AnimationPhase, Archetype, FISH_ARCHETYPE, Position, Velocity } from './components';

export { perceptionSystem } from './perception-system';
export { schoolingSystem } from './schooling-system';
export { depthSystem } from './depth-system';
export { steeringIntegrator } from './steering-integrator';
export { fearSystem } from './fear-system';
export { nippingSystem } from './nipping-system';
export { territorialSystem } from './territorial-system';
export { feedingSystem, foodSpriteLifetimeSystem } from './feeding-system';
export { foodSpriteKinematicSystem } from './food-kinematics';
export { curiositySystem } from './curiosity-system';
export { flowFieldSystem } from './flow-field-system';
export { collisionSystem } from './collision-system';

const TWO_PI = Math.PI * 2;

const kinematicQuery = defineQuery([Position, Velocity]);
const animationQuery = defineQuery([AnimationPhase]);

/**
 * Maximum vertical velocity for crawler-archetype entities (mm/sec).
 * F11.6 Wave 2 — shrimp + snail are substrate-glued. Without this cap a
 * fear-startled crawler can pick up a noticeable schooling-noise Y
 * impulse and momentarily lift off; clamping at the integrator keeps the
 * substrate-hugging silhouette stable without needing a dedicated
 * crawler kinematic model. The downward direction is left unclamped so
 * gravity-like drift toward the substrate (DepthSystem pulling
 * preferredY=0.05) keeps working at full strength.
 */
const CRAWLER_MAX_VY_MM_PER_SEC = 5;

/**
 * Integrate `Position += Velocity * dt`. F11.1 left Velocity at zero so
 * this was effectively a no-op; F11.2 starts populating Velocity via
 * `SteeringIntegrator`, but the per-tick math is unchanged. Post-step
 * AABB clamping lives in `world.ts` (`clampPositionToAabb`) so the
 * kinematic loop itself stays minimal — three multiplies + adds per
 * entity per tick.
 *
 * Crawler special-case (F11.6 Wave 2): for entities tagged with
 * `Archetype === FISH_ARCHETYPE.CRAWLER`, clamp `|Velocity.y|` to
 * `CRAWLER_MAX_VY_MM_PER_SEC` before integrating. The cap is applied
 * symmetrically (upper + lower bound) so both an upward startle impulse
 * and an overshooting downward correction stay bounded. This is the
 * minimal substrate-glue heuristic — true SDF-gradient surface
 * conforming locomotion for snails crawling along rock faces is a
 * future-work item (see `plans/stage-11-animated-livestock.md` F11.6).
 */
export function kinematicSystem(world: IWorld, dt: number): void {
  // `for...of` narrows the element to `number` (vs. `for (let i…)` indexing
  // which, with `noUncheckedIndexedAccess`, yields `number | undefined`).
  for (const eid of kinematicQuery(world)) {
    // Crawler Y-velocity clamp — applied in place before integration so
    // the clamped value is also what subsequent ticks see.
    if (hasComponent(world, Archetype, eid) && Archetype.id[eid] === FISH_ARCHETYPE.CRAWLER) {
      const vy = Velocity.y[eid] as number;
      if (vy > CRAWLER_MAX_VY_MM_PER_SEC) {
        Velocity.y[eid] = CRAWLER_MAX_VY_MM_PER_SEC;
      } else if (vy < -CRAWLER_MAX_VY_MM_PER_SEC) {
        Velocity.y[eid] = -CRAWLER_MAX_VY_MM_PER_SEC;
      }
    }
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
