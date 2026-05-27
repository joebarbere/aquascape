import { AnimationPhase, FISH_ARCHETYPE, Position, Velocity } from './components';
import { animationSystem, kinematicSystem } from './systems';
import { createLivestockWorld, SIM_DT } from './world';

// `FISH_ARCHETYPE` is already imported above; the crawler tests use it
// directly from that import.

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

  describe('crawler Y-velocity clamp (F11.6 Wave 2)', () => {
    it('clamps an upward Y velocity to +5 mm/sec for CRAWLER-archetype entities', () => {
      const w = createLivestockWorld(0);
      const eid = w.spawnFish({
        archetype: FISH_ARCHETYPE.CRAWLER,
        speciesId: 1,
        bodyLengthMm: 15,
        position: { x: 0, y: 0, z: 0 },
      });
      // Simulate a steering impulse that would otherwise launch the
      // crawler off the substrate.
      Velocity.y[eid] = 500; // mm/s upward — would lift 16.6 mm/tick at 30Hz
      kinematicSystem(w.ecs, SIM_DT);
      // Velocity was capped before integration; position advanced by
      // exactly cap * dt = 5 / 30 ≈ 0.1667 mm rather than 500 / 30 ≈ 16.67.
      expect(Position.y[eid]).toBeCloseTo(5 * SIM_DT, 5);
      // And the slab is permanently capped so subsequent ticks see the
      // clamped value, not the raw 500.
      expect(Velocity.y[eid]).toBe(5);
    });

    it('clamps a downward Y velocity to -5 mm/sec for CRAWLER-archetype entities', () => {
      const w = createLivestockWorld(0);
      const eid = w.spawnFish({
        archetype: FISH_ARCHETYPE.CRAWLER,
        speciesId: 1,
        bodyLengthMm: 15,
        position: { x: 0, y: 100, z: 0 },
      });
      Velocity.y[eid] = -200;
      kinematicSystem(w.ecs, SIM_DT);
      expect(Position.y[eid]).toBeCloseTo(100 + -5 * SIM_DT, 5);
      expect(Velocity.y[eid]).toBe(-5);
    });

    it('does not clamp Y velocity for non-crawler archetypes', () => {
      const w = createLivestockWorld(0);
      const eid = spawn(w, { position: { x: 0, y: 0, z: 0 } });
      Velocity.y[eid] = 200; // mm/s upward — fish can dart this fast
      kinematicSystem(w.ecs, SIM_DT);
      // No cap applied: position advanced by 200 / 30 ≈ 6.67 mm.
      expect(Position.y[eid]).toBeCloseTo(200 * SIM_DT, 5);
      expect(Velocity.y[eid]).toBe(200);
    });

    it('does not affect X or Z velocity components for CRAWLER entities', () => {
      // Crawlers can still wander horizontally at full integrator speed —
      // only the Y axis is clamped, since "substrate glue" is a vertical
      // constraint.
      const w = createLivestockWorld(0);
      const eid = w.spawnFish({
        archetype: FISH_ARCHETYPE.CRAWLER,
        speciesId: 1,
        bodyLengthMm: 15,
        position: { x: 0, y: 0, z: 0 },
      });
      Velocity.x[eid] = 100;
      Velocity.y[eid] = 50; // above the +5 cap
      Velocity.z[eid] = -75;
      kinematicSystem(w.ecs, SIM_DT);
      expect(Position.x[eid]).toBeCloseTo(100 * SIM_DT, 5);
      expect(Position.z[eid]).toBeCloseTo(-75 * SIM_DT, 5);
      expect(Velocity.x[eid]).toBe(100); // untouched
      expect(Velocity.z[eid]).toBe(-75); // untouched
      expect(Velocity.y[eid]).toBe(5); // capped
    });

    it('keeps |Velocity.y| ≤ cap across many ticks even with reinjection', () => {
      // Simulates the realistic case where a behaviour system keeps
      // adding upward Y impulses each tick — the clamp must hold.
      const w = createLivestockWorld(0);
      const eid = w.spawnFish({
        archetype: FISH_ARCHETYPE.CRAWLER,
        speciesId: 1,
        bodyLengthMm: 15,
        position: { x: 0, y: 0, z: 0 },
      });
      for (let i = 0; i < 100; i++) {
        // Re-inject a fresh 50 mm/s upward each tick — the clamp must
        // bring it back to +5 before integration.
        Velocity.y[eid] = 50;
        kinematicSystem(w.ecs, SIM_DT);
        expect(Math.abs(Velocity.y[eid] as number)).toBeLessThanOrEqual(5);
      }
    });
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
