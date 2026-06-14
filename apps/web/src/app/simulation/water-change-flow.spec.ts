import {
  DEFAULT_REPLACEMENT,
  DEFAULT_WATER_CHANGE_FRACTION,
  inFraction,
  levelAfterIn,
  levelAfterOut,
  outFraction,
  toReplacementWater,
} from './water-change-flow';

describe('water-change-flow (OUT/IN volume → chemistry/level mapping)', () => {
  describe('outFraction / inFraction', () => {
    it('default to the 30% partial-change fraction', () => {
      expect(outFraction()).toBeCloseTo(DEFAULT_WATER_CHANGE_FRACTION);
      expect(inFraction()).toBeCloseTo(DEFAULT_WATER_CHANGE_FRACTION);
    });

    it('passes the fraction through unchanged when in range (the applyWaterChange input)', () => {
      expect(outFraction(0.5)).toBe(0.5);
      expect(inFraction(0.25)).toBe(0.25);
    });

    it('clamps to the (0, 1] range applyWaterChange requires', () => {
      expect(outFraction(1.5)).toBe(1);
      expect(outFraction(-0.2)).toBe(0);
      expect(outFraction(Number.NaN)).toBe(0);
      expect(inFraction(2)).toBe(1);
    });
  });

  describe('levelAfterOut', () => {
    it('drops the level by the drained fraction', () => {
      expect(levelAfterOut(500, 0.3)).toBe(350);
      expect(levelAfterOut(575, 0.3)).toBe(403); // round(402.5)
    });

    it('floors at 1 mm even on a full drain', () => {
      expect(levelAfterOut(500, 1)).toBe(1);
    });
  });

  describe('levelAfterIn', () => {
    it('restores the pre-drain level, clamped to tank height', () => {
      expect(levelAfterIn(575, 600)).toBe(575);
      expect(levelAfterIn(900, 600)).toBe(600);
    });
  });

  describe('a full OUT then IN round-trip restores the level', () => {
    it('drains 30% then refills back to the captured level', () => {
      const tankHeight = 600;
      const start = 575;
      const drained = levelAfterOut(start, DEFAULT_WATER_CHANGE_FRACTION);
      expect(drained).toBeLessThan(start);
      const refilled = levelAfterIn(start, tankHeight);
      expect(refilled).toBe(start);
    });
  });

  describe('toReplacementWater', () => {
    it('maps form params to clean-source ReplacementWater with the chosen pH/gh', () => {
      const rw = toReplacementWater({ temperatureC: 22, ph: 6.8, hardnessDgh: 4 });
      expect(rw).toEqual({ ammonia: 0, nitrite: 0, nitrate: 0, ph: 6.8, gh: 4 });
    });

    it('defaults are neutral, room-temp, soft-medium', () => {
      expect(DEFAULT_REPLACEMENT.ph).toBeCloseTo(7.0);
      expect(DEFAULT_REPLACEMENT.temperatureC).toBe(24);
    });
  });
});
