import { PHI } from './constants';
import { focalPoints, goldenRatioLines, thirdsLines } from './composition-guides';

describe('composition-guides', () => {
  describe('goldenRatioLines', () => {
    it('returns vertical lines at w/φ and w - w/φ, ascending', () => {
      const w = 1000;
      const h = 500;
      const { vertical } = goldenRatioLines(w, h);
      const big = w / PHI;
      const small = w - big;
      expect(vertical[0]).toBeCloseTo(small, 6);
      expect(vertical[1]).toBeCloseTo(big, 6);
      expect(vertical[0] as number).toBeLessThan(vertical[1] as number);
    });

    it('returns horizontal lines at h/φ and h - h/φ, ascending', () => {
      const w = 1000;
      const h = 500;
      const { horizontal } = goldenRatioLines(w, h);
      const big = h / PHI;
      const small = h - big;
      expect(horizontal[0]).toBeCloseTo(small, 6);
      expect(horizontal[1]).toBeCloseTo(big, 6);
    });

    it('handles a square (vertical and horizontal pairs match)', () => {
      const { vertical, horizontal } = goldenRatioLines(100, 100);
      expect(vertical).toEqual(horizontal);
    });
  });

  describe('thirdsLines', () => {
    it('divides width at 1/3 and 2/3', () => {
      const { vertical } = thirdsLines(300, 600);
      expect(vertical[0]).toBeCloseTo(100, 9);
      expect(vertical[1]).toBeCloseTo(200, 9);
    });

    it('divides height at 1/3 and 2/3', () => {
      const { horizontal } = thirdsLines(300, 600);
      expect(horizontal[0]).toBeCloseTo(200, 9);
      expect(horizontal[1]).toBeCloseTo(400, 9);
    });
  });

  describe('focalPoints', () => {
    it('returns four points at the intersections of the golden-ratio lines', () => {
      const w = 1000;
      const h = 500;
      const pts = focalPoints(w, h);
      const { vertical, horizontal } = goldenRatioLines(w, h);
      expect(pts).toHaveLength(4);
      // Four combinations of (vSmall, vLarge) x (hSmall, hLarge).
      expect(pts[0]).toEqual({ x: vertical[0], y: horizontal[0] });
      expect(pts[1]).toEqual({ x: vertical[1], y: horizontal[0] });
      expect(pts[2]).toEqual({ x: vertical[0], y: horizontal[1] });
      expect(pts[3]).toEqual({ x: vertical[1], y: horizontal[1] });
    });

    it('handles a square', () => {
      const pts = focalPoints(100, 100);
      const small = 100 - 100 / PHI;
      const big = 100 / PHI;
      expect((pts[0] as { x: number; y: number }).x).toBeCloseTo(small, 6);
      expect((pts[0] as { x: number; y: number }).y).toBeCloseTo(small, 6);
      expect((pts[3] as { x: number; y: number }).x).toBeCloseTo(big, 6);
      expect((pts[3] as { x: number; y: number }).y).toBeCloseTo(big, 6);
    });
  });
});
