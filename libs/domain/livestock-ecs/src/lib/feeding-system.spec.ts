/**
 * FeedingSystem + algae regrowth + per-category coverage tests (Stage 11 F11.4).
 *
 * Phases covered:
 *   - Hunger integration crosses threshold over time.
 *   - Algae-grazer + rock: oto rasps algae, hunger drops.
 *   - Algae regrowth fires per tick when nobody is grazing.
 *   - Food sprite consumption: surface fish reaches + consumes sprite.
 *   - Detritivore stays satiated near substrate.
 *   - Per-FeedingCategory branch coverage.
 *   - Mode arbitration regression: algae-grazer in REFUGE doesn't rasp.
 */
import {
  BOTTOM_PRESET,
  MID_PRESET,
  TOP_PRESET,
  type ResolvedBehavior,
} from '@aquascape/domain/livestock-behaviors';
import {
  BEHAVIOR_MODE,
  BehaviorMode,
  FISH_ARCHETYPE,
  FOOD_TYPE,
  FeedingDrive,
  Force,
  HARDSCAPE_CATEGORY,
  Position,
  Velocity,
} from './components';
import { feedingSystem, foodSpriteLifetimeSystem } from './feeding-system';
import { createLivestockWorld, SIM_DT, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

function clone(p: ResolvedBehavior): ResolvedBehavior {
  return JSON.parse(JSON.stringify(p)) as ResolvedBehavior;
}

describe('feedingSystem — hunger integration', () => {
  it('integrates hunger to 1.0 after 60 sim-seconds at rate 1/60', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.feeding.hungerRatePerSec = 1 / 60;
    params.feeding.threshold = 1000; // never seek
    const handle = w.registerSpeciesBehavior(1, params);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    // 60 seconds at SIM_DT = 1800 ticks.
    for (let i = 0; i < 1800; i++) feedingSystem(w, SIM_DT);
    expect(FeedingDrive.hunger[eid] as number).toBeCloseTo(1.0, 2);
  });

  it('skips entities without a registered behaviour (NO_BEHAVIOR_HANDLE)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
    });
    // FeedingDrive isn't attached to NO_BEHAVIOR_HANDLE entities, so the
    // system has no row to process — voids any assertion on hunger.
    expect(() => feedingSystem(w, SIM_DT)).not.toThrow();
    // The eid exists, and we verify it stayed at FORAGE / Force.x = 0.
    expect(Force.x[eid] as number).toBe(0);
  });
});

describe('feedingSystem — algae grazer + rock', () => {
  it('oto near rock rasps algae down + hunger drops', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const oto = clone(BOTTOM_PRESET);
    oto.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'algae-grazer' };
    const handle = w.registerSpeciesBehavior(1, oto);
    w.registerHardscape([
      { position: { x: 200, y: 50, z: 200 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.CORY_CYLINDER,
      speciesId: 1,
      bodyLengthMm: 40,
      position: { x: 210, y: 50, z: 210 }, // within rasp range (BL=40, range=80)
      behaviorHandleIdx: handle,
    });
    // Force hunger above threshold so the fish wants to feed.
    FeedingDrive.hunger[eid] = 0.8;
    // After hardscape registration, find the rock eid via getAlgaeScore
    // (which returns null if not a hardscape). Iterate small range.
    let rockEid = -1;
    for (let i = 0; i < 200; i++) {
      if (w.getAlgaeScore(i) !== null) {
        rockEid = i;
        break;
      }
    }
    expect(rockEid).toBeGreaterThanOrEqual(0);
    expect(w.getAlgaeScore(rockEid)).toBe(1.0);
    // Run 100 ticks of rasping.
    for (let i = 0; i < 100; i++) feedingSystem(w, SIM_DT);
    const algaeAfter = w.getAlgaeScore(rockEid);
    if (algaeAfter === null) throw new Error('algaeScore went missing');
    expect(algaeAfter).toBeLessThan(1.0);
    expect(FeedingDrive.hunger[eid] as number).toBeLessThan(0.8);
  });

  it('algae regrows on rocks with no grazers (algaeScore = 0.3 → > 0.3 after 1000 ticks)', async () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 200, y: 50, z: 200 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    let rockEid = -1;
    for (let i = 0; i < 200; i++) {
      if (w.getAlgaeScore(i) !== null) {
        rockEid = i;
        break;
      }
    }
    expect(rockEid).toBeGreaterThanOrEqual(0);
    // Manually drop algae to 0.3 (simulating prior grazing). The world
    // API doesn't expose a setter; touch the slab directly via the
    // components import. Lazy-imported inside the test to avoid leaking
    // the bitECS-internal handle into the test file's top-level scope.
    const { Hardscape } = await import('./components');
    Hardscape.algaeScore[rockEid] = 0.3;
    expect(w.getAlgaeScore(rockEid)).toBeCloseTo(0.3);
    // Run 1000 ticks of feedingSystem — no fish spawned, so only the
    // regrowth scan fires.
    for (let i = 0; i < 1000; i++) feedingSystem(w, SIM_DT);
    const after = w.getAlgaeScore(rockEid);
    if (after === null) throw new Error('algaeScore missing');
    expect(after).toBeGreaterThan(0.3);
  });

  it('plant/other category rocks start at algaeScore = 0', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.PLANT },
      { position: { x: 200, y: 0, z: 100 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.OTHER },
    ]);
    let plantEid = -1;
    let otherEid = -1;
    for (let i = 0; i < 200; i++) {
      const s = w.getAlgaeScore(i);
      if (s === 0 && plantEid < 0) {
        plantEid = i;
      } else if (s === 0 && otherEid < 0) {
        otherEid = i;
      }
    }
    expect(plantEid).toBeGreaterThanOrEqual(0);
    expect(otherEid).toBeGreaterThanOrEqual(0);
    expect(w.getAlgaeScore(plantEid)).toBe(0);
    expect(w.getAlgaeScore(otherEid)).toBe(0);
  });

  it('rock + wood category hardscape start at algaeScore = 1.0', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.WOOD },
      { position: { x: 200, y: 0, z: 100 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    let count = 0;
    for (let i = 0; i < 200; i++) {
      if (w.getAlgaeScore(i) === 1.0) count++;
    }
    expect(count).toBe(2);
  });
});

describe('feedingSystem — food sprite consumption', () => {
  it('surface fish reaches food sprite + consumes it (hunger → 0)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const top = clone(TOP_PRESET);
    top.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'surface' };
    const handle = w.registerSpeciesBehavior(1, top);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.HATCHET_WEDGE,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 200, y: 360, z: 200 }, // surface band
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[eid] = 0.8;
    // Sprite within reach (2*BL=60 mm; place 20 mm away). Calories=0.5
    // so a single bite (consumed = min(0.5, 0.8) = 0.5) fully exhausts
    // the sprite and triggers despawn.
    w.spawnFoodSprite({ x: 220, y: 360, z: 200 }, 30, 0.5);
    expect(w.getFoodSpriteCount()).toBe(1);
    feedingSystem(w, SIM_DT);
    expect(FeedingDrive.hunger[eid] as number).toBe(0);
    expect(w.getFoodSpriteCount()).toBe(0);
  });

  it('surface fish nibbles a sprite — partial consumption leaves the sprite alive', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const top = clone(TOP_PRESET);
    top.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'surface' };
    const handle = w.registerSpeciesBehavior(1, top);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.HATCHET_WEDGE,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 200, y: 360, z: 200 },
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[eid] = 0.5;
    // Plenty of calories — one fish takes 0.5, sprite keeps 1.5.
    w.spawnFoodSprite({ x: 220, y: 360, z: 200 }, 30, 2.0);
    feedingSystem(w, SIM_DT);
    expect(FeedingDrive.hunger[eid] as number).toBe(0);
    // Sprite still alive.
    expect(w.getFoodSpriteCount()).toBe(1);
  });

  it('surface fish steers toward distant food sprite (writes Force toward it)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const top = clone(TOP_PRESET);
    top.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'surface' };
    const handle = w.registerSpeciesBehavior(1, top);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.HATCHET_WEDGE,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 100, y: 360, z: 200 },
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[eid] = 0.8;
    w.spawnFoodSprite({ x: 500, y: 360, z: 200 }, 30, 1);
    feedingSystem(w, SIM_DT);
    // Sprite is to the right (+x) so Force.x > 0.
    expect(Force.x[eid] as number).toBeGreaterThan(0);
  });

  it('midwater fish picks any sprite (no Y filter)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const mid = clone(MID_PRESET);
    mid.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'midwater' };
    const handle = w.registerSpeciesBehavior(1, mid);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 200, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[eid] = 0.8;
    w.spawnFoodSprite({ x: 300, y: 100, z: 200 }, 30, 1);
    feedingSystem(w, SIM_DT);
    // Force toward sprite (+x, -y).
    expect(Force.x[eid] as number).toBeGreaterThan(0);
    expect(Force.y[eid] as number).toBeLessThan(0);
  });

  it('substrate fish prefers substrate-zone sprites', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const bot = clone(BOTTOM_PRESET);
    bot.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'substrate' };
    const handle = w.registerSpeciesBehavior(1, bot);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.CORY_CYLINDER,
      speciesId: 1,
      bodyLengthMm: 40,
      position: { x: 100, y: 30, z: 200 },
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[eid] = 0.8;
    // Substrate sprite (in bottom 30 % — Y < 120) at y=30, far enough
    // that the fish has to steer (>2*BL away).
    w.spawnFoodSprite({ x: 500, y: 30, z: 200 }, 30, 1);
    feedingSystem(w, SIM_DT);
    // Force should be toward substrate sprite (+x mostly).
    expect(Force.x[eid] as number).toBeGreaterThan(0);
  });
});

describe('feedingSystem — typed-food band matching (F14.1)', () => {
  it('surface feeder prefers a near FLAKE over an equidistant WAFER', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const top = clone(TOP_PRESET);
    top.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'surface' };
    const handle = w.registerSpeciesBehavior(1, top);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.HATCHET_WEDGE,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 360, z: 200 },
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[eid] = 0.8;
    // A wafer to the LEFT (-x) and a flake to the RIGHT (+x), both in the
    // surface band, both equidistant. The surface feeder should steer toward
    // the flake (+x) thanks to the type-preference bias.
    w.spawnFoodSprite({ x: 300, y: 360, z: 200 }, 60, 1, FOOD_TYPE.WAFER);
    w.spawnFoodSprite({ x: 700, y: 360, z: 200 }, 60, 1, FOOD_TYPE.FLAKE);
    feedingSystem(w, SIM_DT);
    expect(Force.x[eid] as number).toBeGreaterThan(0);
  });

  it('substrate feeder prefers a near WAFER over an equidistant FLAKE', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const bot = clone(BOTTOM_PRESET);
    bot.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'substrate' };
    const handle = w.registerSpeciesBehavior(1, bot);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.CORY_CYLINDER,
      speciesId: 1,
      bodyLengthMm: 40,
      position: { x: 500, y: 30, z: 200 },
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[eid] = 0.8;
    // Flake to the left, wafer to the right — both settled in the substrate
    // band. The substrate feeder should steer toward the wafer (+x).
    w.spawnFoodSprite({ x: 300, y: 20, z: 200 }, 60, 1, FOOD_TYPE.FLAKE);
    w.spawnFoodSprite({ x: 700, y: 20, z: 200 }, 60, 1, FOOD_TYPE.WAFER);
    feedingSystem(w, SIM_DT);
    expect(Force.x[eid] as number).toBeGreaterThan(0);
  });

  it('a mismatched-but-only sprite is still eaten (preference biases, never ignores)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const top = clone(TOP_PRESET);
    top.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'surface' };
    const handle = w.registerSpeciesBehavior(1, top);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.HATCHET_WEDGE,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 200, y: 360, z: 200 },
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[eid] = 0.8;
    // Only a WAFER within reach (mismatched for a surface feeder). It should
    // still be consumed — the penalty is a selection bias, not a gate.
    w.spawnFoodSprite({ x: 220, y: 360, z: 200 }, 60, 0.5, FOOD_TYPE.WAFER);
    feedingSystem(w, SIM_DT);
    expect(FeedingDrive.hunger[eid] as number).toBe(0);
    expect(w.getFoodSpriteCount()).toBe(0);
  });
});

describe('feedingSystem — detritivore', () => {
  it('detritivore stays satiated when on substrate', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const shrimp = clone(BOTTOM_PRESET);
    shrimp.feeding = { hungerRatePerSec: 1 / 60, threshold: 0.7, category: 'detritivore' };
    const handle = w.registerSpeciesBehavior(1, shrimp);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.CORY_CYLINDER,
      speciesId: 1,
      bodyLengthMm: 20,
      position: { x: 500, y: 10, z: 500 }, // on substrate (Y < 50)
      behaviorHandleIdx: handle,
    });
    // Pre-load some hunger; it should decrease over ticks.
    FeedingDrive.hunger[eid] = 0.5;
    for (let i = 0; i < 300; i++) feedingSystem(w, SIM_DT);
    // Hunger reduction (0.02/s for 10s = 0.2) competes with rate
    // accumulation (1/60 * 10 = 0.167) — net should be lower than 0.5.
    expect(FeedingDrive.hunger[eid] as number).toBeLessThan(0.5);
  });

  it('detritivore high in the water column gets a downward Force toward substrate', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const shrimp = clone(BOTTOM_PRESET);
    shrimp.feeding = { hungerRatePerSec: 0, threshold: 0.7, category: 'detritivore' };
    const handle = w.registerSpeciesBehavior(1, shrimp);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.CORY_CYLINDER,
      speciesId: 1,
      bodyLengthMm: 20,
      position: { x: 500, y: 300, z: 500 }, // mid-water
      behaviorHandleIdx: handle,
    });
    feedingSystem(w, SIM_DT);
    expect(Force.y[eid] as number).toBeLessThan(0);
  });

  it('detritivore ignores food sprites entirely', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const shrimp = clone(BOTTOM_PRESET);
    shrimp.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'detritivore' };
    const handle = w.registerSpeciesBehavior(1, shrimp);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.CORY_CYLINDER,
      speciesId: 1,
      bodyLengthMm: 20,
      position: { x: 100, y: 10, z: 100 }, // on substrate
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[eid] = 0.9;
    w.spawnFoodSprite({ x: 500, y: 300, z: 100 }, 30, 1); // sprite far away
    feedingSystem(w, SIM_DT);
    // Force.x should NOT be toward the sprite (sprite is at x=500, fish
    // at x=100, but detritivore ignores). Force.x should be 0 (no horizontal pull).
    expect(Math.abs(Force.x[eid] as number)).toBeLessThan(1);
    // Sprite still alive.
    expect(w.getFoodSpriteCount()).toBe(1);
  });
});

describe('feedingSystem — plant-eater branch', () => {
  it('plant-eater behaves like algae-grazer (rasps a rock when nearby)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const eater = clone(MID_PRESET);
    eater.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'plant-eater' };
    const handle = w.registerSpeciesBehavior(1, eater);
    w.registerHardscape([
      { position: { x: 200, y: 100, z: 200 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.DEEP_BODIED,
      speciesId: 1,
      bodyLengthMm: 80,
      position: { x: 240, y: 100, z: 230 }, // within rasp range
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[eid] = 0.8;
    let rockEid = -1;
    for (let i = 0; i < 200; i++) {
      if (w.getAlgaeScore(i) !== null) {
        rockEid = i;
        break;
      }
    }
    for (let i = 0; i < 100; i++) feedingSystem(w, SIM_DT);
    const after = w.getAlgaeScore(rockEid);
    if (after === null) throw new Error('algaeScore missing');
    expect(after).toBeLessThan(1.0);
  });
});

describe('feedingSystem — priority arbitration regression', () => {
  it('algae-grazer in REFUGE does NOT rasp (mode-gated)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const oto = clone(BOTTOM_PRESET);
    oto.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'algae-grazer' };
    const handle = w.registerSpeciesBehavior(1, oto);
    w.registerHardscape([
      { position: { x: 200, y: 50, z: 200 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.CORY_CYLINDER,
      speciesId: 1,
      bodyLengthMm: 40,
      position: { x: 210, y: 50, z: 210 },
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[eid] = 0.8;
    // Flip mode to REFUGE manually — bypasses FearSystem.
    BehaviorMode.mode[eid] = BEHAVIOR_MODE.REFUGE;
    let rockEid = -1;
    for (let i = 0; i < 200; i++) {
      if (w.getAlgaeScore(i) !== null) {
        rockEid = i;
        break;
      }
    }
    const algaeBefore = w.getAlgaeScore(rockEid);
    for (let i = 0; i < 100; i++) feedingSystem(w, SIM_DT);
    // No regrowth either (already 1.0). Algae score unchanged.
    expect(w.getAlgaeScore(rockEid)).toBeCloseTo(algaeBefore as number);
  });

  it('mode = PURSUE also gates feeding (no rasp, no sprite-seek)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const top = clone(TOP_PRESET);
    top.feeding = { hungerRatePerSec: 0, threshold: 0.4, category: 'surface' };
    const handle = w.registerSpeciesBehavior(1, top);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.HATCHET_WEDGE,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 200, y: 360, z: 200 },
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[eid] = 0.8;
    w.spawnFoodSprite({ x: 220, y: 360, z: 200 }, 30, 1);
    BehaviorMode.mode[eid] = BEHAVIOR_MODE.PURSUE;
    feedingSystem(w, SIM_DT);
    // Sprite NOT consumed (PURSUE skipped feeding).
    expect(w.getFoodSpriteCount()).toBe(1);
    // f32 stores 0.8 as ~0.800000011920929 — use toBeCloseTo.
    expect(FeedingDrive.hunger[eid] as number).toBeCloseTo(0.8, 5);
  });
});

describe('food sprite lifecycle', () => {
  it('spawnFoodSprite increments getFoodSpriteCount', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    expect(w.getFoodSpriteCount()).toBe(0);
    w.spawnFoodSprite({ x: 100, y: 200, z: 200 });
    expect(w.getFoodSpriteCount()).toBe(1);
    w.spawnFoodSprite({ x: 200, y: 200, z: 200 });
    expect(w.getFoodSpriteCount()).toBe(2);
  });

  it('foodSpriteLifetimeSystem despawns sprites whose lifetime expired', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.spawnFoodSprite({ x: 100, y: 200, z: 200 }, 1.0); // 1 second lifetime
    expect(w.getFoodSpriteCount()).toBe(1);
    // 30 ticks of SIM_DT = 1 second exactly; the system runs at
    // start-of-tick so lifetime drops to 0 by tick 30.
    for (let i = 0; i < 31; i++) foodSpriteLifetimeSystem(w, SIM_DT);
    expect(w.getFoodSpriteCount()).toBe(0);
  });

  it('lifetime defaults to 30s + calories defaults to 1', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.spawnFoodSprite({ x: 100, y: 200, z: 200 });
    // After 29s sim time still alive.
    for (let i = 0; i < 29 * 30; i++) foodSpriteLifetimeSystem(w, SIM_DT);
    expect(w.getFoodSpriteCount()).toBe(1);
    // After 31s sim time: gone.
    for (let i = 0; i < 2 * 30; i++) foodSpriteLifetimeSystem(w, SIM_DT);
    expect(w.getFoodSpriteCount()).toBe(0);
  });

  it('full world.step despawns expired sprites at end of step', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.spawnFoodSprite({ x: 100, y: 200, z: 200 }, 0.5);
    expect(w.getFoodSpriteCount()).toBe(1);
    for (let i = 0; i < 30; i++) w.step(SIM_DT);
    expect(w.getFoodSpriteCount()).toBe(0);
  });
});

describe('getAlgaeScore', () => {
  it('returns null for an unknown eid', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    expect(w.getAlgaeScore(999999)).toBeNull();
  });

  it('returns the slab value for a registered hardscape', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    let found = false;
    for (let i = 0; i < 200; i++) {
      if (w.getAlgaeScore(i) === 1.0) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

describe('feedingSystem — kept calm by SteeringIntegrator', () => {
  // Smoke test that the produced Force vector doesn't blow up velocity.
  // Catches a regression where, say, removing the magnitude normaliser
  // would send a fish flying off-screen.
  it('food-seeking fish stays within tank after 500 ticks of full step()', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const top = clone(TOP_PRESET);
    top.feeding = { hungerRatePerSec: 1 / 5, threshold: 0.3, category: 'surface' };
    const handle = w.registerSpeciesBehavior(1, top);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.HATCHET_WEDGE,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 200, y: 360, z: 200 },
      behaviorHandleIdx: handle,
    });
    w.spawnFoodSprite({ x: 800, y: 380, z: 300 }, 60, 1);
    for (let i = 0; i < 500; i++) w.step(SIM_DT);
    const px = Position.x[eid] as number;
    const py = Position.y[eid] as number;
    const pz = Position.z[eid] as number;
    expect(px).toBeGreaterThanOrEqual(0);
    expect(px).toBeLessThanOrEqual(1000);
    expect(py).toBeGreaterThanOrEqual(0);
    expect(py).toBeLessThanOrEqual(400);
    expect(pz).toBeGreaterThanOrEqual(0);
    expect(pz).toBeLessThanOrEqual(400);
    // Velocity also bounded by vMax.
    const vx = Velocity.x[eid] as number;
    const vy = Velocity.y[eid] as number;
    const vz = Velocity.z[eid] as number;
    expect(Math.hypot(vx, vy, vz)).toBeLessThanOrEqual(top.schooling.vMax + 1);
  });
});
