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
  BehaviorParamsRef,
  BodyLength,
  FISH_ARCHETYPE,
  Force,
  NO_BEHAVIOR_HANDLE,
  Orientation,
  ParamStore,
  Position,
  SIM_DT,
  SIM_HZ,
  SpatialGrid,
  SpeciesId,
  Velocity,
  animationSystem,
  createLivestockWorld,
  depthSystem,
  kinematicSystem,
  perceptionSystem,
  schoolingSystem,
  steeringIntegrator,
  tickPrng,
} from '../index';
import { MID_PRESET } from '@aquascape/domain/livestock-behaviors';

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

  it('exposes all component slabs as bitECS-shaped objects', () => {
    for (const c of [
      Position,
      Velocity,
      Orientation,
      SpeciesId,
      BodyLength,
      Archetype,
      AnimationPhase,
      BehaviorMode,
      BehaviorParamsRef,
      Force,
    ]) {
      expect(c).toBeDefined();
    }
  });

  it('exposes ParamStore + NO_BEHAVIOR_HANDLE + the F11.2 systems', () => {
    expect(typeof perceptionSystem).toBe('function');
    expect(typeof schoolingSystem).toBe('function');
    expect(typeof depthSystem).toBe('function');
    expect(typeof steeringIntegrator).toBe('function');
    expect(NO_BEHAVIOR_HANDLE).toBe(0xffff);
    const s = new ParamStore();
    expect(s.size).toBe(0);
    const h = s.registerSpecies(1, MID_PRESET);
    expect(s.get(h)?.schooling.ZOA).toBe(MID_PRESET.schooling.ZOA);
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
