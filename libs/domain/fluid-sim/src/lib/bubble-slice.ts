/**
 * Stam 1999 / 2003 stable-fluids solver on a 32×32 (default) vertical 2D
 * slice. One slice per air-stone equipment item — the renderer reads the
 * `u`, `v` velocity field to advect billboard bubble sprites upward.
 *
 * Storage: `(n+2)*(n+2)` arrays per the Stam papers, where row/column 0 and
 * n+1 are ghost cells used by boundary handling. Accessors index as
 * `i + (n+2) * j` for a cell at column i, row j in `[0, n+1]`.
 *
 * Pre-allocation: every per-step scratch buffer lives on the slice itself
 * (`scratchU`, `scratchV`, `scratchDensity`, `pressure`, `divergence`). The
 * step never allocates — important for hitting Stage 11's per-tick budget
 * with N air-stones running concurrently in the ECS world.
 *
 * Determinism: pure deterministic; same `BubbleSlice` state + same `dt` +
 * same `externalForces` sequence reproduces the same density field
 * byte-for-byte. The solver itself does no random sampling.
 */

import { clamp } from './grid-math';
import type { Vec3 } from './types';

const DEFAULT_GRID_SIZE = 32;
/** Default cell size in mm — yields a ~640 mm slice at gridSize=32. */
const DEFAULT_CELL_SIZE_MM = 20;
/** Diffusion coefficient for velocity (kinematic viscosity proxy). */
const VELOCITY_DIFF = 0.0001;
/** Diffusion coefficient for density (bubble mass spreading). */
const DENSITY_DIFF = 0.0;
/** Gauss-Seidel iteration count for diffuse + project. Stam 2003 default. */
const GS_ITERS = 20;

/** Index into an (n+2)*(n+2) array, column-major flattening. */
function IX(i: number, j: number, n: number): number {
  return i + (n + 2) * j;
}

/** 2D Stam stable-fluids slice for one air-stone. */
export interface BubbleSlice {
  /** Grid resolution (always 32 in F11.5). */
  n: number;
  /** World-space mapping. Slice is vertical: +y in world = +y in slice; local x is unconstrained. */
  origin: Vec3;
  cellSize: number;
  /** Velocity field (2D), parallel arrays length (n+2)*(n+2). */
  u: Float32Array;
  v: Float32Array;
  /** Density field (mass/colour proxy for bubble particles), same shape. */
  density: Float32Array;
  /** Pre-allocated scratch — used internally by stepBubbleSlice. Same shape. */
  scratchU: Float32Array;
  scratchV: Float32Array;
  scratchDensity: Float32Array;
  /** Pressure + divergence buffers for the projection sub-step. */
  pressure: Float32Array;
  divergence: Float32Array;
}

export interface CreateBubbleSliceOpts {
  origin: Vec3;
  /** Resolution override (default 32). */
  gridSize?: number;
  /** World-space cell size in mm (default 20). */
  cellSize?: number;
}

/** Allocate a fresh zero-state BubbleSlice. */
export function createBubbleSlice(opts: CreateBubbleSliceOpts): BubbleSlice {
  const n = opts.gridSize ?? DEFAULT_GRID_SIZE;
  const cellSize = opts.cellSize ?? DEFAULT_CELL_SIZE_MM;
  const size = (n + 2) * (n + 2);
  return {
    n,
    origin: { x: opts.origin.x, y: opts.origin.y, z: opts.origin.z },
    cellSize,
    u: new Float32Array(size),
    v: new Float32Array(size),
    density: new Float32Array(size),
    scratchU: new Float32Array(size),
    scratchV: new Float32Array(size),
    scratchDensity: new Float32Array(size),
    pressure: new Float32Array(size),
    divergence: new Float32Array(size),
  };
}

/**
 * One Stam-style fluid step on the slice.
 *
 * Order:
 *   1. addForce u/v from externalForces (if supplied).
 *   2. velocity step: diffuse → project → advect → project.
 *   3. density step: diffuse → advect.
 *
 * The double-projection in the velocity step is per the Stam papers — the
 * first ensures inflow forces don't create divergence, the second cleans
 * up after advection. Density isn't projected.
 */
export function stepBubbleSlice(
  slice: BubbleSlice,
  dt: number,
  externalForces?: { u: Float32Array; v: Float32Array },
): void {
  const { n, u, v, density, scratchU, scratchV, scratchDensity, pressure, divergence } = slice;

  if (externalForces !== undefined) {
    addForce(u, externalForces.u, dt, n);
    addForce(v, externalForces.v, dt, n);
  }

  // velocity step
  diffuse(scratchU, u, VELOCITY_DIFF, dt, n, 1);
  diffuse(scratchV, v, VELOCITY_DIFF, dt, n, 2);
  project(scratchU, scratchV, pressure, divergence, n);
  advect(u, scratchU, scratchU, scratchV, dt, n, 1);
  advect(v, scratchV, scratchU, scratchV, dt, n, 2);
  project(u, v, pressure, divergence, n);

  // density step
  diffuse(scratchDensity, density, DENSITY_DIFF, dt, n, 0);
  advect(density, scratchDensity, u, v, dt, n, 0);
}

// ─── Stam helpers ──────────────────────────────────────────────────────────

/** `field[i] += dt * source[i]` for every cell (including ghost cells — cheap). */
function addForce(field: Float32Array, source: Float32Array, dt: number, n: number): void {
  const total = (n + 2) * (n + 2);
  for (let i = 0; i < total; i++) {
    field[i] = field[i]! + dt * source[i]!;
  }
}

/**
 * Implicit diffusion: solve `(I - dt*diff*∇²) x = x0` via Gauss-Seidel.
 *
 * `boundary` selects the boundary handler:
 *   0 — density (mirror on all walls)
 *   1 — u-component (negate on left/right, mirror on top/bottom)
 *   2 — v-component (negate on top/bottom, mirror on left/right)
 *
 * If `diff` is 0 we still copy x0 → x — the rest of the step expects the
 * scratch buffer to hold "diffused" state even when diffusion is disabled.
 */
function diffuse(
  out: Float32Array,
  src: Float32Array,
  diff: number,
  dt: number,
  n: number,
  boundary: 0 | 1 | 2,
): void {
  if (diff <= 0) {
    out.set(src);
    setBoundary(out, n, boundary);
    return;
  }
  const a = dt * diff * n * n;
  // Initial guess: source itself (Stam's standard practice).
  out.set(src);
  for (let k = 0; k < GS_ITERS; k++) {
    for (let j = 1; j <= n; j++) {
      for (let i = 1; i <= n; i++) {
        out[IX(i, j, n)] =
          (src[IX(i, j, n)]! +
            a *
              (out[IX(i - 1, j, n)]! +
                out[IX(i + 1, j, n)]! +
                out[IX(i, j - 1, n)]! +
                out[IX(i, j + 1, n)]!)) /
          (1 + 4 * a);
      }
    }
    setBoundary(out, n, boundary);
  }
}

/**
 * Semi-Lagrangian advection: for each cell, trace backwards through the
 * velocity field by `dt` and sample `src` at that point.
 */
function advect(
  out: Float32Array,
  src: Float32Array,
  uField: Float32Array,
  vField: Float32Array,
  dt: number,
  n: number,
  boundary: 0 | 1 | 2,
): void {
  // Per Stam: scale dt by grid resolution so velocity units (cells/sec)
  // line up with the backtrace.
  const dt0 = dt * n;
  for (let j = 1; j <= n; j++) {
    for (let i = 1; i <= n; i++) {
      let x = i - dt0 * uField[IX(i, j, n)]!;
      let y = j - dt0 * vField[IX(i, j, n)]!;
      x = clamp(x, 0.5, n + 0.5);
      y = clamp(y, 0.5, n + 0.5);
      const i0 = Math.floor(x);
      const i1 = i0 + 1;
      const j0 = Math.floor(y);
      const j1 = j0 + 1;
      const s1 = x - i0;
      const s0 = 1 - s1;
      const t1 = y - j0;
      const t0 = 1 - t1;
      out[IX(i, j, n)] =
        s0 * (t0 * src[IX(i0, j0, n)]! + t1 * src[IX(i0, j1, n)]!) +
        s1 * (t0 * src[IX(i1, j0, n)]! + t1 * src[IX(i1, j1, n)]!);
    }
  }
  setBoundary(out, n, boundary);
}

/**
 * Hodge projection — Poisson solve on pressure, subtract gradient from
 * velocity. Same algorithm as the 3D FlowField projection, just one fewer
 * axis.
 */
function project(
  uField: Float32Array,
  vField: Float32Array,
  p: Float32Array,
  div: Float32Array,
  n: number,
): void {
  const h = 1.0 / n;
  for (let j = 1; j <= n; j++) {
    for (let i = 1; i <= n; i++) {
      div[IX(i, j, n)] =
        -0.5 *
        h *
        (uField[IX(i + 1, j, n)]! -
          uField[IX(i - 1, j, n)]! +
          vField[IX(i, j + 1, n)]! -
          vField[IX(i, j - 1, n)]!);
      p[IX(i, j, n)] = 0;
    }
  }
  setBoundary(div, n, 0);
  setBoundary(p, n, 0);

  for (let k = 0; k < GS_ITERS; k++) {
    for (let j = 1; j <= n; j++) {
      for (let i = 1; i <= n; i++) {
        p[IX(i, j, n)] =
          (div[IX(i, j, n)]! +
            p[IX(i - 1, j, n)]! +
            p[IX(i + 1, j, n)]! +
            p[IX(i, j - 1, n)]! +
            p[IX(i, j + 1, n)]!) /
          4;
      }
    }
    setBoundary(p, n, 0);
  }

  for (let j = 1; j <= n; j++) {
    for (let i = 1; i <= n; i++) {
      uField[IX(i, j, n)] =
        uField[IX(i, j, n)]! - (0.5 * (p[IX(i + 1, j, n)]! - p[IX(i - 1, j, n)]!)) / h;
      vField[IX(i, j, n)] =
        vField[IX(i, j, n)]! - (0.5 * (p[IX(i, j + 1, n)]! - p[IX(i, j - 1, n)]!)) / h;
    }
  }
  setBoundary(uField, n, 1);
  setBoundary(vField, n, 2);
}

/**
 * Stam boundary handler. Ghost-cell values mirror (or negate) the adjacent
 * interior cell so the field obeys no-slip walls.
 */
function setBoundary(field: Float32Array, n: number, b: 0 | 1 | 2): void {
  for (let i = 1; i <= n; i++) {
    field[IX(0, i, n)] = b === 1 ? -field[IX(1, i, n)]! : field[IX(1, i, n)]!;
    field[IX(n + 1, i, n)] = b === 1 ? -field[IX(n, i, n)]! : field[IX(n, i, n)]!;
    field[IX(i, 0, n)] = b === 2 ? -field[IX(i, 1, n)]! : field[IX(i, 1, n)]!;
    field[IX(i, n + 1, n)] = b === 2 ? -field[IX(i, n, n)]! : field[IX(i, n, n)]!;
  }
  // Corners average the two adjacent ghost cells.
  field[IX(0, 0, n)] = 0.5 * (field[IX(1, 0, n)]! + field[IX(0, 1, n)]!);
  field[IX(0, n + 1, n)] = 0.5 * (field[IX(1, n + 1, n)]! + field[IX(0, n, n)]!);
  field[IX(n + 1, 0, n)] = 0.5 * (field[IX(n, 0, n)]! + field[IX(n + 1, 1, n)]!);
  field[IX(n + 1, n + 1, n)] = 0.5 * (field[IX(n, n + 1, n)]! + field[IX(n + 1, n, n)]!);
}
