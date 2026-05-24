import fc from 'fast-check';
import {
  addVec3,
  crossVec3,
  distanceVec3,
  dotVec3,
  lengthVec3,
  lerpVec3,
  mulVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
  vec3,
} from './vec3';

const finite = (): fc.Arbitrary<number> => fc.double({ min: -1e6, max: 1e6, noNaN: true });
const v3 = (): fc.Arbitrary<{ x: number; y: number; z: number }> =>
  fc.record({ x: finite(), y: finite(), z: finite() });

describe('vec3', () => {
  describe('vec3', () => {
    it('constructs a Vec3', () => {
      expect(vec3(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3 });
    });
  });

  describe('addVec3', () => {
    it('adds component-wise', () => {
      expect(addVec3({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toEqual({
        x: 5,
        y: 7,
        z: 9,
      });
    });

    it('does not mutate inputs', () => {
      const a = { x: 1, y: 2, z: 3 };
      const b = { x: 4, y: 5, z: 6 };
      addVec3(a, b);
      expect(a).toEqual({ x: 1, y: 2, z: 3 });
      expect(b).toEqual({ x: 4, y: 5, z: 6 });
    });
  });

  describe('subVec3', () => {
    it('subtracts component-wise', () => {
      expect(subVec3({ x: 5, y: 5, z: 5 }, { x: 1, y: 2, z: 3 })).toEqual({
        x: 4,
        y: 3,
        z: 2,
      });
    });
  });

  describe('mulVec3', () => {
    it('multiplies component-wise', () => {
      expect(mulVec3({ x: 2, y: 3, z: 4 }, { x: 5, y: 6, z: 7 })).toEqual({
        x: 10,
        y: 18,
        z: 28,
      });
    });
  });

  describe('scaleVec3', () => {
    it('scales by scalar', () => {
      expect(scaleVec3({ x: 1, y: 2, z: 3 }, 2)).toEqual({ x: 2, y: 4, z: 6 });
    });
  });

  describe('dotVec3', () => {
    it('orthogonal basis vectors have dot 0', () => {
      expect(dotVec3({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0);
    });

    it('parallel vectors have positive dot', () => {
      expect(dotVec3({ x: 1, y: 2, z: 3 }, { x: 2, y: 4, z: 6 })).toBe(28);
    });
  });

  describe('crossVec3', () => {
    // Direction-explicit tests: right-handed (+x right, +y up, +z back).
    it('cross(ex, ey) = ez (right-hand rule)', () => {
      expect(crossVec3({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({
        x: 0,
        y: 0,
        z: 1,
      });
    });

    it('cross(ey, ez) = ex', () => {
      expect(crossVec3({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 })).toEqual({
        x: 1,
        y: 0,
        z: 0,
      });
    });

    it('cross(ez, ex) = ey', () => {
      expect(crossVec3({ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })).toEqual({
        x: 0,
        y: 1,
        z: 0,
      });
    });

    it('cross is anti-commutative: cross(a, b) = -cross(b, a)', () => {
      fc.assert(
        fc.property(v3(), v3(), (a, b) => {
          const ab = crossVec3(a, b);
          const ba = crossVec3(b, a);
          expect(ab.x).toBeCloseTo(-ba.x, 6);
          expect(ab.y).toBeCloseTo(-ba.y, 6);
          expect(ab.z).toBeCloseTo(-ba.z, 6);
        }),
      );
    });
  });

  describe('lengthVec3', () => {
    it.each([
      [{ x: 0, y: 0, z: 0 }, 0],
      [{ x: 1, y: 2, z: 2 }, 3],
      [{ x: -1, y: -2, z: -2 }, 3],
    ])('lengthVec3(%j) = %s', (v, expected) => {
      expect(lengthVec3(v)).toBeCloseTo(expected, 9);
    });
  });

  describe('distanceVec3', () => {
    it('measures Euclidean distance', () => {
      expect(distanceVec3({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 2 })).toBeCloseTo(3, 9);
    });
  });

  describe('normalizeVec3', () => {
    it('normalizes to unit length', () => {
      const n = normalizeVec3({ x: 0, y: 3, z: 4 });
      expect(lengthVec3(n)).toBeCloseTo(1, 9);
    });

    it('returns zero vector for the zero vector', () => {
      expect(normalizeVec3({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('returns zero vector for sub-EPSILON inputs', () => {
      expect(normalizeVec3({ x: 1e-9, y: 1e-9, z: 1e-9 })).toEqual({
        x: 0,
        y: 0,
        z: 0,
      });
    });

    it('property: normalize(v) has length 1 for any non-tiny v', () => {
      fc.assert(
        fc.property(v3(), (v) => {
          fc.pre(Math.hypot(v.x, v.y, v.z) > 1e-3);
          const n = normalizeVec3(v);
          expect(lengthVec3(n)).toBeCloseTo(1, 6);
        }),
      );
    });
  });

  describe('lerpVec3', () => {
    it.each([
      [{ x: 1, y: 2, z: 3 }, { x: 5, y: 6, z: 7 }, 0, { x: 1, y: 2, z: 3 }],
      [{ x: 1, y: 2, z: 3 }, { x: 5, y: 6, z: 7 }, 1, { x: 5, y: 6, z: 7 }],
      [{ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 }, 0.5, { x: 5, y: 10, z: 15 }],
    ])('lerpVec3(%j, %j, %s) = %j', (a, b, t, expected) => {
      expect(lerpVec3(a, b, t)).toEqual(expected);
    });
  });
});
