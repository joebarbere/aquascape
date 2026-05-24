import fc from 'fast-check';
import { EPSILON } from './constants';
import {
  applyTransform,
  composeTransform,
  identityTransform,
  invertTransform,
  isApproxIdentity,
} from './transform';
import type { Transform, Vec3 } from './types';

const finite = (max = 100): fc.Arbitrary<number> => fc.double({ min: -max, max, noNaN: true });

/**
 * Arbitrary "well-conditioned" transform for round-trip property tests.
 *
 * IMPORTANT: TRS decomposition (the round trip used internally by
 * `composeTransform` and `invertTransform`) is only well-defined for
 * UNIFORM-scale transforms when rotation is non-trivial — non-uniform
 * scale combined with rotation produces a shear that cannot be expressed
 * as a clean position / rotation / scale triple, so the round trip is
 * inherently lossy. Aquascape's real-world transforms are uniform-or-
 * near-uniform scale, so this is a deliberate limit of the public API
 * documented in the lib's README; the property tests pin a safe slice.
 *
 * For the property tests below we use uniform scale.
 */
const wellConditionedTransform = (): fc.Arbitrary<Transform> =>
  fc
    .record({
      position: fc.record({
        x: finite(1000),
        y: finite(1000),
        z: finite(1000),
      }),
      rotation: fc.record({
        x: fc.double({ min: -1.4, max: 1.4, noNaN: true }),
        y: fc.double({ min: -1.4, max: 1.4, noNaN: true }),
        z: fc.double({ min: -1.4, max: 1.4, noNaN: true }),
      }),
      uniformScale: fc.double({ min: 0.1, max: 10, noNaN: true }),
    })
    .map(({ position, rotation, uniformScale }) => ({
      position,
      rotation,
      scale: { x: uniformScale, y: uniformScale, z: uniformScale },
      flipX: false,
      flipY: false,
    }));

const expectVec3Close = (a: Vec3, b: Vec3, eps = 1e-4): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(eps);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(eps);
  expect(Math.abs(a.z - b.z)).toBeLessThanOrEqual(eps);
};

/**
 * Tolerance that scales with the magnitude of the point and the condition
 * number of the transform — composing/inverting a transform with a 100x
 * scale spread will amplify the EPSILON-level matrix error proportionally.
 * Use this for round-trip property tests on transforms.
 */
const scaledTolerance = (t: Transform, p: Vec3): number => {
  const scaleMax = Math.max(Math.abs(t.scale.x), Math.abs(t.scale.y), Math.abs(t.scale.z));
  const pointMag = Math.max(1, Math.hypot(p.x, p.y, p.z));
  // Float error scales with the magnitude of the transformed coordinate
  // (≈ scaleMax × pointMag). Add a safety floor for low-magnitude cases.
  return 1e-8 * scaleMax * pointMag + 1e-6;
};

describe('transform', () => {
  describe('identityTransform', () => {
    it('returns canonical identity values', () => {
      expect(identityTransform()).toEqual({
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        flipX: false,
        flipY: false,
      });
    });

    it('returns a fresh object each call (no shared state)', () => {
      const a = identityTransform();
      const b = identityTransform();
      expect(a).not.toBe(b);
      expect(a.position).not.toBe(b.position);
    });
  });

  describe('applyTransform', () => {
    it('identity leaves a point unchanged', () => {
      const p: Vec3 = { x: 1, y: 2, z: 3 };
      expect(applyTransform(identityTransform(), p)).toEqual(p);
    });

    it('translation adds position', () => {
      const t: Transform = {
        ...identityTransform(),
        position: { x: 10, y: 20, z: 30 },
      };
      expectVec3Close(applyTransform(t, { x: 1, y: 1, z: 1 }), {
        x: 11,
        y: 21,
        z: 31,
      });
    });

    it('uniform scale scales each axis', () => {
      const t: Transform = {
        ...identityTransform(),
        scale: { x: 2, y: 3, z: 4 },
      };
      expectVec3Close(applyTransform(t, { x: 1, y: 1, z: 1 }), {
        x: 2,
        y: 3,
        z: 4,
      });
    });

    it('rotation about z by +π/2 sends (1, 0, 0) → (0, 1, 0) — right-hand rule', () => {
      const t: Transform = {
        ...identityTransform(),
        rotation: { x: 0, y: 0, z: Math.PI / 2 },
      };
      expectVec3Close(applyTransform(t, { x: 1, y: 0, z: 0 }), {
        x: 0,
        y: 1,
        z: 0,
      });
    });

    it('rotation about x by +π/2 sends (0, 1, 0) → (0, 0, 1) — right-hand rule', () => {
      const t: Transform = {
        ...identityTransform(),
        rotation: { x: Math.PI / 2, y: 0, z: 0 },
      };
      expectVec3Close(applyTransform(t, { x: 0, y: 1, z: 0 }), {
        x: 0,
        y: 0,
        z: 1,
      });
    });

    it('rotation about y by +π/2 sends (0, 0, 1) → (1, 0, 0) — right-hand rule', () => {
      const t: Transform = {
        ...identityTransform(),
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
      };
      expectVec3Close(applyTransform(t, { x: 0, y: 0, z: 1 }), {
        x: 1,
        y: 0,
        z: 0,
      });
    });

    it('flipX negates the local x before scale/rotation/translation', () => {
      const t: Transform = {
        ...identityTransform(),
        flipX: true,
      };
      expectVec3Close(applyTransform(t, { x: 1, y: 2, z: 3 }), {
        x: -1,
        y: 2,
        z: 3,
      });
    });

    it('flipY negates the local y', () => {
      const t: Transform = {
        ...identityTransform(),
        flipY: true,
      };
      expectVec3Close(applyTransform(t, { x: 1, y: 2, z: 3 }), {
        x: 1,
        y: -2,
        z: 3,
      });
    });

    it('combines flip → scale → rotate → translate in the documented order', () => {
      // flipX, scale x by 2, rotate +π/2 about z, translate +1 in y.
      // Local (1, 0, 0) → flip → (-1, 0, 0) → scale → (-2, 0, 0)
      //                → rotZ(+π/2) → (0, -2, 0) → translate → (0, -1, 0).
      const t: Transform = {
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: Math.PI / 2 },
        scale: { x: 2, y: 1, z: 1 },
        flipX: true,
        flipY: false,
      };
      expectVec3Close(applyTransform(t, { x: 1, y: 0, z: 0 }), {
        x: 0,
        y: -1,
        z: 0,
      });
    });
  });

  describe('composeTransform', () => {
    it('compose(identity, identity) = identity', () => {
      const c = composeTransform(identityTransform(), identityTransform());
      expect(isApproxIdentity(c)).toBe(true);
    });

    it('compose(a, b) applies b first then a', () => {
      // a = translate +10x; b = rotate +π/2 about z.
      const a: Transform = {
        ...identityTransform(),
        position: { x: 10, y: 0, z: 0 },
      };
      const b: Transform = {
        ...identityTransform(),
        rotation: { x: 0, y: 0, z: Math.PI / 2 },
      };
      const ab = composeTransform(a, b);
      // (1, 0, 0) -> b -> (0, 1, 0) -> a -> (10, 1, 0)
      expectVec3Close(applyTransform(ab, { x: 1, y: 0, z: 0 }), {
        x: 10,
        y: 1,
        z: 0,
      });
    });

    it('property: compose(t, identity) ≡ t (within tolerance, applied to a point)', () => {
      fc.assert(
        fc.property(
          wellConditionedTransform(),
          fc.record({ x: finite(100), y: finite(100), z: finite(100) }),
          (t, p) => {
            const composed = composeTransform(t, identityTransform());
            expectVec3Close(
              applyTransform(composed, p),
              applyTransform(t, p),
              scaledTolerance(t, p),
            );
          },
        ),
      );
    });

    it('property: compose(identity, t) ≡ t (within tolerance, applied to a point)', () => {
      fc.assert(
        fc.property(
          wellConditionedTransform(),
          fc.record({ x: finite(100), y: finite(100), z: finite(100) }),
          (t, p) => {
            const composed = composeTransform(identityTransform(), t);
            expectVec3Close(
              applyTransform(composed, p),
              applyTransform(t, p),
              scaledTolerance(t, p),
            );
          },
        ),
      );
    });
  });

  describe('invertTransform', () => {
    it('inverse of identity is identity', () => {
      expect(isApproxIdentity(invertTransform(identityTransform()))).toBe(true);
    });

    it('inverse of pure translation negates position', () => {
      const t: Transform = {
        ...identityTransform(),
        position: { x: 5, y: -3, z: 7 },
      };
      const inv = invertTransform(t);
      expectVec3Close(applyTransform(inv, { x: 0, y: 0, z: 0 }), {
        x: -5,
        y: 3,
        z: -7,
      });
    });

    it('throws on singular (zero-scale) transform', () => {
      const t: Transform = {
        ...identityTransform(),
        scale: { x: 0, y: 1, z: 1 },
      };
      expect(() => invertTransform(t)).toThrow();
    });

    it('property: compose(t, invert(t)) applied to a point ≈ identity on that point', () => {
      fc.assert(
        fc.property(
          wellConditionedTransform(),
          fc.record({ x: finite(100), y: finite(100), z: finite(100) }),
          (t, p) => {
            const inv = invertTransform(t);
            // apply(compose(t, inv), p) should ≈ p.
            const composed = composeTransform(t, inv);
            // Two compositions + inversion compound float error; loosen
            // the per-axis tolerance one extra order of magnitude.
            expectVec3Close(applyTransform(composed, p), p, scaledTolerance(t, p) * 10);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('property: applying t then invert(t) recovers the original point', () => {
      fc.assert(
        fc.property(
          wellConditionedTransform(),
          fc.record({ x: finite(50), y: finite(50), z: finite(50) }),
          (t, p) => {
            const inv = invertTransform(t);
            const out = applyTransform(inv, applyTransform(t, p));
            expectVec3Close(out, p, scaledTolerance(t, p) * 10);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe('decomposition edge cases (covered through public API)', () => {
    it('round-trips a transform with rotation.y at +π/2 (gimbal lock)', () => {
      // Pitch at +π/2 collapses the ZYX Euler basis. Our decomposition
      // canonicalizes by setting rx = 0 and folding the contribution
      // into rz, which still produces the correct matrix.
      const t: Transform = {
        ...identityTransform(),
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
      };
      const composed = composeTransform(t, identityTransform());
      // Applied to (0, 0, 1) under the original transform: rotating +π/2
      // about y sends (0, 0, 1) → (1, 0, 0).
      expectVec3Close(applyTransform(composed, { x: 0, y: 0, z: 1 }), {
        x: 1,
        y: 0,
        z: 0,
      });
    });

    it('round-trips a transform with rotation.y at -π/2 (gimbal lock other side)', () => {
      const t: Transform = {
        ...identityTransform(),
        rotation: { x: 0, y: -Math.PI / 2, z: 0 },
      };
      const composed = composeTransform(t, identityTransform());
      // -π/2 about y sends (0, 0, 1) → (-1, 0, 0).
      expectVec3Close(applyTransform(composed, { x: 0, y: 0, z: 1 }), {
        x: -1,
        y: 0,
        z: 0,
      });
    });

    it('round-trips a transform with a single flip (det < 0 in decompose)', () => {
      // flipX makes the upper-3x3 determinant negative; the decompose
      // path canonicalizes by flipping sx instead of recording flipX.
      const t: Transform = {
        ...identityTransform(),
        flipX: true,
      };
      const composed = composeTransform(t, identityTransform());
      expectVec3Close(applyTransform(composed, { x: 1, y: 2, z: 3 }), {
        x: -1,
        y: 2,
        z: 3,
      });
    });
  });

  describe('isApproxIdentity', () => {
    it('true for identity()', () => {
      expect(isApproxIdentity(identityTransform())).toBe(true);
    });

    it('false when translation differs', () => {
      expect(
        isApproxIdentity({
          ...identityTransform(),
          position: { x: 1, y: 0, z: 0 },
        }),
      ).toBe(false);
    });

    it('true within a wider epsilon', () => {
      expect(
        isApproxIdentity(
          {
            ...identityTransform(),
            position: { x: 1e-4, y: 0, z: 0 },
          },
          1e-3,
        ),
      ).toBe(true);
    });

    it('false when flipX differs', () => {
      expect(isApproxIdentity({ ...identityTransform(), flipX: true })).toBe(false);
    });

    it('uses default EPSILON when omitted', () => {
      expect(
        isApproxIdentity({
          ...identityTransform(),
          position: { x: EPSILON / 2, y: 0, z: 0 },
        }),
      ).toBe(true);
    });
  });
});
