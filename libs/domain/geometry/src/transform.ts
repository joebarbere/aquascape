/**
 * Pure Transform ops.
 *
 * `Transform` is a plain-object record: `{ position, rotation, scale,
 * flipX, flipY }` matching `aqua-document.ts`. To compose and invert
 * transforms, we lower them to a 4x4 homogeneous matrix (row-major), do
 * the matrix math, then decompose back. The decomposition picks a unique
 * representative whenever the matrix is non-degenerate; this is sufficient
 * for the editor's needs (composition is associative and `compose(t,
 * invert(t)) ≈ identity` within EPSILON).
 *
 * Application order in {@link applyTransform}, from local to world:
 *   1. flipX / flipY  — negate local x / y before scaling
 *   2. scale          — component-wise (sx, sy, sz)
 *   3. rotation.x     — about local +x (right-hand rule)
 *   4. rotation.y     — about local +y
 *   5. rotation.z     — about local +z (yaw, in-plane for the 2D renderer)
 *   6. position       — translate
 *
 * compose(a, b) means "apply b first, then a". So the world-space transform
 * of a child whose local transform is `child` and whose parent transform is
 * `parent` is `compose(parent, child)`.
 */
import { EPSILON } from './constants';
import type { Transform, Vec3 } from './types';

// ─── 4x4 matrix helpers (internal) ────────────────────────────────────────

/*
 * Row-major 4x4 homogeneous matrix as a length-16 array. Indexed as
 * `m[row*4 + col]`. Internal only — public API takes/returns `Transform`.
 */
type Mat4 = readonly number[];

const IDENTITY_MAT4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        // a row-major: a[r*4 + k]; b row-major: b[k*4 + c]
        s += (a[r * 4 + k] as number) * (b[k * 4 + c] as number);
      }
      out[r * 4 + c] = s;
    }
  }
  return out;
}

function mat4Translate(t: Vec3): Mat4 {
  return [1, 0, 0, t.x, 0, 1, 0, t.y, 0, 0, 1, t.z, 0, 0, 0, 1];
}

function mat4Scale(s: { x: number; y: number; z: number }): Mat4 {
  return [s.x, 0, 0, 0, 0, s.y, 0, 0, 0, 0, s.z, 0, 0, 0, 0, 1];
}

function mat4RotX(rad: number): Mat4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}

function mat4RotY(rad: number): Mat4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}

function mat4RotZ(rad: number): Mat4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/**
 * Build the 4x4 world matrix for a Transform.
 *
 * Pre-multiplication order (so that applying to a column vector yields the
 * step order documented at the top of this file):
 *   M = T * Rz * Ry * Rx * S * F
 * where F is a diagonal flip matrix that negates local x / y as configured.
 */
function transformToMat4(t: Transform): Mat4 {
  const flipSign = {
    x: t.flipX ? -1 : 1,
    y: t.flipY ? -1 : 1,
    z: 1,
  };
  const F = mat4Scale(flipSign);
  const S = mat4Scale(t.scale);
  const Rx = mat4RotX(t.rotation.x);
  const Ry = mat4RotY(t.rotation.y);
  const Rz = mat4RotZ(t.rotation.z);
  const T = mat4Translate(t.position);
  // T * Rz * Ry * Rx * S * F
  return mat4Mul(T, mat4Mul(Rz, mat4Mul(Ry, mat4Mul(Rx, mat4Mul(S, F)))));
}

/**
 * General 4x4 matrix inversion (Gauss-Jordan with partial pivoting).
 * Returns `undefined` if the matrix is singular. Used only for inverting
 * the composed world matrix of a Transform.
 */
function mat4Invert(m: Mat4): Mat4 | undefined {
  // Augmented [m | I] -> [I | m^-1]
  const a = m.slice() as number[];
  const b = IDENTITY_MAT4.slice() as number[];

  for (let col = 0; col < 4; col++) {
    // Find pivot row
    let pivotRow = col;
    let pivotAbs = Math.abs(a[col * 4 + col] as number);
    for (let r = col + 1; r < 4; r++) {
      const v = Math.abs(a[r * 4 + col] as number);
      if (v > pivotAbs) {
        pivotAbs = v;
        pivotRow = r;
      }
    }
    if (pivotAbs < 1e-12) {
      return undefined;
    }
    if (pivotRow !== col) {
      for (let k = 0; k < 4; k++) {
        const tmpA = a[col * 4 + k] as number;
        a[col * 4 + k] = a[pivotRow * 4 + k] as number;
        a[pivotRow * 4 + k] = tmpA;
        const tmpB = b[col * 4 + k] as number;
        b[col * 4 + k] = b[pivotRow * 4 + k] as number;
        b[pivotRow * 4 + k] = tmpB;
      }
    }
    // Scale pivot row to make pivot = 1
    const pivot = a[col * 4 + col] as number;
    for (let k = 0; k < 4; k++) {
      a[col * 4 + k] = (a[col * 4 + k] as number) / pivot;
      b[col * 4 + k] = (b[col * 4 + k] as number) / pivot;
    }
    // Eliminate other rows
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const factor = a[r * 4 + col] as number;
      if (factor === 0) continue;
      for (let k = 0; k < 4; k++) {
        a[r * 4 + k] = (a[r * 4 + k] as number) - factor * (a[col * 4 + k] as number);
        b[r * 4 + k] = (b[r * 4 + k] as number) - factor * (b[col * 4 + k] as number);
      }
    }
  }

  return b;
}

/**
 * Decompose a 4x4 matrix back into a Transform.
 *
 * We assume the matrix came from `transformToMat4` (or the inverse thereof)
 * — that is, a TRS-with-flips affine. The decomposition:
 *   - position = m[col 3] (translation)
 *   - extract column vectors of the upper 3x3, treat their lengths as
 *     scale magnitudes, then read Euler angles from the rotation submatrix.
 *
 * Sign ambiguity: a single negative scale and a 180° rotation about an
 * axis are indistinguishable from the matrix alone. We canonicalize by
 * returning `flipX = flipY = false` (the flips are baked into the scale
 * magnitudes / rotation) — round-trips through this lib remain consistent
 * for non-degenerate cases.
 */
function mat4ToTransform(m: Mat4): Transform {
  const position: Vec3 = {
    x: m[0 * 4 + 3] as number,
    y: m[1 * 4 + 3] as number,
    z: m[2 * 4 + 3] as number,
  };

  // Columns of upper 3x3 = scaled basis vectors.
  const c0x = m[0 * 4 + 0] as number;
  const c0y = m[1 * 4 + 0] as number;
  const c0z = m[2 * 4 + 0] as number;
  const c1x = m[0 * 4 + 1] as number;
  const c1y = m[1 * 4 + 1] as number;
  const c1z = m[2 * 4 + 1] as number;
  const c2x = m[0 * 4 + 2] as number;
  const c2y = m[1 * 4 + 2] as number;
  const c2z = m[2 * 4 + 2] as number;

  let sx = Math.hypot(c0x, c0y, c0z);
  const sy = Math.hypot(c1x, c1y, c1z);
  const sz = Math.hypot(c2x, c2y, c2z);

  // Restore handedness: if determinant of the upper 3x3 is negative,
  // flip the sign of sx so the orthonormal rotation matrix below has
  // det +1.
  const det =
    c0x * (c1y * c2z - c1z * c2y) - c1x * (c0y * c2z - c0z * c2y) + c2x * (c0y * c1z - c0z * c1y);
  if (det < 0) {
    sx = -sx;
  }

  // Orthonormal rotation matrix R = [r0 | r1 | r2] (column-major in
  // mathematical sense; we still index it row-major below).
  const inv_sx = sx !== 0 ? 1 / sx : 0;
  const inv_sy = sy !== 0 ? 1 / sy : 0;
  const inv_sz = sz !== 0 ? 1 / sz : 0;

  const r00 = c0x * inv_sx;
  const r10 = c0y * inv_sx;
  const r20 = c0z * inv_sx;
  const r01 = c1x * inv_sy;
  const r11 = c1y * inv_sy;
  const r21 = c1z * inv_sy;
  // r02 and r12 are not needed for ZYX Euler extraction; r22 is.
  const r22 = c2z * inv_sz;

  // Extract Euler angles for the order Rz * Ry * Rx applied to a column
  // vector (i.e. intrinsic ZYX). Standard derivation:
  //   ry = asin(-r20)
  //   if cos(ry) is non-degenerate:
  //     rx = atan2(r21, r22)
  //     rz = atan2(r10, r00)
  //   else (gimbal lock):
  //     rx = 0
  //     rz = atan2(-r01, r11)
  let rx: number;
  let rz: number;
  const sy_ = -r20;
  const ry = Math.asin(Math.max(-1, Math.min(1, sy_)));
  const cy = Math.cos(ry);
  if (Math.abs(cy) > 1e-7) {
    rx = Math.atan2(r21, r22);
    rz = Math.atan2(r10, r00);
  } else {
    // Gimbal lock: pitch is ±π/2, only the sum/difference of roll and
    // yaw is observable. Pick rx = 0 by convention.
    rx = 0;
    rz = Math.atan2(-r01, r11);
  }

  return {
    position,
    rotation: { x: rx, y: ry, z: rz },
    scale: { x: sx, y: sy, z: sz },
    flipX: false,
    flipY: false,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────

/** Identity transform: no translation, no rotation, scale 1, no flips. */
export function identityTransform(): Transform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    flipX: false,
    flipY: false,
  };
}

/**
 * Compose two transforms. The result is equivalent to first applying `b`,
 * then applying `a`. In matrix terms: `M = Ma * Mb`.
 *
 * Compose-with-identity is a no-op (up to decomposition round-trip):
 * `compose(t, identity) ≈ t`.
 */
export function composeTransform(a: Transform, b: Transform): Transform {
  return mat4ToTransform(mat4Mul(transformToMat4(a), transformToMat4(b)));
}

/**
 * Invert a transform. For non-degenerate transforms (no zero-scale axis),
 * `compose(t, invertTransform(t))` is the identity within {@link EPSILON}.
 *
 * Throws if the transform is singular (some scale component is 0).
 */
export function invertTransform(t: Transform): Transform {
  const m = transformToMat4(t);
  const inv = mat4Invert(m);
  if (inv === undefined) {
    throw new Error('invertTransform: transform is singular (zero scale on at least one axis)');
  }
  return mat4ToTransform(inv);
}

/**
 * Apply a transform to a point in the object's local frame, returning the
 * point in the parent (world) frame.
 *
 * Implementation: lowers `t` to a 4x4 matrix and multiplies by `[v.x, v.y,
 * v.z, 1]`. This is equivalent to the step order documented at the top of
 * this file: flip → scale → rotateX → rotateY → rotateZ → translate.
 */
export function applyTransform(t: Transform, v: Vec3): Vec3 {
  const m = transformToMat4(t);
  return {
    x: (m[0] as number) * v.x + (m[1] as number) * v.y + (m[2] as number) * v.z + (m[3] as number),
    y: (m[4] as number) * v.x + (m[5] as number) * v.y + (m[6] as number) * v.z + (m[7] as number),
    z:
      (m[8] as number) * v.x + (m[9] as number) * v.y + (m[10] as number) * v.z + (m[11] as number),
  };
}

/**
 * Test if a transform is "approximately" the identity within `eps`. Used
 * primarily in tests; not part of the hot path.
 */
export function isApproxIdentity(t: Transform, eps: number = EPSILON): boolean {
  const id = identityTransform();
  const close = (a: number, b: number): boolean => Math.abs(a - b) < eps;
  return (
    close(t.position.x, id.position.x) &&
    close(t.position.y, id.position.y) &&
    close(t.position.z, id.position.z) &&
    close(t.rotation.x, id.rotation.x) &&
    close(t.rotation.y, id.rotation.y) &&
    close(t.rotation.z, id.rotation.z) &&
    close(t.scale.x, id.scale.x) &&
    close(t.scale.y, id.scale.y) &&
    close(t.scale.z, id.scale.z) &&
    t.flipX === id.flipX &&
    t.flipY === id.flipY
  );
}
