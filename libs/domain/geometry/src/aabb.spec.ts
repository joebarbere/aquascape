import fc from 'fast-check';
import {
  aabbContainsPoint,
  aabbExpand,
  aabbFromPoints,
  aabbIntersects,
  transformAabb,
} from './aabb';
import { identityTransform } from './transform';
import type { Transform } from './types';

const finite = (): fc.Arbitrary<number> => fc.double({ min: -1e4, max: 1e4, noNaN: true });
const v2 = (): fc.Arbitrary<{ x: number; y: number }> => fc.record({ x: finite(), y: finite() });

describe('aabb', () => {
  describe('aabbContainsPoint', () => {
    const box = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };

    it.each([
      [{ x: 5, y: 5 }, true],
      [{ x: 0, y: 0 }, true], // corner — inclusive
      [{ x: 10, y: 10 }, true], // opposite corner — inclusive
      [{ x: 10, y: 5 }, true], // on edge — inclusive
      [{ x: -1, y: 5 }, false],
      [{ x: 5, y: 11 }, false],
      [{ x: 5, y: -0.0001 }, false],
    ])('aabbContainsPoint(box, %j) = %s', (p, expected) => {
      expect(aabbContainsPoint(box, p)).toBe(expected);
    });

    it('degenerate AABB (zero size) contains its single point', () => {
      const degenerate = { min: { x: 5, y: 5 }, max: { x: 5, y: 5 } };
      expect(aabbContainsPoint(degenerate, { x: 5, y: 5 })).toBe(true);
      expect(aabbContainsPoint(degenerate, { x: 5.0001, y: 5 })).toBe(false);
    });
  });

  describe('aabbIntersects', () => {
    it('returns true for overlapping boxes', () => {
      expect(
        aabbIntersects(
          { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
          { min: { x: 5, y: 5 }, max: { x: 15, y: 15 } },
        ),
      ).toBe(true);
    });

    it('returns true for boxes sharing an edge (inclusive)', () => {
      expect(
        aabbIntersects(
          { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
          { min: { x: 10, y: 0 }, max: { x: 20, y: 10 } },
        ),
      ).toBe(true);
    });

    it('returns false for disjoint boxes', () => {
      expect(
        aabbIntersects(
          { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
          { min: { x: 20, y: 0 }, max: { x: 30, y: 10 } },
        ),
      ).toBe(false);
    });
  });

  describe('aabbFromPoints', () => {
    it('bounds a single point as a degenerate box', () => {
      expect(aabbFromPoints([{ x: 3, y: 4 }])).toEqual({
        min: { x: 3, y: 4 },
        max: { x: 3, y: 4 },
      });
    });

    it('bounds a set of points', () => {
      expect(
        aabbFromPoints([
          { x: 1, y: 2 },
          { x: -3, y: 5 },
          { x: 4, y: -1 },
        ]),
      ).toEqual({
        min: { x: -3, y: -1 },
        max: { x: 4, y: 5 },
      });
    });

    it('throws on empty input (documented behavior)', () => {
      expect(() => aabbFromPoints([])).toThrow();
    });

    it('property: aabbContainsPoint(aabbFromPoints(ps), p) for every p ∈ ps', () => {
      fc.assert(
        fc.property(fc.array(v2(), { minLength: 1, maxLength: 50 }), (ps) => {
          const box = aabbFromPoints(ps);
          for (const p of ps) {
            expect(aabbContainsPoint(box, p)).toBe(true);
          }
        }),
      );
    });
  });

  describe('aabbExpand', () => {
    it('expands outward by byMm on all sides', () => {
      expect(aabbExpand({ min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }, 1)).toEqual({
        min: { x: -1, y: -1 },
        max: { x: 11, y: 11 },
      });
    });

    it('zero expansion returns an equivalent box', () => {
      const box = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };
      expect(aabbExpand(box, 0)).toEqual(box);
    });

    it('negative expansion shrinks the box', () => {
      expect(aabbExpand({ min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }, -1)).toEqual({
        min: { x: 1, y: 1 },
        max: { x: 9, y: 9 },
      });
    });

    it('over-shrinking collapses to a degenerate box at the center', () => {
      // Original is 10x10 centered at (5, 5). Shrink by 10 would invert
      // both axes; result is the degenerate point at the center.
      expect(aabbExpand({ min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }, -10)).toEqual({
        min: { x: 5, y: 5 },
        max: { x: 5, y: 5 },
      });
    });
  });

  describe('transformAabb', () => {
    it('identity transform leaves AABB unchanged', () => {
      const box = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };
      expect(transformAabb(box, identityTransform())).toEqual(box);
    });

    it('translation shifts the bbox', () => {
      const box = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };
      const t: Transform = {
        ...identityTransform(),
        position: { x: 5, y: -2, z: 0 },
      };
      const out = transformAabb(box, t);
      expect(out.min.x).toBeCloseTo(5, 6);
      expect(out.min.y).toBeCloseTo(-2, 6);
      expect(out.max.x).toBeCloseTo(15, 6);
      expect(out.max.y).toBeCloseTo(8, 6);
    });

    it('45° rotation grows the AABB by √2 on each axis (for a unit square)', () => {
      const unitSquare = {
        min: { x: -1, y: -1 },
        max: { x: 1, y: 1 },
      };
      const t: Transform = {
        ...identityTransform(),
        rotation: { x: 0, y: 0, z: Math.PI / 4 },
      };
      const out = transformAabb(unitSquare, t);
      expect(out.max.x).toBeCloseTo(Math.SQRT2, 4);
      expect(out.max.y).toBeCloseTo(Math.SQRT2, 4);
      expect(out.min.x).toBeCloseTo(-Math.SQRT2, 4);
      expect(out.min.y).toBeCloseTo(-Math.SQRT2, 4);
    });
  });
});
