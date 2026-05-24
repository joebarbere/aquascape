/**
 * Snap helpers for editor input.
 */
import type { Vec2 } from './types';

/**
 * Snap a 2D point to the nearest grid intersection of size `gridSize`.
 *
 * A `gridSize` of 0 (or negative) is treated as "no snap" — the input is
 * returned unchanged (cloned). This avoids divide-by-zero and lets the UI
 * pass the user's configured grid size through unconditionally.
 */
export function snapToGrid(p: Vec2, gridSize: number): Vec2 {
  if (gridSize <= 0) {
    return { x: p.x, y: p.y };
  }
  return {
    x: Math.round(p.x / gridSize) * gridSize,
    y: Math.round(p.y / gridSize) * gridSize,
  };
}

/**
 * Snap a scalar to the nearest value in `snaps`, but only if it falls
 * within `tolerance`. If no snap is within tolerance, returns `v` unchanged.
 *
 * An empty `snaps` array or `tolerance <= 0` always returns `v` unchanged.
 */
export function snapToValue(v: number, snaps: ReadonlyArray<number>, tolerance: number): number {
  if (snaps.length === 0 || tolerance <= 0) return v;
  let best = v;
  let bestDist = tolerance; // strict-less-than below; allow equality at tolerance
  for (let i = 0; i < snaps.length; i++) {
    const s = snaps[i] as number;
    const d = Math.abs(v - s);
    if (d <= bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}
