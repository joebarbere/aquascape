import { snapToGrid, snapToValue } from './snap';

describe('snap', () => {
  describe('snapToGrid', () => {
    it('snaps a point to the nearest grid intersection', () => {
      expect(snapToGrid({ x: 1.4, y: 1.6 }, 1)).toEqual({ x: 1, y: 2 });
    });

    it('snaps to a non-unit grid', () => {
      expect(snapToGrid({ x: 12, y: 27 }, 10)).toEqual({ x: 10, y: 30 });
    });

    it('passes through unchanged when gridSize <= 0', () => {
      expect(snapToGrid({ x: 1.3, y: 2.7 }, 0)).toEqual({ x: 1.3, y: 2.7 });
      expect(snapToGrid({ x: 1.3, y: 2.7 }, -1)).toEqual({ x: 1.3, y: 2.7 });
    });

    it('does not mutate the input', () => {
      const p = { x: 1.4, y: 1.6 };
      snapToGrid(p, 1);
      expect(p).toEqual({ x: 1.4, y: 1.6 });
    });
  });

  describe('snapToValue', () => {
    it('snaps to the nearest value within tolerance', () => {
      expect(snapToValue(9.5, [0, 10, 20], 1)).toBe(10);
    });

    it('returns unchanged when no snap is within tolerance', () => {
      expect(snapToValue(5, [0, 10, 20], 1)).toBe(5);
    });

    it('returns unchanged for empty snaps', () => {
      expect(snapToValue(5, [], 1)).toBe(5);
    });

    it('returns unchanged for non-positive tolerance', () => {
      expect(snapToValue(5, [0, 10], 0)).toBe(5);
      expect(snapToValue(5, [0, 10], -1)).toBe(5);
    });

    it('picks the closer snap when multiple are within tolerance', () => {
      // Both 9 and 11 within tolerance 2 from 10.4; nearest is 11.
      expect(snapToValue(10.4, [9, 11], 2)).toBe(11);
    });

    it('snaps a value exactly at tolerance distance', () => {
      // distance = tolerance is INSIDE (uses <=).
      expect(snapToValue(11, [10], 1)).toBe(10);
    });
  });
});
