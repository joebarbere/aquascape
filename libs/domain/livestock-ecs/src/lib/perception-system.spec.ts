import { MID_PRESET } from '@aquascape/domain/livestock-behaviors';
import { FISH_ARCHETYPE } from './components';
import { perceptionSystem } from './perception-system';
import { createLivestockWorld } from './world';

function spawn(
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

describe('perceptionSystem', () => {
  it('inserts every Position-bearing entity into the spatial grid', () => {
    const w = createLivestockWorld(0, { tankAabb: { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 } });
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    spawn(w, 100, 100, 100, handle);
    spawn(w, 105, 100, 100, handle);
    spawn(w, 500, 200, 200, handle);
    perceptionSystem(w);
    expect(w.spatialGrid.size).toBe(3);
  });

  it('clears the grid before each rebuild (no stale state across ticks)', () => {
    const w = createLivestockWorld(0);
    const handle = w.registerSpeciesBehavior(1, MID_PRESET);
    const a = spawn(w, 50, 50, 50, handle);
    perceptionSystem(w);
    expect(w.spatialGrid.size).toBe(1);
    w.despawn(a);
    perceptionSystem(w);
    // Despawned entity should NOT remain in the grid.
    expect(w.spatialGrid.size).toBe(0);
  });

  it('returns expected eids when queried within ZOA of a probe point', () => {
    const w = createLivestockWorld(0);
    const handle = w.registerSpeciesBehavior(1, MID_PRESET); // ZOA = 90
    // Cluster of 5 near (100,100,100); 5 far away near (500,500,500).
    const near: number[] = [];
    for (let i = 0; i < 5; i++) near.push(spawn(w, 100 + i * 5, 100, 100, handle));
    for (let i = 0; i < 5; i++) spawn(w, 500 + i * 5, 500, 500, handle);
    perceptionSystem(w);
    const hits = Array.from(w.spatialGrid.query(100, 100, 100, MID_PRESET.schooling.ZOA));
    for (const eid of near) expect(hits).toContain(eid);
  });

  it('resizes the grid cell when the max neighbour radius shifts', () => {
    const w = createLivestockWorld(0);
    const initialCell = w.spatialGrid.cellSizeMm;
    // Default fallback before any species is registered.
    expect(initialCell).toBe(50);
    w.registerSpeciesBehavior(1, MID_PRESET);
    perceptionSystem(w);
    // After registration, cell should match the new max (ZOA=90).
    expect(w.spatialGrid.cellSizeMm).toBe(
      MID_PRESET.schooling.ZOA,
    );
  });
});
