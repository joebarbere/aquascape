// Property + unit tests for the cm / in / mm conversion helpers.
//
// Storage IS integer mm. The lossy direction is mm → fractional cm / in,
// which the UI tolerates because it only displays. The lossless direction
// is the round-trip mm → cm → mm and mm → in → mm, which the integer-
// rounding helpers preserve over the supported range [100, 10_000] mm.

import fc from 'fast-check';

import {
  LITRES_PER_US_GALLON,
  cmToMm,
  formatForDisplay,
  formatWaterFill,
  gallonsToMmLevel,
  inchesToMm,
  mmLevelToGallons,
  mmToCm,
  mmToInches,
  parseToMm,
  parseWaterFillToMm,
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

describe('water-fill conversions (mm level ↔ US gallons)', () => {
  // Reference footprint chosen for clean numbers: 600 × 300 mm means each
  // mm of water level is exactly 0.18 L.
  const W = 600;
  const D = 300;

  it('pins the litres-per-US-gallon constant', () => {
    expect(LITRES_PER_US_GALLON).toBe(3.78541);
  });

  it('mmLevelToGallons: 200 mm at 600×300 = 36 L = 9.5102 gal', () => {
    expect(mmLevelToGallons(200, W, D)).toBeCloseTo(36 / 3.78541, 9);
    expect(mmLevelToGallons(200, W, D)).toBeCloseTo(9.5102, 4);
  });

  it('mmLevelToGallons: 1 mm at 600×300 = 0.18 L', () => {
    expect(mmLevelToGallons(1, W, D) * LITRES_PER_US_GALLON).toBeCloseTo(0.18, 9);
  });

  it('gallonsToMmLevel rounds to integer mm', () => {
    // 10 gal = 37.8541 L → 37.8541e6 / 180_000 = 210.30055… → 210 mm.
    expect(gallonsToMmLevel(10, W, D)).toBe(210);
  });

  it('gallonsToMmLevel returns null for non-finite gallons or degenerate footprints', () => {
    expect(gallonsToMmLevel(Number.NaN, W, D)).toBeNull();
    expect(gallonsToMmLevel(Number.POSITIVE_INFINITY, W, D)).toBeNull();
    expect(gallonsToMmLevel(10, 0, D)).toBeNull();
    expect(gallonsToMmLevel(10, W, -1)).toBeNull();
  });

  describe('round-trip gallonsToMmLevel(mmLevelToGallons(mm))', () => {
    it('preserves every integer mm in [1, 10_000] across realistic footprints', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10_000 }),
          fc.integer({ min: 100, max: 3_000 }),
          fc.integer({ min: 100, max: 3_000 }),
          (mm, width, depth) => {
            expect(gallonsToMmLevel(mmLevelToGallons(mm, width, depth), width, depth)).toBe(mm);
          },
        ),
        { numRuns: 500 },
      );
    });
  });

  describe('formatWaterFill', () => {
    it('mm: integer string', () => {
      expect(formatWaterFill(335, 'mm', W, D)).toBe('335');
      expect(formatWaterFill(335.4, 'mm', W, D)).toBe('335');
    });
    it('gal: one decimal', () => {
      // 335 mm at 600×300 = 60.3 L = 15.9296… gal → "15.9".
      expect(formatWaterFill(335, 'gal', W, D)).toBe('15.9');
      expect(formatWaterFill(200, 'gal', W, D)).toBe('9.5');
    });
  });

  describe('parseWaterFillToMm', () => {
    it('returns null for empty / non-finite input', () => {
      expect(parseWaterFillToMm('', 'mm', W, D)).toBeNull();
      expect(parseWaterFillToMm('  ', 'gal', W, D)).toBeNull();
      expect(parseWaterFillToMm('nope', 'mm', W, D)).toBeNull();
      expect(parseWaterFillToMm('Infinity', 'gal', W, D)).toBeNull();
    });

    it('mm: rounds to integer mm', () => {
      expect(parseWaterFillToMm('210.4', 'mm', W, D)).toBe(210);
      expect(parseWaterFillToMm('210.6', 'mm', W, D)).toBe(211);
    });

    it('gal: converts through the footprint then rounds', () => {
      expect(parseWaterFillToMm('10', 'gal', W, D)).toBe(210);
      expect(parseWaterFillToMm('9.5102', 'gal', W, D)).toBe(200);
    });
  });
});
