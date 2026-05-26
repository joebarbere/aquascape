/**
 * Load-bearing invariant for Stage 11:
 *   same seed + same SpawnOpts + same step() count
 *   → byte-identical snapshot typed arrays.
 *
 * Every random read in the world must funnel through `seededHash01` /
 * `tickPrng` for this to hold. If a regression introduces `Math.random()`
 * (the lint rule should catch it first) or a per-Date.now() seed somewhere,
 * this test will fail on the very next run.
 */
import { MID_PRESET } from '@aquascape/domain/livestock-behaviors';
import { FISH_ARCHETYPE, type LivestockWorld } from '../index';
import { createLivestockWorld, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

interface SpawnSpec {
  archetype: number;
  speciesId: number;
  bodyLengthMm: number;
  position: { x: number; y: number; z: number };
  tailBeatFreq: number;
  phaseOffset: number;
}

const FLEET: SpawnSpec[] = [
  { archetype: FISH_ARCHETYPE.SLIM_TETRA, speciesId: 1, bodyLengthMm: 30, position: { x: 100, y: 200, z: 150 }, tailBeatFreq: 4.2, phaseOffset: 0.1 },
  { archetype: FISH_ARCHETYPE.SLIM_TETRA, speciesId: 1, bodyLengthMm: 31, position: { x: 110, y: 210, z: 160 }, tailBeatFreq: 4.0, phaseOffset: 0.5 },
  { archetype: FISH_ARCHETYPE.DEEP_BODIED, speciesId: 2, bodyLengthMm: 80, position: { x: 300, y: 250, z: 100 }, tailBeatFreq: 3.0, phaseOffset: 1.0 },
  { archetype: FISH_ARCHETYPE.BARB, speciesId: 3, bodyLengthMm: 50, position: { x: 50, y: 150, z: 200 }, tailBeatFreq: 5.5, phaseOffset: 1.5 },
  { archetype: FISH_ARCHETYPE.CORY_CYLINDER, speciesId: 4, bodyLengthMm: 55, position: { x: 200, y: 30, z: 250 }, tailBeatFreq: 2.5, phaseOffset: 2.0 },
  { archetype: FISH_ARCHETYPE.EEL, speciesId: 5, bodyLengthMm: 120, position: { x: 400, y: 40, z: 180 }, tailBeatFreq: 1.8, phaseOffset: 2.5 },
  { archetype: FISH_ARCHETYPE.HATCHET_WEDGE, speciesId: 6, bodyLengthMm: 35, position: { x: 250, y: 380, z: 220 }, tailBeatFreq: 6.0, phaseOffset: 3.0 },
];

const SEED = 0xa5c011a5;
const SIM_DT = 1 / 30;
const TICKS = 1000;

function runFleet(): { position: Float32Array; orientation: Float32Array; phase: Float32Array; archetype: Uint8Array; scale: Float32Array } {
  const w: LivestockWorld = createLivestockWorld(SEED);
  for (const spec of FLEET) w.spawnFish(spec);
  for (let i = 0; i < TICKS; i++) w.step(SIM_DT);
  const snap = w.snapshot(0);
  // The snapshot views are pooled — copy out so a subsequent run's snapshot
  // can't accidentally compare equal by aliasing the same backing buffer.
  return {
    position: new Float32Array(snap.position),
    orientation: new Float32Array(snap.orientation),
    phase: new Float32Array(snap.phase),
    archetype: new Uint8Array(snap.archetype),
    scale: new Float32Array(snap.scale),
  };
}

function byteEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
  return true;
}

describe('determinism: 1000 ticks × fixed fleet', () => {
  it('produces byte-identical snapshot arrays across two fresh worlds', () => {
    const run1 = runFleet();
    const run2 = runFleet();
    // Note: `ids` are NOT compared. bitECS allocates from a module-global
    // entity cursor, so successive `createLivestockWorld()` calls within the
    // same process get distinct id ranges. The renderer doesn't read the ids
    // (only position/orientation/phase/archetype/scale), so this is fine.
    // The Wave 4 LivestockSimulationService treats the snapshot ids as
    // *opaque* — useful only for stable per-entity diffing within a single
    // world instance.
    expect(byteEqual(run1.position, run2.position)).toBe(true);
    expect(byteEqual(run1.orientation, run2.orientation)).toBe(true);
    expect(byteEqual(run1.phase, run2.phase)).toBe(true);
    expect(byteEqual(run1.archetype, run2.archetype)).toBe(true);
    expect(byteEqual(run1.scale, run2.scale)).toBe(true);
  });

  it('1000-tick replay with registered behaviour is byte-identical (F11.2 invariant)', () => {
    // Same as the F11.1 test, but every fish gets MID_PRESET behaviour
    // wired in. The Schooling + Depth + Steering systems now drive
    // Velocity through tickPrng noise — so the byte-identity check
    // exercises *every* random read the lib makes.
    function runBehavedFleet(): {
      position: Float32Array;
      orientation: Float32Array;
      phase: Float32Array;
    } {
      const w: LivestockWorld = createLivestockWorld(SEED, { tankAabb: TANK });
      const handle = w.registerSpeciesBehavior(99, MID_PRESET);
      for (const spec of FLEET) {
        w.spawnFish({ ...spec, behaviorHandleIdx: handle });
      }
      for (let i = 0; i < TICKS; i++) w.step(SIM_DT);
      const s = w.snapshot(0);
      return {
        position: new Float32Array(s.position),
        orientation: new Float32Array(s.orientation),
        phase: new Float32Array(s.phase),
      };
    }
    const r1 = runBehavedFleet();
    const r2 = runBehavedFleet();
    expect(byteEqual(r1.position, r2.position)).toBe(true);
    expect(byteEqual(r1.orientation, r2.orientation)).toBe(true);
    expect(byteEqual(r1.phase, r2.phase)).toBe(true);
  });

  it('different seeds still produce identical *static* fields (position w/ v=0, archetype, scale)', () => {
    // With Velocity=0 in F11.1, Position never changes from its spawn value
    // — so the seed only affects fields driven by `tickPrng` (none yet). This
    // test pins that contract: seed doesn't leak into Kinematic/Animation in
    // F11.1. When F11.2 starts using `tickPrng` for noise injection, this
    // expectation will need to flip for the Position field.
    const a = (() => {
      const w = createLivestockWorld(1);
      for (const spec of FLEET) w.spawnFish(spec);
      for (let i = 0; i < TICKS; i++) w.step(SIM_DT);
      const s = w.snapshot(0);
      return { position: new Float32Array(s.position), phase: new Float32Array(s.phase) };
    })();
    const b = (() => {
      const w = createLivestockWorld(2);
      for (const spec of FLEET) w.spawnFish(spec);
      for (let i = 0; i < TICKS; i++) w.step(SIM_DT);
      const s = w.snapshot(0);
      return { position: new Float32Array(s.position), phase: new Float32Array(s.phase) };
    })();
    // Position is purely a function of (spawn position, integrated zero
    // velocity) → seed-independent in F11.1.
    expect(byteEqual(a.position, b.position)).toBe(true);
    // Phase is a function of (spawnOpts.phaseOffset, freq, tick count) → also
    // seed-independent in F11.1.
    expect(byteEqual(a.phase, b.phase)).toBe(true);
  });
});
