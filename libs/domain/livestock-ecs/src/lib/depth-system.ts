/**
 * DepthSystem (Stage 11 F11.2).
 *
 * Vertical stratification — hatchetfish hug the surface, cories scoot along
 * the substrate, tetras cruise the middle. Each species' `DepthParams` is a
 * soft restoring well: outside `bandWidth * tankHeight` of `preferredY *
 * tankHeight`, a constant returnForce pulls the fish back toward the band;
 * inside the band, only a small deterministic noise term applies (so fish
 * don't all collapse onto a flat plane).
 *
 * The band is centred on `preferredY` (a fraction of tank height, 0 = floor,
 * 1 = waterline) rather than an absolute mm value so the same DepthParams
 * preset reads sensibly across any tank height — the resolveBehavior layer
 * doesn't need a tank-dimension to pick the right preset.
 */
import { defineQuery } from 'bitecs';
import { BehaviorParamsRef, Force, Position } from './components';
import { tickPrng } from './prng';
import type { LivestockWorld } from './world';

const depthQuery = defineQuery([Position, BehaviorParamsRef, Force]);

/** Multiplier on `returnForce` for the in-band noise term. */
const IN_BAND_NOISE_FRACTION = 0.1;

export function depthSystem(world: LivestockWorld, _dt: number): void {
  const aabb = world.tankAabb;
  const tankHeight = aabb.maxY - aabb.minY;
  // Tank with no vertical extent (degenerate) → DepthSystem has nothing
  // to do. The clamp in KinematicSystem will hold every fish at y=minY.
  if (tankHeight <= 0) return;

  const store = world.paramStore;

  for (const eid of depthQuery(world.ecs)) {
    const handle = BehaviorParamsRef.handleIdx[eid] as number;
    const behavior = store.get(handle);
    if (behavior === null) continue;
    const params = behavior.depth;

    // `preferredY` is a tank-height fraction; map into absolute Y with
    // the world's current AABB so a setTankAabb() during the doc's life
    // refocuses every fish's band.
    const targetY = aabb.minY + params.preferredY * tankHeight;
    const bandHalf = params.bandWidth * tankHeight;
    const offset = (Position.y[eid] as number) - targetY;

    if (Math.abs(offset) > bandHalf) {
      // Outside the band — restoring force toward the band. Sign opposes
      // the offset: too-high fish gets a negative Y push, too-low fish a
      // positive Y push.
      const dir = offset > 0 ? -1 : 1;
      Force.y[eid] = (Force.y[eid] as number) + dir * params.returnForce;
    } else {
      // Inside the band — tiny deterministic noise so fish don't
      // homogenise onto y = preferredY * tankHeight. Symmetric around 0
      // so the in-band noise doesn't bias the band centre. Use
      // `spawnIndex` (stable across cold worlds) rather than the bitECS
      // eid (module-global, not cross-world stable).
      const idx = BehaviorParamsRef.spawnIndex[eid] as number;
      const r = tickPrng(world, idx, 2);
      Force.y[eid] = (Force.y[eid] as number) + (r - 0.5) * 2 * IN_BAND_NOISE_FRACTION * params.returnForce;
    }
  }
}
