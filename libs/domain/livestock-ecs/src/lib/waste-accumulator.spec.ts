/**
 * Waste accumulator unit tests (Stage 14 F14.4 — producer side).
 *
 * Covers: the per-fish baseline source term, the uneaten-food impulse raising
 * it, an EATEN sprite contributing nothing, and the determinism of the trace.
 */
import { MID_PRESET, type ResolvedBehavior } from '@aquascape/domain/livestock-behaviors';
// Import through the public barrel so the index re-exports are exercised.
import {
  createLivestockWorld,
  DEFAULT_FOOD_WASTE_FACTOR,
  FISH_ARCHETYPE,
  FISH_BASELINE_WASTE_N_MG_PER_DAY,
  FOOD_TYPE,
  FeedingDrive,
  recordUneatenFood,
  UNEATEN_FOOD_WASTE_N_MG_PER_CALORIE,
  WASTE_RATE_EMA_PER_SEC,
  wasteSystem,
  type LivestockWorld,
  type WasteAccumulator,
} from '../index';

// Touch the re-exported tuning constants + type so the barrel bindings cover.
void DEFAULT_FOOD_WASTE_FACTOR;
void UNEATEN_FOOD_WASTE_N_MG_PER_CALORIE;
void WASTE_RATE_EMA_PER_SEC;
const _wasteTypeProbe: WasteAccumulator | null = null;
void _wasteTypeProbe;

const SEED = 0x55aa33cc;
const SIM_DT = 1 / 30;
const TANK = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

function spawnFish(world: LivestockWorld, handle: number, n: number): void {
  for (let i = 0; i < n; i++) {
    world.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 200 + i * 10, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
  }
}

describe('waste accumulator (F14.4)', () => {
  it('an empty world has a zero waste source term', () => {
    const world = createLivestockWorld(SEED, { tankAabb: TANK });
    for (let i = 0; i < 100; i++) world.step(SIM_DT);
    expect(world.getWasteSourceN()).toBe(0);
  });

  it('a stocked tank converges its source term toward the per-fish baseline', () => {
    const world = createLivestockWorld(SEED, { tankAabb: TANK });
    const handle = world.registerSpeciesBehavior(1, MID_PRESET);
    spawnFish(world, handle, 5);
    // Run long enough for the EMA to settle toward the baseline.
    for (let i = 0; i < 20000; i++) world.step(SIM_DT);
    const expected = 5 * FISH_BASELINE_WASTE_N_MG_PER_DAY;
    expect(world.getWasteSourceN()).toBeCloseTo(expected, 1);
  });

  it('more fish → a higher steady source term', () => {
    function steady(n: number): number {
      const world = createLivestockWorld(SEED, { tankAabb: TANK });
      const handle = world.registerSpeciesBehavior(1, MID_PRESET);
      spawnFish(world, handle, n);
      for (let i = 0; i < 20000; i++) world.step(SIM_DT);
      return world.getWasteSourceN();
    }
    expect(steady(10)).toBeGreaterThan(steady(2));
  });

  it('uneaten food (lifetime expiry) raises the source term above the baseline', () => {
    const world = createLivestockWorld(SEED, { tankAabb: TANK });
    const handle = world.registerSpeciesBehavior(1, MID_PRESET);
    spawnFish(world, handle, 2);
    // Settle the baseline first.
    for (let i = 0; i < 5000; i++) world.step(SIM_DT);
    const baseline = world.getWasteSourceN();
    // Drop a short-lived sprite far from any fish so it rots uneaten. Put it in
    // a corner the schooling fish won't reach within the lifetime.
    world.spawnFoodSprite({ x: 980, y: 380, z: 380 }, 1, 5, FOOD_TYPE.PELLET, 0.5);
    // Run past the 1 s lifetime so the sprite rots + records its waste.
    for (let i = 0; i < 60; i++) world.step(SIM_DT);
    expect(world.getWasteSourceN()).toBeGreaterThan(baseline);
  });

  it('a higher wasteFactor releases more nitrogen than a clean food', () => {
    function pulse(wasteFactor: number): number {
      const world = createLivestockWorld(SEED, { tankAabb: TANK });
      // No fish so the baseline is zero — isolate the food impulse.
      world.spawnFoodSprite({ x: 980, y: 380, z: 380 }, 1, 5, FOOD_TYPE.PELLET, wasteFactor);
      // Run exactly to the rot tick, then read immediately (before the EMA
      // decays the impulse much).
      for (let i = 0; i < 32; i++) world.step(SIM_DT);
      return world.getWasteSourceN();
    }
    expect(pulse(0.8)).toBeGreaterThan(pulse(0.1));
  });

  it('an EATEN sprite contributes nothing to waste (only baseline remains)', () => {
    const world = createLivestockWorld(SEED, { tankAabb: TANK });
    const behavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    // Hungry fast + low threshold so the fish reaches + eats the sprite quickly.
    behavior.feeding = { hungerRatePerSec: 1 / 2, threshold: 0.1, category: 'midwater' };
    const handle = world.registerSpeciesBehavior(1, behavior);
    // One fish right next to the food so it's consumed (removeEntity directly,
    // NOT a lifetime expiry → recordUneatenFood never fires for it). Use a
    // near-neutral LIVE sprite (doesn't fast-sink away from the fish) + pre-set
    // the fish hungry so it seeks + eats on the first FORAGE tick.
    const fishEid = world.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    FeedingDrive.hunger[fishEid] = 1;
    world.spawnFoodSprite({ x: 505, y: 200, z: 200 }, 30, 1, FOOD_TYPE.LIVE, 1.0);
    for (let i = 0; i < 60; i++) world.step(SIM_DT);
    // The sprite was eaten within a few ticks → no uneaten-food impulse. The
    // source term reflects ONLY the single-fish baseline (well below what a
    // rotted high-waste sprite would have added).
    expect(world.getFoodSpriteCount()).toBe(0);
    // Baseline for 1 fish is tiny + the EMA hasn't fully converged; the key
    // assertion is that no large food impulse landed. Compare against a world
    // where the same sprite rots uneaten.
    const eaten = world.getWasteSourceN();

    const wasted = createLivestockWorld(SEED, { tankAabb: TANK });
    wasted.spawnFoodSprite({ x: 980, y: 380, z: 380 }, 1, 1, FOOD_TYPE.PELLET, 1.0);
    for (let i = 0; i < 60; i++) wasted.step(SIM_DT);
    expect(eaten).toBeLessThan(wasted.getWasteSourceN());
  });

  it('recordUneatenFood clamps wasteFactor + ignores non-positive calories', () => {
    const world = createLivestockWorld(SEED, { tankAabb: TANK });
    recordUneatenFood(world, 0, 1); // zero calories → no contribution
    expect(world.__waste.pendingUneatenN).toBe(0);
    recordUneatenFood(world, -5, 1); // negative calories → no contribution
    expect(world.__waste.pendingUneatenN).toBe(0);
    recordUneatenFood(world, 1, 2); // wasteFactor clamped to 1
    const clamped = world.__waste.pendingUneatenN;
    world.__waste.pendingUneatenN = 0;
    recordUneatenFood(world, 1, 1); // exactly 1
    expect(world.__waste.pendingUneatenN).toBe(clamped);
  });

  it('a fixed fish count + no food produces a byte-identical source-term trace across two cold worlds', () => {
    function run(): Float64Array {
      const world = createLivestockWorld(SEED, { tankAabb: TANK });
      const handle = world.registerSpeciesBehavior(1, MID_PRESET);
      spawnFish(world, handle, 4);
      const trace = new Float64Array(500);
      for (let i = 0; i < 500; i++) {
        world.step(SIM_DT);
        trace[i] = world.getWasteSourceN();
      }
      return trace;
    }
    const a = run();
    const b = run();
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i]);
  });

  it('wasteSystem can be driven standalone for an isolated unit check', () => {
    const world = createLivestockWorld(SEED, { tankAabb: TANK });
    const handle = world.registerSpeciesBehavior(1, MID_PRESET);
    spawnFish(world, handle, 3);
    // No full step — just the waste system. After one tick the rate has moved
    // off zero toward the 3-fish baseline.
    wasteSystem(world, SIM_DT);
    expect(world.getWasteSourceN()).toBeGreaterThan(0);
    expect(world.getWasteSourceN()).toBeLessThan(3 * FISH_BASELINE_WASTE_N_MG_PER_DAY);
  });

  it('degenerate dt is handled safely (dt=0 → no uneaten spike; large dt → EMA clamps to the instant rate)', () => {
    const world = createLivestockWorld(SEED, { tankAabb: TANK });
    const handle = world.registerSpeciesBehavior(1, MID_PRESET);
    spawnFish(world, handle, 2);
    // dt = 0 → the uneaten-rate branch divides nothing (guarded), and the EMA
    // alpha is 0 so the rate doesn't move. Must not NaN / spike.
    world.__waste.pendingUneatenN = 5;
    wasteSystem(world, 0);
    expect(Number.isFinite(world.getWasteSourceN())).toBe(true);
    expect(world.getWasteSourceN()).toBe(0);
    // A huge dt drives the EMA alpha past 1, where it clamps to 1 → the rate
    // snaps to the instantaneous baseline in a single step.
    wasteSystem(world, 1000);
    expect(world.getWasteSourceN()).toBeCloseTo(2 * FISH_BASELINE_WASTE_N_MG_PER_DAY, 5);
  });
});
