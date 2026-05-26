// Tests for the tankAabb plumbing on `createLivestockWorld`. The AABB is
// load-bearing for DepthSystem (height scaling), SteeringIntegrator (wall
// projection), and KinematicSystem (defensive clamp). Mutation via
// `setTankAabb` must take effect on the next tick so the
// LivestockSimulationService can resize the tank without rebuilding the
// world.

import { MID_PRESET } from '@aquascape/domain/livestock-behaviors';
import { FISH_ARCHETYPE, Position } from './components';
import { createLivestockWorld, SIM_DT, type TankAabb } from './world';

const BIG: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };
const SMALL: TankAabb = { minX: 0, maxX: 200, minY: 0, maxY: 100, minZ: 0, maxZ: 100 };

describe('tankAabb', () => {
  it('defaults to a sensible interior when opts omitted', () => {
    const w = createLivestockWorld(0);
    expect(w.tankAabb.maxX).toBeGreaterThan(0);
    expect(w.tankAabb.maxY).toBeGreaterThan(0);
    expect(w.tankAabb.maxZ).toBeGreaterThan(0);
  });

  it('takes opts.tankAabb when supplied', () => {
    const w = createLivestockWorld(0, { tankAabb: BIG });
    expect(w.tankAabb).toEqual(BIG);
  });

  it('setTankAabb updates the bound; next-tick depth reads use it', () => {
    // Start with a big tank so MID_PRESET targets y ≈ 0.55 * 400 = 220.
    const w = createLivestockWorld(0, { tankAabb: BIG });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 220, z: 200 },
      behaviorHandleIdx: handle,
    });
    // Warm-up — settles at ~220mm (within band).
    for (let t = 0; t < 100; t++) w.step(SIM_DT);
    // Switch to SMALL tank → target y is now 0.55 * 100 = 55 mm.
    w.setTankAabb(SMALL);
    // Run another 200 ticks; mean Y should be inside the new band.
    let sum = 0;
    for (let t = 0; t < 200; t++) {
      w.step(SIM_DT);
      sum += Position.y[eid] as number;
    }
    const meanY = sum / 200;
    const target = MID_PRESET.depth.preferredY * (SMALL.maxY - SMALL.minY);
    const tol = MID_PRESET.depth.bandWidth * (SMALL.maxY - SMALL.minY) + 5;
    expect(Math.abs(meanY - target)).toBeLessThanOrEqual(tol);
  });

  it('clamps Position when an entity is outside a freshly-shrunk AABB', () => {
    const w = createLivestockWorld(0, { tankAabb: BIG });
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 800, y: 350, z: 350 },
    });
    // Shrink — fish is now well outside SMALL.
    w.setTankAabb(SMALL);
    w.step(SIM_DT);
    expect(Position.x[eid]).toBeLessThanOrEqual(SMALL.maxX);
    expect(Position.y[eid]).toBeLessThanOrEqual(SMALL.maxY);
    expect(Position.z[eid]).toBeLessThanOrEqual(SMALL.maxZ);
  });

  it('setTankAabb defensively copies — caller mutations don\'t leak', () => {
    const w = createLivestockWorld(0);
    const aabb = { ...BIG };
    w.setTankAabb(aabb);
    aabb.maxX = 1; // mutate caller's copy
    expect(w.tankAabb.maxX).toBe(BIG.maxX);
  });
});
