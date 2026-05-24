/**
 * Pure transform-math helpers for the F3.3 follow-up: turning a pointer
 * drag into a new `Transform`. Extracted from `AppComponent` so the math
 * is unit-testable without booting Angular.
 *
 * SCALE MODEL (load-bearing) — v1 uses a **uniform, centre-anchored**
 * scale: dragging any corner handle scales the object by the ratio
 * `(cursor distance from object centre) / (drag start distance from
 * object centre)`. The object stays anchored at its position; the
 * opposite-corner-stays-fixed model standard design tools use is a
 * future improvement. Pros: trivial math, no rotation interaction
 * bugs, intuitive for a single hardscape piece. Cons: per-axis scaling
 * and asymmetric corner anchors are out of reach until v2.
 *
 * ROTATE MODEL — `rotation.z` = atan2(cursor - centre) - atan2(start -
 * centre) + original rotation. The rotate handle's painted position is
 * irrelevant to the math; only the cursor's angle relative to the
 * object centre matters.
 *
 * All helpers are **pure**: same inputs → same outputs, no globals.
 */

import type { Transform } from '@aquascape/domain/geometry';

/** A 2D point (mm) — local to this module so we don't pull in a heavier dep. */
interface Vec2 {
  readonly x: number;
  readonly y: number;
}

// ─── Move ────────────────────────────────────────────────────────────────

/**
 * Translate the original transform by `deltaWorld`. Z is preserved.
 * Zero delta returns a transform that's structurally equal to the input.
 */
export function applyMoveDrag(original: Transform, deltaWorld: Vec2): Transform {
  return {
    ...original,
    position: {
      x: original.position.x + deltaWorld.x,
      y: original.position.y + deltaWorld.y,
      z: original.position.z,
    },
  };
}

// ─── Scale ───────────────────────────────────────────────────────────────

/**
 * Uniform centre-anchored scale. Computes the cursor's distance from the
 * object centre divided by the start point's distance from the centre,
 * multiplies the original scale by that ratio. Z scale is preserved.
 *
 * Degenerate fall-throughs (all kept stable, never NaN / Infinity):
 *  - `startWorld === objectCenter` (zero start distance) → returns the
 *    original transform unchanged. The user grabbed a handle that's at
 *    the object centre; there's no meaningful ratio.
 *  - Ratio < `MIN_SCALE_RATIO` → clamped. Prevents the object from
 *    collapsing to invisible bounds the user can't recover.
 */
export function applyScaleDrag(args: {
  original: Transform;
  cursorWorld: Vec2;
  startWorld: Vec2;
}): Transform {
  const { original, cursorWorld, startWorld } = args;
  const cx = original.position.x;
  const cy = original.position.y;
  const startDistance = distance({ x: startWorld.x - cx, y: startWorld.y - cy });
  if (startDistance < EPSILON) return original;
  const cursorDistance = distance({ x: cursorWorld.x - cx, y: cursorWorld.y - cy });
  const ratio = Math.max(MIN_SCALE_RATIO, cursorDistance / startDistance);
  return {
    ...original,
    scale: {
      x: original.scale.x * ratio,
      y: original.scale.y * ratio,
      z: original.scale.z,
    },
  };
}

// ─── Rotate ──────────────────────────────────────────────────────────────

/**
 * Rotate the object by the angle the cursor has swept relative to the
 * object centre. `rotation.x` and `rotation.y` are preserved; only `z`
 * changes (the 2D renderer reads only `rotation.z` anyway).
 *
 * Degenerate fall-through: `startWorld === objectCenter` → original
 * transform unchanged (atan2 is undefined for a zero vector).
 */
export function applyRotateDrag(args: {
  original: Transform;
  cursorWorld: Vec2;
  startWorld: Vec2;
}): Transform {
  const { original, cursorWorld, startWorld } = args;
  const cx = original.position.x;
  const cy = original.position.y;
  const sdx = startWorld.x - cx;
  const sdy = startWorld.y - cy;
  if (sdx === 0 && sdy === 0) return original;
  const startAngle = Math.atan2(sdy, sdx);
  const cursorAngle = Math.atan2(cursorWorld.y - cy, cursorWorld.x - cx);
  const deltaAngle = cursorAngle - startAngle;
  return {
    ...original,
    rotation: {
      x: original.rotation.x,
      y: original.rotation.y,
      z: original.rotation.z + deltaAngle,
    },
  };
}

// ─── Constants ───────────────────────────────────────────────────────────

const EPSILON = 1e-9;
/** Floor on the scale ratio so a user can't collapse the bbox to zero. */
const MIN_SCALE_RATIO = 0.01;

// ─── Internal ────────────────────────────────────────────────────────────

function distance(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}
