/**
 * 2D hit-test primitives. All are pure and return booleans.
 *
 * Boundary convention: INCLUSIVE. A point exactly on the edge counts as
 * inside (rectangle, rotated rectangle, circle). This matches
 * {@link import('./aabb').aabbContainsPoint}.
 *
 * For polygons the even-odd rule classifies edge points as "inside" when
 * they lie on a non-degenerate edge; degenerate (zero-length) edges in the
 * input are skipped. This is the standard ray-casting trade-off.
 */
import { aabbContainsPoint } from './aabb';
import type { Aabb, Vec2 } from './types';

/** Point inside an axis-aligned rectangle (alias for AABB containment). */
export function pointInRect(p: Vec2, rect: Aabb): boolean {
  return aabbContainsPoint(rect, p);
}

/**
 * Point inside an oriented rectangle centered at `center`, with
 * `halfExtents` (half-width, half-height) before rotation, rotated by
 * `rotationRad` (right-hand rule about +z, i.e. counter-clockwise in screen
 * coordinates where +y is up).
 */
export function pointInRotatedRect(
  p: Vec2,
  center: Vec2,
  halfExtents: Vec2,
  rotationRad: number,
): boolean {
  // Inverse-rotate the point into the rect's local frame, then do an
  // axis-aligned test.
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const c = Math.cos(-rotationRad);
  const s = Math.sin(-rotationRad);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return lx >= -halfExtents.x && lx <= halfExtents.x && ly >= -halfExtents.y && ly <= halfExtents.y;
}

/** Point inside (or on the boundary of) a circle. */
export function pointInCircle(p: Vec2, center: Vec2, radius: number): boolean {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Point-in-polygon via even-odd / ray-casting. Polygon is given as an
 * ordered list of vertices; the closing edge from the last back to the
 * first is implicit.
 *
 * Returns `false` for polygons with fewer than 3 vertices.
 *
 * Edge points: the classic ray-casting test treats them ambiguously; we
 * additionally check `isOnSegment` for each edge so a point lying exactly
 * on an edge is reported as inside (consistent with the inclusive
 * convention used elsewhere in this lib).
 */
export function pointInPolygon(p: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  // First: exact on-edge check.
  for (let i = 0; i < n; i++) {
    const a = polygon[i] as Vec2;
    const b = polygon[(i + 1) % n] as Vec2;
    if (isOnSegment(p, a, b)) return true;
  }

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i] as Vec2;
    const pj = polygon[j] as Vec2;
    // Horizontal ray to +x. An edge crosses the ray if one endpoint is
    // strictly above p.y and the other is at-or-below.
    const intersects =
      pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * True if `p` lies on the closed segment `[a, b]` within a small tolerance.
 * Used by {@link pointInPolygon} to make edge points inclusive.
 */
function isOnSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  // Cross product == 0 (within tolerance) → collinear.
  const cross = abx * apy - aby * apx;
  // Tolerance is proportional to the segment length to handle large
  // coordinates without becoming so loose that interior points are
  // flagged as on-edge.
  const segLenSq = abx * abx + aby * aby;
  if (segLenSq === 0) {
    // Degenerate edge: only the endpoint itself is on-segment.
    return apx === 0 && apy === 0;
  }
  // 1e-6 absolute combined with a relative term covers both small and
  // large coordinates.
  const tol = 1e-6 * Math.sqrt(segLenSq) + 1e-9;
  if (Math.abs(cross) > tol) return false;
  // Within the segment's parameter range [0, 1].
  const dot = apx * abx + apy * aby;
  if (dot < 0) return false;
  if (dot > segLenSq) return false;
  return true;
}
