/**
 * Lighting rig for the Stage 10 F10.1 Three.js renderer.
 *
 * Ships a three-light setup: a soft ambient fill, a sky/ground hemisphere
 * fill, and a single directional key light positioned at front-top-right.
 * As of the Stage 11 fidelity pass the key light also CASTS SOFT SHADOWS
 * and the scene carries an image-based-lighting environment (set on the
 * renderer side — see `three-3d-renderer.ts`), so the ambient + hemisphere
 * fills are pulled back from their original "lean bright because we have no
 * environment" levels: an over-bright ambient flattens the very shadows we
 * now cast.
 *
 * Shadows (fidelity pass)
 * -----------------------
 * The key light casts into a single `PCFSoftShadowMap` (configured on the
 * renderer). Its shadow camera is an orthographic frustum framed to the
 * tank AABB with a generous pad, near/far bracketed to the light→tank
 * distance. `normalBias` is scaled to the tank's millimetre dimensions to
 * defeat shadow acne on the steeply-angled extruded substrate / hardscape
 * faces without introducing visible peter-panning.
 *
 * EXPLICIT FUTURE WORK (NOT yet):
 *   - Point lights inside the tank to mimic a real planted LED bar.
 *   - A coloured (warm/cool) sun on the day-night ramp — today the cycle's
 *     temperature shift rides on the ambient channel alone.
 */

import type { Tank } from '@aquascape/domain/scene-model';
import { AmbientLight, DirectionalLight, Group, HemisphereLight, Vector3 } from 'three';

/**
 * Ambient fill — keeps shaded faces readable. Pulled back from the original
 * 0.7 now that the scene carries an IBL environment + casts shadows: strong
 * uniform ambient washes out the directional key's shading and flattens the
 * shadows. 0.45 keeps back / underside faces legible without erasing depth.
 */
const AMBIENT_INTENSITY = 0.45;
/** Directional key light intensity. */
const KEY_INTENSITY = 1.0;
/**
 * Soft "sky fill" hemisphere light — bluish from above, warm earthy from
 * below. Pulled back from 0.4 for the same reason as ambient: the IBL
 * environment now supplies most of the soft directional fill.
 */
const HEMI_INTENSITY = 0.3;

/** Shadow map resolution (square). 2048 reads crisp on a single key light. */
const SHADOW_MAP_SIZE = 2048;
/**
 * Constant depth bias. Small negative value nudges the comparison toward
 * the light to kill the last of the surface-acne shimmer the `normalBias`
 * doesn't catch on near-grazing faces.
 */
const SHADOW_BIAS = -0.0005;
/**
 * `normalBias` as a fraction of the tank's largest dimension. The scene is
 * in millimetres (tanks are hundreds of mm), so a unit-scale normalBias
 * would be invisibly small; scaling to the tank defeats acne on the
 * extruded slabs. ~0.2 % of the max dimension ≈ 1.2 mm on a 600 mm tank.
 */
const SHADOW_NORMAL_BIAS_FRAC = 0.002;

/**
 * Build the v1 lighting group. The group contains an ambient + one
 * directional light positioned relative to the tank dimensions. Adding the
 * group to `THREE.Scene` is the renderer's job.
 */
export function buildLighting(tank: Tank): Group {
  const group = new Group();
  group.name = 'aquascape:lighting';

  const ambient = new AmbientLight(0xffffff, AMBIENT_INTENSITY);
  ambient.name = 'aquascape:lighting/ambient';
  group.add(ambient);

  // Sky/ground hemisphere — adds soft directional fill (cool from above,
  // warm earthy from below) without the cost of a real environment map.
  const hemi = new HemisphereLight(0xcfe6ff, 0x6b5a44, HEMI_INTENSITY);
  hemi.name = 'aquascape:lighting/hemisphere';
  group.add(hemi);

  const key = new DirectionalLight(0xffffff, KEY_INTENSITY);
  key.name = 'aquascape:lighting/key';
  // Position relative to the tank — front-top-right of the box. Negative
  // z places the light in FRONT of the front glass (where the viewer
  // stands) so the visible-to-the-camera faces get the strongest
  // illumination. The old positive-z position lit the BACK faces only —
  // a compounding cause of the "dark 3D view" symptom.
  key.position.set(tank.width * 0.7, tank.height * 1.8, -tank.depth * 1.2);
  // Target the tank centre. DirectionalLight.target is a Object3D that
  // Three.js consults each frame — we set its position and DO NOT add it
  // to the scene here (Three.js handles parented targets transparently
  // when only the position matters). Disposing the group disposes the
  // target along with it.
  const center = new Vector3(tank.width / 2, tank.height / 2, tank.depth / 2);
  key.target.position.copy(center);

  // Soft shadows (fidelity pass). Frame the orthographic shadow camera to
  // the tank AABB with a pad so steep extruded faces near the rim don't
  // clip out of the shadow frustum. near/far bracket the light→tank
  // distance tightly for depth precision.
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const maxDim = Math.max(tank.width, tank.height, tank.depth);
  const span = maxDim; // half-extent of the ortho frustum (pads the tank)
  const lightDist = key.position.distanceTo(center);
  const shadowCam = key.shadow.camera;
  shadowCam.left = -span;
  shadowCam.right = span;
  shadowCam.top = span;
  shadowCam.bottom = -span;
  shadowCam.near = Math.max(1, lightDist - maxDim * 1.5);
  shadowCam.far = lightDist + maxDim * 1.5;
  shadowCam.updateProjectionMatrix();
  key.shadow.bias = SHADOW_BIAS;
  key.shadow.normalBias = maxDim * SHADOW_NORMAL_BIAS_FRAC;
  group.add(key);
  // Add the target as well so it participates in the scene graph and is
  // disposed cleanly when the group is removed.
  group.add(key.target);

  return group;
}
