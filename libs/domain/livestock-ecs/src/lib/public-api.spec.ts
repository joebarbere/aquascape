/**
 * Smoke test that the public `index.ts` surface re-exports the expected
 * bindings + that they all behave correctly when invoked through the
 * publish path (catches stale re-exports after refactors).
 */
import {
  AnimationPhase,
  Archetype,
  BEHAVIOR_MODE,
  BUBBLE_GLOBAL_CAP_COUNT,
  BehaviorMode,
  BehaviorParamsRef,
  BodyLength,
  BubbleParticle,
  bubbleLifetimeSystem,
  bubbleSourceSpawnSystem,
  Curiosity,
  FearState,
  FeedingDrive,
  FISH_ARCHETYPE,
  FLAKE_FLOAT_SECONDS,
  FLAKE_FLOAT_VY_MM_PER_S,
  FLAKE_SINK_VY_MM_PER_S,
  FOOD_TYPE,
  FoodSprite,
  foodSpriteKinematicSystem,
  Force,
  initialFoodKinematics,
  LIVE_DRIFT_VY_MM_PER_S,
  PELLET_SINK_VY_MM_PER_S,
  WAFER_SINK_VY_MM_PER_S,
  HARDSCAPE_CATEGORY,
  Hardscape,
  NippingDrive,
  NO_BEHAVIOR_HANDLE,
  NO_INTEREST,
  Orientation,
  ParamStore,
  Position,
  SIM_DT,
  SIM_HZ,
  SpatialGrid,
  SpeciesId,
  Territory,
  Velocity,
  animationSystem,
  collisionSystem,
  createLivestockWorld,
  curiositySystem,
  depthSystem,
  fearSystem,
  feedingSystem,
  flowFieldSystem,
  foodSpriteLifetimeSystem,
  kinematicSystem,
  nippingSystem,
  perceptionSystem,
  schoolingSystem,
  steeringIntegrator,
  territorialSystem,
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
    expect(FISH_ARCHETYPE.CRAWLER).toBe(6); // F11.6 Wave 2 — shrimp + snails
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
      Curiosity,
      FeedingDrive,
      FoodSprite,
      Force,
      FearState,
      Hardscape,
      NippingDrive,
      Territory,
    ]) {
      expect(c).toBeDefined();
    }
  });

  it('exposes F11.4 system + sentinel exports', () => {
    expect(typeof feedingSystem).toBe('function');
    expect(typeof curiositySystem).toBe('function');
    expect(typeof foodSpriteLifetimeSystem).toBe('function');
    expect(NO_INTEREST).toBeLessThan(-1e29);
  });

  it('exposes the F11.3 enums + systems', () => {
    expect(HARDSCAPE_CATEGORY.WOOD).toBe(0);
    expect(HARDSCAPE_CATEGORY.ROCK).toBe(1);
    expect(HARDSCAPE_CATEGORY.PLANT).toBe(2);
    expect(HARDSCAPE_CATEGORY.OTHER).toBe(3);
    expect(typeof fearSystem).toBe('function');
    expect(typeof nippingSystem).toBe('function');
    expect(typeof territorialSystem).toBe('function');
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

  it('F11.4 world API — spawnFoodSprite + getFoodSpriteCount + getAlgaeScore', () => {
    const w = createLivestockWorld(0);
    expect(w.getFoodSpriteCount()).toBe(0);
    const eid = w.spawnFoodSprite({ x: 100, y: 200, z: 200 });
    expect(typeof eid).toBe('number');
    expect(w.getFoodSpriteCount()).toBe(1);
    // Unregistered eid → null.
    expect(w.getAlgaeScore(999999)).toBeNull();
  });

  it('exposes the F11.5 Wave 4 systems + world API', () => {
    expect(typeof flowFieldSystem).toBe('function');
    expect(typeof collisionSystem).toBe('function');
    const w = createLivestockWorld(0);
    expect(typeof w.registerFlowField).toBe('function');
    expect(typeof w.registerHardscapeSdf).toBe('function');
    expect(typeof w.getFlowField).toBe('function');
    expect(typeof w.getHardscapeSdf).toBe('function');
    expect(w.getFlowField()).toBeNull();
    expect(w.getHardscapeSdf()).toBeNull();
  });

  it('exposes the F11.5 Wave 5 BubbleParticle component + systems + world API', () => {
    expect(BubbleParticle).toBeDefined();
    expect(typeof bubbleSourceSpawnSystem).toBe('function');
    expect(typeof bubbleLifetimeSystem).toBe('function');
    expect(BUBBLE_GLOBAL_CAP_COUNT).toBe(200);
    const w = createLivestockWorld(0);
    expect(typeof w.registerBubbleSources).toBe('function');
    expect(typeof w.getBubbleParticleCount).toBe('function');
    expect(typeof w.getBubbleSourceCount).toBe('function');
    expect(w.getBubbleSourceCount()).toBe(0);
    expect(w.getBubbleParticleCount()).toBe(0);
  });

  it('F11.5 Wave 5 WorldSnapshot has additive bubble slab fields', () => {
    const w = createLivestockWorld(0);
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 800 }]);
    w.step(SIM_DT);
    const snap = w.snapshot(0);
    expect(typeof snap.bubbleCount).toBe('number');
    expect(snap.bubblePosition).toBeInstanceOf(Float32Array);
    expect(snap.bubblePosition.length).toBe(snap.bubbleCount * 3);
  });

  it('F11.4 WorldSnapshot has additive food sprite fields', () => {
    const w = createLivestockWorld(0);
    w.spawnFoodSprite({ x: 100, y: 200, z: 200 });
    const snap = w.snapshot(0);
    expect(snap.foodSpriteCount).toBe(1);
    expect(snap.foodSpritePosition.length).toBe(3);
    expect(snap.foodSpritePosition[0]).toBeCloseTo(100);
    expect(snap.foodSpritePosition[1]).toBeCloseTo(200);
    expect(snap.foodSpritePosition[2]).toBeCloseTo(200);
    // Fish slab unchanged — no fish spawned, count is 0.
    expect(snap.entityCount).toBe(0);
  });

  it('F14.1 exposes FOOD_TYPE + the kinematic system + the typed snapshot slab', () => {
    expect(FOOD_TYPE.FLAKE).toBe(0);
    expect(FOOD_TYPE.PELLET).toBe(1);
    expect(FOOD_TYPE.WAFER).toBe(2);
    expect(FOOD_TYPE.LIVE).toBe(3);
    expect(typeof foodSpriteKinematicSystem).toBe('function');
    const w = createLivestockWorld(0);
    const eid = w.spawnFoodSprite({ x: 100, y: 200, z: 200 }, 30, 1, FOOD_TYPE.PELLET);
    expect(FoodSprite.foodType[eid] as number).toBe(FOOD_TYPE.PELLET);
    const snap = w.snapshot(0);
    expect(snap.foodSpriteType).toBeInstanceOf(Uint8Array);
    expect(snap.foodSpriteType.length).toBe(snap.foodSpriteCount);
    expect(snap.foodSpriteType[0]).toBe(FOOD_TYPE.PELLET);
  });

  it('F14.1 exposes the food sink constants + initialFoodKinematics', () => {
    // Sink speeds: flakes rise while buoyant, every form sinks otherwise,
    // and the pellet is the fastest sinker.
    expect(FLAKE_FLOAT_VY_MM_PER_S).toBeGreaterThan(0);
    expect(FLAKE_SINK_VY_MM_PER_S).toBeLessThan(0);
    expect(WAFER_SINK_VY_MM_PER_S).toBeLessThan(0);
    expect(LIVE_DRIFT_VY_MM_PER_S).toBeLessThan(0);
    expect(PELLET_SINK_VY_MM_PER_S).toBeLessThan(WAFER_SINK_VY_MM_PER_S);
    expect(FLAKE_FLOAT_SECONDS).toBeGreaterThan(0);
    // Flake seeds with its float velocity + window; other forms start at rest.
    expect(initialFoodKinematics(FOOD_TYPE.FLAKE)).toEqual({
      vy: FLAKE_FLOAT_VY_MM_PER_S,
      floatRemaining: FLAKE_FLOAT_SECONDS,
    });
    expect(initialFoodKinematics(FOOD_TYPE.PELLET)).toEqual({ vy: 0, floatRemaining: 0 });
  });
});
