/**
 * Pure Vec2 ops. All functions return new plain `{x, y}` objects; inputs
 * are never mutated.
 */
import { EPSILON } from './constants';
import type { Vec2 } from './types';

/** Construct a Vec2. Convenience for test code; the rest of the lib accepts plain objects. */
export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

/** Component-wise addition. */
export function addVec2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Component-wise subtraction (a - b). */
export function subVec2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Component-wise (Hadamard) product. */
export function mulVec2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x * b.x, y: a.y * b.y };
}

/** Scalar multiplication. */
export function scaleVec2(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}

/** Dot product. */
export function dotVec2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** Euclidean length. */
export function lengthVec2(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/** Distance between two points. */
export function distanceVec2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Unit vector. For vectors of length < {@link EPSILON} this returns the
 * zero vector `{x: 0, y: 0}` rather than throwing or returning NaN — chosen
 * so callers don't have to special-case a degenerate normalize before doing
 * downstream math. Document this on the public API.
 */
export function normalizeVec2(v: Vec2): Vec2 {
  const len = lengthVec2(v);
  if (len < EPSILON) {
    return { x: 0, y: 0 };
  }
  return { x: v.x / len, y: v.y / len };
}

/** Linear interpolation; t in [0, 1] but not clamped. */
export function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}
