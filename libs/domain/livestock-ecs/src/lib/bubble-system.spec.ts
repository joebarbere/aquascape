/**
 * Bubble particle spawn + lifetime + determinism tests (Stage 11 F11.5 Wave 5).
 *
 * Covers:
 *   - registerBubbleSources([]) clears; one source registers.
 *   - After several steps, particle count grows roughly in line with the
 *     declared `airRateMl` and `BUBBLE_SCALE`.
 *   - Bubbles rise (`Position.y` increases each tick).
 *   - Bubbles despawn near the waterline.
 *   - Global cap holds regardless of how absurd the `airRateMl` is.
 *   - Determinism: same seed + same source set → byte-identical
 *     `WorldSnapshot.bubblePosition` across 1000 ticks.
 *   - Re-registration is idempotent (count goes to 0 on `[]`).
 *
 * No `Math.random` anywhere — every random read in the system flows through
 * `tickPrng`, and these tests verify the byte-identical replay invariant.
 */
import { defineQuery } from 'bitecs';

import { BubbleParticle, Position } from './components';
import {
  BUBBLE_DEFAULT_LIFETIME_SEC,
  BUBBLE_DEFAULT_VELOCITY_Y_MM_PER_S,
  BUBBLE_GLOBAL_CAP_COUNT,
  BUBBLE_HORIZONTAL_JITTER_MM,
  BUBBLE_SCALE,
  bubbleLifetimeSystem,
  bubbleSourceSpawnSystem,
} from './bubble-system';
import { createLivestockWorld, SIM_DT, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

const bubbleQuery = defineQuery([BubbleParticle, Position]);

describe('world.registerBubbleSources — registration surface', () => {
  it('starts with zero sources + zero particles', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    expect(w.getBubbleSourceCount()).toBe(0);
    expect(w.getBubbleParticleCount()).toBe(0);
  });

  it('registers one source from a single registration', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 800 }]);
    expect(w.getBubbleSourceCount()).toBe(1);
  });

  it('passing [] clears every previously-registered source', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 800 }]);
    expect(w.getBubbleSourceCount()).toBe(1);
    w.registerBubbleSources([]);
    expect(w.getBubbleSourceCount()).toBe(0);
  });

  it('replacing the source set updates the count + per-source state', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 800 }]);
    w.registerBubbleSources([
      { position: { x: 100, y: 0, z: 100 }, airRateMl: 400 },
      { position: { x: 300, y: 0, z: 200 }, airRateMl: 600 },
    ]);
    expect(w.getBubbleSourceCount()).toBe(2);
    expect(w.__bubbleSources.posX[0]).toBeCloseTo(100);
    expect(w.__bubbleSources.posX[1]).toBeCloseTo(300);
  });

  it('dispose() clears the bubble source set + particle entities', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 800 }]);
    for (let i = 0; i < 60; i++) w.step(SIM_DT);
    expect(w.getBubbleParticleCount()).toBeGreaterThan(0);
    w.dispose();
    expect(w.getBubbleSourceCount()).toBe(0);
  });
});

describe('bubbleSourceSpawnSystem — spawn rate calibration', () => {
  it('zero airRateMl produces zero particles even after many ticks', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 0 }]);
    for (let i = 0; i < 300; i++) w.step(SIM_DT);
    expect(w.getBubbleParticleCount()).toBe(0);
  });

  it('after N ticks, particle count grows in proportion to airRateMl × BUBBLE_SCALE', () => {
    // Spawn-rate expectation: with airRateMl = 600 mL/min and BUBBLE_SCALE
    // = 3, the per-second rate is 600/60 * BUBBLE_SCALE = 30 particles/sec,
    // i.e. 1 per tick at 30 Hz. After 30 ticks, expect ~30 particles spawned
    // (give or take a few for the per-source accumulator's fractional carry).
    const airRateMl = 600;
    const ticks = 30;
    const expectedRate = (airRateMl / 60) * BUBBLE_SCALE; // particles/sec
    const expectedCount = expectedRate * ticks * SIM_DT;
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl }]);
    for (let i = 0; i < ticks; i++) w.step(SIM_DT);
    // At this point lifetime has not started despawning anything (a single
    // bubble has only risen 30 * SIM_DT * 150 mm/s = 150 mm — well below
    // the waterline at 390 mm).
    const count = w.getBubbleParticleCount();
    expect(count).toBeGreaterThanOrEqual(Math.floor(expectedCount - 2));
    expect(count).toBeLessThanOrEqual(Math.ceil(expectedCount + 2));
  });

  it('two sources spawn from independent accumulators (sum approx 2× rate)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([
      { position: { x: 200, y: 20, z: 200 }, airRateMl: 300 },
      { position: { x: 500, y: 20, z: 200 }, airRateMl: 300 },
    ]);
    // Two sources at 300 mL/min each → 300/60 * 3 * 2 = 30 particles/sec
    // total → ~30 over 30 ticks.
    for (let i = 0; i < 30; i++) w.step(SIM_DT);
    const n = w.getBubbleParticleCount();
    expect(n).toBeGreaterThanOrEqual(28);
    expect(n).toBeLessThanOrEqual(32);
  });
});

describe('bubbleSourceSpawnSystem — spawn jitter + position', () => {
  it('spawns at the source position + small horizontal jitter', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const srcX = 200;
    const srcZ = 200;
    w.registerBubbleSources([
      { position: { x: srcX, y: 20, z: srcZ }, airRateMl: 800 },
    ]);
    // Drive a single spawn-system call directly so we can inspect the
    // freshly-spawned bubble before lifetime touches it. Step the systems
    // manually rather than going through world.step() to skip the lifetime
    // pass.
    bubbleSourceSpawnSystem(w, SIM_DT);
    const eids = bubbleQuery(w.ecs);
    expect(eids.length).toBeGreaterThan(0);
    for (const eid of eids) {
      const x = Position.x[eid] as number;
      const z = Position.z[eid] as number;
      // Jitter is bounded by ±BUBBLE_HORIZONTAL_JITTER_MM.
      expect(Math.abs(x - srcX)).toBeLessThanOrEqual(BUBBLE_HORIZONTAL_JITTER_MM);
      expect(Math.abs(z - srcZ)).toBeLessThanOrEqual(BUBBLE_HORIZONTAL_JITTER_MM);
      // Y starts exactly at the source.
      expect(Position.y[eid] as number).toBeCloseTo(20);
    }
  });

  it('newly-spawned bubbles carry the default velocity + lifetime', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 800 }]);
    bubbleSourceSpawnSystem(w, SIM_DT);
    const eids = bubbleQuery(w.ecs);
    expect(eids.length).toBeGreaterThan(0);
    const eid = eids[0]!;
    expect(BubbleParticle.velocityY[eid] as number).toBeCloseTo(BUBBLE_DEFAULT_VELOCITY_Y_MM_PER_S);
    expect(BubbleParticle.lifetimeSec[eid] as number).toBeCloseTo(BUBBLE_DEFAULT_LIFETIME_SEC);
    expect(BubbleParticle.sourceEid[eid]).toBe(0);
  });
});

describe('bubbleLifetimeSystem — rise + despawn', () => {
  it('bubbles rise on +Y by velocityY * dt every tick', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 800 }]);
    // Single spawn pass — no lifetime advance yet.
    bubbleSourceSpawnSystem(w, SIM_DT);
    const eidsBefore = bubbleQuery(w.ecs);
    const eid = eidsBefore[0]!;
    const yBefore = Position.y[eid] as number;
    // Drive lifetime once — expect +velocityY * SIM_DT.
    bubbleLifetimeSystem(w, SIM_DT);
    const yAfter = Position.y[eid] as number;
    expect(yAfter - yBefore).toBeCloseTo(BUBBLE_DEFAULT_VELOCITY_Y_MM_PER_S * SIM_DT, 3);
  });

  it('bubbles drift horizontally as they rise (fluid advection, fidelity pass)', () => {
    // Drives the full world.step() path so the per-source Stam fluid slice is
    // stepped each tick (bubbleFluidStepSystem). The advected velocity field
    // should push bubbles off a straight vertical line — the fidelity-pass
    // replacement for the old height-driven helix.
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 800 }]);
    // Build a column.
    for (let i = 0; i < 10; i++) w.step(SIM_DT);
    const eid = bubbleQuery(w.ecs)[0]!;
    const x0 = Position.x[eid] as number;
    const z0 = Position.z[eid] as number;
    let maxDx = 0;
    let maxDz = 0;
    for (let i = 0; i < 40; i++) {
      w.step(SIM_DT);
      if (!bubbleQuery(w.ecs).includes(eid)) break; // popped at waterline
      maxDx = Math.max(maxDx, Math.abs((Position.x[eid] as number) - x0));
      maxDz = Math.max(maxDz, Math.abs((Position.z[eid] as number) - z0));
    }
    // The bubble drifted laterally (not a straight vertical line).
    expect(maxDx + maxDz).toBeGreaterThan(1);
  });

  it('falls back to the helix drift when the system is driven without fluid slices', () => {
    // Calling bubbleLifetimeSystem directly (without registered sources →
    // no slices) exercises the slice-less fallback path. Spawn a bubble by
    // hand-driving the spawn system after registering, then CLEAR sources so
    // no fluid slice exists, and confirm the helix still drifts it.
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 800 }]);
    bubbleSourceSpawnSystem(w, SIM_DT);
    const eid = bubbleQuery(w.ecs)[0]!;
    // Drop the sources → fluid slice set empties → helix fallback engages.
    w.registerBubbleSources([]);
    const x0 = Position.x[eid] as number;
    const z0 = Position.z[eid] as number;
    let maxDx = 0;
    let maxDz = 0;
    for (let i = 0; i < 40; i++) {
      bubbleLifetimeSystem(w, SIM_DT);
      if (!bubbleQuery(w.ecs).includes(eid)) break;
      maxDx = Math.max(maxDx, Math.abs((Position.x[eid] as number) - x0));
      maxDz = Math.max(maxDz, Math.abs((Position.z[eid] as number) - z0));
    }
    expect(maxDx + maxDz).toBeGreaterThan(1);
  });

  it('bubbles despawn at the waterline (count returns to 0 with no further spawns)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 800 }]);
    // Spawn for a bit to build up a column.
    for (let i = 0; i < 30; i++) w.step(SIM_DT);
    expect(w.getBubbleParticleCount()).toBeGreaterThan(0);
    // Clear the sources so no new spawns happen.
    w.registerBubbleSources([]);
    // 400 mm tank / 150 mm/s rise + 6 s lifetime cap → all bubbles gone
    // within ~3 s = 90 ticks. Give 240 ticks of headroom.
    for (let i = 0; i < 240; i++) w.step(SIM_DT);
    expect(w.getBubbleParticleCount()).toBe(0);
  });

  it('expires bubbles via lifetimeSec when the tank is so tall they would never reach the waterline', () => {
    // A 100m-tall tank — bubbles at 150 mm/s for 6 s rise only 900 mm,
    // well short of 100000 mm. The lifetimeSec cap is the only thing that
    // can despawn them, and it must.
    const tallTank: TankAabb = { ...TANK, maxY: 100000 };
    const w = createLivestockWorld(0, { tankAabb: tallTank });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 200 }]);
    for (let i = 0; i < 30; i++) w.step(SIM_DT);
    expect(w.getBubbleParticleCount()).toBeGreaterThan(0);
    w.registerBubbleSources([]);
    // Drive past BUBBLE_DEFAULT_LIFETIME_SEC.
    const ticksToExpire = Math.ceil(BUBBLE_DEFAULT_LIFETIME_SEC / SIM_DT) + 5;
    for (let i = 0; i < ticksToExpire; i++) w.step(SIM_DT);
    expect(w.getBubbleParticleCount()).toBe(0);
  });
});

describe('bubbleSourceSpawnSystem — global cap', () => {
  it('count never exceeds BUBBLE_GLOBAL_CAP_COUNT, no matter how high airRateMl is', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    // 1e9 mL/min → spawn debt accumulates faster than lifetime can drain.
    w.registerBubbleSources([
      { position: { x: 200, y: 20, z: 200 }, airRateMl: 1e9 },
    ]);
    // Drive enough ticks for steady-state to clamp at the cap.
    for (let i = 0; i < 600; i++) {
      w.step(SIM_DT);
      expect(w.getBubbleParticleCount()).toBeLessThanOrEqual(BUBBLE_GLOBAL_CAP_COUNT);
    }
  });
});

describe('bubble particles — determinism replay (F11.5 Wave 5 invariant)', () => {
  function runBubbles(): {
    bubbleCount: number;
    bubblePosition: Float32Array;
  } {
    const w = createLivestockWorld(0xb0bb1e, { tankAabb: TANK });
    w.registerBubbleSources([
      { position: { x: 250, y: 20, z: 200 }, airRateMl: 300 },
      { position: { x: 750, y: 20, z: 200 }, airRateMl: 600 },
    ]);
    for (let i = 0; i < 1000; i++) w.step(SIM_DT);
    const snap = w.snapshot(0);
    return {
      bubbleCount: snap.bubbleCount,
      bubblePosition: new Float32Array(snap.bubblePosition),
    };
  }

  function byteEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
    if (a.byteLength !== b.byteLength) return false;
    const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
    return true;
  }

  it('two cold worlds with identical bubble sources produce byte-identical bubblePosition slabs at tick 1000', () => {
    const r1 = runBubbles();
    const r2 = runBubbles();
    expect(r1.bubbleCount).toBe(r2.bubbleCount);
    expect(byteEqual(r1.bubblePosition, r2.bubblePosition)).toBe(true);
  });
});

describe('bubbleSourceSpawnSystem — fast-path early-out', () => {
  it('no-op when no sources are registered', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    // Should not throw or spawn anything.
    bubbleSourceSpawnSystem(w, SIM_DT);
    expect(w.getBubbleParticleCount()).toBe(0);
  });
});

describe('WorldSnapshot — bubble slab', () => {
  it('snapshot.bubbleCount + bubblePosition reflect live particles', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 800 }]);
    for (let i = 0; i < 10; i++) w.step(SIM_DT);
    const snap = w.snapshot(0);
    expect(snap.bubbleCount).toBeGreaterThan(0);
    expect(snap.bubblePosition.length).toBe(snap.bubbleCount * 3);
    // Every bubble's Y is between the source Y (20) and the waterline.
    for (let i = 0; i < snap.bubbleCount; i++) {
      const y = snap.bubblePosition[i * 3 + 1]!;
      expect(y).toBeGreaterThanOrEqual(20);
      expect(y).toBeLessThanOrEqual(TANK.maxY);
    }
  });

  it('snapshot.bubbleCount = 0 when no sources are registered', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    for (let i = 0; i < 30; i++) w.step(SIM_DT);
    const snap = w.snapshot(0);
    expect(snap.bubbleCount).toBe(0);
    expect(snap.bubblePosition.length).toBe(0);
  });

  it('fish slab + foodSprite slab are independent of bubble slab (additive contract)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 800 }]);
    for (let i = 0; i < 30; i++) w.step(SIM_DT);
    const snap = w.snapshot(0);
    // No fish, no sprites — bubble slab must NOT pollute either count.
    expect(snap.entityCount).toBe(0);
    expect(snap.foodSpriteCount).toBe(0);
    expect(snap.bubbleCount).toBeGreaterThan(0);
  });
});
