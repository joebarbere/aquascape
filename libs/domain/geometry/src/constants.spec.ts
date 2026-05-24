import { EPSILON, PHI, approxEquals } from './constants';

describe('constants', () => {
  it('EPSILON is 1e-6', () => {
    expect(EPSILON).toBe(1e-6);
  });

  it('PHI is the golden ratio', () => {
    expect(PHI).toBeCloseTo(1.6180339887, 9);
    // PHI - 1 ≈ 1/PHI
    expect(PHI - 1).toBeCloseTo(1 / PHI, 9);
  });

  describe('approxEquals', () => {
    it.each([
      [1, 1, true],
      [1, 1 + 1e-9, true],
      [1, 1 + 1e-3, false],
      [0, 0, true],
      [-1, -1, true],
      [1, -1, false],
    ])('approxEquals(%s, %s) = %s', (a, b, expected) => {
      expect(approxEquals(a, b)).toBe(expected);
    });

    it('honors a custom epsilon', () => {
      expect(approxEquals(1, 1.5, 1)).toBe(true);
      expect(approxEquals(1, 3, 1)).toBe(false);
    });
  });
});
