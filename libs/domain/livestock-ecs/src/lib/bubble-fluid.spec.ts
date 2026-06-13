/**
 * Bubble fluid coupling tests ("bubble fluid fidelity pass").
 *
 * Covers:
 *   - rebuildBubbleFluid allocates one slice per source + early-outs at 0.
 *   - bubbleFluidStepSystem develops a non-trivial velocity field over ticks
 *     (the plume is actually advecting), and early-outs with no sources.
 *   - sampleBubbleFluid sums overlapping slices (multi-stone interaction —
 *     two adjacent plumes produce a larger sampled magnitude than one).
 *   - Determinism: two cold worlds with identical sources produce byte-
 *     identical slice velocity fields after N ticks (the fluid step is the
 *     only new float state feeding the bubble snapshot).
 *
 * No `Math.random` — the only entropy is the seeded turbulence puff via
 * `tickPrng`.
 */
import { bubbleFluidStepSystem, sampleBubbleFluid } from './bubble-fluid';
import { createLivestockWorld, SIM_DT, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

function fieldEnergy(arr: Float32Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += Math.abs(arr[i]!);
  return s;
}

describe('rebuildBubbleFluid — slice lifecycle', () => {
  it('builds one slice per registered source', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([
      { position: { x: 200, y: 20, z: 200 }, airRateMl: 400 },
      { position: { x: 800, y: 20, z: 200 }, airRateMl: 600 },
    ]);
    expect(w.__bubbleFluid.slices.length).toBe(2);
    // Centre X tracks the source positions, in registration order.
    expect(w.__bubbleFluid.centreX[0]).toBeCloseTo(200);
    expect(w.__bubbleFluid.centreX[1]).toBeCloseTo(800);
  });

  it('clears slices when sources are cleared', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 400 }]);
    expect(w.__bubbleFluid.slices.length).toBe(1);
    w.registerBubbleSources([]);
    expect(w.__bubbleFluid.slices.length).toBe(0);
  });

  it('rebuilds slices on a tank resize so rows still span the tank height', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 400 }]);
    const row0 = w.__bubbleFluid.rowSizeY[0]!;
    w.setTankAabb({ ...TANK, maxY: 800 });
    const row1 = w.__bubbleFluid.rowSizeY[0]!;
    // Doubling the tank height doubles the mm-per-row mapping.
    expect(row1).toBeCloseTo(row0 * 2, 3);
  });
});

describe('bubbleFluidStepSystem — plume develops', () => {
  it('early-outs cleanly with no sources', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    expect(() => bubbleFluidStepSystem(w, SIM_DT)).not.toThrow();
  });

  it('grows a non-trivial velocity field over ticks for a live source', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 600 }]);
    const slice = w.__bubbleFluid.slices[0]!;
    expect(fieldEnergy(slice.v)).toBe(0); // starts quiescent
    for (let i = 0; i < 30; i++) bubbleFluidStepSystem(w, SIM_DT);
    // Buoyancy injection + advection should have built a real updraft.
    expect(fieldEnergy(slice.v)).toBeGreaterThan(0);
    // The seeded turbulence puff should have produced lateral velocity too.
    expect(fieldEnergy(slice.u)).toBeGreaterThan(0);
  });

  it('a zero-rate source stays quiescent (no buoyancy injected)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    w.registerBubbleSources([{ position: { x: 200, y: 20, z: 200 }, airRateMl: 0 }]);
    const slice = w.__bubbleFluid.slices[0]!;
    for (let i = 0; i < 30; i++) bubbleFluidStepSystem(w, SIM_DT);
    expect(fieldEnergy(slice.v)).toBe(0);
    expect(fieldEnergy(slice.u)).toBe(0);
  });
});

describe('sampleBubbleFluid — multi-stone interaction', () => {
  it('a two-source sample equals the sum of the two single-source samples (overlapping slices interact)', () => {
    // The fidelity-pass interaction is: overlapping slices SUM in world space,
    // so a point in both plumes' influence reads both. Verify directly — run
    // each source alone (same seed → same per-source field), sample at a
    // shared probe in both plumes' overlap, and confirm the two-source world's
    // sample equals the sum of the two singles.
    const probeX = 500; // inside both ±200 mm bands (450±200, 550±200)
    const probeY = 150;
    const TICKS = 60;

    // Solo worlds keep the SAME two-slot layout (so each plume's source INDEX
    // — which keys its turbulence-puff stream — matches the two-source world)
    // but zero the other slot's rate, leaving it quiescent.
    const a = createLivestockWorld(0xabc, { tankAabb: TANK });
    a.registerBubbleSources([
      { position: { x: 450, y: 20, z: 200 }, airRateMl: 600 },
      { position: { x: 550, y: 20, z: 200 }, airRateMl: 0 },
    ]);
    for (let i = 0; i < TICKS; i++) bubbleFluidStepSystem(a, SIM_DT);
    const outA = { u: 0, v: 0 };
    sampleBubbleFluid(a, probeX, probeY, outA);

    const b = createLivestockWorld(0xabc, { tankAabb: TANK });
    b.registerBubbleSources([
      { position: { x: 450, y: 20, z: 200 }, airRateMl: 0 },
      { position: { x: 550, y: 20, z: 200 }, airRateMl: 600 },
    ]);
    for (let i = 0; i < TICKS; i++) bubbleFluidStepSystem(b, SIM_DT);
    const outB = { u: 0, v: 0 };
    sampleBubbleFluid(b, probeX, probeY, outB);

    const both = createLivestockWorld(0xabc, { tankAabb: TANK });
    both.registerBubbleSources([
      { position: { x: 450, y: 20, z: 200 }, airRateMl: 600 },
      { position: { x: 550, y: 20, z: 200 }, airRateMl: 600 },
    ]);
    for (let i = 0; i < TICKS; i++) bubbleFluidStepSystem(both, SIM_DT);
    const outBoth = { u: 0, v: 0 };
    sampleBubbleFluid(both, probeX, probeY, outBoth);

    // Each source's slice in `both` evolves identically to its solo world (the
    // turbulence puff is keyed by source INDEX — index 0 in solo `a` matches
    // index 0 in `both`; index 1 in solo `b` matches index 1 in `both`), so
    // the sum is exact up to float round-off.
    expect(outBoth.u).toBeCloseTo(outA.u + outB.u, 4);
    expect(outBoth.v).toBeCloseTo(outA.v + outB.v, 4);
    // And the overlap genuinely carries influence from both plumes.
    expect(Math.abs(outBoth.v)).toBeGreaterThan(0);
  });

  it('returns zero when no slices exist', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const out = { u: 1, v: 1 };
    sampleBubbleFluid(w, 100, 100, out);
    expect(out.u).toBe(0);
    expect(out.v).toBe(0);
  });
});

describe('bubble fluid — determinism', () => {
  function runFluidField(): { u: Float32Array; v: Float32Array } {
    const w = createLivestockWorld(0xf101d, { tankAabb: TANK });
    w.registerBubbleSources([
      { position: { x: 250, y: 20, z: 200 }, airRateMl: 400 },
      { position: { x: 750, y: 20, z: 200 }, airRateMl: 700 },
    ]);
    for (let i = 0; i < 500; i++) bubbleFluidStepSystem(w, SIM_DT);
    // Copy out so a later run can't alias.
    return {
      u: new Float32Array(w.__bubbleFluid.slices[1]!.u),
      v: new Float32Array(w.__bubbleFluid.slices[1]!.v),
    };
  }

  function byteEqual(a: Float32Array, b: Float32Array): boolean {
    if (a.byteLength !== b.byteLength) return false;
    const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
    return true;
  }

  it('two cold worlds produce byte-identical slice fields after 500 ticks', () => {
    const r1 = runFluidField();
    const r2 = runFluidField();
    expect(byteEqual(r1.u, r2.u)).toBe(true);
    expect(byteEqual(r1.v, r2.v)).toBe(true);
  });
});
