/**
 * Axis-aligned bounding box primitives (2D).
 *
 * Conventions:
 * - An AABB is `{ min, max }` where `min.x <= max.x` and `min.y <= max.y`.
 *   A zero-width or zero-height box is allowed and is called "degenerate".
 * - Boundary is INCLUSIVE for containment and intersection (a point on the
 *   edge is considered inside; two boxes sharing an edge are considered to
 *   intersect). Pick once, document it, keep it consistent.
 * - {@link aabbFromPoints} on an empty input array throws — there is no
 *   meaningful "empty bbox" we can construct (the canonical sentinel
 *   `{+∞, -∞}` doesn't compose well with other functions, and silently
 *   returning a degenerate box would mask bugs). Callers must guard.
 */
import { applyTransform } from './transform';
import type { Aabb, Transform, Vec2 } from './types';

/**
 * Inclusive point-in-AABB test. Points on the boundary count as inside.
 */
export function aabbContainsPoint(box: Aabb, p: Vec2): boolean {
  return p.x >= box.min.x && p.x <= box.max.x && p.y >= box.min.y && p.y <= box.max.y;
}

/**
 * Inclusive AABB-vs-AABB intersection. Boxes that share an edge or corner
 * count as intersecting (consistent with {@link aabbContainsPoint}).
 */
export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y;
}

/**
 * Tightest AABB enclosing `points`. Throws on empty input — see file
 * header for why. Caller must guard.
 */
export function aabbFromPoints(points: ReadonlyArray<Vec2>): Aabb {
  if (points.length === 0) {
    throw new Error('aabbFromPoints: requires at least one point');
  }
  const first = points[0] as Vec2;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (let i = 1; i < points.length; i++) {
    const p = points[i] as Vec2;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/**
 * Expand an AABB outward by `byMm` on every side. Negative values shrink
 * the box. If shrinking would invert the box, the result is clamped to a
 * degenerate box centered on the original.
 */
export function aabbExpand(a: Aabb, byMm: number): Aabb {
  const minX = a.min.x - byMm;
  const minY = a.min.y - byMm;
  const maxX = a.max.x + byMm;
  const maxY = a.max.y + byMm;
  if (minX > maxX || minY > maxY) {
    const cx = (a.min.x + a.max.x) / 2;
    const cy = (a.min.y + a.max.y) / 2;
    return { min: { x: cx, y: cy }, max: { x: cx, y: cy } };
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/**
 * Transform an AABB by an affine `Transform`.
 *
 * The AABB lives in 2D (z=0). We lift each of its four corners to 3D,
 * apply the transform, project back to 2D via the canonical -z projection,
 * and re-bound. For non-axis-aligned rotations the result is larger than
 * the input — that is the correct conservative bound.
 */
export function transformAabb(box: Aabb, t: Transform): Aabb {
  const corners: Vec2[] = [
    { x: box.min.x, y: box.min.y },
    { x: box.max.x, y: box.min.y },
    { x: box.max.x, y: box.max.y },
    { x: box.min.x, y: box.max.y },
  ];
  const projected = corners.map((c) => {
    const w = applyTransform(t, { x: c.x, y: c.y, z: 0 });
    return { x: w.x, y: w.y };
  });
  return aabbFromPoints(projected);
}
