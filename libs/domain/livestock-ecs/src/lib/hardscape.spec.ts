/**
 * Hardscape registration + auto-anchor assignment tests (Stage 11 F11.3).
 */
import { defineQuery } from 'bitecs';
import {
  MID_PRESET,
  type ResolvedBehavior,
} from '@aquascape/domain/livestock-behaviors';
import {
  FISH_ARCHETYPE,
  HARDSCAPE_CATEGORY,
  Hardscape,
  Position,
  Territory,
} from './components';
import { createLivestockWorld, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

function clone(p: ResolvedBehavior): ResolvedBehavior {
  return JSON.parse(JSON.stringify(p)) as ResolvedBehavior;
}

function ramParams(): ResolvedBehavior {
  const p = clone(MID_PRESET);
  p.territory = {
    coreRadius: 60,
    displayRadius: 120,
    aggression: 200,
    fatigueRate: 0.1,
  };
  return p;
}

describe('world.registerHardscape', () => {
  it('creates the correct number of Hardscape-tagged entities', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    expect(w.getHardscapeCount()).toBe(0);
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
      { position: { x: 200, y: 0, z: 200 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
      { position: { x: 300, y: 0, z: 300 }, coverScore: 0.0, category: HARDSCAPE_CATEGORY.OTHER },
    ]);
    expect(w.getHardscapeCount()).toBe(3);
    const q = defineQuery([Hardscape]);
    expect(q(w.ecs).length).toBe(3);
  });

  it('persists coverScore + category on the bitECS slabs', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 100, y: 50, z: 100 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
    ]);
    const q = defineQuery([Hardscape, Position]);
    const eids = q(w.ecs);
    expect(eids.length).toBe(1);
    const eid = eids[0] as number;
    expect(Position.x[eid]).toBeCloseTo(100);
    expect(Position.y[eid]).toBeCloseTo(50);
    expect(Position.z[eid]).toBeCloseTo(100);
    expect(Hardscape.coverScore[eid]).toBeCloseTo(0.6);
    expect(Hardscape.category[eid]).toBe(HARDSCAPE_CATEGORY.WOOD);
  });

  it('clamps coverScore to [0, 1]', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 0, y: 0, z: 0 }, coverScore: -0.5, category: HARDSCAPE_CATEGORY.WOOD },
      { position: { x: 100, y: 0, z: 0 }, coverScore: 1.5, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    const q = defineQuery([Hardscape]);
    const eids = q(w.ecs);
    expect(eids.length).toBe(2);
    expect(Hardscape.coverScore[eids[0] as number]).toBe(0);
    expect(Hardscape.coverScore[eids[1] as number]).toBe(1);
  });

  it('re-registration replaces the set (no leftovers, no double-counting)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
      { position: { x: 200, y: 0, z: 200 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
      { position: { x: 300, y: 0, z: 300 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
    ]);
    expect(w.getHardscapeCount()).toBe(3);
    w.registerHardscape([
      { position: { x: 500, y: 0, z: 500 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    expect(w.getHardscapeCount()).toBe(1);
    const q = defineQuery([Hardscape]);
    expect(q(w.ecs).length).toBe(1);
  });

  it('empty re-registration clears the set', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
    ]);
    expect(w.getHardscapeCount()).toBe(1);
    w.registerHardscape([]);
    expect(w.getHardscapeCount()).toBe(0);
  });

  it('dispose clears the hardscape registry', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
    ]);
    expect(w.getHardscapeCount()).toBe(1);
    w.dispose();
    expect(w.getHardscapeCount()).toBe(0);
  });
});

describe('auto-anchor assignment on spawn', () => {
  it('territorial spawn within 2*coreRadius → anchorEid set to nearest hardscape', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    // coreRadius = 60 → range = 120 mm.
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
      { position: { x: 300, y: 0, z: 300 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    const handle = w.registerSpeciesBehavior(1, ramParams());
    const ram = w.spawnFish({
      archetype: FISH_ARCHETYPE.DEEP_BODIED,
      speciesId: 1,
      bodyLengthMm: 80,
      // Spawn ~14 mm from first hardscape, ~280 mm from second.
      // Distance limit: 2 * 60 = 120. First hardscape (within range)
      // is picked.
      position: { x: 110, y: 0, z: 110 },
      behaviorHandleIdx: handle,
    });
    const anchor = w.getEntityTerritoryAnchor(ram);
    if (anchor === null) throw new Error('expected anchor to be assigned');
    // Picked hardscape position should match the first one (100, 0, 100).
    expect(Position.x[anchor]).toBeCloseTo(100);
    expect(Position.z[anchor]).toBeCloseTo(100);
  });

  it('territorial spawn with no hardscape in range → getEntityTerritoryAnchor returns null', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 900, y: 0, z: 900 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    const handle = w.registerSpeciesBehavior(1, ramParams());
    const ram = w.spawnFish({
      archetype: FISH_ARCHETYPE.DEEP_BODIED,
      speciesId: 1,
      bodyLengthMm: 80,
      // 800 mm away — way outside 2 * 60 = 120.
      position: { x: 100, y: 0, z: 100 },
      behaviorHandleIdx: handle,
    });
    expect(w.getEntityTerritoryAnchor(ram)).toBeNull();
    // The slab carries the NO_ENTITY_REF sentinel rather than 0.
    expect(Territory.anchorEid[ram]).toBe(0xffffffff);
  });

  it('non-territorial species → getEntityTerritoryAnchor returns null', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    // MID_PRESET has territory = null.
    const handle = w.registerSpeciesBehavior(2, clone(MID_PRESET));
    const tetra = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 2,
      bodyLengthMm: 30,
      position: { x: 100, y: 0, z: 100 },
      behaviorHandleIdx: handle,
    });
    expect(w.getEntityTerritoryAnchor(tetra)).toBeNull();
  });

  it('NO_BEHAVIOR_HANDLE entity → getEntityTerritoryAnchor returns null', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    // No species registered; default handle is NO_BEHAVIOR_HANDLE.
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 0,
      bodyLengthMm: 30,
      position: { x: 100, y: 0, z: 100 },
    });
    expect(w.getEntityTerritoryAnchor(eid)).toBeNull();
  });

  it('picks the nearest hardscape when multiple are in range', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 0, y: 0, z: 0 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
      { position: { x: 50, y: 0, z: 0 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
      { position: { x: 100, y: 0, z: 0 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    const handle = w.registerSpeciesBehavior(1, ramParams());
    const ram = w.spawnFish({
      archetype: FISH_ARCHETYPE.DEEP_BODIED,
      speciesId: 1,
      bodyLengthMm: 80,
      position: { x: 60, y: 0, z: 0 }, // closest to (50, 0, 0)
      behaviorHandleIdx: handle,
    });
    const anchor = w.getEntityTerritoryAnchor(ram);
    if (anchor === null) throw new Error('expected anchor to be assigned');
    expect(Position.x[anchor]).toBeCloseTo(50);
  });
});

describe('world.injectStartle', () => {
  it('accumulates magnitudes per eid', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 0, y: 0, z: 0 },
    });
    w.injectStartle(eid, 0.5);
    w.injectStartle(eid, 0.3);
    // Internal map is shared via __internals (test surface).
    expect(w.__internals.pendingStartles.get(eid)).toBeCloseTo(0.8);
  });

  it('ignores non-positive magnitudes', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 0, y: 0, z: 0 },
    });
    w.injectStartle(eid, 0);
    w.injectStartle(eid, -1);
    expect(w.__internals.pendingStartles.get(eid)).toBeUndefined();
  });
});

describe('world.getHardscapeEntities (Stage 16 F16.5 cleaner seam)', () => {
  it('snapshots the registered hardscape eids + positions', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
      { position: { x: 200, y: 10, z: 300 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
    ]);
    const rows = w.getHardscapeEntities();
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ x: 100, y: 0, z: 100 });
    expect(rows[1]).toMatchObject({ x: 200, y: 10, z: 300 });
    // Every returned eid resolves to a real per-type algae record.
    for (const r of rows) expect(w.getAlgaeByType(r.eid)).not.toBeNull();
  });

  it('is empty when no hardscape is registered', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    expect(w.getHardscapeEntities()).toEqual([]);
  });
});

describe('world.raspAlgaeType (Stage 16 F16.5 cleaner mutation)', () => {
  function rockWorld() {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    const eid = w.getHardscapeEntities()[0]!.eid;
    return { w, eid };
  }

  it('reduces one type, leaves the others, and re-derives the aggregate', () => {
    const { w, eid } = rockWorld();
    const before = w.getAlgaeByType(eid)!; // each type seeded at 0.25 (total 1.0)
    const removed = w.raspAlgaeType(eid, 'green-spot', 0.1);
    expect(removed).toBeCloseTo(0.1);
    const after = w.getAlgaeByType(eid)!;
    expect(after['green-spot']).toBeCloseTo(before['green-spot'] - 0.1);
    expect(after.hair).toBe(before.hair);
    expect(after['black-beard']).toBe(before['black-beard']);
    expect(after.diatom).toBe(before.diatom);
    // Aggregate score dropped in lock-step (was 1.0 → 0.9).
    expect(w.getAlgaeScore(eid)).toBeCloseTo(0.9);
  });

  it('clamps the stock at zero and returns only what was actually removed', () => {
    const { w, eid } = rockWorld(); // green-spot starts at 0.25
    const removed = w.raspAlgaeType(eid, 'green-spot', 1.0); // ask for more than present
    expect(removed).toBeCloseTo(0.25);
    expect(w.getAlgaeByType(eid)!['green-spot']).toBe(0);
    // A second rasp on the empty type is a no-op.
    expect(w.raspAlgaeType(eid, 'green-spot', 0.1)).toBe(0);
  });

  it('is a no-op (0) for a non-hardscape eid, a non-positive amount', () => {
    const { w, eid } = rockWorld();
    expect(w.raspAlgaeType(999999, 'green-spot', 0.1)).toBe(0);
    expect(w.raspAlgaeType(eid, 'green-spot', 0)).toBe(0);
    expect(w.raspAlgaeType(eid, 'green-spot', -1)).toBe(0);
  });
});
