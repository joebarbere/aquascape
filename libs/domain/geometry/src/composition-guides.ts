/**
 * Composition guides used by Stage 5 (precision overlays): golden-ratio
 * and rule-of-thirds line positions, plus the four classic golden-ratio
 * focal-point intersections.
 *
 * All coordinates are returned in the same units as the input `width` /
 * `height` (mm in scene space, but the math is unit-agnostic). The origin
 * is the box's `(0, 0)` corner; callers translate to scene coordinates as
 * needed.
 */
import { PHI } from './constants';
import type { Vec2 } from './types';

/**
 * Golden-ratio guide lines for a box of `width` × `height`.
 *
 * Vertical lines are at `width/φ` and `width - width/φ`. The latter equals
 * `width * (φ - 1) / φ = width / φ²` ≈ `0.382 * width`. Horizontal lines
 * mirror.
 *
 * Returned arrays are ordered ascending (smaller coordinate first).
 */
export function goldenRatioLines(
  width: number,
  height: number,
): { vertical: number[]; horizontal: number[] } {
  const vx1 = width / PHI; // ≈ 0.618 * width
  const vx2 = width - vx1; // ≈ 0.382 * width
  const hy1 = height / PHI;
  const hy2 = height - hy1;
  return {
    vertical: [Math.min(vx1, vx2), Math.max(vx1, vx2)],
    horizontal: [Math.min(hy1, hy2), Math.max(hy1, hy2)],
  };
}

/**
 * Rule-of-thirds guide lines for a box of `width` × `height`.
 *
 * Returned arrays are ordered ascending.
 */
export function thirdsLines(
  width: number,
  height: number,
): { vertical: number[]; horizontal: number[] } {
  return {
    vertical: [width / 3, (2 * width) / 3],
    horizontal: [height / 3, (2 * height) / 3],
  };
}

/**
 * Four classic golden-ratio focal points — the intersections of the two
 * vertical and two horizontal golden-ratio lines.
 *
 * Order: top-left, top-right, bottom-left, bottom-right (where "top" is
 * smaller y under the canonical +y-up convention; callers using a flipped
 * pixel convention can reorder).
 */
export function focalPoints(width: number, height: number): Vec2[] {
  const { vertical, horizontal } = goldenRatioLines(width, height);
  // vertical = [vSmall, vLarge]; horizontal = [hSmall, hLarge]
  const vSmall = vertical[0] as number;
  const vLarge = vertical[1] as number;
  const hSmall = horizontal[0] as number;
  const hLarge = horizontal[1] as number;
  return [
    { x: vSmall, y: hSmall },
    { x: vLarge, y: hSmall },
    { x: vSmall, y: hLarge },
    { x: vLarge, y: hLarge },
  ];
}
