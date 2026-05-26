/**
 * Smoke test that the public `index.ts` surface re-exports the expected
 * bindings + that they all behave correctly when invoked through the
 * publish path (catches stale re-exports after refactors).
 */
import {
  AnimationPhase,
  Archetype,
  BEHAVIOR_MODE,
  BehaviorMode,
  BodyLength,
  FISH_ARCHETYPE,
  Orientation,
  Position,
  SIM_DT,
  SIM_HZ,
  SpatialGrid,
  SpeciesId,
  Velocity,
  animationSystem,
  createLivestockWorld,
  kinematicSystem,
  tickPrng,
} from '../index';

describe('public API surface', () => {
  it('exports SIM constants', () => {
    expect(SIM_HZ).toBe(30);
    expect(SIM_DT).toBeCloseTo(1 / 30);
  });

  it('exports the archetype + behavior-mode enums', () => {
    expect(FISH_ARCHETYPE.SLIM_TETRA).toBe(0);
    expect(FISH_ARCHETYPE.HATCHET_WEDGE).toBe(5);
    expect(BEHAVIOR_MODE.FORAGE).toBe(0);
    expect(BEHAVIOR_MODE.PURSUE).toBe(2);
  });

  it('exposes all eight component slabs as bitECS-shaped objects', () => {
    for (const c of [
      Position,
      Velocity,
      Orientation,
      SpeciesId,
      BodyLength,
      Archetype,
      AnimationPhase,
      BehaviorMode,
    ]) {
      expect(c).toBeDefined();
    }
  });

  it('drives a full spawn → step → snapshot cycle through the public API', () => {
    const w = createLivestockWorld(123);
    w.spawnFish({
      archetype: FISH_ARCHETYPE.BARB,
      speciesId: 7,
      bodyLengthMm: 40,
      position: { x: 10, y: 20, z: 30 },
      tailBeatFreq: 4,
    });
    w.step(SIM_DT);
    const snap = w.snapshot(0);
    expect(snap.entityCount).toBe(1);
    expect(snap.archetype[0]).toBe(FISH_ARCHETYPE.BARB);
    expect(snap.scale[0]).toBeCloseTo(40);
    // tickPrng surfaces as a public helper for F11.2.
    expect(tickPrng(w, 0)).toBeGreaterThanOrEqual(0);
  });

  it('exposes raw systems for direct invocation (renderer integration tests use this)', () => {
    const w = createLivestockWorld(0);
    w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 0,
      bodyLengthMm: 30,
      position: { x: 0, y: 0, z: 0 },
    });
    // Directly invoking the systems should work just like step() does.
    kinematicSystem(w.ecs, SIM_DT);
    animationSystem(w.ecs, SIM_DT);
  });

  it('exposes SpatialGrid for F11.2 schooling', () => {
    const g = new SpatialGrid(50);
    g.insert(1, 0, 0, 0);
    expect(Array.from(g.query(0, 0, 0, 1))).toContain(1);
  });
});
