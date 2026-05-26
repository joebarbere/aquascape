/**
 * NippingSystem phase tests (Stage 11 F11.3).
 *
 * Tiger barb + betta fixtures + group-threshold suppression + cooldown.
 */
import {
  MID_PRESET,
  type ResolvedBehavior,
} from '@aquascape/domain/livestock-behaviors';
import {
  BehaviorMode,
  BEHAVIOR_MODE,
  FISH_ARCHETYPE,
  Force,
  NippingDrive,
  Position,
  Velocity,
} from './components';
import { perceptionSystem } from './perception-system';
import { nippingSystem } from './nipping-system';
import { createLivestockWorld, SIM_DT, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

function clone(p: ResolvedBehavior): ResolvedBehavior {
  return JSON.parse(JSON.stringify(p)) as ResolvedBehavior;
}

/** Tiger-barb-flavoured params (nipping enabled, group threshold 8). */
function tigerBarbParams(): ResolvedBehavior {
  const p = clone(MID_PRESET);
  p.nipping = {
    groupThreshold: 8,
    finFraction: 0.4,
    rate: 0.5,
  };
  return p;
}

/** Plain peaceful mid-water default (no nipping). */
function peacefulParams(): ResolvedBehavior {
  return clone(MID_PRESET);
}

function spawnBarb(
  w: ReturnType<typeof createLivestockWorld>,
  handle: number,
  pos: { x: number; y: number; z: number },
  speciesId = 100,
) {
  return w.spawnFish({
    archetype: FISH_ARCHETYPE.BARB,
    speciesId,
    bodyLengthMm: 50,
    position: pos,
    behaviorHandleIdx: handle,
  });
}

function spawnBetta(
  w: ReturnType<typeof createLivestockWorld>,
  handle: number,
  pos: { x: number; y: number; z: number },
) {
  const eid = w.spawnFish({
    // Bettas are the DEEP_BODIED archetype (long-fin class).
    archetype: FISH_ARCHETYPE.DEEP_BODIED,
    speciesId: 200,
    bodyLengthMm: 60,
    position: pos,
    behaviorHandleIdx: handle,
  });
  // Bettas swim slowly — sets up the "slow swimmer" vulnerability
  // check. Velocity = 0 also satisfies it (default).
  Velocity.x[eid] = 5;
  return eid;
}

describe('nippingSystem', () => {
  it('barb with <groupThreshold conspecifics + slow betta in range → nips (PURSUE + Force toward betta)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const barbHandle = w.registerSpeciesBehavior(100, tigerBarbParams());
    const bettaHandle = w.registerSpeciesBehavior(200, peacefulParams());
    // 4 conspecifics + 1 betta → 4 < groupThreshold=8 → nipping fires.
    const barb = spawnBarb(w, barbHandle, { x: 500, y: 200, z: 500 });
    for (let i = 0; i < 4; i++) {
      spawnBarb(w, barbHandle, { x: 500 + (i + 1) * 10, y: 200, z: 500 });
    }
    const betta = spawnBetta(w, bettaHandle, { x: 550, y: 200, z: 500 });
    perceptionSystem(w);
    nippingSystem(w, SIM_DT);
    expect(BehaviorMode.mode[barb]).toBe(BEHAVIOR_MODE.PURSUE);
    // Force pointing toward the betta (positive x direction).
    expect(Force.x[barb] as number).toBeGreaterThan(0);
    expect(NippingDrive.cooldownSec[barb] as number).toBeGreaterThan(0);
    // Betta itself unaffected by this system (only the barb's Force
    // is written).
    expect(Force.x[betta]).toBe(0);
  });

  it('barb with ≥groupThreshold conspecifics → suppresses nipping (mode stays FORAGE, no force)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const barbHandle = w.registerSpeciesBehavior(100, tigerBarbParams());
    const bettaHandle = w.registerSpeciesBehavior(200, peacefulParams());
    const barb = spawnBarb(w, barbHandle, { x: 500, y: 200, z: 500 });
    // 8 conspecifics — meets threshold, urge suppressed.
    for (let i = 0; i < 8; i++) {
      spawnBarb(w, barbHandle, { x: 500 + (i + 1) * 5, y: 200, z: 500 });
    }
    spawnBetta(w, bettaHandle, { x: 550, y: 200, z: 500 });
    perceptionSystem(w);
    nippingSystem(w, SIM_DT);
    expect(BehaviorMode.mode[barb]).toBe(BEHAVIOR_MODE.FORAGE);
    expect(Force.x[barb]).toBe(0);
  });

  it('cooldown blocks back-to-back nips for 2 seconds after an attempt', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const barbHandle = w.registerSpeciesBehavior(100, tigerBarbParams());
    const bettaHandle = w.registerSpeciesBehavior(200, peacefulParams());
    const barb = spawnBarb(w, barbHandle, { x: 500, y: 200, z: 500 });
    spawnBetta(w, bettaHandle, { x: 550, y: 200, z: 500 });
    perceptionSystem(w);
    nippingSystem(w, SIM_DT);
    expect(NippingDrive.cooldownSec[barb] as number).toBeGreaterThan(0);
    // Mode resets to FORAGE on the next tick (PURSUE is one-tick).
    // Run several ticks while cooldown is still > 0 — no new force.
    const cooldownAfter = NippingDrive.cooldownSec[barb] as number;
    for (let i = 0; i < 10; i++) {
      // Clear Force from last tick to test cleanly.
      Force.x[barb] = 0;
      perceptionSystem(w);
      nippingSystem(w, SIM_DT);
      // Cooldown is still positive (we only ran 10 * SIM_DT = 0.33s).
      expect(NippingDrive.cooldownSec[barb] as number).toBeGreaterThan(0);
      // No new nip Force.
      expect(Force.x[barb]).toBe(0);
    }
    expect(NippingDrive.cooldownSec[barb] as number).toBeLessThan(cooldownAfter);
  });

  it('skips non-nipper fish (nipping params null) — peaceful mid-water tetra ignores betta', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const peacefulHandle = w.registerSpeciesBehavior(100, peacefulParams());
    const bettaHandle = w.registerSpeciesBehavior(200, peacefulParams());
    const peaceful = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 100,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 500 },
      behaviorHandleIdx: peacefulHandle,
    });
    spawnBetta(w, bettaHandle, { x: 550, y: 200, z: 500 });
    perceptionSystem(w);
    nippingSystem(w, SIM_DT);
    // No NippingDrive component → query doesn't match → no change.
    expect(BehaviorMode.mode[peaceful]).toBe(BEHAVIOR_MODE.FORAGE);
    expect(Force.x[peaceful]).toBe(0);
  });

  it('skips fast-swimming heterospecifics — only slow long-fin fish are victims', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const barbHandle = w.registerSpeciesBehavior(100, tigerBarbParams());
    const bettaHandle = w.registerSpeciesBehavior(200, peacefulParams());
    const barb = spawnBarb(w, barbHandle, { x: 500, y: 200, z: 500 });
    const betta = spawnBetta(w, bettaHandle, { x: 550, y: 200, z: 500 });
    // Crank the betta's speed past `selfVMax * 0.5` = 140 * 0.5 = 70.
    Velocity.x[betta] = 100;
    perceptionSystem(w);
    nippingSystem(w, SIM_DT);
    // No vulnerable victim found → barb stays FORAGE, no force.
    expect(BehaviorMode.mode[barb]).toBe(BEHAVIOR_MODE.FORAGE);
    expect(Force.x[barb]).toBe(0);
  });

  it('skips REFUGE / PURSUE mode entities (priority arbitration)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const barbHandle = w.registerSpeciesBehavior(100, tigerBarbParams());
    const bettaHandle = w.registerSpeciesBehavior(200, peacefulParams());
    const barb = spawnBarb(w, barbHandle, { x: 500, y: 200, z: 500 });
    spawnBetta(w, bettaHandle, { x: 550, y: 200, z: 500 });
    // Force the barb into REFUGE mode externally (FearSystem would
    // normally do this).
    BehaviorMode.mode[barb] = BEHAVIOR_MODE.REFUGE;
    perceptionSystem(w);
    nippingSystem(w, SIM_DT);
    // Mode preserved; no nipping force written.
    expect(BehaviorMode.mode[barb]).toBe(BEHAVIOR_MODE.REFUGE);
    expect(Force.x[barb]).toBe(0);
  });

  it('uses the auto-anchor + spatial grid — distant betta out of nipping radius is ignored', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const barbHandle = w.registerSpeciesBehavior(100, tigerBarbParams());
    const bettaHandle = w.registerSpeciesBehavior(200, peacefulParams());
    const barb = spawnBarb(w, barbHandle, { x: 100, y: 200, z: 100 });
    // Betta well outside the 150 mm nipping radius.
    spawnBetta(w, bettaHandle, { x: 900, y: 200, z: 900 });
    perceptionSystem(w);
    nippingSystem(w, SIM_DT);
    expect(BehaviorMode.mode[barb]).toBe(BEHAVIOR_MODE.FORAGE);
    expect(Force.x[barb]).toBe(0);
  });

  it('Position.x[victim] unaffected (system does not write to other entities)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const barbHandle = w.registerSpeciesBehavior(100, tigerBarbParams());
    const bettaHandle = w.registerSpeciesBehavior(200, peacefulParams());
    spawnBarb(w, barbHandle, { x: 500, y: 200, z: 500 });
    const betta = spawnBetta(w, bettaHandle, { x: 550, y: 200, z: 500 });
    const startBettaX = Position.x[betta] as number;
    perceptionSystem(w);
    nippingSystem(w, SIM_DT);
    // The betta's force / position are untouched by the nipping
    // system — it only writes to the nipper. Schooling / steering for
    // the betta will respond on subsequent ticks via the normal pipe.
    expect(Position.x[betta]).toBeCloseTo(startBettaX);
    expect(Force.x[betta]).toBe(0);
  });
});
