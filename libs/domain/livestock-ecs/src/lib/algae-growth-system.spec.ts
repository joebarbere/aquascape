/**
 * Stage 13 F13.6 — per-type algae simulation tests.
 *
 * Covers the acceptance criterion ("Algae grows faster under high nitrate +
 * long photoperiod; grazing reduces it"), the per-type differentiation driven
 * by the catalog config, type-selective grazing + the generalist fallback, and
 * the default-safe / determinism guarantees:
 *   - nitrate 0 (the default) ⇒ NO growth (a chemistry-less world is benign).
 *   - same seed + same (nitrate, photoperiod, flow) ⇒ byte-identical algae over
 *     1000 ticks (extends the replay gate to the new state).
 */
import { MID_PRESET, type ResolvedBehavior } from '@aquascape/domain/livestock-behaviors';
import { bakeFlowField } from '@aquascape/domain/fluid-sim';
import { FISH_ARCHETYPE, HARDSCAPE_CATEGORY } from '../index';
import { createLivestockWorld, type LivestockWorld, type TankAabb } from './world';
import { ALGAE_TYPE_FIELDS } from './algae-growth-system';
import { Hardscape } from './components';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };
const SEED = 0x13f60a1;
const SIM_DT = 1 / 30;

/** Build a world with one rock (all per-type stocks start at 1.0/4 = 0.25). */
function worldWithRock(): { world: LivestockWorld; rockEid: number } {
  const world = createLivestockWorld(SEED, { tankAabb: TANK });
  world.registerHardscape([
    { position: { x: 300, y: 80, z: 200 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
  ]);
  // The single hardscape entity is the only one in getAlgaeByType range.
  const rockEid = findHardscapeEid(world);
  return { world, rockEid };
}

/**
 * The lone hardscape eid. bitECS eids are module-global, so by the time this
 * spec runs the cursor is well past a small cap — scan a wide range and return
 * the first eid this world recognises as hardscape (per-world getAlgaeScore
 * returns null otherwise).
 */
function findHardscapeEid(world: LivestockWorld): number {
  for (let eid = 0; eid < 100000; eid++) {
    if (world.getAlgaeScore(eid) !== null) return eid;
  }
  throw new Error('no hardscape found');
}

function stepN(world: LivestockWorld, n: number): void {
  for (let i = 0; i < n; i++) world.step(SIM_DT);
}

/** Sum of the four per-type stocks on a rock. */
function totalAlgae(world: LivestockWorld, eid: number): number {
  const t = world.getAlgaeByType(eid);
  if (t === null) return 0;
  return ALGAE_TYPE_FIELDS.reduce((acc, { type }) => acc + t[type], 0);
}

describe('algaeGrowthSystem — growth drivers (F13.6 acceptance)', () => {
  it('nitrate 0 (default) grows NO algae — chemistry-less world is benign', () => {
    const { world, rockEid } = worldWithRock();
    // Graze the rock to near-bare first so we can see whether it regrows.
    world.setPhotoperiodHours(11);
    // Manually drain the per-type stocks via a long run with no nitrate.
    const before = totalAlgae(world, rockEid);
    stepN(world, 600); // 20 s sim time, nitrate still 0
    const after = totalAlgae(world, rockEid);
    expect(after).toBeCloseTo(before, 6); // unchanged — no growth at nitrate 0
  });

  it('grows faster under HIGH nitrate than low nitrate (same photoperiod)', () => {
    function grown(nitrate: number): number {
      const { world, rockEid } = worldWithRock();
      // Start from a partially-grazed rock so there's headroom to grow into.
      drainAllTypes(world, rockEid, 0.2);
      world.setPhotoperiodHours(11);
      world.setWaterQuality({ ammonia: 0, nitrite: 0, nitrate });
      stepN(world, 300);
      return totalAlgae(world, rockEid);
    }
    const lowN = grown(2);
    const highN = grown(40);
    expect(highN).toBeGreaterThan(lowN);
  });

  it('grows faster under a LONG photoperiod than a short one (same nitrate)', () => {
    function grown(hours: number): number {
      const { world, rockEid } = worldWithRock();
      drainAllTypes(world, rockEid, 0.2);
      world.setPhotoperiodHours(hours);
      world.setWaterQuality({ ammonia: 0, nitrite: 0, nitrate: 30 });
      stepN(world, 300);
      return totalAlgae(world, rockEid);
    }
    // 2 h is far below every type's optimum; 11 h sits near the bright-light
    // types' optima — so the long photoperiod grows more total algae.
    const shortDay = grown(2);
    const longDay = grown(11);
    expect(longDay).toBeGreaterThan(shortDay);
  });

  it('the aggregate algaeScore tracks the per-type stock sum (clamped to 1)', () => {
    const { world, rockEid } = worldWithRock();
    world.setPhotoperiodHours(11);
    world.setWaterQuality({ ammonia: 0, nitrite: 0, nitrate: 40 });
    stepN(world, 200);
    const sum = totalAlgae(world, rockEid);
    const agg = world.getAlgaeScore(rockEid) as number;
    expect(agg).toBeCloseTo(Math.min(1, sum), 5);
  });
});

describe('algaeGrowthSystem — per-type catalog differentiation', () => {
  it('a higher growthRate for one type makes it outgrow the others', () => {
    const { world, rockEid } = worldWithRock();
    drainAllTypes(world, rockEid, 0.1);
    // Register profiles: pump green-spot, suppress the rest.
    world.registerAlgaeProfiles({
      'green-spot': { growthRate: 1, lightDependence: 0.9 },
      hair: { growthRate: 0.05, lightDependence: 0.9 },
      'black-beard': { growthRate: 0.05, lightDependence: 0.5 },
      diatom: { growthRate: 0.05, lightDependence: 0.2 },
    });
    world.setPhotoperiodHours(10); // green-spot optimum
    world.setWaterQuality({ ammonia: 0, nitrite: 0, nitrate: 40 });
    stepN(world, 300);
    const t = world.getAlgaeByType(rockEid)!;
    expect(t['green-spot']).toBeGreaterThan(t.hair);
    expect(t['green-spot']).toBeGreaterThan(t['black-beard']);
    expect(t['green-spot']).toBeGreaterThan(t.diatom);
  });
});

describe('algaeGrowthSystem — type-selective grazing (F13.6)', () => {
  // An oto grazes diatom (bit 3) + green-spot (bit 0) per the catalog grazer
  // mapping — model that with an explicit mask.
  const GREEN_SPOT_BIT = 1 << 0;
  const DIATOM_BIT = 1 << 3;

  function otoBehavior(): ResolvedBehavior {
    const b: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    b.feeding = { hungerRatePerSec: 1, threshold: 0.1, category: 'algae-grazer' };
    b.depth.preferredY = 0.2;
    return b;
  }

  it('an oto reduces its PREFERRED types (diatom/green-spot) and leaves others', () => {
    const otoSpecies = 7;
    const world = createLivestockWorld(SEED, { tankAabb: TANK });
    const handle = world.registerSpeciesBehavior(otoSpecies, otoBehavior());
    world.registerHardscape([
      { position: { x: 300, y: 80, z: 200 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    const rockEid = findHardscapeEid(world);
    world.registerGrazerPreference(otoSpecies, GREEN_SPOT_BIT | DIATOM_BIT);
    // Oto right on the rock so it rasps from tick 1. No nitrate → no regrowth,
    // so any reduction is purely the rasp.
    world.spawnFish({
      archetype: FISH_ARCHETYPE.CORY_CYLINDER,
      speciesId: otoSpecies,
      bodyLengthMm: 40,
      position: { x: 305, y: 80, z: 205 },
      behaviorHandleIdx: handle,
    });
    const before = world.getAlgaeByType(rockEid)!;
    stepN(world, 400);
    const after = world.getAlgaeByType(rockEid)!;
    // Preferred types dropped.
    expect(after['green-spot']).toBeLessThan(before['green-spot']);
    expect(after.diatom).toBeLessThan(before.diatom);
    // Non-preferred types untouched (no nitrate growth, no rasp).
    expect(after.hair).toBeCloseTo(before.hair, 6);
    expect(after['black-beard']).toBeCloseTo(before['black-beard'], 6);
  });

  it('a grazer with NO registered preference reduces the highest-stock type (fallback)', () => {
    const species = 8;
    const world = createLivestockWorld(SEED, { tankAabb: TANK });
    const handle = world.registerSpeciesBehavior(species, otoBehavior());
    world.registerHardscape([
      { position: { x: 300, y: 80, z: 200 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    const rockEid = findHardscapeEid(world);
    // Make hair the clear highest-stock type by draining the others.
    setTypeStocks(world, rockEid, { 'green-spot': 0.1, hair: 0.9, 'black-beard': 0.1, diatom: 0.1 });
    world.spawnFish({
      archetype: FISH_ARCHETYPE.CORY_CYLINDER,
      speciesId: species,
      bodyLengthMm: 40,
      position: { x: 305, y: 80, z: 205 },
      behaviorHandleIdx: handle,
    });
    const before = world.getAlgaeByType(rockEid)!;
    stepN(world, 200);
    const after = world.getAlgaeByType(rockEid)!;
    // The generalist rasps the highest-stock type (hair).
    expect(after.hair).toBeLessThan(before.hair);
    // The low-stock types are left essentially untouched.
    expect(after['green-spot']).toBeCloseTo(before['green-spot'], 5);
  });
});

describe('algaeGrowthSystem — determinism', () => {
  it('1000-tick replay with nitrate + photoperiod + flow is byte-identical (per-type stocks)', () => {
    function run(): Float32Array {
      const world = createLivestockWorld(SEED, { tankAabb: TANK });
      world.registerHardscape([
        { position: { x: 300, y: 80, z: 200 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
        { position: { x: 700, y: 60, z: 150 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
      ]);
      world.registerAlgaeProfiles({
        'green-spot': { growthRate: 0.45, lightDependence: 0.9 },
        hair: { growthRate: 0.7, lightDependence: 0.9 },
        'black-beard': { growthRate: 0.5, lightDependence: 0.5 },
        diatom: { growthRate: 0.6, lightDependence: 0.2 },
      });
      world.setPhotoperiodHours(11);
      world.setWaterQuality({ ammonia: 0.5, nitrite: 0.2, nitrate: 25 });
      world.registerFlowField(
        bakeFlowField({
          tankAabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 1000, y: 400, z: 400 } },
          sources: [{ outflowPos: { x: 900, y: 350, z: 200 }, flowRate: 300 }],
        }),
      );
      for (let i = 0; i < 1000; i++) world.step(SIM_DT);
      // Read both rocks' per-type stocks into one array. Wide eid scan —
      // bitECS eids are module-global so the cursor may be past a small cap.
      const out: number[] = [];
      for (let eid = 0; eid < 100000; eid++) {
        const t = world.getAlgaeByType(eid);
        if (t === null) continue;
        for (const { type } of ALGAE_TYPE_FIELDS) out.push(t[type]);
      }
      return new Float32Array(out);
    }
    const a = run();
    const b = run();
    expect(a.length).toBeGreaterThan(0);
    expect(byteEqual(a, b)).toBe(true);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function byteEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
  return true;
}

/**
 * Drain every per-type stock down to `to` by repeatedly registering a fresh
 * mask-less grazer is overkill; instead, directly set stocks via the public
 * setter helper below. We expose the manipulation through `setTypeStocks`.
 */
function drainAllTypes(world: LivestockWorld, eid: number, to: number): void {
  setTypeStocks(world, eid, { 'green-spot': to, hair: to, 'black-beard': to, diatom: to });
}

/**
 * Test-only helper to set the per-type stocks on a hardscape entity. The world
 * doesn't expose a public setter (production only grows/grazes), so we reach
 * into the component slab the same way the system does — via the exported
 * `Hardscape` component + the type→field mapping. Keeps the test self-contained
 * without widening the production API.
 */
function setTypeStocks(
  world: LivestockWorld,
  eid: number,
  stocks: Record<string, number>,
): void {
  let agg = 0;
  for (const { type, field } of ALGAE_TYPE_FIELDS) {
    const v = stocks[type] ?? 0;
    (Hardscape[field] as Float32Array)[eid] = v;
    agg += v;
  }
  (Hardscape.algaeScore as Float32Array)[eid] = Math.min(1, agg);
  void world;
}
