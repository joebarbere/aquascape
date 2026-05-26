/**
 * Uniform 3D spatial hash for nearest-neighbour queries.
 *
 * Reserved for F11.2's SchoolingSystem (perception radius ≪ tank), but lands
 * in F11.1 so the data structure + test harness are settled before behaviors
 * arrive. Cell size should be set to `max(ZOR, ZOA)` per the Boids tuning in
 * `docs/research/stage-11-livestock-subsystem.md` §4 — F11.2 will pick a
 * concrete value.
 *
 * Layout:
 *  - `clear()`            — drop all bucket contents (per-tick rebuild).
 *  - `insert(eid, x,y,z)` — add an entity id to the cell containing the point.
 *  - `query(x,y,z, r)`    — return entity ids whose cells lie within `r` of the
 *                            point. Cheap broad-phase; callers do a fine-phase
 *                            distance check.
 *
 * Negative cell indices: world coordinates can be slightly negative (e.g.
 * after a steering integration crosses the front-bottom-left interior corner).
 * We bit-pack with a per-axis bias so the key stays a non-negative 32-bit
 * integer suitable as a Map key.
 */

/** Bias added to each per-axis cell index before bit-packing. Allows the
 * grid to address `±BIAS` cells per axis (≈ ±524 m at a 1 mm cell, which
 * comfortably exceeds any conceivable aquarium dimension). */
const CELL_BIAS = 0x80000; // 2^19

/** Mask for a single axis once biased — 20 bits → 0…(2^20 − 1). */
const AXIS_MASK = 0xfffff;

function cellKey(cx: number, cy: number, cz: number): number {
  // Bias + mask each axis, then bit-pack into a single 32-bit non-negative
  // integer. Three axes × 20 bits ≈ 60 bits → JS can't safely store that in
  // a Number bit-pattern, so we fall back to a string-tagged composite key.
  // Strings as Map keys are well-defined, and the allocation cost is small
  // compared to the per-tick query workload (we're inserting ~N entities,
  // not ~N²).
  const bx = (cx + CELL_BIAS) & AXIS_MASK;
  const by = (cy + CELL_BIAS) & AXIS_MASK;
  const bz = (cz + CELL_BIAS) & AXIS_MASK;
  return bx * 0x100000000 + by * 0x1000 + bz; // packed numeric key
}

export class SpatialGrid {
  private readonly cellSize: number;
  private readonly buckets = new Map<number, number[]>();

  constructor(cellSize: number) {
    if (cellSize <= 0 || !Number.isFinite(cellSize)) {
      throw new Error(`SpatialGrid cellSize must be positive finite, got ${cellSize}`);
    }
    this.cellSize = cellSize;
  }

  /** Drop every bucket. Called once per sim tick before re-inserting. */
  clear(): void {
    this.buckets.clear();
  }

  /** Insert an entity id at world coords `(x, y, z)`. */
  insert(eid: number, x: number, y: number, z: number): void {
    const key = cellKey(
      Math.floor(x / this.cellSize),
      Math.floor(y / this.cellSize),
      Math.floor(z / this.cellSize),
    );
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(eid);
  }

  /**
   * Return entity ids whose containing cell is within `radius` of `(x,y,z)`.
   * Broad-phase only — callers must fine-phase with a distance check; the
   * grid happily returns entities in corner cells beyond the sphere.
   */
  query(x: number, y: number, z: number, radius: number): Uint32Array {
    if (radius < 0 || !Number.isFinite(radius)) {
      throw new Error(`SpatialGrid query radius must be non-negative finite, got ${radius}`);
    }
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const span = Math.ceil(radius / this.cellSize);
    // Estimate output size from the visited cells. We don't know the bucket
    // population in advance, so push to a plain array and copy out at the end.
    const out: number[] = [];
    for (let dz = -span; dz <= span; dz++) {
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          const bucket = this.buckets.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (bucket) {
            // `for...of` over `number[]` narrows to `number` — avoids the
            // `noUncheckedIndexedAccess` widening that `bucket[i]` would hit.
            for (const eid of bucket) out.push(eid);
          }
        }
      }
    }
    return Uint32Array.from(out);
  }

  /** Total entities currently in the grid — useful for assertions in tests. */
  get size(): number {
    let n = 0;
    for (const bucket of this.buckets.values()) n += bucket.length;
    return n;
  }

  /**
   * Read the cell size set at construction. PerceptionSystem reads this
   * to decide whether to swap in a fresh grid when the param store's max
   * neighbour radius has shifted; without it the only alternative is an
   * `as unknown as { cellSize: number }` cast.
   */
  get cellSizeMm(): number {
    return this.cellSize;
  }
}
