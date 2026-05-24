/**
 * Pure Vec3 ops. All functions return new plain `{x, y, z}` objects; inputs
 * are never mutated.
 *
 * Coordinate system: right-handed (+x right, +y up, +z back). The cross
 * product follows the right-hand rule: `cross({1,0,0}, {0,1,0}) = {0,0,1}`.
 */
import { EPSILON } from './constants';
import type { Vec3 } from './types';

/** Construct a Vec3. Convenience for test code. */
export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** Component-wise addition. */
export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Component-wise subtraction (a - b). */
export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** Component-wise (Hadamard) product. */
export function mulVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z };
}

/** Scalar multiplication. */
export function scaleVec3(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

/** Dot product. */
export function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Cross product, right-hand rule.
 *
 * `cross(ex, ey) = ez` where ex=(1,0,0), ey=(0,1,0), ez=(0,0,1).
 */
export function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Euclidean length. */
export function lengthVec3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Distance between two points. */
export function distanceVec3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Unit vector. For vectors of length < {@link EPSILON} this returns the
 * zero vector rather than throwing — same convention as
 * {@link import('./vec2').normalizeVec2}.
 */
export function normalizeVec3(v: Vec3): Vec3 {
  const len = lengthVec3(v);
  if (len < EPSILON) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Linear interpolation; t in [0, 1] but not clamped. */
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}
