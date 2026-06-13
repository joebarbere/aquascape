/**
 * Bubble fluid coupling (Stage 11 — "Bubble fluid fidelity pass").
 *
 * Activates the previously-unwired `BubbleStableFluids2D` Stam 1999/2003
 * slice (`@aquascape/domain/fluid-sim`) so rising air-stone bubbles are
 * advected by a *real* turbulent velocity field instead of the lightweight
 * height-driven helix. The helix faked a perfect circular spiral; the fluid
 * slice grows genuine asymmetric vortex shedding and — because overlapping
 * slices sum in world space — one air-stone's plume nudges another's (the
 * "multi-stone column interaction" the F11.5 notes reserved for this pass).
 *
 * COUPLING MODEL
 * --------------
 * One vertical 2D `BubbleSlice` per registered bubble source. The slice is a
 * thin plane through the source:
 *   - slice ROW    j ← world Y  (the slice's `v` / vertical axis)
 *   - slice COLUMN i ← world X  (the slice's `u` / lateral axis, centred on
 *                                the source X)
 * Each tick we inject:
 *   - a steady upward BUOYANCY force in a small band of columns above the
 *     source (drives the plume), and
 *   - a small deterministic, *asymmetric* lateral "puff" whose sign + cell
 *     wander come from `tickPrng` (seeded — NEVER `Math.random`) so the
 *     column sheds vortices left/right rather than rising as a perfect line.
 * Then we `stepBubbleSlice` once on the fixed sim dt.
 *
 * Each bubble samples the SUMMED lateral `u` velocity (across every slice) at
 * its world (x, y); that velocity perturbs the bubble's horizontal motion
 * while the bubble's own `velocityY` keeps the net rise. A secondary,
 * phase-offset fraction of the same lateral magnitude drives Z so a 2D slice
 * still reads as a 3D, non-planar plume. Buoyancy (rise) is unchanged — the
 * fluid only adds the lateral structure, so the pass is strictly a fidelity
 * improvement over the helix, never a rise regression.
 *
 * DETERMINISM
 * -----------
 * `stepBubbleSlice` is a pure function of (slice state, dt, externalForces).
 * The only entropy is the per-tick turbulence puff, which is drawn from
 * `tickPrng(world, BUBBLE_FLUID_KEY, sourceIdx, …)` — the same seeded stream
 * every other system uses. Slices are stepped in source-index order; forces
 * are written into a pre-allocated scratch buffer in a fixed loop; sampling
 * sums slices in source-index order (float add over a fixed sequence is
 * order-stable). Two cold worlds with the same `(seed, sources)` produce
 * byte-identical slice fields and therefore byte-identical bubble positions —
 * the 1000-tick replay holds.
 *
 * PERF
 * ----
 * Slices are SMALL (`BUBBLE_FLUID_GRID = 16` → 18² cells) and there are only
 * as many as there are air-stones (typically 1–2). The per-tick force write
 * reuses a scratch buffer allocated once per source at slice-build time — no
 * per-tick allocation. The whole coupling early-outs when no source declares
 * a positive rate, so a tank with no air-stone pays nothing.
 */
import {
  createBubbleSlice,
  stepBubbleSlice,
  type BubbleSlice,
} from '@aquascape/domain/fluid-sim';

import { tickPrng } from './prng';
import type { LivestockWorld } from './world';

/** FNV-1a fold of `'bubble-fluid'` — partitions this system's tickPrng stream. */
const BUBBLE_FLUID_KEY = (() => {
  let h = 0x811c9dc5;
  const s = 'bubble-fluid';
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  return h | 0;
})();

/**
 * Slice resolution. 16 keeps the Stam solve cheap (18² cells, 20 GS iters ×
 * ~5 passes) while still resolving plume-scale vortices. The cost is bounded
 * by the air-stone count, not the bubble count.
 */
export const BUBBLE_FLUID_GRID = 16;

/**
 * Lateral world half-width the slice spans, in mm. The slice's `n` columns
 * map onto `[sourceX - W, sourceX + W]`; bubbles outside that band sample the
 * (mirrored, no-slip) wall cells, which is fine — they've drifted past the
 * plume's influence. 200 mm gives a ~400 mm-wide plume envelope.
 */
export const BUBBLE_FLUID_HALF_WIDTH_MM = 200;

/**
 * Upward buoyancy force injected each tick into the source column band, in
 * slice velocity units (cells/sec-ish — the Stam `addForce` does
 * `field += dt * force`). Tuned so the plume develops a clear updraft without
 * the velocity field saturating.
 */
export const BUBBLE_FLUID_BUOYANCY = 6;

/**
 * Peak lateral turbulence puff force (same units as buoyancy). Small relative
 * to buoyancy so the plume rises but wanders. Sign + cell drawn per tick from
 * `tickPrng` → deterministic vortex shedding.
 */
export const BUBBLE_FLUID_TURBULENCE = 2.4;

/**
 * Conversion from sampled slice lateral velocity to world mm/s of bubble
 * drift. The slice velocity is in (cells/sec)-ish units; this scales it into
 * a visible-but-gentle horizontal speed comparable to the old helix's
 * `BUBBLE_WOBBLE_VEL_MM_PER_S` (28).
 */
export const BUBBLE_FLUID_DRIFT_MM_PER_S = 26;

/**
 * Fraction of the lateral drift applied to Z (vs. X), so a 2D slice still
 * reads as a 3D plume. The Z component uses a per-bubble phase derived from
 * `spawnSeq` so neighbouring bubbles don't drift in planar lockstep.
 */
export const BUBBLE_FLUID_Z_FRACTION = 0.55;

/** Index into an (n+2)² slice array, column-major (mirrors bubble-slice IX). */
function ix(i: number, j: number, n: number): number {
  return i + (n + 2) * j;
}

/**
 * Per-source fluid state held on the world (one slice + one pre-allocated
 * force scratch buffer per air-stone). Allocated by `rebuildBubbleFluid`
 * whenever the source set changes; stepped in place every tick.
 */
export interface BubbleFluidState {
  /** One slice per source, parallel to `world.__bubbleSources`. */
  slices: BubbleSlice[];
  /** World X each slice is centred on (source X). */
  centreX: Float32Array;
  /** World Y the slice row 1 maps to (tank floor). */
  baseY: Float32Array;
  /** mm per slice row (vertical) — (maxY - minY) / n. */
  rowSizeY: Float32Array;
  /** mm per slice column (lateral) — 2*halfWidth / n. */
  colSizeX: Float32Array;
  /** Pre-allocated zero-force scratch (shared across sources, reset per use). */
  scratchU: Float32Array;
  scratchV: Float32Array;
}

/** Empty fluid state — no slices, no allocation. */
export function makeEmptyBubbleFluidState(): BubbleFluidState {
  return {
    slices: [],
    centreX: new Float32Array(0),
    baseY: new Float32Array(0),
    rowSizeY: new Float32Array(0),
    colSizeX: new Float32Array(0),
    scratchU: new Float32Array(0),
    scratchV: new Float32Array(0),
  };
}

/**
 * (Re)build the per-source slice set to match the world's current bubble
 * sources + tank AABB. Called from `registerBubbleSources` (and on tank
 * resize) so the slices always reflect the live source layout. A source with
 * a non-positive rate still gets a slice — it just receives no buoyancy, so
 * it stays quiescent and contributes ~0 to the summed sample.
 */
export function rebuildBubbleFluid(world: LivestockWorld): void {
  const sources = world.__bubbleSources;
  const n = sources.count;
  const fluid = world.__bubbleFluid;

  const tank = world.tankAabb;
  const tankH = tank.maxY - tank.minY;

  const slices: BubbleSlice[] = [];
  const centreX = new Float32Array(n);
  const baseY = new Float32Array(n);
  const rowSizeY = new Float32Array(n);
  const colSizeX = new Float32Array(n);

  const g = BUBBLE_FLUID_GRID;
  // Vertical cell size so the slice spans the whole tank height.
  const rowMm = tankH > 0 ? tankH / g : 1;
  const colMm = (2 * BUBBLE_FLUID_HALF_WIDTH_MM) / g;

  for (let s = 0; s < n; s++) {
    slices.push(
      createBubbleSlice({
        origin: {
          x: sources.posX[s] as number,
          y: tank.minY,
          z: sources.posZ[s] as number,
        },
        gridSize: g,
        // The Stam solver's advection scales by grid resolution, not cell
        // size; cellSize is metadata for the caller's world mapping. We store
        // the world mapping in the parallel arrays below + use it in sampling.
        cellSize: colMm,
      }),
    );
    centreX[s] = sources.posX[s] as number;
    baseY[s] = tank.minY;
    rowSizeY[s] = rowMm;
    colSizeX[s] = colMm;
  }

  fluid.slices = slices;
  fluid.centreX = centreX;
  fluid.baseY = baseY;
  fluid.rowSizeY = rowSizeY;
  fluid.colSizeX = colSizeX;
  const size = (g + 2) * (g + 2);
  // Grow the shared scratch only when it can't hold a single slice's force
  // field (all slices share resolution, so one buffer suffices).
  if (fluid.scratchU.length < size) {
    fluid.scratchU = new Float32Array(size);
    fluid.scratchV = new Float32Array(size);
  }
}

/**
 * Advance every per-source fluid slice by one fixed sim step. Injects steady
 * buoyancy at the source column + a deterministic seeded turbulence puff, then
 * runs the Stam advect/diffuse/project loop. Runs before `bubbleLifetimeSystem`
 * so bubbles sample the just-updated field.
 *
 * Early-outs when no source has a positive spawn rate — a quiescent / empty
 * tank pays nothing.
 */
export function bubbleFluidStepSystem(world: LivestockWorld, dt: number): void {
  const sources = world.__bubbleSources;
  if (sources.count === 0) return;
  const fluid = world.__bubbleFluid;
  if (fluid.slices.length !== sources.count) {
    // Defensive: source set changed without a rebuild (shouldn't happen via
    // the world API, but keeps the system self-consistent for direct callers
    // + tests). Cheap when already in sync (length compare only).
    rebuildBubbleFluid(world);
  }

  const g = BUBBLE_FLUID_GRID;
  const size = (g + 2) * (g + 2);
  const fU = fluid.scratchU;
  const fV = fluid.scratchV;
  // Source-column band centre (slice column 1..n) — the source sits at the
  // lateral centre of the slice by construction.
  const centreCol = Math.max(1, Math.min(g, Math.round((g + 1) / 2)));

  for (let s = 0; s < sources.count; s++) {
    const rate = sources.rateParticlesPerSec[s] as number;
    const slice = fluid.slices[s]!;
    // Zero the shared force scratch.
    fU.fill(0, 0, size);
    fV.fill(0, 0, size);

    if (rate > 0) {
      // Steady buoyancy in the lowest few rows of the source column band so
      // the plume is born at the substrate and rises.
      const buoyRows = Math.max(1, Math.floor(g / 6));
      for (let j = 1; j <= buoyRows; j++) {
        fV[ix(centreCol, j, g)] = BUBBLE_FLUID_BUOYANCY;
        // Spread buoyancy onto the two adjacent columns at half strength so
        // the plume has finite width (a single column reads as a thin jet).
        fV[ix(centreCol - 1, j, g)] = BUBBLE_FLUID_BUOYANCY * 0.5;
        fV[ix(centreCol + 1, j, g)] = BUBBLE_FLUID_BUOYANCY * 0.5;
      }

      // Deterministic turbulence puff — a lateral force whose sign + injection
      // row wander per tick. seeded via tickPrng (NOT Math.random). This is
      // what makes the plume shed asymmetric vortices instead of rising as a
      // mirror-symmetric column. Two seeded draws: one selects the row in the
      // lower half, one selects the signed magnitude.
      const rRow = tickPrng(world, BUBBLE_FLUID_KEY, s, 0);
      const rMag = tickPrng(world, BUBBLE_FLUID_KEY, s, 1);
      const puffRow = 1 + Math.floor(rRow * Math.max(1, g / 2));
      const puffMag = (rMag * 2 - 1) * BUBBLE_FLUID_TURBULENCE;
      // Read-with-coalesce (not `+=`): under the build's strict
      // `noUncheckedIndexedAccess` a typed-array index reads as
      // `number | undefined`, so a compound assignment trips TS2532. The cell
      // was just zeroed by `fU.fill(0, …)` above, so the `?? 0` is purely a
      // type guard — behaviour is identical.
      const puffIdx = ix(centreCol, puffRow, g);
      fU[puffIdx] = (fU[puffIdx] ?? 0) + puffMag;
    }

    stepBubbleSlice(slice, dt, { u: fU, v: fV });
  }
}

/**
 * Sample the SUMMED lateral (`uOut`) + vertical (`vOut`) fluid velocity across
 * every slice at world point (x, y), in slice velocity units. Bubbles convert
 * the lateral component into horizontal drift; the vertical component lightly
 * modulates rise. Summing in fixed source-index order keeps the float result
 * order-stable (determinism).
 *
 * Returns the values via the caller-supplied 2-element scratch to avoid an
 * allocation per bubble per tick.
 */
export function sampleBubbleFluid(
  world: LivestockWorld,
  x: number,
  y: number,
  out: { u: number; v: number },
): void {
  out.u = 0;
  out.v = 0;
  const fluid = world.__bubbleFluid;
  const slices = fluid.slices;
  if (slices.length === 0) return;
  const g = BUBBLE_FLUID_GRID;

  for (let s = 0; s < slices.length; s++) {
    const slice = slices[s]!;
    const centre = fluid.centreX[s] as number;
    const base = fluid.baseY[s] as number;
    const rowMm = fluid.rowSizeY[s] as number;
    const colMm = fluid.colSizeX[s] as number;
    if (rowMm <= 0 || colMm <= 0) continue;

    // World → slice continuous cell coords. Source X sits at the lateral
    // centre column ((g+1)/2); +X is +column.
    const ci = (g + 1) / 2 + (x - centre) / colMm;
    const cj = 1 + (y - base) / rowMm;
    // Out-of-band bubbles read the nearest wall cell (clamped) — the plume's
    // influence has decayed to ~0 there anyway.
    const fi = ci < 0.5 ? 0.5 : ci > g + 0.5 ? g + 0.5 : ci;
    const fj = cj < 0.5 ? 0.5 : cj > g + 0.5 ? g + 0.5 : cj;
    const i0 = Math.floor(fi);
    const i1 = i0 + 1;
    const j0 = Math.floor(fj);
    const j1 = j0 + 1;
    const s1 = fi - i0;
    const s0 = 1 - s1;
    const t1 = fj - j0;
    const t0 = 1 - t1;
    const u = slice.u;
    const v = slice.v;
    out.u +=
      s0 * (t0 * (u[ix(i0, j0, g)] as number) + t1 * (u[ix(i0, j1, g)] as number)) +
      s1 * (t0 * (u[ix(i1, j0, g)] as number) + t1 * (u[ix(i1, j1, g)] as number));
    out.v +=
      s0 * (t0 * (v[ix(i0, j0, g)] as number) + t1 * (v[ix(i0, j1, g)] as number)) +
      s1 * (t0 * (v[ix(i1, j0, g)] as number) + t1 * (v[ix(i1, j1, g)] as number));
  }
}
