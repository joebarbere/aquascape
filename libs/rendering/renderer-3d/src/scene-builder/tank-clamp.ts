/**
 * Tank-bounds clamp helper.
 *
 * The 2D renderer hides objects that lie outside the tank silhouette
 * because it clips to the tank rect. The 3D renderer draws the full
 * geometry, so a rock authored with its centre 100 mm outside the
 * tank's right wall is visible poking through the glass. This helper
 * clamps an object's world (x, z) so the object's bounding box stays
 * inside the tank's interior.
 *
 * Clamp policy (per axis):
 *
 *   - X: position.x ∈ [halfW, tank.width  - halfW]
 *   - Z: position.z ∈ [halfD, tank.depth  - halfD]
 *
 *   `halfW` / `halfD` are the SCALED half-extents
 *   (`naturalHalf × transform.scale`).
 *
 * Overflow rule: when `2 × halfW > tank.width` (or `2 × halfD >
 * tank.depth`) the object is wider/deeper than the tank can hold and
 * clamping to `[halfW, tank.width - halfW]` would invert the interval.
 * In that case the object is **centred** on the corresponding axis — at
 * least the front-elevation view stays sensible while the user fixes
 * the data.
 *
 * Y stays untouched: hardscape + plant builders already snap Y to the
 * substrate via `substrateHeightAt`, and that's the correct floor —
 * this helper has no business with it.
 *
 * **Scatter patches are NOT clamped per-instance** in v1. Each scatter
 * instance lives inside the user-authored brush polygon; per-instance
 * clamping would change the density the user intended. The polygon
 * itself is the user's responsibility for now; a future "fence the
 * brush to the tank" pass can live here when we ship freehand brush UI.
 *
 * Pure — no Three.js dependency.
 */

import type { Vec3 } from '@aquascape/domain/geometry';
import type { Scene } from '@aquascape/domain/scene-model';

export interface HalfExtentsXZ {
  /** Half-width (along world X) — already scaled by transform.scale.x. */
  readonly x: number;
  /** Half-depth (along world Z) — already scaled by transform.scale.z. */
  readonly z: number;
}

export interface ClampTankDims {
  readonly width: number;
  readonly depth: number;
}

/**
 * Clamp `position` so the AABB defined by `±halfExtents` fits inside the
 * tank's interior. `position.y` is returned unchanged.
 */
export function clampToTank(
  position: Vec3,
  halfExtents: HalfExtentsXZ,
  tank: ClampTankDims,
): Vec3 {
  return {
    x: clampAxis(position.x, halfExtents.x, tank.width),
    y: position.y,
    z: clampAxis(position.z, halfExtents.z, tank.depth),
  };
}

/**
 * Clamp a single axis. When `2 × half > extent`, the object is wider
 * than the tank along this axis — return the tank's centre. Otherwise
 * clamp into `[half, extent - half]`. Negative or non-finite half-
 * extents are treated as zero (defensive).
 */
function clampAxis(value: number, half: number, extent: number): number {
  const safeHalf = !Number.isFinite(half) || half < 0 ? 0 : half;
  if (!Number.isFinite(extent) || extent <= 0) return value;
  if (2 * safeHalf >= extent) return extent * 0.5;
  const lo = safeHalf;
  const hi = extent - safeHalf;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/** Sugar wrapper — pulls the tank dimensions out of a Scene. */
export function clampToScene(
  position: Vec3,
  halfExtents: HalfExtentsXZ,
  scene: Scene,
): Vec3 {
  return clampToTank(position, halfExtents, {
    width: scene.tank.width,
    depth: scene.tank.depth,
  });
}
