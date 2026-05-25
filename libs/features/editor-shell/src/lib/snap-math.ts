// Pure snap math for Stage 5 F5.4 + the F5.3 alignment-guide leftover.
//
// Three concerns:
//   1. Generate snap *targets* (lists of world-mm x / y coordinates) from
//      the scene + the snap-options the user toggled.
//   2. Apply a snap to a position with a tolerance, returning the snapped
//      position AND which target was hit (so the renderer can paint an
//      alignment guide at that line).
//   3. Compose multiple snap sources into one final snap.
//
// No DOM, no canvas, no signals — UI consumers (`snap-options.service`,
// the drag math in `apps/web/src/app/app.component.ts`) build on top.
//
// Coordinate model: world millimetres, +x right, +y up, origin at the
// tank's front-bottom-left interior corner. Identical to everything else
// in the scene / renderer.

import {
  focalPoints,
  goldenRatioLines,
  thirdsLines,
} from '@aquascape/domain/geometry';
import type { Vec2 } from '@aquascape/domain/geometry';
import type { ObjectId, Scene, SceneObject } from '@aquascape/domain/scene-model';

/** Default grid spacing in mm — matches the renderer's `GRID_MINOR_MM`. */
export const DEFAULT_GRID_SIZE_MM = 10;
/** Allowed range for the grid size input (mm). */
export const MIN_GRID_SIZE_MM = 1;
export const MAX_GRID_SIZE_MM = 100;

/** Default snap tolerance in CSS pixels. */
export const DEFAULT_TOLERANCE_CSS_PX = 8;
export const MIN_TOLERANCE_CSS_PX = 1;
export const MAX_TOLERANCE_CSS_PX = 40;

/**
 * Snap targets along each axis, in world-mm. `xs` are vertical lines the
 * dragged point's x-coordinate may snap to; `ys` are horizontal lines for
 * the y-coordinate.
 */
export interface SnapTargets {
  readonly xs: ReadonlyArray<number>;
  readonly ys: ReadonlyArray<number>;
}

/** Single-axis snap result. `target` is `null` when no snap engaged. */
export interface AxisSnap {
  readonly value: number;
  readonly target: number | null;
}

/** Two-axis snap result. Both axes are independent. */
export interface SnapResult {
  readonly position: Vec2;
  readonly snappedX: number | null;
  readonly snappedY: number | null;
}

// ─── Target generation ────────────────────────────────────────────────────

/**
 * Grid snap targets within the tank's front face. We only generate targets
 * inside the tank rect so an object dragged far outside the tank still
 * snaps to grid lines the user can see, but we don't synthesise infinite
 * arrays of off-tank targets.
 *
 * `gridSizeMm <= 0` → empty set (caller has effectively disabled grid).
 */
export function gridTargets(
  tankWidthMm: number,
  tankHeightMm: number,
  gridSizeMm: number,
): SnapTargets {
  if (gridSizeMm <= 0 || tankWidthMm <= 0 || tankHeightMm <= 0) {
    return { xs: [], ys: [] };
  }
  const xs: number[] = [];
  for (let x = 0; x <= tankWidthMm + 1e-9; x += gridSizeMm) {
    xs.push(Math.min(x, tankWidthMm));
  }
  // Always include the right / top tank edge as a snap target — lets the
  // user land an object cleanly on the wall when the grid spacing doesn't
  // divide the tank size evenly.
  if (xs[xs.length - 1] !== tankWidthMm) xs.push(tankWidthMm);
  const ys: number[] = [];
  for (let y = 0; y <= tankHeightMm + 1e-9; y += gridSizeMm) {
    ys.push(Math.min(y, tankHeightMm));
  }
  if (ys[ys.length - 1] !== tankHeightMm) ys.push(tankHeightMm);
  return { xs, ys };
}

/**
 * Composition-guide snap targets: golden-ratio lines (vertical + horizontal)
 * + rule-of-thirds lines + the four golden-ratio focal-point intersections.
 *
 * Independent of whether the corresponding overlays are CURRENTLY VISIBLE.
 * Users frequently want to snap to a focal point even without the overlay
 * painted — the discoverability story is the snap-settings panel listing
 * what's available, not the overlay state.
 */
export function guideTargets(tankWidthMm: number, tankHeightMm: number): SnapTargets {
  if (tankWidthMm <= 0 || tankHeightMm <= 0) {
    return { xs: [], ys: [] };
  }
  const golden = goldenRatioLines(tankWidthMm, tankHeightMm);
  const thirds = thirdsLines(tankWidthMm, tankHeightMm);
  const focals = focalPoints(tankWidthMm, tankHeightMm);
  // De-dupe via sets so adjacent golden / focal x's don't double-count.
  const xSet = new Set<number>([
    ...golden.vertical,
    ...thirds.vertical,
    ...focals.map((p) => p.x),
  ]);
  const ySet = new Set<number>([
    ...golden.horizontal,
    ...thirds.horizontal,
    ...focals.map((p) => p.y),
  ]);
  return {
    xs: [...xSet].sort((a, b) => a - b),
    ys: [...ySet].sort((a, b) => a - b),
  };
}

/**
 * Object snap targets: every OTHER object's `transform.position` (centre
 * point). v1 snaps to centres only; edge / bounding-box snap can be added
 * later without changing this signature (returning more xs / ys).
 *
 * `excludeId` (the dragged object) is filtered out so an object doesn't
 * snap to itself.
 */
export function objectTargets(scene: Scene, excludeId: ObjectId | null): SnapTargets {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    for (const obj of layer.objects) {
      if (excludeId !== null && obj.id === excludeId) continue;
      const pos = (obj as SceneObject).transform.position;
      xs.push(pos.x);
      ys.push(pos.y);
    }
  }
  return { xs, ys };
}

/**
 * Merge multiple `SnapTargets` into one. De-dupes via a numeric-keyed set
 * so the alignment-guide painter never renders two lines at the same
 * coordinate.
 */
export function mergeTargets(...groups: ReadonlyArray<SnapTargets>): SnapTargets {
  const xSet = new Set<number>();
  const ySet = new Set<number>();
  for (const g of groups) {
    for (const x of g.xs) xSet.add(x);
    for (const y of g.ys) ySet.add(y);
  }
  return {
    xs: [...xSet].sort((a, b) => a - b),
    ys: [...ySet].sort((a, b) => a - b),
  };
}

// ─── Apply ─────────────────────────────────────────────────────────────────

/**
 * Snap a single axis value to the nearest target within `toleranceMm`.
 * Returns the snapped value + the target that was hit (or `null`). When
 * no target is within tolerance, `value` is returned unchanged and
 * `target` is `null`.
 *
 * Ties (two targets at the same absolute distance) go to the earlier one
 * in the array — deterministic for tests.
 */
export function snapAxis(
  v: number,
  targets: ReadonlyArray<number>,
  toleranceMm: number,
): AxisSnap {
  if (toleranceMm <= 0 || targets.length === 0 || !Number.isFinite(v)) {
    return { value: v, target: null };
  }
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const t of targets) {
    const d = Math.abs(v - t);
    if (d <= toleranceMm && d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best === null ? { value: v, target: null } : { value: best, target: best };
}

/**
 * Snap a 2D position to the nearest x + y targets within `toleranceMm`.
 * Each axis is snapped independently — so the result can snap on x only,
 * y only, both, or neither.
 */
export function snapPosition(
  pos: Vec2,
  targets: SnapTargets,
  toleranceMm: number,
): SnapResult {
  const x = snapAxis(pos.x, targets.xs, toleranceMm);
  const y = snapAxis(pos.y, targets.ys, toleranceMm);
  return {
    position: { x: x.value, y: y.value },
    snappedX: x.target,
    snappedY: y.target,
  };
}

/**
 * Convert a tolerance in CSS pixels to world millimetres given the current
 * viewport zoom (CSS-px per world-mm). Avoids divide-by-zero and infinite
 * tolerance at zoom=0 (degenerate surface — returns 0 so no snap engages).
 */
export function toleranceCssPxToMm(toleranceCssPx: number, zoomPxPerMm: number): number {
  if (zoomPxPerMm <= 0 || !Number.isFinite(zoomPxPerMm)) return 0;
  if (toleranceCssPx <= 0 || !Number.isFinite(toleranceCssPx)) return 0;
  return toleranceCssPx / zoomPxPerMm;
}
