// Pure viewport-zoom helpers. Stage 5.x (user-controlled zoom).
//
// `defaultViewport` (already in this directory) computes a fit-to-window
// viewport. The user-zoom layer composes two extra inputs ON TOP of that:
//
//   - `userZoomMult` — a multiplier over fit (1 = "fit-to-window",
//     1.5 = 150 % of fit, 0.5 = 50 % of fit). `null` means "no override".
//   - `userPan`      — a world-mm offset added to the tank's geometric
//     centre. `null` means "no override" (centre on the tank).
//
// Everything here is pure. No DOM, no canvas, no signals — UI consumers
// (`viewport.service.ts` for state, `zoom-control.component.ts` for the
// buttons, `app.component.ts` for the compose step) build on top.
//
// Coordinate model (matches the rest of the shell):
//   - Canvas CSS pixels: `+x` right, `+y` down, origin at top-left.
//   - World mm:          `+x` right, `+y` UP, origin at tank's front-
//     bottom-left interior corner. The renderer flips `y` when drawing.

import type { Viewport } from '@aquascape/rendering/renderer-api';

/**
 * Allowed range for `userZoomMult`. 0.1× = down to a fingernail thumbnail;
 * 10× = enough to see brush-stroke detail on the largest tank. Outside
 * this range zoom feels useless or breaks numeric stability in the
 * cursor-anchored math.
 */
export const ZOOM_MULT_MIN = 0.1;
export const ZOOM_MULT_MAX = 10;

/** Default multiplier per +/- button click. */
export const ZOOM_STEP_MULT = 1.25;

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface CanvasSizeCss {
  readonly width: number;
  readonly height: number;
}

/**
 * Clamp a `userZoomMult` into `[ZOOM_MULT_MIN, ZOOM_MULT_MAX]`. Non-finite
 * inputs (NaN / +Inf / -Inf) collapse to `1` ("fit-to-window") rather than
 * polluting state with garbage.
 */
export function clampZoomMult(mult: number): number {
  if (!Number.isFinite(mult)) return 1;
  if (mult < ZOOM_MULT_MIN) return ZOOM_MULT_MIN;
  if (mult > ZOOM_MULT_MAX) return ZOOM_MULT_MAX;
  return mult;
}

/**
 * Compose a fit-to-window `defaultViewport` with optional user overrides.
 *
 * - When `userZoomMult` is `null`, returns `def` unchanged on the zoom axis.
 * - When `userPan` is `null`, returns `def`'s centre unchanged.
 * - Both non-null: scales the zoom by the multiplier and shifts the
 *   centre by `userPan` (world-mm).
 *
 * The rotation passes through. `defaultViewport`'s degenerate `zoom = 0`
 * case is preserved: composing a multiplier with zero stays zero (the
 * renderer paints nothing rather than crashing on a zero-divide).
 */
export function composeViewport(
  def: Viewport,
  userZoomMult: number | null,
  userPan: Vec2 | null,
): Viewport {
  const zoom = userZoomMult !== null ? def.zoom * clampZoomMult(userZoomMult) : def.zoom;
  const center =
    userPan !== null
      ? { x: def.center.x + userPan.x, y: def.center.y + userPan.y }
      : def.center;
  return { center, zoom, rotation: def.rotation };
}

/**
 * Given the currently-applied viewport (which already reflects user state)
 * and a cursor at CSS coords `cursor`, recover the WORLD-mm point under
 * the cursor.
 *
 * Renderer flips `y` (world `+y` is UP, canvas `+y` is DOWN) and frames
 * the scene so that `viewport.center` lands at the canvas centre at
 * `viewport.zoom` CSS-px / mm. Inverting that:
 *
 *   worldX = (cursorX - canvasW/2) / zoom + centerX
 *   worldY = -((cursorY - canvasH/2) / zoom) + centerY
 *
 * Returns `viewport.center` if `viewport.zoom <= 0` (degenerate — surface
 * not yet sized; safe fallback so callers don't divide by zero).
 */
export function cursorToWorld(
  cursor: Vec2,
  viewport: Viewport,
  canvas: CanvasSizeCss,
): Vec2 {
  if (viewport.zoom <= 0) return viewport.center;
  const dx = cursor.x - canvas.width / 2;
  const dy = cursor.y - canvas.height / 2;
  return {
    x: dx / viewport.zoom + viewport.center.x,
    y: -(dy / viewport.zoom) + viewport.center.y,
  };
}

/**
 * Compute the `userPan` that keeps `anchorWorld` under the cursor after a
 * zoom change, given the new composed zoom and the default fit-to-window
 * centre + zoom.
 *
 * Math: we want the cursor to map back to `anchorWorld` under the new
 * `effectiveZoom`. From `cursorToWorld`'s inverse:
 *
 *   anchorWorld.x = (cursorX - canvasW/2) / effectiveZoom + newCenter.x
 *   anchorWorld.y = -((cursorY - canvasH/2) / effectiveZoom) + newCenter.y
 *
 * Solve for `newCenter`, then `userPan = newCenter - defaultCenter`.
 *
 * Falls back to `(0, 0)` when `effectiveZoom <= 0` (degenerate surface).
 */
export function panForCursorAnchor(
  cursor: Vec2,
  anchorWorld: Vec2,
  canvas: CanvasSizeCss,
  effectiveZoom: number,
  defaultCenter: Vec2,
): Vec2 {
  if (effectiveZoom <= 0) return { x: 0, y: 0 };
  const dx = cursor.x - canvas.width / 2;
  const dy = cursor.y - canvas.height / 2;
  const newCenterX = anchorWorld.x - dx / effectiveZoom;
  const newCenterY = anchorWorld.y + dy / effectiveZoom;
  return { x: newCenterX - defaultCenter.x, y: newCenterY - defaultCenter.y };
}

/**
 * Convert a wheel `deltaY` (mouse/trackpad) into a zoom multiplier delta.
 * Smooth exponential: `factor = e^(-deltaY × WHEEL_SENSITIVITY)`. The
 * sensitivity is tuned so a typical mouse-wheel notch (`deltaY ≈ ±100`)
 * produces a roughly ±10 % zoom change.
 *
 * Returns `1` (no change) for non-finite or zero `deltaY`.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.001;
export function wheelDeltaToZoomFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  return Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);
}

/** Display string for the zoom control, e.g. `"125%"`. */
export function formatZoomPercent(userZoomMult: number | null): string {
  const mult = userZoomMult ?? 1;
  return `${Math.round(mult * 100)}%`;
}
