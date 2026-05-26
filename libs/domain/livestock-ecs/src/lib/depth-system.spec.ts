import { BOTTOM_PRESET, MID_PRESET, TOP_PRESET } from '@aquascape/domain/livestock-behaviors';
import { FISH_ARCHETYPE, Position } from './components';
import { createLivestockWorld, SIM_DT, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };
const TANK_HEIGHT = TANK.maxY - TANK.minY;

function spawnAt(
  world: ReturnType<typeof createLivestockWorld>,
  x: number,
  y: number,
  z: number,
  handle: number,
) {
  return world.spawnFish({
    archetype: FISH_ARCHETYPE.SLIM_TETRA,
    speciesId: 1,
    bodyLengthMm: 30,
    position: { x, y, z },
    behaviorHandleIdx: handle,
  });
}

function meanY(world: ReturnType<typeof createLivestockWorld>, eids: number[]): number {
  let sum = 0;
  for (const eid of eids) sum += Position.y[eid] as number;
  return sum / eids.length;
}

describe('depthSystem — vertical stratification phase tests', () => {
  it('TOP_PRESET — surface dwellers settle in the upper band', () => {
    const w = createLivestockWorld(0xdeadbeef, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, TOP_PRESET);
    // Start every fish at mid-depth — depth force must drag them upward.
    // Spawn far enough apart that they don't collide in xz (which would
    // dominate motion via separation forces from SchoolingSystem and
    // obscure the vertical-band measurement we actually care about here).
    const eids: number[] = [];
    for (let i = 0; i < 6; i++)
      eids.push(spawnAt(w, 100 + i * 150, TANK_HEIGHT * 0.5, 100 + i * 50, handle));
    // Warm-up 100 ticks first — the depth spring is constant-force so
    // we need to wait for velocity to settle.
    for (let t = 0; t < 100; t++) w.step(SIM_DT);
    let sum = 0;
    for (let t = 0; t < 100; t++) {
      w.step(SIM_DT);
      sum += meanY(w, eids);
    }
    const avg = sum / 100;
    // Acceptance: mean Y ≥ 0.85 * tankHeight. With TOP_PRESET (preferredY
    // = 0.92, bandWidth = 0.06), the band lower bound is 0.86 * H. The
    // 0.85 threshold is a slight relaxation that survives schooling noise.
    expect(avg).toBeGreaterThanOrEqual(0.85 * TANK_HEIGHT);
  });

  it('BOTTOM_PRESET — substrate dwellers settle in the lower band', () => {
    const w = createLivestockWorld(0xdeadbeef, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, BOTTOM_PRESET);
    const eids: number[] = [];
    for (let i = 0; i < 6; i++)
      eids.push(spawnAt(w, 100 + i * 150, TANK_HEIGHT * 0.5, 100 + i * 50, handle));
    for (let t = 0; t < 100; t++) w.step(SIM_DT);
    let sum = 0;
    for (let t = 0; t < 100; t++) {
      w.step(SIM_DT);
      sum += meanY(w, eids);
    }
    const avg = sum / 100;
    expect(avg).toBeLessThanOrEqual(0.15 * TANK_HEIGHT);
  });

  it('MID_PRESET — mid-water schoolers cluster around preferredY * tankHeight', () => {
    const w = createLivestockWorld(42, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    const eids: number[] = [];
    // Stagger initial positions across full height — they should converge
    // into the band.
    for (let i = 0; i < 12; i++) {
      const y = TANK.minY + (i / 12) * TANK_HEIGHT;
      eids.push(spawnAt(w, 100 + i * 30, y, 100, handle));
    }
    // Warm-up 100 ticks, then average over next 100.
    for (let t = 0; t < 100; t++) w.step(SIM_DT);
    let sum = 0;
    for (let t = 0; t < 100; t++) {
      w.step(SIM_DT);
      sum += meanY(w, eids);
    }
    const avg = sum / 100;
    const target = MID_PRESET.depth.preferredY * TANK_HEIGHT;
    const tol = MID_PRESET.depth.bandWidth * TANK_HEIGHT;
    expect(Math.abs(avg - target)).toBeLessThanOrEqual(tol);
  });

  it('no-op when behaviour handle is unregistered (F11.1 static-wiggle path)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    // No registerSpeciesBehavior call — handle stays at NO_BEHAVIOR_HANDLE
    // by default.
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 100, y: 200, z: 100 },
    });
    const startY = Position.y[eid] as number;
    for (let t = 0; t < 30; t++) w.step(SIM_DT);
    // Position.y unchanged (no behaviour → no force → no velocity).
    expect(Position.y[eid]).toBeCloseTo(startY);
  });
});
