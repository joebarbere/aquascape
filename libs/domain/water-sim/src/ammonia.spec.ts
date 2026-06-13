import { freeAmmonia, freeAmmoniaFraction } from './ammonia';

describe('freeAmmoniaFraction (Emerson et al. 1975 equilibrium)', () => {
  it('rises with pH — more toxic NH3 at higher pH', () => {
    const low = freeAmmoniaFraction(6.5, 25);
    const mid = freeAmmoniaFraction(7.5, 25);
    const high = freeAmmoniaFraction(8.5, 25);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it('rises with temperature at fixed pH', () => {
    const cold = freeAmmoniaFraction(7.5, 15);
    const warm = freeAmmoniaFraction(7.5, 30);
    expect(warm).toBeGreaterThan(cold);
  });

  it('matches the known order of magnitude at pH 7, 25°C (~0.6% free)', () => {
    // Emerson 1975 tables put the NH3 fraction at pH 7 / 25°C near 0.6%.
    const f = freeAmmoniaFraction(7, 25);
    expect(f).toBeGreaterThan(0.003);
    expect(f).toBeLessThan(0.012);
  });

  it('is bounded in (0, 1)', () => {
    for (const ph of [4, 7, 9, 11]) {
      const f = freeAmmoniaFraction(ph, 25);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('clamps absurd pH inputs without going out of band', () => {
    expect(freeAmmoniaFraction(-5, 25)).toBeGreaterThan(0);
    expect(freeAmmoniaFraction(99, 25)).toBeLessThan(1);
  });

  it('defends NaN inputs to a neutral default', () => {
    expect(Number.isFinite(freeAmmoniaFraction(NaN, NaN))).toBe(true);
  });
});

describe('freeAmmonia', () => {
  it('scales total ammonia by the free fraction', () => {
    const total = 2;
    const frac = freeAmmoniaFraction(8, 26);
    expect(freeAmmonia(total, 8, 26)).toBeCloseTo(total * frac, 6);
  });

  it('zero / negative total ammonia → zero free ammonia', () => {
    expect(freeAmmonia(0, 8, 26)).toBe(0);
    expect(freeAmmonia(-3, 8, 26)).toBe(0);
  });

  it('same total ammonia is more dangerous at high pH', () => {
    expect(freeAmmonia(1, 8.4, 26)).toBeGreaterThan(freeAmmonia(1, 6.6, 26));
  });
});
