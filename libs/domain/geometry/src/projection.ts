/**
 * Projection from canonical 3D scene space to the 2D renderer's view.
 *
 * Per `aqua-document.ts` design rule 2, the 2D renderer projects along -z,
 * meaning it discards the depth axis and keeps (x, y). The 3D renderer
 * consumes the same coordinates without projecting.
 */
import type { Vec2, Vec3 } from './types';

/** Drop the z component; returns a new `{x, y}` object. */
export function project2D(v: Vec3): Vec2 {
  return { x: v.x, y: v.y };
}
