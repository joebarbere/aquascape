import {
  EMPTY_VITALITY,
  HEART_COUNT,
  HUNGRY_THRESHOLD,
  archetypeLabel,
  computeVitalityAggregate,
  fishVitalityAt,
  healthToHearts,
  vitalityBand,
} from './vitality-hud.model';

describe('computeVitalityAggregate', () => {
  it('returns the empty aggregate for a zero-count school', () => {
    expect(computeVitalityAggregate(new Float32Array(0), new Float32Array(0), 0)).toEqual(
      EMPTY_VITALITY,
    );
  });

  it('computes avg + min health and the hungry count/fraction', () => {
    const health = new Float32Array([1.0, 0.5, 0.2, 0.8]);
    const hunger = new Float32Array([0.0, 0.7, 0.9, 0.69]);
    const agg = computeVitalityAggregate(health, hunger, 4);

    expect(agg.count).toBe(4);
    expect(agg.avgHealth).toBeCloseTo((1.0 + 0.5 + 0.2 + 0.8) / 4, 6);
    expect(agg.minHealth).toBeCloseTo(0.2, 6);
    // hunger >= 0.7 → indices 1 (0.7) and 2 (0.9). 0.69 is below threshold.
    expect(agg.hungryCount).toBe(2);
    expect(agg.hungryFraction).toBeCloseTo(0.5, 6);
  });

  it('counts a fish at exactly HUNGRY_THRESHOLD as hungry despite f32 rounding', () => {
    // The slab is f32, so f32(0.7) reads back fractionally below 0.7 — the
    // tolerant compare still counts it. A clearly-fed fish (0.4) does not.
    const agg = computeVitalityAggregate(
      new Float32Array([1, 1]),
      new Float32Array([HUNGRY_THRESHOLD, 0.4]),
      2,
    );
    expect(agg.hungryCount).toBe(1);
  });

  it('only reads the first `count` entries of a longer pooled slab', () => {
    // Pooled slabs can be longer than the live entity count — the [4] and [5]
    // tail entries (health 0) must NOT drag the average down.
    const health = new Float32Array([1, 1, 1, 1, 0, 0]);
    const hunger = new Float32Array([0, 0, 0, 0, 5, 5]);
    const agg = computeVitalityAggregate(health, hunger, 4);
    expect(agg.count).toBe(4);
    expect(agg.avgHealth).toBe(1);
    expect(agg.hungryCount).toBe(0);
  });

  it('clamps count to the shorter slab so it never reads past the buffer', () => {
    const agg = computeVitalityAggregate(new Float32Array([1, 1]), new Float32Array([0]), 5);
    expect(agg.count).toBe(1);
  });
});

describe('healthToHearts', () => {
  it('renders full health as all full hearts', () => {
    expect(healthToHearts(1)).toEqual(['full', 'full', 'full', 'full', 'full']);
  });

  it('renders zero health as all empty hearts', () => {
    expect(healthToHearts(0)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
  });

  it('renders a half-heart at the boundary', () => {
    // 0.5 of 5 hearts = 2.5 hearts → 2 full + 1 half.
    expect(healthToHearts(0.5)).toEqual(['full', 'full', 'half', 'empty', 'empty']);
  });

  it('clamps out-of-range input', () => {
    expect(healthToHearts(2)).toEqual(['full', 'full', 'full', 'full', 'full']);
    expect(healthToHearts(-1)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
  });

  it('always returns HEART_COUNT pips', () => {
    expect(healthToHearts(0.73).length).toBe(HEART_COUNT);
  });
});

describe('vitalityBand', () => {
  it('bands health into healthy / stressed / critical', () => {
    expect(vitalityBand(0.9)).toBe('healthy');
    expect(vitalityBand(0.67)).toBe('healthy');
    expect(vitalityBand(0.5)).toBe('stressed');
    expect(vitalityBand(0.34)).toBe('stressed');
    expect(vitalityBand(0.2)).toBe('critical');
  });
});

describe('archetypeLabel', () => {
  it('labels known archetype codes and falls back for unknown', () => {
    expect(archetypeLabel(0)).toBe('tetra');
    expect(archetypeLabel(6)).toBe('crawler');
    expect(archetypeLabel(99)).toBe('fish');
  });
});

describe('fishVitalityAt', () => {
  it('builds a per-fish readout with hearts, band, hungry + player flags', () => {
    const f = fishVitalityAt(42, 3, 0.5, 0.8, 2, 42);
    expect(f.eid).toBe(42);
    expect(f.index).toBe(3);
    expect(f.health).toBe(0.5);
    expect(f.hunger).toBe(0.8);
    expect(f.hungry).toBe(true);
    expect(f.band).toBe('stressed');
    expect(f.hearts).toEqual(['full', 'full', 'half', 'empty', 'empty']);
    expect(f.archetype).toBe(2);
    expect(f.isPlayer).toBe(true);
  });

  it('flags non-player fish + fed state', () => {
    const f = fishVitalityAt(7, 0, 1, 0.1, 0, 99);
    expect(f.isPlayer).toBe(false);
    expect(f.hungry).toBe(false);
  });
});
