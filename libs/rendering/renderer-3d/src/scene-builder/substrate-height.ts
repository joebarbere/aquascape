/**
 * Compute the substrate "top" height at any world-X position. Used by the
 * hardscape + plant builders to rest objects ON the substrate instead of
 * letting them float (their world-Y in the 2D document is the silhouette
 * centre, which in 3D would render the rock floating mid-tank).
 *
 * v1 simplification matches `substrate-mesh.ts`: substrate height varies
 * only with world X (front-to-back fall-off is uniform). A future stage
 * can extend the profile to vary along Z too — this helper would then
 * take a (worldX, worldZ) pair and the substrate-mesh would sample the
 * same way.
 *
 * Pure — no Three.js dependency. Tested as plain TypeScript.
 */

import type { Scene, SubstrateRegion } from '@aquascape/domain/scene-model';

/**
 * Substrate height (mm above the tank floor) at world X coordinate
 * `worldX`. Returns 0 when no region covers that X. When multiple regions
 * overlap, returns the max — that's the visible top.
 *
 * `worldX` is in millimetres from the tank's front-bottom-left interior
 * corner (same coordinate convention the rest of the document uses).
 */
export function substrateHeightAt(scene: Scene, worldX: number): number {
  const tankWidth = scene.tank.width;
  if (tankWidth <= 0) return 0;
  let maxHeight = 0;
  for (const region of scene.substrate.regions) {
    const h = regionHeightAt(region, worldX, tankWidth);
    if (h > maxHeight) maxHeight = h;
  }
  return maxHeight;
}

/**
 * Sample one region's profile at a world-X. Returns 0 when `worldX` is
 * outside the region's `[fromX, toX]` extent.
 */
function regionHeightAt(
  region: SubstrateRegion,
  worldX: number,
  tankWidth: number,
): number {
  const x0 = region.fromX * tankWidth;
  const x1 = region.toX * tankWidth;
  if (worldX < x0 || worldX > x1) return 0;
  const span = x1 - x0;
  if (span <= 0) return 0;
  const fracX = (worldX - x0) / span;
  return sampleProfileLinear(region.profile, fracX);
}

/**
 * Sample a profile (array of `{ x: [0,1], y: mm }` control points) at
 * fractional position `fracX`. Linear interpolation between adjacent
 * control points; returns 0 for empty profiles.
 *
 * v1 uses linear sampling here (cheap, predictable) rather than the
 * `sampleCatmullRom` the renderer uses for the visible silhouette. The
 * height beneath an object doesn't need spline accuracy — a few-mm
 * difference at the contact point is invisible at any orbit distance.
 */
function sampleProfileLinear(
  profile: ReadonlyArray<{ x: number; y: number }>,
  fracX: number,
): number {
  if (profile.length === 0) return 0;
  if (profile.length === 1) return Math.max(0, profile[0]!.y);
  // Find the bracketing pair.
  if (fracX <= profile[0]!.x) return Math.max(0, profile[0]!.y);
  if (fracX >= profile[profile.length - 1]!.x) {
    return Math.max(0, profile[profile.length - 1]!.y);
  }
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i]!;
    const b = profile[i + 1]!;
    if (fracX >= a.x && fracX <= b.x) {
      const dx = b.x - a.x;
      const t = dx <= 0 ? 0 : (fracX - a.x) / dx;
      return Math.max(0, a.y + (b.y - a.y) * t);
    }
  }
  return 0;
}
