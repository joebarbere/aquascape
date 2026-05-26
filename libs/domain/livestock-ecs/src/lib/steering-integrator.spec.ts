import { MID_PRESET } from '@aquascape/domain/livestock-behaviors';
import { FISH_ARCHETYPE, Force, Orientation, Velocity } from './components';
import { steeringIntegrator } from './steering-integrator';
import { createLivestockWorld, SIM_DT, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

function spawn(
  world: ReturnType<typeof createLivestockWorld>,
  pos: { x: number; y: number; z: number },
  handle?: number,
) {
  return world.spawnFish({
    archetype: FISH_ARCHETYPE.SLIM_TETRA,
    speciesId: 1,
    bodyLengthMm: 30,
    position: pos,
    behaviorHandleIdx: handle,
  });
}

describe('steeringIntegrator', () => {
  it('integrates Force into Velocity using dt', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    const eid = spawn(w, { x: 500, y: 200, z: 200 }, handle);
    Force.x[eid] = 100;
    steeringIntegrator(w, SIM_DT);
    expect(Velocity.x[eid]).toBeCloseTo(100 * SIM_DT, 5);
  });

  it('resets Force to zero after integration', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    const eid = spawn(w, { x: 500, y: 200, z: 200 }, handle);
    Force.x[eid] = 50;
    Force.y[eid] = -25;
    Force.z[eid] = 10;
    steeringIntegrator(w, SIM_DT);
    expect(Force.x[eid]).toBe(0);
    expect(Force.y[eid]).toBe(0);
    expect(Force.z[eid]).toBe(0);
  });

  it('clamps |Velocity| to vMax over 100 ticks of randomised force inputs', () => {
    // Deterministic per-tick force draws via tickPrng-like indexing — we
    // hand-set Force so we don't tangle with the schooling RNG path.
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    const eids: number[] = [];
    for (let i = 0; i < 20; i++) eids.push(spawn(w, { x: 500, y: 200, z: 200 }, handle));
    const vMax = MID_PRESET.schooling.vMax;
    for (let tick = 0; tick < 100; tick++) {
      // Push every fish with a deterministic huge force — would blow past
      // vMax if the clamp weren't running.
      for (const eid of eids) {
        Force.x[eid] = 10000 * Math.sin(tick + eid);
        Force.y[eid] = 10000 * Math.cos(tick + eid);
        Force.z[eid] = 10000 * Math.sin(tick * 0.5 + eid);
      }
      steeringIntegrator(w, SIM_DT);
      for (const eid of eids) {
        const speed = Math.hypot(
          Velocity.x[eid] as number,
          Velocity.y[eid] as number,
          Velocity.z[eid] as number,
        );
        expect(speed).toBeLessThanOrEqual(vMax + 1e-3);
      }
    }
  });

  it('caps angular change per tick to turnMax * dt', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    const eid = spawn(w, { x: 500, y: 200, z: 200 }, handle);
    // Start the fish swimming +X.
    Velocity.x[eid] = 50;
    Velocity.y[eid] = 0;
    Velocity.z[eid] = 0;
    // Push a HUGE force in the −X direction so the integrator wants to
    // flip the heading 180° in one tick — turnMax should hold the
    // rotation to turnMax * dt.
    Force.x[eid] = -1e6;
    const turnMax = MID_PRESET.schooling.turnMax;
    // Compute the prior forward axis via rotateByQuat([1,0,0], q).
    const qy0 = Orientation.y[eid] as number;
    const qz0 = Orientation.z[eid] as number;
    const fx0 = 1 + 2 * (-(qy0 * qy0) - qz0 * qz0);
    void fx0;
    steeringIntegrator(w, SIM_DT);
    // Forward axis after one tick.
    const qx = Orientation.x[eid] as number;
    const qy = Orientation.y[eid] as number;
    const qz = Orientation.z[eid] as number;
    const qw = Orientation.w[eid] as number;
    const fx1 = 1 + 2 * (-qy * qy - qz * qz);
    const fy1 = 2 * (qz * qw + qx * qy);
    const fz1 = 2 * (qx * qz - qy * qw);
    // Initial forward was +X, so the dot with the new forward is fx1.
    let dot = fx1;
    if (dot > 1) dot = 1;
    if (dot < -1) dot = -1;
    const angleMoved = Math.acos(dot);
    void fy1;
    void fz1;
    expect(angleMoved).toBeLessThanOrEqual(turnMax * SIM_DT + 1e-3);
  });

  it('wall-projects Velocity along the AABB (slides along the glass)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    // Spawn against the +X wall, moving further +X.
    const eid = spawn(w, { x: TANK.maxX - 1, y: 200, z: 200 }, handle);
    Velocity.x[eid] = 100;
    Velocity.y[eid] = 50; // tangent — should survive projection.
    Velocity.z[eid] = 0;
    Force.x[eid] = 0;
    Force.y[eid] = 0;
    Force.z[eid] = 0;
    steeringIntegrator(w, SIM_DT);
    expect(Velocity.x[eid]).toBe(0);
    expect(Velocity.y[eid]).toBeGreaterThan(0); // tangent untouched.
  });
});
