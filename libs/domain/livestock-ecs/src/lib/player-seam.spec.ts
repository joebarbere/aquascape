/**
 * Stage 16 F16.1 — the player-control seam.
 *
 * Two guarantees:
 *   1. A marked player's Velocity is overwritten by the injected input each
 *      `step()`, the AI integrator skips it, and KinematicSystem integrates
 *      the injected velocity (so the player MOVES under input — input →
 *      position mapping).
 *   2. A world with NO player marked replays byte-identically to a baseline
 *      — the injection path is a strict no-op, so the 1000-tick determinism
 *      contract for non-game worlds holds.
 */
import { MID_PRESET, type ResolvedBehavior } from '@aquascape/domain/livestock-behaviors';
import { FISH_ARCHETYPE, NO_ENTITY_REF, Position, Velocity } from '../index';
import { createLivestockWorld, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };
const SIM_DT = 1 / 30;
const SEED = 0x16f16a1;

const BEHAVIOR: ResolvedBehavior = MID_PRESET;

function spawnTwoFish(seed: number) {
  const world = createLivestockWorld(seed, { tankAabb: { ...TANK } });
  const handle = world.registerSpeciesBehavior(1, BEHAVIOR);
  const a = world.spawnFish({
    archetype: FISH_ARCHETYPE.SLIM_TETRA,
    speciesId: 1,
    bodyLengthMm: 30,
    position: { x: 500, y: 200, z: 200 },
    behaviorHandleIdx: handle,
  });
  const b = world.spawnFish({
    archetype: FISH_ARCHETYPE.SLIM_TETRA,
    speciesId: 1,
    bodyLengthMm: 30,
    position: { x: 520, y: 210, z: 190 },
    behaviorHandleIdx: handle,
  });
  return { world, a, b };
}

describe('player seam — marking + injection', () => {
  it('defaults to no player', () => {
    const { world } = spawnTwoFish(SEED);
    expect(world.getPlayerEntity()).toBe(NO_ENTITY_REF);
  });

  it('setPlayer / clearPlayer round-trips the marked eid', () => {
    const { world, a } = spawnTwoFish(SEED);
    world.setPlayer(a);
    expect(world.getPlayerEntity()).toBe(a);
    world.clearPlayer();
    expect(world.getPlayerEntity()).toBe(NO_ENTITY_REF);
  });

  it('setPlayer(NO_ENTITY_REF) clears the player', () => {
    const { world, a } = spawnTwoFish(SEED);
    world.setPlayer(a);
    world.setPlayer(NO_ENTITY_REF);
    expect(world.getPlayerEntity()).toBe(NO_ENTITY_REF);
  });

  it('injects the player velocity onto Velocity each step (input → velocity)', () => {
    const { world, a } = spawnTwoFish(SEED);
    world.setPlayer(a);
    world.setPlayerVelocity(60, -30, 12);
    world.step(SIM_DT);
    expect(Velocity.x[a]).toBeCloseTo(60, 5);
    expect(Velocity.y[a]).toBeCloseTo(-30, 5);
    expect(Velocity.z[a]).toBeCloseTo(12, 5);
  });

  it('moves the player by the injected velocity (input → position)', () => {
    const { world, a } = spawnTwoFish(SEED);
    world.setPlayer(a);
    const x0 = Position.x[a] as number;
    const z0 = Position.z[a] as number;
    world.setPlayerVelocity(90, 0, 0);
    world.step(SIM_DT);
    // Position += velocity * dt; AABB clamp doesn't bite at x=500 mid-tank.
    expect(Position.x[a] as number).toBeCloseTo(x0 + 90 * SIM_DT, 4);
    expect(Position.z[a] as number).toBeCloseTo(z0, 4);
  });

  it('a zero injected velocity keeps the player essentially still (no AI drift)', () => {
    // Spawn a single fish so no collision-separation nudges the player; the
    // guarantee is that with zero injected velocity the AI steering forces
    // (schooling / depth / stall-nudge) never move the player.
    const world = createLivestockWorld(SEED, { tankAabb: { ...TANK } });
    const handle = world.registerSpeciesBehavior(1, BEHAVIOR);
    const a = world.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    world.setPlayer(a);
    world.setPlayerVelocity(0, 0, 0);
    const x0 = Position.x[a] as number;
    const y0 = Position.y[a] as number;
    const z0 = Position.z[a] as number;
    for (let i = 0; i < 50; i++) world.step(SIM_DT);
    expect(Position.x[a] as number).toBeCloseTo(x0, 4);
    expect(Position.y[a] as number).toBeCloseTo(y0, 4);
    expect(Position.z[a] as number).toBeCloseTo(z0, 4);
  });

  it('a non-player fish still moves under AI steering while the player is held still', () => {
    const { world, a, b } = spawnTwoFish(SEED);
    world.setPlayer(a);
    world.setPlayerVelocity(0, 0, 0);
    const bx0 = Position.x[b] as number;
    const by0 = Position.y[b] as number;
    const bz0 = Position.z[b] as number;
    for (let i = 0; i < 50; i++) world.step(SIM_DT);
    const moved =
      Math.abs((Position.x[b] as number) - bx0) +
      Math.abs((Position.y[b] as number) - by0) +
      Math.abs((Position.z[b] as number) - bz0);
    expect(moved).toBeGreaterThan(0.1);
  });

  it('setPlayerVelocity is a no-op when no player is marked', () => {
    const { world, a } = spawnTwoFish(SEED);
    // No setPlayer call.
    world.setPlayerVelocity(500, 500, 500);
    expect(() => world.step(SIM_DT)).not.toThrow();
    // Fish `a` is AI-driven, so its velocity is whatever steering produced —
    // certainly not the injected (500,500,500).
    expect(Velocity.x[a] as number).not.toBeCloseTo(500, 1);
  });
});

describe('player seam — determinism (no player marked)', () => {
  function runNoPlayer(seed: number, ticks: number): Float32Array {
    const { world } = spawnTwoFish(seed);
    for (let i = 0; i < ticks; i++) world.step(SIM_DT);
    return new Float32Array(world.snapshot(0).position);
  }

  it('a world with no player marked replays byte-identically', () => {
    const a = runNoPlayer(SEED, 1000);
    const b = runNoPlayer(SEED, 1000);
    const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    expect(av.byteLength).toBe(bv.byteLength);
    for (let i = 0; i < av.length; i++) {
      expect(av[i]).toBe(bv[i]);
    }
  });
});
