import {
  ENGINE_VERSION,
  freshWaterState,
  simulateChemistry,
  type WaterChemistryParams,
  type WaterState,
} from './chemistry';
import { cycleProgress } from './cycle';

const TANK: WaterChemistryParams = { volumeLitres: 100, kh: 5, temperatureC: 25 };
const SEED = 0xc0ffee;

/** Advance week-by-week, returning the per-week state trace (inclusive of t=0). */
function weeklyTrace(
  params: WaterChemistryParams,
  start: WaterState,
  sourceN: number,
  weeks: number,
  seed = SEED,
): WaterState[] {
  const trace: WaterState[] = [start];
  let s = start;
  for (let w = 0; w < weeks; w++) {
    s = simulateChemistry(params, s, 1, sourceN, seed);
    trace.push(s);
  }
  return trace;
}

describe('simulateChemistry — basics & totality', () => {
  it('does not mutate the input state', () => {
    const s = freshWaterState({ ammonia: 1 });
    const snapshot = JSON.stringify(s);
    simulateChemistry(TANK, s, 4, 100, SEED);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('elapsedWeeks = 0 is identity (but stamps engine version)', () => {
    const s = freshWaterState({ ammonia: 0.7, engineVersion: 0 });
    const out = simulateChemistry(TANK, s, 0, 500, SEED);
    expect(out.ammonia).toBe(0.7);
    expect(out.ageWeeks).toBe(s.ageWeeks);
    expect(out.engineVersion).toBe(ENGINE_VERSION);
  });

  it('NaN elapsedWeeks is treated as zero (identity)', () => {
    const s = freshWaterState({ ammonia: 0.5 });
    const out = simulateChemistry(TANK, s, NaN as unknown as number, 100, SEED);
    expect(out.ammonia).toBe(0.5);
    expect(out.ageWeeks).toBe(s.ageWeeks);
  });

  it('clamps pH to the upper bound when starting alkaline with no nitrification', () => {
    // No source → no nitrification acid; a state seeded above the cap is clamped.
    const out = simulateChemistry(TANK, freshWaterState({ ph: 12 }), 1, 0, SEED);
    expect(out.ph).toBeLessThanOrEqual(8.6);
  });

  it('advances the age clock by elapsedWeeks', () => {
    const out = simulateChemistry(TANK, freshWaterState(), 6, 200, SEED);
    expect(out.ageWeeks).toBeCloseTo(6, 4);
  });

  it('stamps the current engine version on output', () => {
    const out = simulateChemistry(TANK, freshWaterState(), 1, 200, SEED);
    expect(out.engineVersion).toBe(ENGINE_VERSION);
  });

  it('is total against garbage inputs (NaN/negatives → defended)', () => {
    const bad = {
      ammonia: NaN,
      nitrite: -5,
      nitrate: NaN,
      ph: NaN,
      aobColony: -1,
      nobColony: NaN,
      ageWeeks: -3,
      engineVersion: 0,
    } as WaterState;
    const out = simulateChemistry(
      { volumeLitres: NaN, kh: NaN, temperatureC: NaN },
      bad,
      2,
      NaN as unknown as number,
      SEED,
    );
    // Garbage params/state/source → all output fields finite & non-negative.
    for (const v of [out.ammonia, out.nitrite, out.nitrate, out.aobColony, out.nobColony]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(Number.isFinite(out.ph)).toBe(true);
  });

  it('a negative source term is floored to zero (no negative ammonia)', () => {
    const out = simulateChemistry(TANK, freshWaterState(), 2, -999, SEED);
    expect(out.ammonia).toBeGreaterThanOrEqual(0);
  });

  it('handles a degenerate sub-one-litre volume without exploding', () => {
    const out = simulateChemistry({ ...TANK, volumeLitres: 0 }, freshWaterState(), 1, 50, SEED);
    expect(Number.isFinite(out.ammonia)).toBe(true);
  });
});

describe('golden curve — fishless cycle (dosed ammonia, no fish)', () => {
  // A classic fishless cycle: dose ammonia (a fixed source) into a sterile tank.
  // Expect ammonia to spike then fall, nitrite to follow on a lag, nitrate to
  // accumulate, and the tank to reach `cycled`.
  const SOURCE = 250; // mg-N/day dosed
  const trace = weeklyTrace(TANK, freshWaterState(), SOURCE, 10);

  it('ammonia spikes early then falls as the AOB colony establishes', () => {
    const peak = Math.max(...trace.map((s) => s.ammonia));
    const peakWeek = trace.findIndex((s) => s.ammonia === peak);
    expect(peak).toBeGreaterThan(0.5); // a real spike
    expect(peakWeek).toBeGreaterThan(0);
    expect(peakWeek).toBeLessThan(trace.length - 1); // it falls afterward
    expect(trace[trace.length - 1].ammonia).toBeLessThan(peak); // fell from peak
  });

  it('nitrite spikes AFTER ammonia (the two-stage lag)', () => {
    const ammoniaPeakWeek = trace.findIndex(
      (s) => s.ammonia === Math.max(...trace.map((t) => t.ammonia)),
    );
    const nitritePeakWeek = trace.findIndex(
      (s) => s.nitrite === Math.max(...trace.map((t) => t.nitrite)),
    );
    expect(Math.max(...trace.map((s) => s.nitrite))).toBeGreaterThan(0.3);
    expect(nitritePeakWeek).toBeGreaterThan(ammoniaPeakWeek);
  });

  it('nitrate accumulates monotonically (only a water change removes it)', () => {
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i].nitrate).toBeGreaterThanOrEqual(trace[i - 1].nitrate - 1e-9);
    }
    expect(trace[trace.length - 1].nitrate).toBeGreaterThan(1);
  });

  it('reaches the `cycled` stage and ammonia + nitrite settle to safe', () => {
    const final = trace[trace.length - 1];
    expect(final.ammonia).toBeLessThanOrEqual(0.25);
    expect(final.nitrite).toBeLessThanOrEqual(0.25);
    expect(cycleProgress(final)).toBe('cycled');
  });

  it('pH drifts downward over the cycle (nitrification acidifies)', () => {
    expect(trace[trace.length - 1].ph).toBeLessThan(trace[0].ph);
  });

  it('progresses uncycled → cycling → cycled in order', () => {
    const stages = trace.map((s) => cycleProgress(s));
    expect(stages[0]).toBe('uncycled');
    expect(stages).toContain('cycling');
    expect(stages[stages.length - 1]).toBe('cycled');
    const firstCycled = stages.indexOf('cycled');
    const firstCycling = stages.indexOf('cycling');
    expect(firstCycling).toBeGreaterThan(0);
    expect(firstCycled).toBeGreaterThan(firstCycling);
  });
});

describe('golden curve — stocked cycle vs fishless empty tank', () => {
  it('an empty (no source) tank never cycles — stays uncycled, no nitrogen', () => {
    const trace = weeklyTrace(TANK, freshWaterState(), 0, 10);
    const final = trace[trace.length - 1];
    expect(final.ammonia).toBeLessThanOrEqual(0.25);
    expect(final.nitrite).toBeLessThanOrEqual(0.25);
    expect(final.nitrate).toBeLessThan(0.01);
    expect(cycleProgress(final)).toBe('uncycled');
  });

  it('a stocked tank (bioload source) cycles; the empty tank does not', () => {
    const stocked = weeklyTrace(TANK, freshWaterState(), 180, 10);
    const empty = weeklyTrace(TANK, freshWaterState(), 0, 10);
    expect(cycleProgress(stocked[stocked.length - 1])).toBe('cycled');
    expect(cycleProgress(empty[empty.length - 1])).toBe('uncycled');
    // The stocked tank accumulated nitrate; the empty one did not.
    expect(stocked[stocked.length - 1].nitrate).toBeGreaterThan(1);
    expect(empty[empty.length - 1].nitrate).toBeLessThan(0.01);
  });

  it('fish-in (continuous source) shows the dangerous ammonia spike a fishless-low tank avoids', () => {
    const heavy = weeklyTrace(TANK, freshWaterState(), 400, 6);
    const light = weeklyTrace(TANK, freshWaterState(), 40, 6);
    const heavyPeak = Math.max(...heavy.map((s) => s.ammonia));
    const lightPeak = Math.max(...light.map((s) => s.ammonia));
    expect(heavyPeak).toBeGreaterThan(lightPeak);
  });

  it('reaches `cycled` on the SAME week every run for a fixed seed (acceptance)', () => {
    const cycledWeek = (seed: number): number => {
      const trace = weeklyTrace(TANK, freshWaterState(), 250, 12, seed);
      return trace.findIndex((s) => cycleProgress(s) === 'cycled');
    };
    const a = cycledWeek(SEED);
    const b = cycledWeek(SEED);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0); // it did cycle within the window
  });
});

describe('determinism — property test (same seed ⇒ byte-identical evolution)', () => {
  // A varied multi-step event sequence: changing source, varied dt, varied tank.
  const eventSequence: Array<{ weeks: number; source: number }> = [
    { weeks: 0.5, source: 120 },
    { weeks: 1.3, source: 300 },
    { weeks: 2, source: 60 },
    { weeks: 0.25, source: 500 },
    { weeks: 3.7, source: 180 },
    { weeks: 1, source: 0 },
  ];

  function run(seed: number, params: WaterChemistryParams): WaterState[] {
    let s = freshWaterState();
    const out: WaterState[] = [];
    for (const ev of eventSequence) {
      s = simulateChemistry(params, s, ev.weeks, ev.source, seed);
      out.push(s);
    }
    return out;
  }

  it('is byte-for-byte reproducible across runs for a fixed seed', () => {
    const runs = Array.from({ length: 5 }, () => run(SEED, TANK));
    const first = JSON.stringify(runs[0]);
    for (const r of runs) {
      expect(JSON.stringify(r)).toBe(first);
    }
  });

  it('different seeds produce different evolutions (jitter is seed-driven)', () => {
    const a = JSON.stringify(run(1, TANK));
    const b = JSON.stringify(run(2, TANK));
    expect(a).not.toBe(b);
  });

  it('subdividing the time span yields the same trajectory (jitter keyed to the global ageWeeks clock, not call boundaries)', () => {
    // One 4-week step vs four 1-week steps land on the same jitter stream because
    // the step index is derived from the running ageWeeks, not the call boundary.
    // (Per-call 4dp rounding of the snapshot means they agree to ~2dp, not
    // byte-identically — byte-identity for a FIXED call sequence is covered by
    // the repeat-run test above; this asserts the trajectory is call-split
    // invariant.)
    const oneShot = simulateChemistry(TANK, freshWaterState(), 4, 250, SEED);
    let s = freshWaterState();
    for (let i = 0; i < 4; i++) s = simulateChemistry(TANK, s, 1, 250, SEED);
    expect(s.ammonia).toBeCloseTo(oneShot.ammonia, 2);
    expect(s.nitrate).toBeCloseTo(oneShot.nitrate, 1);
    expect(s.aobColony).toBeCloseTo(oneShot.aobColony, 2);
  });

  it('a fixed scenario matches a recorded golden snapshot (rate-model drift guard)', () => {
    const trace = weeklyTrace(TANK, freshWaterState(), 250, 8);
    const summary = trace.map((s) => ({
      w: s.ageWeeks,
      nh3: s.ammonia,
      no2: s.nitrite,
      no3: s.nitrate,
      stage: cycleProgress(s),
    }));
    expect(summary).toMatchSnapshot();
  });
});

describe('tank parameter effects', () => {
  it('a larger tank dilutes the same source → a smaller ammonia spike', () => {
    const small = weeklyTrace({ ...TANK, volumeLitres: 40 }, freshWaterState(), 250, 6);
    const big = weeklyTrace({ ...TANK, volumeLitres: 400 }, freshWaterState(), 250, 6);
    const smallPeak = Math.max(...small.map((s) => s.ammonia));
    const bigPeak = Math.max(...big.map((s) => s.ammonia));
    expect(bigPeak).toBeLessThan(smallPeak);
  });

  it('high KH buffers pH (less drift than a low-KH tank)', () => {
    const lowKh = weeklyTrace({ ...TANK, kh: 1 }, freshWaterState(), 250, 8);
    const highKh = weeklyTrace({ ...TANK, kh: 12 }, freshWaterState(), 250, 8);
    const lowDrift = lowKh[0].ph - lowKh[lowKh.length - 1].ph;
    const highDrift = highKh[0].ph - highKh[highKh.length - 1].ph;
    expect(highDrift).toBeLessThan(lowDrift);
  });

  it('warmer water cycles faster than cold water (Q10 temperature factor)', () => {
    const warm = weeklyTrace({ ...TANK, temperatureC: 28 }, freshWaterState(), 250, 12);
    const cold = weeklyTrace({ ...TANK, temperatureC: 16 }, freshWaterState(), 250, 12);
    const warmCycled = warm.findIndex((s) => cycleProgress(s) === 'cycled');
    const coldCycled = cold.findIndex((s) => cycleProgress(s) === 'cycled');
    expect(warmCycled).toBeGreaterThan(0);
    // Cold either cycles later or not within the window.
    if (coldCycled > 0) {
      expect(warmCycled).toBeLessThanOrEqual(coldCycled);
    }
  });
});
