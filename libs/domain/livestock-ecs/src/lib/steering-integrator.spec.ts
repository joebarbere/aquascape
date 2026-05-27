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

// ─── F11.7 livestock-movement triage — regression tests ────────────────────
//
// These specs guard the three bug fixes that landed when fish were
// observed swimming straight up / down, in reverse, and outside the tank
// in the 3D view:
//
//   1. Pose-axis convention. The fish geometry's nose is at local X=0 and
//      the tail at local X=1 (see `body-builder.ts`). The integrator must
//      align the **nose** (local -X) with the velocity direction — NOT
//      the tail (local +X) — so fish swim head-first. The original F11.2
//      implementation got this backwards and fish swam tail-first.
//   2. Pitch clamp. Heading vectors with |sin(pitch)| > ~sin(25°) get
//      projected back onto a cone around the XZ plane so vertical
//      DepthSystem return-forces don't pitch the body straight up/down.
//   3. Body-extent wall inset. The wall projection treats the AABB as
//      inset by `bodyLength / 2` on every face, so the rendered body
//      (which extends `bodyLength` from the per-instance Position) can't
//      poke through the glass or the water surface.

/**
 * Forward axis of an entity = `rotateByQuat([-1, 0, 0], q)` — the
 * direction the fish's nose points after the entity's quaternion
 * rotation. This mirrors the helper in `steering-integrator.ts`
 * (intentionally duplicated here so the test pins the convention by
 * derivation, not by importing the impl's helper).
 */
function noseForwardAxis(eid: number): { x: number; y: number; z: number } {
  const qx = Orientation.x[eid] as number;
  const qy = Orientation.y[eid] as number;
  const qz = Orientation.z[eid] as number;
  const qw = Orientation.w[eid] as number;
  return {
    x: -(1 + 2 * (-qy * qy - qz * qz)),
    y: -(2 * (qz * qw + qx * qy)),
    z: -(2 * (qx * qz - qy * qw)),
  };
}

describe('steeringIntegrator — F11.7 pose-axis fix', () => {
  it('aligns local -X (the nose) with horizontal velocity — fish swim head-first', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    const eid = spawn(w, { x: 500, y: 200, z: 200 }, handle);
    // Pure +X velocity, well above the stall threshold + below vMax.
    Velocity.x[eid] = 80;
    Velocity.y[eid] = 0;
    Velocity.z[eid] = 0;
    // Run enough ticks for the bounded-turn-rate slerp to converge. With
    // MID_PRESET.turnMax = 2.0 rad/sec and SIM_DT = 1/30, an initial
    // perpendicular orientation (default identity = nose toward -X)
    // converges in < 30 ticks.
    for (let i = 0; i < 60; i++) {
      steeringIntegrator(w, SIM_DT);
      // Re-seed Velocity each tick (kinematic clamp would otherwise drain
      // it once a wall is hit; we want a pure orientation-vs-heading test).
      Velocity.x[eid] = 80;
      Velocity.y[eid] = 0;
      Velocity.z[eid] = 0;
      Force.x[eid] = 0;
      Force.y[eid] = 0;
      Force.z[eid] = 0;
    }
    const f = noseForwardAxis(eid);
    // Nose points along +X (within numerical tolerance). The pre-fix code
    // would have aimed the TAIL at +X, leaving the nose at -X → f.x ≈ -1.
    expect(f.x).toBeGreaterThan(0.99);
    expect(Math.abs(f.y)).toBeLessThan(0.02);
    expect(Math.abs(f.z)).toBeLessThan(0.02);
  });

  it('stall nudge kicks the body forward along the nose direction (local -X), not the tail', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    const eid = spawn(w, { x: 500, y: 200, z: 200 }, handle);
    // Default orientation = identity quaternion → local -X = world -X.
    // Velocity is essentially zero, well below `STALL_FRACTION * vPref`.
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;
    Velocity.z[eid] = 0;
    Force.x[eid] = 0;
    Force.y[eid] = 0;
    Force.z[eid] = 0;
    steeringIntegrator(w, SIM_DT);
    // The stall nudge should push velocity in the -X direction (the nose).
    // Pre-fix it pushed +X (the tail) — which the orientation-tracking
    // step then doubled down on, making fish accelerate tail-first.
    expect(Velocity.x[eid]).toBeLessThan(0);
    expect(Math.abs(Velocity.y[eid] as number)).toBeLessThan(1e-6);
    expect(Math.abs(Velocity.z[eid] as number)).toBeLessThan(1e-6);
  });
});

describe('steeringIntegrator — F11.7 pitch clamp', () => {
  it('clamps heading pitch to sin(25°) when velocity is vertical-dominant', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    const eid = spawn(w, { x: 500, y: 200, z: 200 }, handle);
    // 80% Y, 20% X — way past the 25° pitch cap (which is ~42% Y).
    for (let i = 0; i < 120; i++) {
      Velocity.x[eid] = 20;
      Velocity.y[eid] = 80;
      Velocity.z[eid] = 0;
      Force.x[eid] = 0;
      Force.y[eid] = 0;
      Force.z[eid] = 0;
      steeringIntegrator(w, SIM_DT);
    }
    const f = noseForwardAxis(eid);
    // f is a unit vector; |f.y| must be ≤ MAX_PITCH_SIN + a tiny float
    // tolerance. Pre-fix the orientation would have tracked the raw
    // velocity and `f.y` would converge to 80 / sqrt(80² + 20²) ≈ 0.97.
    expect(Math.abs(f.y)).toBeLessThanOrEqual(0.43);
    // And the horizontal heading is still pointing along the velocity's
    // projection onto the XZ plane — i.e. mostly +X, not random.
    expect(f.x).toBeGreaterThan(0.85);
  });

  it('purely vertical velocity leaves orientation unchanged (no defined heading)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    const eid = spawn(w, { x: 500, y: 200, z: 200 }, handle);
    // Default orientation = identity. Capture the initial forward axis.
    const before = noseForwardAxis(eid);
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 80;
    Velocity.z[eid] = 0;
    Force.x[eid] = 0;
    Force.y[eid] = 0;
    Force.z[eid] = 0;
    steeringIntegrator(w, SIM_DT);
    const after = noseForwardAxis(eid);
    // No XZ projection possible — the integrator must keep the existing
    // heading rather than crashing or rotating to (0, 0.42, 0).
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(after.z).toBeCloseTo(before.z, 5);
  });

  it('still resets Force to zero when the orientation update is skipped (purely vertical heading)', () => {
    // The pure-vertical-heading bail-out path must NOT short-circuit
    // before Force is reset — a previous draft used `continue` which
    // leaked the per-tick force into the next tick. This is a flag-
    // based-skip regression guard.
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    const eid = spawn(w, { x: 500, y: 200, z: 200 }, handle);
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 80;
    Velocity.z[eid] = 0;
    // Non-zero Force; the integrator drains it into Velocity then must
    // reset to zero.
    Force.x[eid] = 5;
    Force.y[eid] = -10;
    Force.z[eid] = 3;
    steeringIntegrator(w, SIM_DT);
    expect(Force.x[eid]).toBe(0);
    expect(Force.y[eid]).toBe(0);
    expect(Force.z[eid]).toBe(0);
  });
});

describe('steeringIntegrator — F11.7 body-extent wall inset', () => {
  it('projects velocity at the AABB face inset by bodyLength / 2 (nose stays inside the glass)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    // Spawn 10 mm from the +X wall. BodyLength = 30 mm → halfBody = 15 mm.
    // Without the inset the projection fires only when `nextX > maxX` —
    // for SIM_DT = 1/30 and vx = 100, nextX = 1000 − 10 + 100/30 ≈ 993.3,
    // still inside, no projection, fish leaves the tank. With the inset
    // the projection fires once `nextX > maxX − 15 = 985`.
    const eid = spawn(w, { x: TANK.maxX - 10, y: 200, z: 200 }, handle);
    Velocity.x[eid] = 100;
    Velocity.y[eid] = 0;
    Velocity.z[eid] = 0;
    Force.x[eid] = 0;
    Force.y[eid] = 0;
    Force.z[eid] = 0;
    steeringIntegrator(w, SIM_DT);
    expect(Velocity.x[eid]).toBe(0);
  });

  it('does not project Velocity when the body still fits inside the inset AABB', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    // Spawn well clear of any wall — half-body inset shouldn't matter.
    const eid = spawn(w, { x: 500, y: 200, z: 200 }, handle);
    Velocity.x[eid] = 50;
    Velocity.y[eid] = 0;
    Velocity.z[eid] = 0;
    Force.x[eid] = 0;
    Force.y[eid] = 0;
    Force.z[eid] = 0;
    steeringIntegrator(w, SIM_DT);
    expect(Velocity.x[eid]).toBeCloseTo(50, 5);
  });
});
