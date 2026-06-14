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
import { MID_PRESET, type ResolvedBehavior } from '@aquascape/domain/livestock-behaviors';
import { bakeFlowField, bakeHardscapeSdf } from '@aquascape/domain/fluid-sim';
import { FISH_ARCHETYPE, FOOD_TYPE, HARDSCAPE_CATEGORY, type LivestockWorld } from '../index';
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

  it('F11.3 full system stack — 1000-tick replay with ram + cave + 6 cardinals + 1 betta + 6 tiger barbs is byte-identical', () => {
    // Mixed-species fixture covering every F11.3 system path:
    //   - ram (territorial, anchored to cave) → TerritorialSystem
    //   - 6 cardinals (schooling) → SchoolingSystem
    //   - 1 betta (slow, long-fin victim) → NippingSystem target
    //   - 6 tiger barbs (nippers, just below groupThreshold) → NippingSystem
    //   - every fish has fear params → FearSystem
    //   - 1 cave hardscape → auto-anchor + refuge target
    const ramSpecies = 1;
    const cardinalSpecies = 2;
    const bettaSpecies = 3;
    const barbSpecies = 4;

    const ramBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    ramBehavior.territory = {
      coreRadius: 80,
      displayRadius: 150,
      aggression: 100,
      fatigueRate: 0.08,
    };
    const cardinalBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    const bettaBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    const barbBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    barbBehavior.nipping = {
      groupThreshold: 8,
      finFraction: 0.4,
      rate: 0.5,
    };

    function runMixedFleet(): {
      position: Float32Array;
      orientation: Float32Array;
    } {
      const w: LivestockWorld = createLivestockWorld(SEED, { tankAabb: TANK });
      const ramHandle = w.registerSpeciesBehavior(ramSpecies, ramBehavior);
      const cardinalHandle = w.registerSpeciesBehavior(cardinalSpecies, cardinalBehavior);
      const bettaHandle = w.registerSpeciesBehavior(bettaSpecies, bettaBehavior);
      const barbHandle = w.registerSpeciesBehavior(barbSpecies, barbBehavior);
      // Hardscape MUST be registered before territorial spawn or the
      // auto-anchor finds nothing.
      w.registerHardscape([
        { position: { x: 500, y: 100, z: 300 }, coverScore: 0.5, category: HARDSCAPE_CATEGORY.ROCK },
      ]);
      // Ram anchored near the rock.
      w.spawnFish({
        archetype: FISH_ARCHETYPE.DEEP_BODIED,
        speciesId: ramSpecies,
        bodyLengthMm: 70,
        position: { x: 510, y: 100, z: 310 },
        behaviorHandleIdx: ramHandle,
      });
      // 6 cardinal tetras clustered mid-water.
      for (let i = 0; i < 6; i++) {
        w.spawnFish({
          archetype: FISH_ARCHETYPE.SLIM_TETRA,
          speciesId: cardinalSpecies,
          bodyLengthMm: 30,
          position: { x: 200 + i * 20, y: 200, z: 150 },
          behaviorHandleIdx: cardinalHandle,
        });
      }
      // 1 betta — slow, long-fin (DEEP_BODIED) → barb victim.
      w.spawnFish({
        archetype: FISH_ARCHETYPE.DEEP_BODIED,
        speciesId: bettaSpecies,
        bodyLengthMm: 60,
        position: { x: 700, y: 150, z: 200 },
        behaviorHandleIdx: bettaHandle,
      });
      // 6 tiger barbs — one under the group threshold so nipping fires.
      for (let i = 0; i < 6; i++) {
        w.spawnFish({
          archetype: FISH_ARCHETYPE.BARB,
          speciesId: barbSpecies,
          bodyLengthMm: 50,
          position: { x: 650 + i * 15, y: 180, z: 220 + i * 5 },
          behaviorHandleIdx: barbHandle,
        });
      }
      for (let i = 0; i < TICKS; i++) w.step(SIM_DT);
      const s = w.snapshot(0);
      return {
        position: new Float32Array(s.position),
        orientation: new Float32Array(s.orientation),
      };
    }

    const r1 = runMixedFleet();
    const r2 = runMixedFleet();
    expect(byteEqual(r1.position, r2.position)).toBe(true);
    expect(byteEqual(r1.orientation, r2.orientation)).toBe(true);
  });

  it('F11.4 full stack — 1000-tick replay with oto + rock + 6 cardinals + 2 food sprites is byte-identical', () => {
    // Adds Feeding + Curiosity into the determinism contract. Includes
    // an algae-grazer (oto) + a rock with algae, 6 cardinals (schooling),
    // and 2 food sprites spawned at tick=0. Cover the full F11.4 system
    // matrix: algae rasping, sprite seeking, sprite consumption,
    // curiosity Poisson, regrowth scan.
    const otoSpecies = 1;
    const cardinalSpecies = 2;
    const otoBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    otoBehavior.feeding = {
      hungerRatePerSec: 1 / 10, // hungry fast
      threshold: 0.4,
      category: 'algae-grazer',
    };
    otoBehavior.depth.preferredY = 0.2;
    const cardinalBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));

    function runMixedFleet(): {
      position: Float32Array;
      orientation: Float32Array;
      foodSpritePosition: Float32Array;
    } {
      const w: LivestockWorld = createLivestockWorld(SEED, { tankAabb: TANK });
      const otoHandle = w.registerSpeciesBehavior(otoSpecies, otoBehavior);
      const cardinalHandle = w.registerSpeciesBehavior(cardinalSpecies, cardinalBehavior);
      // Hardscape — one rock so the oto has algae to graze on.
      w.registerHardscape([
        {
          position: { x: 300, y: 80, z: 200 },
          coverScore: 0.4,
          category: HARDSCAPE_CATEGORY.ROCK,
        },
      ]);
      // 1 oto near the rock.
      w.spawnFish({
        archetype: FISH_ARCHETYPE.CORY_CYLINDER,
        speciesId: otoSpecies,
        bodyLengthMm: 40,
        position: { x: 320, y: 80, z: 220 },
        behaviorHandleIdx: otoHandle,
      });
      // 6 cardinal tetras clustered mid-water.
      for (let i = 0; i < 6; i++) {
        w.spawnFish({
          archetype: FISH_ARCHETYPE.SLIM_TETRA,
          speciesId: cardinalSpecies,
          bodyLengthMm: 30,
          position: { x: 200 + i * 20, y: 200, z: 150 },
          behaviorHandleIdx: cardinalHandle,
        });
      }
      // 2 food sprites at tick=0 — life is 30s so they survive 900 ticks (30Hz);
      // the cardinals seek + consume them over the 1000-tick run.
      w.spawnFoodSprite({ x: 250, y: 300, z: 200 }, 60, 5);
      w.spawnFoodSprite({ x: 500, y: 250, z: 200 }, 60, 5);
      for (let i = 0; i < TICKS; i++) w.step(SIM_DT);
      const s = w.snapshot(0);
      return {
        position: new Float32Array(s.position),
        orientation: new Float32Array(s.orientation),
        foodSpritePosition: new Float32Array(s.foodSpritePosition),
      };
    }

    const r1 = runMixedFleet();
    const r2 = runMixedFleet();
    expect(byteEqual(r1.position, r2.position)).toBe(true);
    expect(byteEqual(r1.orientation, r2.orientation)).toBe(true);
    expect(byteEqual(r1.foodSpritePosition, r2.foodSpritePosition)).toBe(true);
  });

  it('F14.1 typed food — 1000-tick replay with all four food forms + mixed-band feeders is byte-identical (foodSpritePosition + type included)', () => {
    // Exercises the F14.1 per-type sink kinematics (flake float→sink, pellet
    // fast sink, wafer settle, live dart) AND the typed-food band-matching in
    // feedingSystem, all inside the determinism contract. The live-food dart
    // is the only random draw (tickPrng keyed by spawnIndex) — if it ever
    // leaked Math.random / wall-clock, this fails on the next run.
    const surfaceSpecies = 1;
    const substrateSpecies = 2;
    const midSpecies = 3;

    const surfaceBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    surfaceBehavior.feeding = { hungerRatePerSec: 1 / 8, threshold: 0.3, category: 'surface' };
    surfaceBehavior.depth.preferredY = 0.85;
    const substrateBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    substrateBehavior.feeding = { hungerRatePerSec: 1 / 8, threshold: 0.3, category: 'substrate' };
    substrateBehavior.depth.preferredY = 0.15;
    const midBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    midBehavior.feeding = { hungerRatePerSec: 1 / 8, threshold: 0.3, category: 'midwater' };

    function runTypedFood(): {
      position: Float32Array;
      foodSpriteCount: number;
      foodSpritePosition: Float32Array;
      foodSpriteType: Uint8Array;
    } {
      const w: LivestockWorld = createLivestockWorld(SEED, { tankAabb: TANK });
      const surfaceHandle = w.registerSpeciesBehavior(surfaceSpecies, surfaceBehavior);
      const substrateHandle = w.registerSpeciesBehavior(substrateSpecies, substrateBehavior);
      const midHandle = w.registerSpeciesBehavior(midSpecies, midBehavior);
      // 3 surface feeders near the top.
      for (let i = 0; i < 3; i++) {
        w.spawnFish({
          archetype: FISH_ARCHETYPE.HATCHET_WEDGE,
          speciesId: surfaceSpecies,
          bodyLengthMm: 30,
          position: { x: 200 + i * 30, y: 360, z: 180 },
          behaviorHandleIdx: surfaceHandle,
        });
      }
      // 3 substrate feeders near the floor.
      for (let i = 0; i < 3; i++) {
        w.spawnFish({
          archetype: FISH_ARCHETYPE.CORY_CYLINDER,
          speciesId: substrateSpecies,
          bodyLengthMm: 40,
          position: { x: 600 + i * 30, y: 30, z: 250 },
          behaviorHandleIdx: substrateHandle,
        });
      }
      // 3 midwater feeders.
      for (let i = 0; i < 3; i++) {
        w.spawnFish({
          archetype: FISH_ARCHETYPE.SLIM_TETRA,
          speciesId: midSpecies,
          bodyLengthMm: 30,
          position: { x: 400 + i * 30, y: 200, z: 200 },
          behaviorHandleIdx: midHandle,
        });
      }
      // One sprite of each form, long-lived so they persist through the run.
      w.spawnFoodSprite({ x: 300, y: 380, z: 200 }, 120, 4, FOOD_TYPE.FLAKE);
      w.spawnFoodSprite({ x: 500, y: 380, z: 220 }, 120, 4, FOOD_TYPE.PELLET);
      w.spawnFoodSprite({ x: 650, y: 380, z: 250 }, 120, 4, FOOD_TYPE.WAFER);
      w.spawnFoodSprite({ x: 450, y: 380, z: 180 }, 120, 4, FOOD_TYPE.LIVE);
      for (let i = 0; i < TICKS; i++) w.step(SIM_DT);
      const s = w.snapshot(0);
      return {
        position: new Float32Array(s.position),
        foodSpriteCount: s.foodSpriteCount,
        foodSpritePosition: new Float32Array(s.foodSpritePosition),
        foodSpriteType: new Uint8Array(s.foodSpriteType),
      };
    }

    const r1 = runTypedFood();
    const r2 = runTypedFood();
    expect(r1.foodSpriteCount).toBe(r2.foodSpriteCount);
    expect(byteEqual(r1.position, r2.position)).toBe(true);
    expect(byteEqual(r1.foodSpritePosition, r2.foodSpritePosition)).toBe(true);
    expect(byteEqual(r1.foodSpriteType, r2.foodSpriteType)).toBe(true);
  });

  it('F11.5 Wave 5 full stack — 1000-tick replay with flow + SDF + bubble source + cave + ram + cardinals + betta + barbs + oto + sprites is byte-identical (bubblePosition included)', () => {
    // Smaller mixed fleet than the Wave 4 stack below — keeps the test
    // focused on the bubble determinism contract while still exercising
    // every system that touches the BubbleParticle path (spawn,
    // lifetime, snapshot).
    const cardinalSpecies = 1;
    const cardinalBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));

    function runWithBubbles(): {
      position: Float32Array;
      bubbleCount: number;
      bubblePosition: Float32Array;
    } {
      const w: LivestockWorld = createLivestockWorld(SEED, { tankAabb: TANK });
      const handle = w.registerSpeciesBehavior(cardinalSpecies, cardinalBehavior);
      // Two air-stone sources — one near the front-left, one near the
      // back-right, both at substrate. Different airRateMls so the
      // streams don't collapse to symmetric draws.
      w.registerBubbleSources([
        { position: { x: 200, y: 20, z: 100 }, airRateMl: 400 },
        { position: { x: 800, y: 20, z: 300 }, airRateMl: 700 },
      ]);
      for (let i = 0; i < 6; i++) {
        w.spawnFish({
          archetype: FISH_ARCHETYPE.SLIM_TETRA,
          speciesId: cardinalSpecies,
          bodyLengthMm: 30,
          position: { x: 200 + i * 20, y: 200, z: 150 },
          behaviorHandleIdx: handle,
        });
      }
      for (let i = 0; i < TICKS; i++) w.step(SIM_DT);
      const s = w.snapshot(0);
      return {
        position: new Float32Array(s.position),
        bubbleCount: s.bubbleCount,
        bubblePosition: new Float32Array(s.bubblePosition),
      };
    }

    const r1 = runWithBubbles();
    const r2 = runWithBubbles();
    expect(r1.bubbleCount).toBe(r2.bubbleCount);
    expect(byteEqual(r1.position, r2.position)).toBe(true);
    expect(byteEqual(r1.bubblePosition, r2.bubblePosition)).toBe(true);
  });

  it('F11.5 Wave 4 full stack — 1000-tick replay with flow + SDF + cave + ram + cardinals + betta + barbs + oto + sprites is byte-identical', () => {
    // Largest mixed fleet so far — covers every system path including
    // FlowFieldSystem (filter outflow) + CollisionSystem (sphere SDF +
    // fish-vs-fish separation in a tight school).
    const ramSpecies = 1;
    const cardinalSpecies = 2;
    const bettaSpecies = 3;
    const barbSpecies = 4;
    const otoSpecies = 5;

    const ramBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    ramBehavior.territory = {
      coreRadius: 80,
      displayRadius: 150,
      aggression: 100,
      fatigueRate: 0.08,
    };
    const cardinalBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    const bettaBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    const barbBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    barbBehavior.nipping = {
      groupThreshold: 8,
      finFraction: 0.4,
      rate: 0.5,
    };
    const otoBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    otoBehavior.feeding = {
      hungerRatePerSec: 1 / 10,
      threshold: 0.4,
      category: 'algae-grazer',
    };
    otoBehavior.depth.preferredY = 0.2;

    function runFullStack(): {
      position: Float32Array;
      orientation: Float32Array;
      foodSpritePosition: Float32Array;
    } {
      const w: LivestockWorld = createLivestockWorld(SEED, { tankAabb: TANK });
      const ramHandle = w.registerSpeciesBehavior(ramSpecies, ramBehavior);
      const cardinalHandle = w.registerSpeciesBehavior(cardinalSpecies, cardinalBehavior);
      const bettaHandle = w.registerSpeciesBehavior(bettaSpecies, bettaBehavior);
      const barbHandle = w.registerSpeciesBehavior(barbSpecies, barbBehavior);
      const otoHandle = w.registerSpeciesBehavior(otoSpecies, otoBehavior);
      // Hardscape (cave/rock) — anchor for the ram + algae for the oto.
      w.registerHardscape([
        { position: { x: 500, y: 100, z: 300 }, coverScore: 0.5, category: HARDSCAPE_CATEGORY.ROCK },
      ]);
      // F11.5 — register a baked flow field driven by a single filter
      // outflow + a baked sphere SDF for the cave rock so collision can
      // deflect fish away.
      const flowField = bakeFlowField({
        tankAabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 1000, y: 400, z: 400 } },
        sources: [
          {
            outflowPos: { x: 950, y: 300, z: 200 },
            outflowVec: { x: -1, y: 0, z: 0 },
            intakePos: { x: 950, y: 50, z: 200 },
            flowRate: 200,
          },
        ],
      });
      const hardscapeSdf = bakeHardscapeSdf({
        tankAabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 1000, y: 400, z: 400 } },
        hardscape: [{ position: { x: 500, y: 100, z: 300 }, radius: 80 }],
      });
      w.registerFlowField(flowField);
      w.registerHardscapeSdf(hardscapeSdf);
      // Ram anchored near the rock.
      w.spawnFish({
        archetype: FISH_ARCHETYPE.DEEP_BODIED,
        speciesId: ramSpecies,
        bodyLengthMm: 70,
        position: { x: 510, y: 100, z: 310 },
        behaviorHandleIdx: ramHandle,
      });
      // 6 cardinal tetras clustered mid-water.
      for (let i = 0; i < 6; i++) {
        w.spawnFish({
          archetype: FISH_ARCHETYPE.SLIM_TETRA,
          speciesId: cardinalSpecies,
          bodyLengthMm: 30,
          position: { x: 200 + i * 20, y: 200, z: 150 },
          behaviorHandleIdx: cardinalHandle,
        });
      }
      // 1 betta — slow, long-fin, barb victim.
      w.spawnFish({
        archetype: FISH_ARCHETYPE.DEEP_BODIED,
        speciesId: bettaSpecies,
        bodyLengthMm: 60,
        position: { x: 700, y: 150, z: 200 },
        behaviorHandleIdx: bettaHandle,
      });
      // 6 tiger barbs — below the group threshold so nipping fires.
      for (let i = 0; i < 6; i++) {
        w.spawnFish({
          archetype: FISH_ARCHETYPE.BARB,
          speciesId: barbSpecies,
          bodyLengthMm: 50,
          position: { x: 650 + i * 15, y: 180, z: 220 + i * 5 },
          behaviorHandleIdx: barbHandle,
        });
      }
      // 1 oto near the rock for the algae-grazer pathway.
      w.spawnFish({
        archetype: FISH_ARCHETYPE.CORY_CYLINDER,
        speciesId: otoSpecies,
        bodyLengthMm: 40,
        position: { x: 480, y: 80, z: 290 },
        behaviorHandleIdx: otoHandle,
      });
      // 2 food sprites for the cardinals + betta to seek.
      w.spawnFoodSprite({ x: 250, y: 300, z: 200 }, 60, 5);
      w.spawnFoodSprite({ x: 500, y: 250, z: 200 }, 60, 5);
      for (let i = 0; i < TICKS; i++) w.step(SIM_DT);
      const s = w.snapshot(0);
      return {
        position: new Float32Array(s.position),
        orientation: new Float32Array(s.orientation),
        foodSpritePosition: new Float32Array(s.foodSpritePosition),
      };
    }

    const r1 = runFullStack();
    const r2 = runFullStack();
    expect(byteEqual(r1.position, r2.position)).toBe(true);
    expect(byteEqual(r1.orientation, r2.orientation)).toBe(true);
    expect(byteEqual(r1.foodSpritePosition, r2.foodSpritePosition)).toBe(true);
  });

  it('F14.2 + F14.4 — 1000-tick replay with injected water quality + uneaten food is byte-identical (health + hunger + waste included)', () => {
    // Brings the vitality + waste producer into the determinism contract:
    //   - injected poor water quality (ammonia + nitrite) → health decays
    //     (the spawnIndex-keyed VitalitySystem jitter is the only random draw)
    //   - hungry fish starve → health decays (no food reaches them)
    //   - a corner sprite rots uneaten → recordUneatenFood folds into the
    //     ammonia source term
    // If any of these leaked Math.random / wall-clock, the two runs diverge.
    const surfaceSpecies = 1;
    const surfaceBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    // Hungry fast so the fish crosses the starvation threshold within the run.
    surfaceBehavior.feeding = { hungerRatePerSec: 1 / 4, threshold: 0.3, category: 'midwater' };

    function runVitality(): {
      position: Float32Array;
      health: Float32Array;
      hunger: Float32Array;
      wasteSourceN: number;
    } {
      const w: LivestockWorld = createLivestockWorld(SEED, { tankAabb: TANK });
      // Inject steady poor water quality (the future WaterChemistryService
      // seam). A world that never calls this stays clean → no health decay.
      w.setWaterQuality({ ammonia: 1.2, nitrite: 0.4 });
      const handle = w.registerSpeciesBehavior(surfaceSpecies, surfaceBehavior);
      for (let i = 0; i < 6; i++) {
        w.spawnFish({
          archetype: FISH_ARCHETYPE.SLIM_TETRA,
          speciesId: surfaceSpecies,
          bodyLengthMm: 30,
          position: { x: 200 + i * 20, y: 200, z: 150 },
          behaviorHandleIdx: handle,
        });
      }
      // A short-lived sprite in the far corner the school won't reach → it
      // rots uneaten and drives the waste source term.
      w.spawnFoodSprite({ x: 980, y: 380, z: 380 }, 5, 4, FOOD_TYPE.PELLET, 0.6);
      for (let i = 0; i < TICKS; i++) w.step(SIM_DT);
      const s = w.snapshot(0);
      return {
        position: new Float32Array(s.position),
        health: new Float32Array(s.health),
        hunger: new Float32Array(s.hunger),
        wasteSourceN: w.getWasteSourceN(),
      };
    }

    const r1 = runVitality();
    const r2 = runVitality();
    expect(byteEqual(r1.position, r2.position)).toBe(true);
    expect(byteEqual(r1.health, r2.health)).toBe(true);
    expect(byteEqual(r1.hunger, r2.hunger)).toBe(true);
    expect(r1.wasteSourceN).toBe(r2.wasteSourceN);
    // Sanity: poor water + starvation actually MOVED health off the spawn 1.0.
    expect(r1.health[0] as number).toBeLessThan(1);
    // Sanity: the uneaten sprite produced a non-zero source term.
    expect(r1.wasteSourceN).toBeGreaterThan(0);
  });

  it('F14.2 — a default (clean-water) world with no feeding pressure keeps every fish at full health (replay-safe baseline)', () => {
    // The byte-identity-preserving baseline: a world that never calls
    // setWaterQuality + whose fish never starve sees health pinned at 1.0,
    // so health is a constant slab and the replay is trivially stable. This
    // documents that the F14.2 additions don't shift behaviour for the common
    // (clean, fed) case.
    const species = 1;
    const behavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    // Slow hunger so the fish never crosses the starvation threshold in 1000
    // ticks (~33 s sim-time) — health stays at full.
    behavior.feeding = { hungerRatePerSec: 1 / 600, threshold: 0.4, category: 'midwater' };
    const w: LivestockWorld = createLivestockWorld(SEED, { tankAabb: TANK });
    const handle = w.registerSpeciesBehavior(species, behavior);
    for (let i = 0; i < 6; i++) {
      w.spawnFish({
        archetype: FISH_ARCHETYPE.SLIM_TETRA,
        speciesId: species,
        bodyLengthMm: 30,
        position: { x: 200 + i * 20, y: 200, z: 150 },
        behaviorHandleIdx: handle,
      });
    }
    for (let i = 0; i < TICKS; i++) w.step(SIM_DT);
    const s = w.snapshot(0);
    for (let i = 0; i < s.entityCount; i++) {
      expect(s.health[i]).toBe(1);
    }
  });

  it('F13.6 per-type algae — 1000-tick replay with nitrate + photoperiod + flow + grazer is byte-identical (per-type stocks + fish)', () => {
    // Brings the F13.6 algae state into the canonical replay gate: a rock + a
    // grazing oto with a registered type-preference mask, nitrate + photoperiod
    // + a flow field driving the growth model, registered per-type catalog
    // tuning. The growth model is pure scalar (no PRNG), the rasp is
    // SpeciesId-keyed (no PRNG), so two cold worlds must match byte-for-byte —
    // both the fish slab AND the per-type algae stocks.
    const otoSpecies = 1;
    const cardinalSpecies = 2;
    const GREEN_SPOT_BIT = 1 << 0;
    const DIATOM_BIT = 1 << 3;
    const otoBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
    otoBehavior.feeding = { hungerRatePerSec: 1 / 8, threshold: 0.3, category: 'algae-grazer' };
    otoBehavior.depth.preferredY = 0.2;
    const cardinalBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));

    function run(): { position: Float32Array; algae: Float32Array } {
      const w: LivestockWorld = createLivestockWorld(SEED, { tankAabb: TANK });
      const otoHandle = w.registerSpeciesBehavior(otoSpecies, otoBehavior);
      const cardinalHandle = w.registerSpeciesBehavior(cardinalSpecies, cardinalBehavior);
      w.registerHardscape([
        { position: { x: 300, y: 80, z: 200 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
        { position: { x: 700, y: 60, z: 150 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
      ]);
      w.registerAlgaeProfiles({
        'green-spot': { growthRate: 0.45, lightDependence: 0.9 },
        hair: { growthRate: 0.7, lightDependence: 0.9 },
        'black-beard': { growthRate: 0.5, lightDependence: 0.5 },
        diatom: { growthRate: 0.6, lightDependence: 0.2 },
      });
      w.setPhotoperiodHours(11);
      w.setWaterQuality({ ammonia: 0, nitrite: 0, nitrate: 25 });
      w.registerGrazerPreference(otoSpecies, GREEN_SPOT_BIT | DIATOM_BIT);
      w.registerFlowField(
        bakeFlowField({
          tankAabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 1000, y: 400, z: 400 } },
          sources: [{ outflowPos: { x: 900, y: 350, z: 200 }, flowRate: 300 }],
        }),
      );
      w.spawnFish({
        archetype: FISH_ARCHETYPE.CORY_CYLINDER,
        speciesId: otoSpecies,
        bodyLengthMm: 40,
        position: { x: 320, y: 80, z: 220 },
        behaviorHandleIdx: otoHandle,
      });
      for (let i = 0; i < 6; i++) {
        w.spawnFish({
          archetype: FISH_ARCHETYPE.SLIM_TETRA,
          speciesId: cardinalSpecies,
          bodyLengthMm: 30,
          position: { x: 200 + i * 20, y: 200, z: 150 },
          behaviorHandleIdx: cardinalHandle,
        });
      }
      for (let i = 0; i < TICKS; i++) w.step(SIM_DT);
      const s = w.snapshot(0);
      const algae: number[] = [];
      // Scan a wide eid range — bitECS eids are module-global, so by the time
      // this test runs the cursor is well past any small cap. The per-world
      // getAlgaeByType returns null for non-hardscape eids, so the scan picks up
      // exactly this world's two rocks in registration (eid-ascending) order.
      for (let eid = 0; eid < 100000; eid++) {
        const t = w.getAlgaeByType(eid);
        if (t === null) continue;
        algae.push(t['green-spot'], t.hair, t['black-beard'], t.diatom);
      }
      return { position: new Float32Array(s.position), algae: new Float32Array(algae) };
    }

    const r1 = run();
    const r2 = run();
    expect(r1.algae.length).toBe(8); // 2 hardscape × 4 types
    expect(byteEqual(r1.position, r2.position)).toBe(true);
    expect(byteEqual(r1.algae, r2.algae)).toBe(true);
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
