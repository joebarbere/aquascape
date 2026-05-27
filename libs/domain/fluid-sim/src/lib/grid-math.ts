/**
 * Small helpers shared by all three bakes (FlowField, BubbleSlice, Sdf).
 *
 * These are deliberately inlined / tiny so the bakes remain self-contained
 * and free of cross-file allocation overhead in hot paths.
 */

/** Clamp a value to `[lo, hi]`. */
export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Linear index into a 3D `gx*gy*gz` array. Same layout as the spec's `i = x + gx*(y + gy*z)`. */
export function idx3(x: number, y: number, z: number, gx: number, gy: number): number {
  return x + gx * (y + gy * z);
}
