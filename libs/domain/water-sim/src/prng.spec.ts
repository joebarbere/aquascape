import { hashSeed, mulberry32, signedJitter } from './prng';

describe('hashSeed', () => {
  it('is deterministic for a fixed (seed, salt)', () => {
    expect(hashSeed(123, 7)).toBe(hashSeed(123, 7));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = hashSeed(-99999, 42);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });

  it('different salts give different hashes', () => {
    expect(hashSeed(123, 1)).not.toBe(hashSeed(123, 2));
  });
});

describe('mulberry32', () => {
  it('is deterministic and reproducible from a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('signedJitter', () => {
  it('is in [-1, 1]', () => {
    for (let step = 0; step < 200; step++) {
      const v = signedJitter(0xabc, 5, step);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic per (seed, channel, step)', () => {
    expect(signedJitter(7, 3, 11)).toBe(signedJitter(7, 3, 11));
  });

  it('different channels are independent sub-streams', () => {
    expect(signedJitter(7, 1, 5)).not.toBe(signedJitter(7, 2, 5));
  });

  it('different steps differ', () => {
    expect(signedJitter(7, 1, 5)).not.toBe(signedJitter(7, 1, 6));
  });
});
