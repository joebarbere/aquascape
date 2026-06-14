/**
 * Typed food sink-kinematics tests (Stage 14 F14.1).
 *
 * Covers each food form's distinct trajectory through `world.step()` (the
 * kinematic system runs inside the step), the substrate-rest behaviour, the
 * deterministic live-food dart, and the per-type initial state. The
 * 1000-tick byte-identity gate for typed food lives in `determinism.spec.ts`.
 */
import {
  FLAKE_FLOAT_SECONDS,
  FLAKE_FLOAT_VY_MM_PER_S,
  FOOD_TYPE,
  FoodSprite,
  Position,
  foodSpriteKinematicSystem,
  initialFoodKinematics,
} from '../index';
import { createLivestockWorld, SIM_DT, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

/** Drop a sprite at mid-column and read its Y after `ticks` of the system. */
function dropAndRun(foodType: number, ticks: number, y0 = 300): { eid: number; y: number; world: ReturnType<typeof createLivestockWorld> } {
  const w = createLivestockWorld(0, { tankAabb: TANK });
  // Long lifetime so the lifetime system never despawns it under us.
  const eid = w.spawnFoodSprite({ x: 500, y: y0, z: 200 }, 10_000, 1, foodType);
  for (let i = 0; i < ticks; i++) foodSpriteKinematicSystem(w, SIM_DT);
  return { eid, y: Position.y[eid] as number, world: w };
}

describe('initialFoodKinematics — per-type seed state', () => {
  it('flake starts buoyant with a float window', () => {
    const k = initialFoodKinematics(FOOD_TYPE.FLAKE);
    expect(k.vy).toBe(FLAKE_FLOAT_VY_MM_PER_S);
    expect(k.floatRemaining).toBe(FLAKE_FLOAT_SECONDS);
  });

  it('pellet / wafer / live start at rest with no float window', () => {
    for (const t of [FOOD_TYPE.PELLET, FOOD_TYPE.WAFER, FOOD_TYPE.LIVE]) {
      const k = initialFoodKinematics(t);
      expect(k.vy).toBe(0);
      expect(k.floatRemaining).toBe(0);
    }
  });
});

describe('foodSpriteKinematicSystem — per-type trajectories', () => {
  it('flake floats UP briefly then sinks (net rise during the float window)', () => {
    // After ~1s (30 ticks) the flake is still in its float window → it has
    // risen above the start Y.
    const start = 300;
    const after1s = dropAndRun(FOOD_TYPE.FLAKE, 30, start);
    expect(after1s.y).toBeGreaterThan(start);
    // Well past the float window it is sinking — lower than the float peak.
    const afterLong = dropAndRun(FOOD_TYPE.FLAKE, 30 * (FLAKE_FLOAT_SECONDS + 6), start);
    expect(afterLong.y).toBeLessThan(after1s.y);
  });

  it('pellet sinks FAST — past the wafer at the same tick count', () => {
    const pellet = dropAndRun(FOOD_TYPE.PELLET, 60, 380);
    const wafer = dropAndRun(FOOD_TYPE.WAFER, 60, 380);
    // Both sink; the pellet is deeper (lower Y) because its terminal speed
    // is higher.
    expect(pellet.y).toBeLessThan(380);
    expect(wafer.y).toBeLessThan(380);
    expect(pellet.y).toBeLessThan(wafer.y);
  });

  it('wafer settles ON the substrate + rests there (vy → 0, Y pinned to floor)', () => {
    const { eid, world } = dropAndRun(FOOD_TYPE.WAFER, 60 * 30, 380); // plenty of time to reach floor
    expect(Position.y[eid] as number).toBe(TANK.minY);
    expect(FoodSprite.vy[eid] as number).toBe(0);
    // Another 100 ticks — it stays put.
    for (let i = 0; i < 100; i++) foodSpriteKinematicSystem(world, SIM_DT);
    expect(Position.y[eid] as number).toBe(TANK.minY);
  });

  it('flake also eventually settles on the substrate', () => {
    const { eid } = dropAndRun(FOOD_TYPE.FLAKE, 200 * 30, 380);
    expect(Position.y[eid] as number).toBe(TANK.minY);
  });

  it('live food darts laterally (X/Z move) while drifting', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const eid = w.spawnFoodSprite({ x: 500, y: 300, z: 200 }, 10_000, 1, FOOD_TYPE.LIVE);
    const x0 = Position.x[eid] as number;
    const z0 = Position.z[eid] as number;
    for (let i = 0; i < 30; i++) foodSpriteKinematicSystem(w, SIM_DT);
    // The deterministic dart moves the sprite off its spawn XZ.
    const moved =
      Math.abs((Position.x[eid] as number) - x0) > 0.1 ||
      Math.abs((Position.z[eid] as number) - z0) > 0.1;
    expect(moved).toBe(true);
  });

  it('a buoyant flake never breaches the waterline', () => {
    // Spawn a flake right at the surface — its upward float must be clamped.
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const eid = w.spawnFoodSprite({ x: 500, y: TANK.maxY, z: 200 }, 10_000, 1, FOOD_TYPE.FLAKE);
    for (let i = 0; i < 30; i++) foodSpriteKinematicSystem(w, SIM_DT);
    expect(Position.y[eid] as number).toBeLessThanOrEqual(TANK.maxY);
  });

  it('default foodType is FLAKE when omitted', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const eid = w.spawnFoodSprite({ x: 500, y: 300, z: 200 });
    expect(FoodSprite.foodType[eid] as number).toBe(FOOD_TYPE.FLAKE);
  });
});

describe('foodSpriteKinematicSystem — determinism', () => {
  it('two cold worlds advect identical live-food darts byte-for-byte', () => {
    function run(): Float32Array {
      const w = createLivestockWorld(0xdeadbeef, { tankAabb: TANK });
      for (let i = 0; i < 4; i++) {
        w.spawnFoodSprite({ x: 200 + i * 100, y: 300, z: 200 }, 10_000, 1, FOOD_TYPE.LIVE);
      }
      for (let i = 0; i < 300; i++) foodSpriteKinematicSystem(w, SIM_DT);
      const snap = w.snapshot(0);
      return new Float32Array(snap.foodSpritePosition);
    }
    const a = run();
    const b = run();
    expect(a.length).toBe(b.length);
    const av = new Uint8Array(a.buffer);
    const bv = new Uint8Array(b.buffer);
    let equal = true;
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) equal = false;
    expect(equal).toBe(true);
  });
});
