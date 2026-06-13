import { ALGAE_TYPES, algaeGrowth, type AlgaeType } from './algae';

describe('algaeGrowth', () => {
  it('grows faster under higher nitrate (nutrient driver)', () => {
    for (const type of ALGAE_TYPES) {
      const low = algaeGrowth(type, 5, 10, 0.5, 1);
      const high = algaeGrowth(type, 60, 10, 0.5, 1);
      expect(high).toBeGreaterThan(low);
    }
  });

  it('is ~zero with no nitrate (no nutrient → no bloom)', () => {
    for (const type of ALGAE_TYPES) {
      expect(algaeGrowth(type, 0, 12, 0.5, 1)).toBeLessThan(0.001);
    }
  });

  it('green-spot & hair grow faster under a long photoperiod', () => {
    const longDay = algaeGrowth('hair', 40, 12, 0.5, 1);
    const noLight = algaeGrowth('hair', 40, 0, 0.5, 1);
    expect(longDay).toBeGreaterThan(noLight);
  });

  it('black-beard likes flow; diatoms are suppressed by it', () => {
    const bbaStill = algaeGrowth('black-beard', 30, 8, 0, 1);
    const bbaFlow = algaeGrowth('black-beard', 30, 8, 1, 1);
    expect(bbaFlow).toBeGreaterThan(bbaStill);

    const diatomStill = algaeGrowth('diatom', 30, 6, 0, 1);
    const diatomFlow = algaeGrowth('diatom', 30, 6, 1, 1);
    expect(diatomFlow).toBeLessThan(diatomStill);
  });

  it('scales linearly with dt', () => {
    const oneDay = algaeGrowth('green-spot', 40, 10, 0.5, 1);
    const twoDays = algaeGrowth('green-spot', 40, 10, 0.5, 2);
    expect(twoDays).toBeCloseTo(oneDay * 2, 6);
  });

  it('dt = 0 or negative → no growth', () => {
    expect(algaeGrowth('hair', 40, 10, 0.5, 0)).toBe(0);
    expect(algaeGrowth('hair', 40, 10, 0.5, -1)).toBe(0);
  });

  it('returns 0 for an unknown algae type', () => {
    expect(algaeGrowth('plankton' as AlgaeType, 40, 10, 0.5, 1)).toBe(0);
  });

  it('is never negative and always finite', () => {
    for (const type of ALGAE_TYPES) {
      const g = algaeGrowth(type, 40, 10, 0.5, 1);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(g)).toBe(true);
    }
  });

  it('defends NaN inputs', () => {
    const g = algaeGrowth('hair', NaN, NaN, NaN, 1);
    expect(Number.isFinite(g)).toBe(true);
    expect(g).toBeGreaterThanOrEqual(0);
  });

  it('clamps an out-of-range photoperiod and flow', () => {
    expect(Number.isFinite(algaeGrowth('hair', 40, 99, 9, 1))).toBe(true);
    expect(Number.isFinite(algaeGrowth('hair', 40, -5, -5, 1))).toBe(true);
  });

  it('diatoms favour a low-light niche over green-spot at short photoperiod', () => {
    // At a short, dim photoperiod the diatom (new-tank) niche should out-grow
    // the bright-light-loving green-spot type.
    const diatom = algaeGrowth('diatom', 20, 5, 0, 1);
    const greenSpot = algaeGrowth('green-spot', 20, 5, 0, 1);
    expect(diatom).toBeGreaterThan(greenSpot);
  });
});
