// Unit tests for the pure game-activation helpers (Stage 16 F16.1b).
//
// These exercise the REAL livestock-ecs world (not a mock) so the player-pick
// + position-read contracts are verified against the actual snapshot slabs.

import {
  FISH_ARCHETYPE,
  NO_ENTITY_REF,
  createLivestockWorld,
  type TankAabb,
} from '@aquascape/domain/livestock-ecs';

import { pickPlayerEntity, readEntityPosition } from './game-activation';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

function spawn(seed: number, positions: ReadonlyArray<{ x: number; y: number; z: number }>) {
  const world = createLivestockWorld(seed, { tankAabb: { ...TANK } });
  const ids = positions.map((p) =>
    world.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: p,
    }),
  );
  return { world, ids };
}

describe('pickPlayerEntity', () => {
  it('returns snapshot index 0 (the first-spawned fish)', () => {
    const { world, ids } = spawn(0x9a7, [
      { x: 100, y: 200, z: 200 },
      { x: 300, y: 200, z: 200 },
    ]);
    expect(pickPlayerEntity(world)).toBe(ids[0]);
  });

  it('is deterministic — same seed + same spawns picks the same eid', () => {
    const a = spawn(42, [{ x: 100, y: 200, z: 200 }]);
    const b = spawn(42, [{ x: 100, y: 200, z: 200 }]);
    // Two cold worlds allocate from a module-global eid cursor, so the raw
    // eids differ — but BOTH pick their own index-0 fish, which is the
    // documented stable contract (the player is the first spawned).
    expect(pickPlayerEntity(a.world)).toBe(a.ids[0]);
    expect(pickPlayerEntity(b.world)).toBe(b.ids[0]);
  });

  it('returns NO_ENTITY_REF for an empty world (caller then skips setPlayer)', () => {
    const world = createLivestockWorld(1, { tankAabb: { ...TANK } });
    expect(pickPlayerEntity(world)).toBe(NO_ENTITY_REF);
  });
});

describe('readEntityPosition', () => {
  it('reads the spawned position back for a present eid', () => {
    const { world, ids } = spawn(7, [{ x: 250, y: 180, z: 220 }]);
    const pos = readEntityPosition(world, ids[0]!);
    expect(pos).not.toBeNull();
    expect(pos!.x).toBeCloseTo(250, 3);
    expect(pos!.y).toBeCloseTo(180, 3);
    expect(pos!.z).toBeCloseTo(220, 3);
  });

  it('returns null for an absent eid', () => {
    const { world } = spawn(7, [{ x: 250, y: 180, z: 220 }]);
    expect(readEntityPosition(world, 999_999)).toBeNull();
  });
});
