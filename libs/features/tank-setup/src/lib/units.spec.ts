// Property + unit tests for the cm / in / mm conversion helpers.
//
// Storage IS integer mm. The lossy direction is mm → fractional cm / in,
// which the UI tolerates because it only displays. The lossless direction
// is the round-trip mm → cm → mm and mm → in → mm, which the integer-
// rounding helpers preserve over the supported range [100, 10_000] mm.

import fc from 'fast-check';

import {
  cmToMm,
  formatForDisplay,
  inchesToMm,
  mmToCm,
  mmToInches,
  parseToMm,
} from './units';

describe('unit conversion', () => {
  it('mmToCm divides by 10 exactly', () => {
    expect(mmToCm(100)).toBe(10);
    expect(mmToCm(155)).toBe(15.5);
  });

  it('cmToMm rounds to integer mm', () => {
    expect(cmToMm(10)).toBe(100);
    expect(cmToMm(15.55)).toBe(156); // 155.5 → 156 (half-away-from-zero)
  });

  it('mmToInches divides by 25.4 exactly (within FP)', () => {
    expect(mmToInches(25.4)).toBeCloseTo(1, 9);
    expect(mmToInches(254)).toBeCloseTo(10, 9);
  });

  it('inchesToMm rounds to integer mm', () => {
    expect(inchesToMm(1)).toBe(25);
    expect(inchesToMm(12)).toBe(305);
  });

  describe('round-trip cmToMm(mmToCm(mm))', () => {
    it('preserves every integer mm in [100, 10_000]', () => {
      fc.assert(
        fc.property(fc.integer({ min: 100, max: 10_000 }), (mm) => {
          expect(cmToMm(mmToCm(mm))).toBe(mm);
        }),
        { numRuns: 500 },
      );
    });
  });

  describe('round-trip inchesToMm(mmToInches(mm))', () => {
    // Sub-mm precision IS intentionally lost because storage is integer mm;
    // the round-trip is exact under the integer-rounding contract.
    it('preserves every integer mm in [100, 10_000]', () => {
      fc.assert(
        fc.property(fc.integer({ min: 100, max: 10_000 }), (mm) => {
          expect(inchesToMm(mmToInches(mm))).toBe(mm);
        }),
        { numRuns: 500 },
      );
    });
  });

  describe('formatForDisplay', () => {
    it('mm: integer string', () => {
      expect(formatForDisplay(600, 'mm')).toBe('600');
    });
    it('cm: one decimal', () => {
      expect(formatForDisplay(600, 'cm')).toBe('60.0');
      expect(formatForDisplay(605, 'cm')).toBe('60.5');
    });
    it('in: two decimals', () => {
      expect(formatForDisplay(254, 'in')).toBe('10.00');
    });
  });

  describe('parseToMm', () => {
    it('returns null for non-finite input', () => {
      expect(parseToMm('not-a-number', 'cm')).toBeNull();
      expect(parseToMm('', 'cm')).toBeNull();
      expect(parseToMm('Infinity', 'mm')).toBeNull();
    });

    it('rounds to integer mm regardless of unit', () => {
      expect(parseToMm('60.0', 'cm')).toBe(600);
      expect(parseToMm('60.04', 'cm')).toBe(600);
      expect(parseToMm('60.06', 'cm')).toBe(601);
      expect(parseToMm('10.00', 'in')).toBe(254);
      expect(parseToMm('600.4', 'mm')).toBe(600);
    });
  });
});
