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

/**
 * Initial 3/4 camera framing. The camera is offset to the LEFT and
 * ABOVE the tank's geometric centre, then pulled back from the front
 * — that reveals three faces (front, top, left) and the tank reads
 * as 3D immediately. A pure straight-on shot looked nearly identical
 * to the 2D view and didn't sell the mode switch.
 */
const INITIAL_OFFSET_X_FRACTION = -0.4;
const INITIAL_HEIGHT_FRACTION = 1.2;

/**
 * Initial camera distance from the front face as a multiple of tank
 * depth. The camera sits at `z = -tank.depth × multiplier` — NEGATIVE
 * because the document convention puts the viewer in front of the tank
 * (`+z = back` per `aqua-document.ts`), so a real-world "standing in
 * front of the aquarium" view has the camera at negative z looking
 * toward positive z. The old code mistakenly used POSITIVE z which put
 * the camera behind the back wall, peering through both glass panes
 * from the rear — visible only as a dark blur.
 */
const INITIAL_PULL_BACK_DEPTH_MULT = 2.2;

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

  // 3/4 view: offset left + above + pulled back so three faces of the
  // tank (front + left + top) are immediately visible. The lookAt
  // target stays at the tank's geometric centre so the orbit pivots
  // around the scene's middle.
  camera.position.set(
    tank.width / 2 + tank.width * INITIAL_OFFSET_X_FRACTION,
    tank.height * INITIAL_HEIGHT_FRACTION,
    -tank.depth * INITIAL_PULL_BACK_DEPTH_MULT,
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
