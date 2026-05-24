import { GROWTH_CURVE_TARGET, plantScale } from './growth-curve';

describe('plantScale', () => {
  const carpet = { weeksToMature: 6, sizeAtZero: 0.3 };
  const rosette = { weeksToMature: 10, sizeAtZero: 0.5 };

  it('returns sizeAtZero × vigor at age 0', () => {
    expect(plantScale(carpet, { ageWeeks: 0, vigor: 1 })).toBeCloseTo(0.3);
    expect(plantScale(carpet, { ageWeeks: 0, vigor: 0.5 })).toBeCloseTo(0.15);
  });

  it('reaches GROWTH_CURVE_TARGET of the gap at weeksToMature', () => {
    // baseScale = sizeAtZero + (1 - sizeAtZero) * GROWTH_CURVE_TARGET
    const expected = carpet.sizeAtZero + (1 - carpet.sizeAtZero) * GROWTH_CURVE_TARGET;
    expect(plantScale(carpet, { ageWeeks: 6, vigor: 1 })).toBeCloseTo(expected, 3);
  });

  it('asymptotes toward 1 × vigor for large ages and never exceeds it (at vigor 1)', () => {
    const big = plantScale(carpet, { ageWeeks: 200, vigor: 1 });
    expect(big).toBeLessThanOrEqual(1);
    expect(big).toBeGreaterThan(0.999);
  });

  it('treats negative ages as week 0 (no time travel)', () => {
    expect(plantScale(carpet, { ageWeeks: -5, vigor: 1 })).toBeCloseTo(0.3);
  });

  it('previewAgeWeeks overrides stored ageWeeks without mutation', () => {
    const state = { ageWeeks: 0, vigor: 1 };
    const before = plantScale(carpet, state);
    const preview = plantScale(carpet, state, 6);
    expect(state.ageWeeks).toBe(0); // unchanged
    expect(before).toBeCloseTo(0.3);
    expect(preview).toBeGreaterThan(before);
  });

  it('previewAgeWeeks = 0 is honored (not treated as undefined)', () => {
    const state = { ageWeeks: 100, vigor: 1 };
    expect(plantScale(carpet, state, 0)).toBeCloseTo(0.3);
  });

  it('vigor scales the entire curve (overgrown plants render > 1)', () => {
    const scale = plantScale(carpet, { ageWeeks: 50, vigor: 1.2 });
    expect(scale).toBeGreaterThan(1);
    expect(scale).toBeLessThanOrEqual(1.2);
  });

  it('is monotonically non-decreasing in age (no shrinking with time)', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 30; t += 0.5) {
      const s = plantScale(rosette, { ageWeeks: t, vigor: 1 });
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = s;
    }
  });

  it('defensive: weeksToMature <= 0 falls back to 1 week rather than dividing by zero', () => {
    const out = plantScale({ weeksToMature: 0, sizeAtZero: 0.3 }, { ageWeeks: 1, vigor: 1 });
    expect(Number.isFinite(out)).toBe(true);
    expect(out).toBeGreaterThan(0.3);
  });

  it('defensive: sizeAtZero outside [0, 1] is clamped (no extrapolation past nature)', () => {
    const high = plantScale({ weeksToMature: 6, sizeAtZero: 1.5 }, { ageWeeks: 0, vigor: 1 });
    expect(high).toBeCloseTo(1);
    const low = plantScale({ weeksToMature: 6, sizeAtZero: -0.5 }, { ageWeeks: 0, vigor: 1 });
    expect(low).toBeCloseTo(0);
  });

  it('defensive: non-finite sizeAtZero collapses to 0', () => {
    expect(plantScale({ weeksToMature: 6, sizeAtZero: NaN }, { ageWeeks: 0, vigor: 1 })).toBe(0);
  });
});
