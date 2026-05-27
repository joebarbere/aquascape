/**
 * 64³ (default) Float32 signed-distance field of hardscape geometry.
 *
 * Each hardscape rock is approximated as a single sphere — coarse but
 * adequate for the F11.5 collision goal ("fish don't swim through this
 * rock"). The bake takes the union of `distance(pos, sphere.center) -
 * sphere.radius` across every hardscape sphere.
 *
 * Negative samples mean "inside hardscape"; positive means "outside / free
 * water". A `gridSize=64` bake over a 1000×400×400 tank gives ~15 mm cells
 * — coarse but sufficient at fish-body-length scale.
 *
 * Empty hardscape: SDF is uniform large-positive (`OUT_OF_BOUNDS_DIST`).
 * Callers treat that as "safely far from anything".
 */

import { clamp, idx3 } from './grid-math';
import type { Aabb, Vec3 } from './types';

const DEFAULT_GRID_SIZE = 64;
/** Returned by `sampleSdf` for points outside the baked grid, and used as
 *  the "no hardscape" sentinel inside the typed array. Large enough that
 *  any caller threshold (e.g. `BL * 0.5` ≈ tens of mm) treats it as "far". */
const OUT_OF_BOUNDS_DIST = 1e6;

/** Hardscape rock approximated as a sphere. */
export interface HardscapeSphere {
  /** World-space center (mm). */
  position: Vec3;
  /** Radius for the sphere approximation (mm). */
  radius: number;
}

/** Baked SDF result. */
export interface HardscapeSdf {
  /** Grid resolution per axis (always 64 in F11.5). */
  gx: number;
  gy: number;
  gz: number;
  /** World-space mapping. */
  origin: Vec3;
  cellSize: number;
  /** Signed distance values — length gx*gy*gz, units mm. Negative inside hardscape. */
  sdf: Float32Array;
}

export interface BakeHardscapeSdfOpts {
  tankAabb: Aabb;
  hardscape: ReadonlyArray<HardscapeSphere>;
  /** Optional grid resolution override (default 64). */
  gridSize?: number;
}

/** Bake the sphere-union SDF over the tank AABB. */
export function bakeHardscapeSdf(opts: BakeHardscapeSdfOpts): HardscapeSdf {
  const gridSize = opts.gridSize ?? DEFAULT_GRID_SIZE;
  const { tankAabb, hardscape } = opts;

  // Use the longest dim to size cubic cells (same convention as bakeFlowField).
  const extent = Math.max(
    tankAabb.max.x - tankAabb.min.x,
    tankAabb.max.y - tankAabb.min.y,
    tankAabb.max.z - tankAabb.min.z,
  );
  const cellSize = extent / gridSize;

  const gx = gridSize;
  const gy = gridSize;
  const gz = gridSize;
  const sdf = new Float32Array(gx * gy * gz);

  const origin: Vec3 = { x: tankAabb.min.x, y: tankAabb.min.y, z: tankAabb.min.z };

  // Fixed-order iteration (z-y-x then per-sphere) → byte-identical output
  // across runs.
  for (let z = 0; z < gz; z++) {
    const pz = origin.z + cellSize * (z + 0.5);
    for (let y = 0; y < gy; y++) {
      const py = origin.y + cellSize * (y + 0.5);
      for (let x = 0; x < gx; x++) {
        const px = origin.x + cellSize * (x + 0.5);
        let d = OUT_OF_BOUNDS_DIST;
        for (let s = 0; s < hardscape.length; s++) {
          const sphere = hardscape[s]!;
          const dx = px - sphere.position.x;
          const dy = py - sphere.position.y;
          const dz = pz - sphere.position.z;
          const sphereD = Math.hypot(dx, dy, dz) - sphere.radius;
          if (sphereD < d) d = sphereD;
        }
        sdf[idx3(x, y, z, gx, gy)] = d;
      }
    }
  }

  return { gx, gy, gz, origin, cellSize, sdf };
}

/**
 * Trilinear-sampled SDF value at `pos`. Returns `OUT_OF_BOUNDS_DIST` for
 * positions outside the baked grid (collision systems treat that as "far
 * from anything").
 */
export function sampleSdf(sdf: HardscapeSdf, pos: Vec3): number {
  const idx = computeIndices(sdf, pos);
  if (idx === null) return OUT_OF_BOUNDS_DIST;
  const { x0, x1, y0, y1, z0, z1, tx, ty, tz } = idx;
  const arr = sdf.sdf;
  const gx = sdf.gx;
  const gy = sdf.gy;

  const i000 = idx3(x0, y0, z0, gx, gy);
  const i100 = idx3(x1, y0, z0, gx, gy);
  const i010 = idx3(x0, y1, z0, gx, gy);
  const i110 = idx3(x1, y1, z0, gx, gy);
  const i001 = idx3(x0, y0, z1, gx, gy);
  const i101 = idx3(x1, y0, z1, gx, gy);
  const i011 = idx3(x0, y1, z1, gx, gy);
  const i111 = idx3(x1, y1, z1, gx, gy);

  const c00 = arr[i000]! * (1 - tx) + arr[i100]! * tx;
  const c10 = arr[i010]! * (1 - tx) + arr[i110]! * tx;
  const c01 = arr[i001]! * (1 - tx) + arr[i101]! * tx;
  const c11 = arr[i011]! * (1 - tx) + arr[i111]! * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

/**
 * Central-differences SDF gradient at `pos`. Returns (0,0,0) for
 * out-of-grid positions — callers shouldn't apply a repulsive force based
 * on an undefined gradient.
 *
 * The gradient is "unit-length-ish": it's the spatial derivative of the
 * SDF, which for a true SDF has unit magnitude almost everywhere. For our
 * trilinear approximation it can drift a few percent off, which is fine
 * for the collision deflection use-case.
 */
export function sampleSdfGradient(sdf: HardscapeSdf, pos: Vec3): Vec3 {
  // Out-of-grid → no gradient.
  if (computeIndices(sdf, pos) === null) {
    return { x: 0, y: 0, z: 0 };
  }
  const h = sdf.cellSize;
  const dx = sampleSdf(sdf, { x: pos.x + h, y: pos.y, z: pos.z }) -
    sampleSdf(sdf, { x: pos.x - h, y: pos.y, z: pos.z });
  const dy = sampleSdf(sdf, { x: pos.x, y: pos.y + h, z: pos.z }) -
    sampleSdf(sdf, { x: pos.x, y: pos.y - h, z: pos.z });
  const dz = sampleSdf(sdf, { x: pos.x, y: pos.y, z: pos.z + h }) -
    sampleSdf(sdf, { x: pos.x, y: pos.y, z: pos.z - h });
  return { x: dx / (2 * h), y: dy / (2 * h), z: dz / (2 * h) };
}

interface SdfIndices {
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  tx: number; ty: number; tz: number;
}

/**
 * Convert a world-space position to its 8 surrounding cell indices and
 * trilinear weights. Returns `null` for out-of-grid positions — keeping
 * the out-of-grid branch in one place lets `sampleSdf` and
 * `sampleSdfGradient` share the same boundary semantics.
 */
function computeIndices(sdf: HardscapeSdf, pos: Vec3): SdfIndices | null {
  const { gx, gy, gz, origin, cellSize } = sdf;
  const fx = (pos.x - origin.x) / cellSize - 0.5;
  const fy = (pos.y - origin.y) / cellSize - 0.5;
  const fz = (pos.z - origin.z) / cellSize - 0.5;
  // Out-of-grid: any coord outside [−0.5, gridSize − 0.5] (i.e. world pos
  // outside the bake AABB). We use a small tolerance so positions exactly
  // on the boundary still sample.
  if (
    fx < -0.5 || fx > gx - 0.5 ||
    fy < -0.5 || fy > gy - 0.5 ||
    fz < -0.5 || fz > gz - 0.5
  ) {
    return null;
  }

  const cx = clamp(fx, 0, gx - 1);
  const cy = clamp(fy, 0, gy - 1);
  const cz = clamp(fz, 0, gz - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const z0 = Math.floor(cz);
  const x1 = Math.min(x0 + 1, gx - 1);
  const y1 = Math.min(y0 + 1, gy - 1);
  const z1 = Math.min(z0 + 1, gz - 1);
  return {
    x0, x1, y0, y1, z0, z1,
    tx: cx - x0,
    ty: cy - y0,
    tz: cz - z0,
  };
}
