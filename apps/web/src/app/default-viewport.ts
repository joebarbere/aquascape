// Default viewport computation for the web shell. Stage 0 / F0.6.
//
// Pure function: given a canvas size (CSS px) and a tank size (mm projected
// via `project2D` — width × height for the 2D renderer), return a `Viewport`
// that centers the tank with ~10% padding on the smaller axis.

import type { Viewport } from '@aquascape/rendering/renderer-api';

/** Padding factor applied to both axes when fitting the tank. */
export const VIEWPORT_PADDING_FACTOR = 1.1;

export interface CanvasSizeCss {
  width: number;
  height: number;
}

export interface TankSize2D {
  width: number;
  height: number;
}

/**
 * Compute a `Viewport` that fits `tank` inside `canvas` with
 * `VIEWPORT_PADDING_FACTOR` worth of breathing room. Centered at the tank's
 * geometric centre. Rotation is always 0 in Stage 0.
 *
 * `canvas.width` / `canvas.height` are in **CSS pixels** (not device pixels —
 * the renderer multiplies by DPR internally). Zoom is **CSS pixels per mm**.
 *
 * Degenerate inputs (zero or negative dimensions on either axis) return a
 * defensive `zoom = 0` rather than `Infinity` / `NaN`. The renderer will
 * draw nothing in that case; the host can resize and re-render once layout
 * settles.
 */
export function defaultViewport(canvas: CanvasSizeCss, tank: TankSize2D): Viewport {
  const center = { x: tank.width / 2, y: tank.height / 2 };

  if (canvas.width <= 0 || canvas.height <= 0 || tank.width <= 0 || tank.height <= 0) {
    return { center, zoom: 0, rotation: 0 };
  }

  const zoomX = canvas.width / (tank.width * VIEWPORT_PADDING_FACTOR);
  const zoomY = canvas.height / (tank.height * VIEWPORT_PADDING_FACTOR);
  const zoom = Math.min(zoomX, zoomY);

  return { center, zoom, rotation: 0 };
}
