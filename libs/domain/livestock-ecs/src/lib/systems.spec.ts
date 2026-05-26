import { AnimationPhase, FISH_ARCHETYPE, Position, Velocity } from './components';
import { animationSystem, kinematicSystem } from './systems';
import { createLivestockWorld, SIM_DT } from './world';

function spawn(world: ReturnType<typeof createLivestockWorld>, opts = {}) {
  return world.spawnFish({
    archetype: FISH_ARCHETYPE.SLIM_TETRA,
    speciesId: 1,
    bodyLengthMm: 30,
    position: { x: 0, y: 0, z: 0 },
    ...opts,
  });
}

describe('kinematicSystem', () => {
  it('leaves Position unchanged when Velocity is zero (F11.1 default)', () => {
    const w = createLivestockWorld(0);
    const eid = spawn(w, { position: { x: 5, y: 6, z: 7 } });
    kinematicSystem(w.ecs, SIM_DT);
    expect(Position.x[eid]).toBeCloseTo(5);
    expect(Position.y[eid]).toBeCloseTo(6);
    expect(Position.z[eid]).toBeCloseTo(7);
  });

  it('integrates Position += Velocity * dt (when something writes Velocity)', () => {
    const w = createLivestockWorld(0);
    const eid = spawn(w, { position: { x: 0, y: 0, z: 0 } });
    // Hand-set velocity to simulate what F11.4 steering will do.
    Velocity.x[eid] = 100; // mm/s
    Velocity.y[eid] = -50;
    Velocity.z[eid] = 25;
    kinematicSystem(w.ecs, 0.5);
    expect(Position.x[eid]).toBeCloseTo(50);
    expect(Position.y[eid]).toBeCloseTo(-25);
    expect(Position.z[eid]).toBeCloseTo(12.5);
  });
});

describe('animationSystem', () => {
  it('advances phase by freq * 2π * dt on a single step', () => {
    const w = createLivestockWorld(0);
    const eid = spawn(w, { tailBeatFreq: 1, phaseOffset: 0 });
    animationSystem(w.ecs, 0.1);
    // 1 Hz × 2π × 0.1 s = 0.2π
    expect(AnimationPhase.phase[eid]).toBeCloseTo(0.2 * Math.PI, 5);
  });

  it('wraps phase into [0, 2π) so it never grows unbounded', () => {
    const w = createLivestockWorld(0);
    const eid = spawn(w, { tailBeatFreq: 10 });
    // 10 Hz × 2π × (1000 × SIM_DT) = ~209π rad if unbounded.
    for (let i = 0; i < 1000; i++) animationSystem(w.ecs, SIM_DT);
    expect(AnimationPhase.phase[eid]).toBeGreaterThanOrEqual(0);
    expect(AnimationPhase.phase[eid]).toBeLessThan(2 * Math.PI);
  });

  it('handles multiple entities independently', () => {
    const w = createLivestockWorld(0);
    const a = spawn(w, { tailBeatFreq: 1, phaseOffset: 0 });
    const b = spawn(w, { tailBeatFreq: 2, phaseOffset: 0 });
    animationSystem(w.ecs, 0.5);
    expect(AnimationPhase.phase[a]).toBeCloseTo(Math.PI, 5);
    // 2 Hz × 2π × 0.5 = 2π → wraps to 0
    expect(AnimationPhase.phase[b]).toBeCloseTo(0, 5);
  });
});

describe('world.step (Kinematic + Animation composition)', () => {
  it('runs both systems and advances tick counter', () => {
    const w = createLivestockWorld(0);
    const eid = spawn(w, { tailBeatFreq: 4 });
    w.step(SIM_DT);
    // Animation advanced
    expect(AnimationPhase.phase[eid]).toBeGreaterThan(0);
    // Position unchanged (Velocity = 0)
    expect(Position.x[eid]).toBe(0);
    // Tick incremented
    expect(w.tickCounter).toBe(1);
  });
});
