/**
 * Camera factory for the Stage 10 F10.1 Three.js renderer.
 *
 * The `Viewport` argument the caller passes to `SceneRenderer.render(scene,
 * viewport, options)` is a 2D framing concept (CSS-px-per-mm + a world-mm
 * centre + a rotation in radians). It is NOT applicable to a perspective
 * 3D camera, so the 3D renderer DELIBERATELY IGNORES it. The camera state
 * of truth in 3D is the OrbitControls binding installed in the renderer,
 * not the 2D viewport.
 *
 * The initial framing here is "front-of-tank, slightly elevated, pulled
 * back 2.5× depth" — a good default for the user's first glance at any
 * tank. OrbitControls then lets the user rotate / pan / dolly from there.
 */

import type { Tank } from '@aquascape/domain/scene-model';
import { PerspectiveCamera, Vector3 } from 'three';

/** Field of view, in degrees. 50° reads natural at typical viewing distances. */
const FOV_DEGREES = 50;

/** Initial camera elevation as a fraction of tank height. */
const INITIAL_HEIGHT_FRACTION = 0.7;

/** Initial camera distance from front face as a multiple of tank depth. */
const INITIAL_PULL_BACK_DEPTH_MULT = 2.5;

/** Near plane in world mm. 10 mm avoids clipping the front glass at typical zooms. */
const NEAR_PLANE_MM = 10;

/** Far plane as a multiple of tank depth. 20× covers any reasonable orbit distance. */
const FAR_PLANE_DEPTH_MULT = 20;

/**
 * Build the perspective camera framed to view the tank from the front,
 * slightly elevated. Targets the tank's geometric centre — `OrbitControls`
 * uses the same target so the orbit feels stable.
 *
 * `aspect` is the renderer's canvas aspect ratio (`width / height`). It's
 * a runtime input from the host's render surface, NOT derived from the
 * tank.
 */
export function buildCamera(tank: Tank, aspect: number): PerspectiveCamera {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const far = Math.max(tank.depth, 1) * FAR_PLANE_DEPTH_MULT;
  const camera = new PerspectiveCamera(FOV_DEGREES, safeAspect, NEAR_PLANE_MM, far);

  // Tank-centred view from the front-bottom-left-corner origin.
  camera.position.set(
    tank.width / 2,
    tank.height * INITIAL_HEIGHT_FRACTION,
    tank.depth * INITIAL_PULL_BACK_DEPTH_MULT,
  );
  camera.lookAt(new Vector3(tank.width / 2, tank.height / 2, tank.depth / 2));
  return camera;
}

/**
 * The world-mm centre point the camera should orbit around. Used by
 * OrbitControls' `target` field and exposed here so the renderer doesn't
 * compute it in two places.
 */
export function tankCenter(tank: Tank): Vector3 {
  return new Vector3(tank.width / 2, tank.height / 2, tank.depth / 2);
}
