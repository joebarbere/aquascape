/**
 * 32³ (default) divergence-free velocity grid baked once per scene.
 *
 * Drives the FlowFieldSystem in `domain/livestock-ecs` — fish read
 * `sampleFlowField(field, pos)` and add the result as a drag force, so they
 * drift toward filter intakes and get pushed by outflow jets.
 *
 * Algorithm:
 *  1. Allocate u/v/w as parallel `Float32Array(gx*gy*gz)`, all zero.
 *  2. For each source, deposit a 3×3×3 Gaussian kernel of velocity at the
 *     cell containing `outflowPos` (and a sink at `intakePos` if present).
 *     Peak magnitude scales with `flowRate / NOMINAL_FLOW_LPH`.
 *  3. Run a Stam-style projection (Gauss-Seidel on the Poisson pressure
 *     equation, default 20 iterations) and subtract the pressure gradient.
 *     This makes the field divergence-free so fish don't get trapped near
 *     sources or pile up on sinks.
 *  4. Zero-velocity boundary at grid edges (no-slip).
 *
 * Determinism: pure function of inputs. Iteration order is fixed (z-y-x
 * loops), so two calls with the same `BakeFlowFieldOpts` produce
 * byte-identical typed-array outputs.
 */

import { clamp, idx3 } from './grid-math';
import type { Aabb, Vec3 } from './types';

/** Default grid resolution. F11.5 always uses 32 — overrideable for tests. */
const DEFAULT_GRID_SIZE = 32;
/** Default projection iterations. 20 is the Stam 2003 recommendation. */
const DEFAULT_PROJECTION_ITERS = 20;
/** Reference flow rate that maps to unit peak velocity (~ standard nano filter). */
const NOMINAL_FLOW_LPH = 200;
/** Peak velocity (mm/sec) at the centre of a unit-rate source kernel. */
const NOMINAL_PEAK_VELOCITY_MM_PER_S = 50;

/** Velocity grid produced by {@link bakeFlowField}. */
export interface FlowField {
  /** Grid resolution per axis (always 32 in F11.5). */
  gx: number;
  gy: number;
  gz: number;
  /** World-space mapping of the grid. */
  origin: Vec3;
  cellSize: number;
  /** Velocity components — three parallel Float32Arrays, length gx*gy*gz each.
   *  At index `i = x + gx*(y + gy*z)`: velocity = (u[i], v[i], w[i]) in mm/sec. */
  u: Float32Array;
  v: Float32Array;
  w: Float32Array;
}

/** A single equipment-driven flow source (filter outflow, optionally with intake). */
export interface FlowSource {
  /** Position where water enters the field (positive divergence). */
  outflowPos: Vec3;
  /** Unit vector for the jet direction. Defaults to (0, 0, 1) if absent. */
  outflowVec?: Vec3;
  /** Optional intake — water *exits* the field here (negative divergence). */
  intakePos?: Vec3;
  /** Volumetric flow rate (L/hr). Drives source magnitude. Defaults to 200. */
  flowRate?: number;
}

/** Bake-time inputs. */
export interface BakeFlowFieldOpts {
  tankAabb: Aabb;
  sources: ReadonlyArray<FlowSource>;
  /** Optional grid resolution override (default 32). */
  gridSize?: number;
  /** Optional projection iteration count (default 20). Higher = more divergence-free. */
  projectionIterations?: number;
}

/**
 * Bake a divergence-free velocity field over `tankAabb`. With zero sources
 * returns an all-zero field (used as a "no equipment" fast path).
 */
export function bakeFlowField(opts: BakeFlowFieldOpts): FlowField {
  const gridSize = opts.gridSize ?? DEFAULT_GRID_SIZE;
  const iters = opts.projectionIterations ?? DEFAULT_PROJECTION_ITERS;
  const { tankAabb } = opts;

  // Use the longest tank dimension to size cells — keeps the grid cubic
  // (so trilinear sampling is uniform in all axes) while ensuring the
  // whole tank fits inside it.
  const extent = Math.max(
    tankAabb.max.x - tankAabb.min.x,
    tankAabb.max.y - tankAabb.min.y,
    tankAabb.max.z - tankAabb.min.z,
  );
  const cellSize = extent / gridSize;

  const gx = gridSize;
  const gy = gridSize;
  const gz = gridSize;
  const n = gx * gy * gz;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const w = new Float32Array(n);

  const origin: Vec3 = { x: tankAabb.min.x, y: tankAabb.min.y, z: tankAabb.min.z };

  // Deposit Gaussian kernels for each source. Even with zero sources we
  // still run projection — but projection on an all-zero field is a no-op,
  // so the early return below saves the work.
  if (opts.sources.length > 0) {
    for (const src of opts.sources) {
      depositGaussian(u, v, w, gx, gy, gz, origin, cellSize, src);
    }
    applyZeroBoundary(u, v, w, gx, gy, gz);
    project(u, v, w, gx, gy, gz, cellSize, iters);
    applyZeroBoundary(u, v, w, gx, gy, gz);
  }

  return { gx, gy, gz, origin, cellSize, u, v, w };
}

/**
 * Trilinear sample with clamp-to-edge. Returns the velocity in mm/sec at
 * `pos`; out-of-grid positions return the value at the nearest grid edge
 * (no NaN, no crash).
 */
export function sampleFlowField(field: FlowField, pos: Vec3): Vec3 {
  const { gx, gy, gz, origin, cellSize, u, v, w } = field;

  // Convert world → grid cell coordinates. The grid stores cell-centred
  // values; we treat the (0,0,0) cell centre as origin + 0.5*cellSize so
  // (origin) itself is exactly on the lower bound between cells (-0.5) and
  // clamps to cell 0.
  const fx = (pos.x - origin.x) / cellSize - 0.5;
  const fy = (pos.y - origin.y) / cellSize - 0.5;
  const fz = (pos.z - origin.z) / cellSize - 0.5;

  const cx = clamp(fx, 0, gx - 1);
  const cy = clamp(fy, 0, gy - 1);
  const cz = clamp(fz, 0, gz - 1);

  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const z0 = Math.floor(cz);
  const x1 = Math.min(x0 + 1, gx - 1);
  const y1 = Math.min(y0 + 1, gy - 1);
  const z1 = Math.min(z0 + 1, gz - 1);

  const tx = cx - x0;
  const ty = cy - y0;
  const tz = cz - z0;

  // 8-corner trilinear weights.
  const i000 = idx3(x0, y0, z0, gx, gy);
  const i100 = idx3(x1, y0, z0, gx, gy);
  const i010 = idx3(x0, y1, z0, gx, gy);
  const i110 = idx3(x1, y1, z0, gx, gy);
  const i001 = idx3(x0, y0, z1, gx, gy);
  const i101 = idx3(x1, y0, z1, gx, gy);
  const i011 = idx3(x0, y1, z1, gx, gy);
  const i111 = idx3(x1, y1, z1, gx, gy);

  return {
    x: trilerp(u, i000, i100, i010, i110, i001, i101, i011, i111, tx, ty, tz),
    y: trilerp(v, i000, i100, i010, i110, i001, i101, i011, i111, tx, ty, tz),
    z: trilerp(w, i000, i100, i010, i110, i001, i101, i011, i111, tx, ty, tz),
  };
}

// ─── Internals ─────────────────────────────────────────────────────────────

function depositGaussian(
  u: Float32Array,
  v: Float32Array,
  w: Float32Array,
  gx: number,
  gy: number,
  gz: number,
  origin: Vec3,
  cellSize: number,
  src: FlowSource,
): void {
  const flowRate = src.flowRate ?? NOMINAL_FLOW_LPH;
  const magnitude = (flowRate / NOMINAL_FLOW_LPH) * NOMINAL_PEAK_VELOCITY_MM_PER_S;

  // Normalise outflow direction. If caller passes a zero vector we fall
  // back to (0, 0, 1) — same as omitting the field entirely.
  const dirRaw = src.outflowVec ?? { x: 0, y: 0, z: 1 };
  const dirLen = Math.hypot(dirRaw.x, dirRaw.y, dirRaw.z);
  const dir: Vec3 =
    dirLen > 1e-9
      ? { x: dirRaw.x / dirLen, y: dirRaw.y / dirLen, z: dirRaw.z / dirLen }
      : { x: 0, y: 0, z: 1 };

  // Outflow: add velocity along `dir`.
  stampKernel(u, v, w, gx, gy, gz, origin, cellSize, src.outflowPos, dir, magnitude);

  // Intake: subtract velocity along `dir` (sink — water leaves along the same axis).
  if (src.intakePos !== undefined) {
    stampKernel(u, v, w, gx, gy, gz, origin, cellSize, src.intakePos, dir, -magnitude);
  }
}

/** 3×3×3 Gaussian-ish stencil centred on the cell containing `worldPos`. */
function stampKernel(
  u: Float32Array,
  v: Float32Array,
  w: Float32Array,
  gx: number,
  gy: number,
  gz: number,
  origin: Vec3,
  cellSize: number,
  worldPos: Vec3,
  dir: Vec3,
  magnitude: number,
): void {
  // Compute cell coords of the source centre. Out-of-grid sources clamp to
  // the nearest valid interior cell (we don't want a source deposit on the
  // boundary because applyZeroBoundary would erase it).
  const cxF = (worldPos.x - origin.x) / cellSize;
  const cyF = (worldPos.y - origin.y) / cellSize;
  const czF = (worldPos.z - origin.z) / cellSize;
  const cx = clamp(Math.floor(cxF), 1, gx - 2);
  const cy = clamp(Math.floor(cyF), 1, gy - 2);
  const cz = clamp(Math.floor(czF), 1, gz - 2);

  // Discretised Gaussian weights summing to 1.0 over the 3x3x3 stencil:
  // centre + 6 face-adjacents + 12 edges + 8 corners. We use a simple
  // distance-based exponential e^{-d^2} rather than computing the exact
  // 3D Gaussian — the projection step smooths it out anyway.
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const d2 = dx * dx + dy * dy + dz * dz;
        const weight = Math.exp(-d2 * 0.5);
        const xi = cx + dx;
        const yi = cy + dy;
        const zi = cz + dz;
        if (xi < 0 || xi >= gx || yi < 0 || yi >= gy || zi < 0 || zi >= gz) continue;
        const i = idx3(xi, yi, zi, gx, gy);
        u[i] = u[i]! + dir.x * magnitude * weight;
        v[i] = v[i]! + dir.y * magnitude * weight;
        w[i] = w[i]! + dir.z * magnitude * weight;
      }
    }
  }
}

/** Zero the velocity on every face of the grid (no-slip walls). */
function applyZeroBoundary(
  u: Float32Array,
  v: Float32Array,
  w: Float32Array,
  gx: number,
  gy: number,
  gz: number,
): void {
  for (let z = 0; z < gz; z++) {
    for (let y = 0; y < gy; y++) {
      for (let x = 0; x < gx; x++) {
        if (x === 0 || x === gx - 1 || y === 0 || y === gy - 1 || z === 0 || z === gz - 1) {
          const i = idx3(x, y, z, gx, gy);
          u[i] = 0;
          v[i] = 0;
          w[i] = 0;
        }
      }
    }
  }
}

/**
 * Stam-style projection step in 3D. Solves ∇²p = ∇·u via Gauss-Seidel and
 * subtracts ∇p from the velocity field.
 *
 * Pressure boundary condition: zero pressure at the walls (Dirichlet),
 * matching the no-slip velocity boundary applied immediately after.
 */
function project(
  u: Float32Array,
  v: Float32Array,
  w: Float32Array,
  gx: number,
  gy: number,
  gz: number,
  cellSize: number,
  iters: number,
): void {
  const n = gx * gy * gz;
  const p = new Float32Array(n);
  const div = new Float32Array(n);

  // Compute divergence at every interior cell. Boundary cells stay 0.
  const h = cellSize;
  for (let z = 1; z < gz - 1; z++) {
    for (let y = 1; y < gy - 1; y++) {
      for (let x = 1; x < gx - 1; x++) {
        const ix = idx3(x, y, z, gx, gy);
        const dux = u[idx3(x + 1, y, z, gx, gy)]! - u[idx3(x - 1, y, z, gx, gy)]!;
        const dvy = v[idx3(x, y + 1, z, gx, gy)]! - v[idx3(x, y - 1, z, gx, gy)]!;
        const dwz = w[idx3(x, y, z + 1, gx, gy)]! - w[idx3(x, y, z - 1, gx, gy)]!;
        div[ix] = (-0.5 * h * (dux + dvy + dwz)) / 1.0;
        p[ix] = 0;
      }
    }
  }

  // Gauss-Seidel iterate.
  for (let k = 0; k < iters; k++) {
    for (let z = 1; z < gz - 1; z++) {
      for (let y = 1; y < gy - 1; y++) {
        for (let x = 1; x < gx - 1; x++) {
          const ix = idx3(x, y, z, gx, gy);
          p[ix] =
            (div[ix]! +
              p[idx3(x - 1, y, z, gx, gy)]! +
              p[idx3(x + 1, y, z, gx, gy)]! +
              p[idx3(x, y - 1, z, gx, gy)]! +
              p[idx3(x, y + 1, z, gx, gy)]! +
              p[idx3(x, y, z - 1, gx, gy)]! +
              p[idx3(x, y, z + 1, gx, gy)]!) /
            6.0;
        }
      }
    }
  }

  // Subtract pressure gradient.
  for (let z = 1; z < gz - 1; z++) {
    for (let y = 1; y < gy - 1; y++) {
      for (let x = 1; x < gx - 1; x++) {
        const ix = idx3(x, y, z, gx, gy);
        u[ix] =
          u[ix]! - (0.5 * (p[idx3(x + 1, y, z, gx, gy)]! - p[idx3(x - 1, y, z, gx, gy)]!)) / h;
        v[ix] =
          v[ix]! - (0.5 * (p[idx3(x, y + 1, z, gx, gy)]! - p[idx3(x, y - 1, z, gx, gy)]!)) / h;
        w[ix] =
          w[ix]! - (0.5 * (p[idx3(x, y, z + 1, gx, gy)]! - p[idx3(x, y, z - 1, gx, gy)]!)) / h;
      }
    }
  }
}

/** Trilinear blend of 8 corner samples by tx/ty/tz weights in [0, 1]. */
function trilerp(
  arr: Float32Array,
  i000: number,
  i100: number,
  i010: number,
  i110: number,
  i001: number,
  i101: number,
  i011: number,
  i111: number,
  tx: number,
  ty: number,
  tz: number,
): number {
  const c00 = arr[i000]! * (1 - tx) + arr[i100]! * tx;
  const c10 = arr[i010]! * (1 - tx) + arr[i110]! * tx;
  const c01 = arr[i001]! * (1 - tx) + arr[i101]! * tx;
  const c11 = arr[i011]! * (1 - tx) + arr[i111]! * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}
