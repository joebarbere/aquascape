/**
 * Canvas → tank raycast — Stage 15 F15.1 (the food-drop point) + F15.2
 * (the siphon nozzle placement). Reused by Stage 16 F16.5 (cleaner mode).
 *
 * THIS IS A SEPARATE INTERACTION SURFACE FROM `hitTest`.
 * --------------------------------------------------------
 * `SceneRenderer.hitTest` is EDITOR hit-testing (selection / drag / inspector)
 * and stays `null` in 3D by design — editing happens in 2D. This module is a
 * deliberate **simulation-interaction** raycast: given a canvas pixel + the
 * live camera it returns the canonical `.aqua` tank coordinate where the ray
 * meets the substrate floor (or the water-surface plane), so the host can
 * place a food drop or a siphon nozzle. It does NOT pick scene objects; it
 * intersects a single horizontal plane and clamps to the tank footprint.
 *
 * PURE-ISH MATH — NO GL CONTEXT REQUIRED.
 * ---------------------------------------
 * The renderer hands us the active `PerspectiveCamera` (orbit or fish-eye) and
 * the CSS-pixel canvas size; everything here is camera unprojection + a
 * ray/plane intersection + an AABB clamp. No WebGL, no render target — so it is
 * unit-testable with a plain Three.js camera (no real renderer) and runs on the
 * headless test-stub path unchanged.
 *
 * THE DOC ↔ WORLD X-MIRROR.
 * -------------------------
 * The renderer wraps its content + lighting groups in `applyDocToWorldMirror`
 * (`scale.x = -1, position.x = tank.width`) so doc `+X` (right side of tank)
 * lands on screen-right. The CAMERA lives OUTSIDE those mirrored groups (in
 * raw world space), so a world-space ray intersection gives a WORLD point that
 * is still X-mirrored relative to the document. We undo the mirror on the way
 * out: `docX = tank.width − worldX`. Z is NOT mirrored (`docZ = worldZ`), and
 * Y is the plane height we chose (floor or water level), which is unmirrored.
 * This yields a coordinate in the SAME canonical space `spawnFood` / scene
 * objects use (origin front-bottom-left, +x right, +y up, +z back).
 */

import type { Vec3 } from '@aquascape/domain/geometry';
import { Plane, Raycaster, Vector2, Vector3, type Camera } from 'three';

/** Which horizontal plane the ray intersects. */
export type RaycastPlane = 'floor' | 'water';

/**
 * The tank footprint + the two candidate plane heights the raycast needs.
 * Kept as plain numbers (no `Scene` dependency) so the math stays trivially
 * testable and the renderer can pass whatever it already computed
 * (`effectiveWaterLevelMm`, the floor at y = 0).
 */
export interface RaycastTankGeometry {
  /** Interior width (mm) — also the X-mirror pivot (`docX = width − worldX`). */
  readonly width: number;
  /** Interior depth (mm) — the Z extent `[0, depth]`. */
  readonly depth: number;
  /**
   * Floor-plane height (mm). Canonical floor is `y = 0`; passing the
   * substrate top here would rest a drop ON the substrate instead, but v1
   * uses the interior floor so the drop sinks naturally.
   */
  readonly floorY: number;
  /** Water-surface plane height (mm) — `effectiveWaterLevelMm(tank)`. */
  readonly waterY: number;
}

/** A CSS-pixel point on the canvas, plus the canvas's CSS size. */
export interface CanvasPoint {
  /** Pointer X in CSS pixels, measured from the canvas's left edge. */
  readonly x: number;
  /** Pointer Y in CSS pixels, measured from the canvas's top edge. */
  readonly y: number;
  /** Canvas logical (CSS) width in pixels. */
  readonly width: number;
  /** Canvas logical (CSS) height in pixels. */
  readonly height: number;
}

/**
 * Convert a canvas CSS pixel to Normalised Device Coordinates ([-1, 1] on
 * both axes, +Y up). Returns `null` when the canvas has a zero dimension
 * (un-sized surface) so callers can bail rather than divide by zero.
 *
 * Exported for direct unit testing of the projection step.
 */
export function canvasPointToNdc(point: CanvasPoint): Vector2 | null {
  if (point.width <= 0 || point.height <= 0) return null;
  const ndcX = (point.x / point.width) * 2 - 1;
  // Canvas Y grows downward; NDC Y grows upward — flip.
  const ndcY = -((point.y / point.height) * 2 - 1);
  return new Vector2(ndcX, ndcY);
}

/**
 * Cast a ray from `camera` through the canvas pixel `point` and intersect it
 * with the requested horizontal plane, returning the **canonical document
 * coordinate** (mm, origin front-bottom-left) of the hit — or `null` when:
 *
 *  - the canvas is un-sized (zero width/height),
 *  - the ray is parallel to / points away from the plane (no intersection),
 *  - the hit lands OUTSIDE the tank footprint AND `clamp` is `false`.
 *
 * When `clamp` is `true` (the default) an out-of-footprint hit is CLAMPED to
 * the nearest interior XZ instead of rejected, so a drag that wanders past the
 * glass still yields a usable in-tank point (the food-drop / siphon UX wants
 * "stick to the wall", not "lose the cursor"). A ray that never meets the
 * plane at all still returns `null` even with `clamp` — there's nothing to
 * clamp.
 *
 * `camera` is the renderer's LIVE active camera (orbit or fish-eye); its world
 * matrices must be current (the renderer calls `updateMatrixWorld` before this
 * via its RAF tick / `paint`). The X-mirror is applied to the OUTPUT only —
 * see the module header.
 */
export function raycastTankPlane(
  camera: Camera,
  point: CanvasPoint,
  tank: RaycastTankGeometry,
  options: { plane?: RaycastPlane; clamp?: boolean } = {},
): Vec3 | null {
  const ndc = canvasPointToNdc(point);
  if (ndc === null) return null;

  const planeY = (options.plane ?? 'floor') === 'water' ? tank.waterY : tank.floorY;
  const clamp = options.clamp ?? true;

  const raycaster = new Raycaster();
  raycaster.setFromCamera(ndc, camera);

  // Horizontal plane y = planeY → THREE.Plane normal (0,1,0), constant = -planeY
  // (plane equation: normal·p + constant = 0 ⇒ y − planeY = 0).
  const plane = new Plane(new Vector3(0, 1, 0), -planeY);
  const hit = new Vector3();
  if (raycaster.ray.intersectPlane(plane, hit) === null) {
    // Ray parallel to the plane or pointing away from it — no intersection.
    return null;
  }

  // Undo the doc→world X-mirror: the camera sits in raw world space, but the
  // tank content is mirrored about its X-midplane, so the world X we just
  // computed is the MIRROR of the document X. Z + Y are unmirrored.
  let docX = tank.width - hit.x;
  let docZ = hit.z;
  const docY = planeY;

  const inFootprint = docX >= 0 && docX <= tank.width && docZ >= 0 && docZ <= tank.depth;
  if (!inFootprint) {
    if (!clamp) return null;
    docX = clampToRange(docX, 0, tank.width);
    docZ = clampToRange(docZ, 0, tank.depth);
  }

  return { x: docX, y: docY, z: docZ };
}

function clampToRange(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
