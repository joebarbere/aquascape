import { tickPrng } from './prng';
import { createLivestockWorld } from './world';

describe('tickPrng', () => {
  it('returns a value in [0, 1)', () => {
    const w = createLivestockWorld(0xc0ffee);
    for (let i = 0; i < 100; i++) {
      const v = tickPrng(w, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for fixed (seed, tickCounter, keys)', () => {
    const w1 = createLivestockWorld(42);
    const w2 = createLivestockWorld(42);
    expect(tickPrng(w1, 1, 2, 3)).toBe(tickPrng(w2, 1, 2, 3));
    expect(tickPrng(w1)).toBe(tickPrng(w2));
    expect(tickPrng(w1, 7)).toBe(tickPrng(w2, 7));
  });

  it('produces different streams when tick counter advances', () => {
    const w = createLivestockWorld(42);
    const a = tickPrng(w, 0);
    w.tickCounter = 1;
    const b = tickPrng(w, 0);
    expect(a).not.toBe(b);
  });

  it('produces different values for different key tuples', () => {
    const w = createLivestockWorld(42);
    const a = tickPrng(w, 1);
    const b = tickPrng(w, 2);
    expect(a).not.toBe(b);
  });

  it('produces different streams when seed differs', () => {
    const w1 = createLivestockWorld(1);
    const w2 = createLivestockWorld(2);
    expect(tickPrng(w1, 99)).not.toBe(tickPrng(w2, 99));
  });
});
