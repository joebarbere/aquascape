import fc from 'fast-check';
import {
  addVec2,
  distanceVec2,
  dotVec2,
  lengthVec2,
  lerpVec2,
  mulVec2,
  normalizeVec2,
  scaleVec2,
  subVec2,
  vec2,
} from './vec2';

const finite = (): fc.Arbitrary<number> => fc.double({ min: -1e6, max: 1e6, noNaN: true });
const v2 = (): fc.Arbitrary<{ x: number; y: number }> => fc.record({ x: finite(), y: finite() });

describe('vec2', () => {
  describe('vec2', () => {
    it('constructs a Vec2', () => {
      expect(vec2(1, 2)).toEqual({ x: 1, y: 2 });
    });
  });

  describe('addVec2', () => {
    it.each([
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 4, y: 6 },
      ],
      [
        { x: -1, y: 2 },
        { x: 1, y: -2 },
        { x: 0, y: 0 },
      ],
    ])('addVec2(%j, %j) = %j', (a, b, expected) => {
      expect(addVec2(a, b)).toEqual(expected);
    });

    it('does not mutate inputs', () => {
      const a = { x: 1, y: 2 };
      const b = { x: 3, y: 4 };
      addVec2(a, b);
      expect(a).toEqual({ x: 1, y: 2 });
      expect(b).toEqual({ x: 3, y: 4 });
    });
  });

  describe('subVec2', () => {
    it.each([
      [
        { x: 5, y: 5 },
        { x: 1, y: 2 },
        { x: 4, y: 3 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: -1, y: -1 },
      ],
    ])('subVec2(%j, %j) = %j', (a, b, expected) => {
      expect(subVec2(a, b)).toEqual(expected);
    });
  });

  describe('mulVec2', () => {
    it('component-wise multiplies', () => {
      expect(mulVec2({ x: 2, y: 3 }, { x: 4, y: 5 })).toEqual({ x: 8, y: 15 });
    });
  });

  describe('scaleVec2', () => {
    it.each([
      [{ x: 1, y: 2 }, 2, { x: 2, y: 4 }],
      [{ x: 1, y: 2 }, 0, { x: 0, y: 0 }],
      [{ x: 1, y: 2 }, -1, { x: -1, y: -2 }],
    ])('scaleVec2(%j, %s) = %j', (v, k, expected) => {
      expect(scaleVec2(v, k)).toEqual(expected);
    });
  });

  describe('dotVec2', () => {
    it.each([
      [{ x: 1, y: 0 }, { x: 0, y: 1 }, 0],
      [{ x: 1, y: 2 }, { x: 3, y: 4 }, 11],
      [{ x: 1, y: 1 }, { x: 1, y: 1 }, 2],
    ])('dotVec2(%j, %j) = %s', (a, b, expected) => {
      expect(dotVec2(a, b)).toBe(expected);
    });
  });

  describe('lengthVec2', () => {
    it.each([
      [{ x: 0, y: 0 }, 0],
      [{ x: 3, y: 4 }, 5],
      [{ x: -3, y: -4 }, 5],
    ])('lengthVec2(%j) = %s', (v, expected) => {
      expect(lengthVec2(v)).toBeCloseTo(expected, 9);
    });
  });

  describe('distanceVec2', () => {
    it.each([
      [{ x: 0, y: 0 }, { x: 0, y: 0 }, 0],
      [{ x: 0, y: 0 }, { x: 3, y: 4 }, 5],
      [{ x: 1, y: 1 }, { x: -2, y: -3 }, 5],
    ])('distanceVec2(%j, %j) = %s', (a, b, expected) => {
      expect(distanceVec2(a, b)).toBeCloseTo(expected, 9);
    });
  });

  describe('normalizeVec2', () => {
    it('normalizes a non-zero vector to unit length', () => {
      const n = normalizeVec2({ x: 3, y: 4 });
      expect(lengthVec2(n)).toBeCloseTo(1, 9);
      expect(n.x).toBeCloseTo(0.6, 9);
      expect(n.y).toBeCloseTo(0.8, 9);
    });

    it('returns the zero vector for the zero vector (documented behavior)', () => {
      expect(normalizeVec2({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    });

    it('returns the zero vector for sub-EPSILON inputs', () => {
      expect(normalizeVec2({ x: 1e-9, y: 1e-9 })).toEqual({ x: 0, y: 0 });
    });

    it('property: normalize(v) has length 1 for any non-tiny v', () => {
      fc.assert(
        fc.property(v2(), (v) => {
          fc.pre(Math.hypot(v.x, v.y) > 1e-3);
          const n = normalizeVec2(v);
          expect(lengthVec2(n)).toBeCloseTo(1, 6);
        }),
      );
    });
  });

  describe('lerpVec2', () => {
    it('returns a at t=0', () => {
      expect(lerpVec2({ x: 1, y: 2 }, { x: 3, y: 4 }, 0)).toEqual({ x: 1, y: 2 });
    });

    it('returns b at t=1', () => {
      expect(lerpVec2({ x: 1, y: 2 }, { x: 3, y: 4 }, 1)).toEqual({ x: 3, y: 4 });
    });

    it('returns midpoint at t=0.5', () => {
      expect(lerpVec2({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
    });
  });
});
