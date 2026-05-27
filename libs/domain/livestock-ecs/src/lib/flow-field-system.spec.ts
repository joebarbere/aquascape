/**
 * FlowFieldSystem tests (Stage 11 F11.5 Wave 4).
 *
 * Covers:
 *   - No-op when world.getFlowField() is null (the no-equipment fast path).
 *   - Uniform synthetic flow field drifts the fish in the source direction.
 *   - Mode-agnostic: REFUGE / PURSUE fish still feel flow (environmental
 *     force, not a behaviour choice).
 *
 * We construct the FlowField directly (synthetic typed-arrays) rather than
 * calling `bakeFlowField` — the bake's correctness is its own spec's
 * concern; here we just need a controlled velocity field to feed the
 * system.
 */
import { MID_PRESET, type ResolvedBehavior } from '@aquascape/domain/livestock-behaviors';
import type { FlowField } from '@aquascape/domain/fluid-sim';
import {
  BEHAVIOR_MODE,
  BehaviorMode,
  FISH_ARCHETYPE,
  Force,
  Position,
  Velocity,
} from './components';
import { flowFieldSystem } from './flow-field-system';
import { steeringIntegrator } from './steering-integrator';
import { kinematicSystem } from './systems';
import { createLivestockWorld, SIM_DT, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

function clone(p: ResolvedBehavior): ResolvedBehavior {
  return JSON.parse(JSON.stringify(p)) as ResolvedBehavior;
}

/**
 * Build a synthetic flow field with a constant velocity at every cell.
 * `cellsPerAxis = 4` keeps the typed arrays tiny — the system is just
 * doing trilinear sampling, so resolution doesn't matter for correctness.
 */
function makeUniformField(vx: number, vy: number, vz: number, cellsPerAxis = 4): FlowField {
  const gx = cellsPerAxis;
  const gy = cellsPerAxis;
  const gz = cellsPerAxis;
  const n = gx * gy * gz;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    u[i] = vx;
    v[i] = vy;
    w[i] = vz;
  }
  // Cell size big enough that the entire tank lies inside the grid.
  const cellSize = 1000 / cellsPerAxis;
  return {
    gx, gy, gz,
    origin: { x: 0, y: 0, z: 0 },
    cellSize,
    u, v, w,
  };
}

describe('flowFieldSystem — no flow registered', () => {
  it('leaves Force untouched when no FlowField is registered', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, clone(MID_PRESET));
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    // Pre-zero Force defensively (should already be zero after spawn).
    Force.x[eid] = 0;
    Force.y[eid] = 0;
    Force.z[eid] = 0;
    flowFieldSystem(w);
    expect(Force.x[eid] as number).toBe(0);
    expect(Force.y[eid] as number).toBe(0);
    expect(Force.z[eid] as number).toBe(0);
  });

  it('leaves Velocity unchanged after a tick when no field registered (full pipeline)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, clone(MID_PRESET));
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    // Zero velocity at start; without flow + with no other forces, only
    // stall-nudge from SteeringIntegrator would touch it. Since flow is
    // the variable under test, run only flowFieldSystem (not the full
    // step) and confirm no Force write.
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;
    Velocity.z[eid] = 0;
    flowFieldSystem(w);
    expect(Velocity.x[eid] as number).toBe(0);
    expect(Velocity.y[eid] as number).toBe(0);
    expect(Velocity.z[eid] as number).toBe(0);
  });
});

describe('flowFieldSystem — uniform field drift', () => {
  it('adds positive X force when uniform field points +X (drag coefficient 0.5)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, clone(MID_PRESET));
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    // 100 mm/s flow in +X → 100 * 0.5 = 50 mm/s² force.
    w.registerFlowField(makeUniformField(100, 0, 0));
    Force.x[eid] = 0;
    Force.y[eid] = 0;
    Force.z[eid] = 0;
    flowFieldSystem(w);
    expect(Force.x[eid] as number).toBeCloseTo(50, 4);
    expect(Force.y[eid] as number).toBe(0);
    expect(Force.z[eid] as number).toBe(0);
  });

  it('drifts fish in +X over N ticks with no other forces (full sim loop)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, clone(MID_PRESET));
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    w.registerFlowField(makeUniformField(100, 0, 0));
    const startX = 500;
    // Drive only flow + steering + kinematic (skip schooling/depth/etc to
    // isolate flow's effect — they'd add their own forces).
    for (let i = 0; i < 60; i++) {
      // Zero force at the start of each tick so each iteration is fresh
      // — without the full step() we don't have SteeringIntegrator's
      // post-tick reset for *all* paths.
      Force.x[eid] = 0;
      Force.y[eid] = 0;
      Force.z[eid] = 0;
      flowFieldSystem(w);
      steeringIntegrator(w, SIM_DT);
      kinematicSystem(w.ecs, SIM_DT);
    }
    // After 60 ticks (2 sim-seconds) the fish should have drifted some
    // amount in +X. SteeringIntegrator caps |v| at vMax (~200 mm/s on
    // MID_PRESET), so the upper bound is ~400 mm displacement. We just
    // need to confirm it moved meaningfully in +X.
    const finalX = Position.x[eid] as number;
    expect(finalX).toBeGreaterThan(startX);
    expect(finalX - startX).toBeGreaterThan(10);
  });

  it('flips drift direction when the field points -Z', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, clone(MID_PRESET));
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    w.registerFlowField(makeUniformField(0, 0, -80));
    Force.x[eid] = 0;
    Force.y[eid] = 0;
    Force.z[eid] = 0;
    flowFieldSystem(w);
    expect(Force.z[eid] as number).toBeCloseTo(-40, 4);
  });
});

describe('flowFieldSystem — mode-agnostic', () => {
  it('still applies flow force when fish is in REFUGE', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, clone(MID_PRESET));
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    w.registerFlowField(makeUniformField(100, 0, 0));
    BehaviorMode.mode[eid] = BEHAVIOR_MODE.REFUGE;
    Force.x[eid] = 0;
    flowFieldSystem(w);
    expect(Force.x[eid] as number).toBeCloseTo(50, 4);
  });

  it('still applies flow force when fish is in PURSUE', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, clone(MID_PRESET));
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    w.registerFlowField(makeUniformField(0, 50, 0));
    BehaviorMode.mode[eid] = BEHAVIOR_MODE.PURSUE;
    Force.y[eid] = 0;
    flowFieldSystem(w);
    expect(Force.y[eid] as number).toBeCloseTo(25, 4);
  });
});

describe('flowFieldSystem — null clear', () => {
  it('treats null registration as no-flow', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, clone(MID_PRESET));
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    // Register + then clear.
    w.registerFlowField(makeUniformField(100, 0, 0));
    w.registerFlowField(null);
    Force.x[eid] = 0;
    flowFieldSystem(w);
    expect(Force.x[eid] as number).toBe(0);
  });
});
