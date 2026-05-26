/**
 * Lighting rig for the Stage 10 F10.1 Three.js renderer.
 *
 * v1 ships a two-light setup: a soft ambient fill plus a single directional
 * key light positioned at front-top-right. This reads as "tank on a desk
 * under room lighting" — not photorealistic, just legible.
 *
 * EXPLICIT FUTURE WORK (NOT in v1):
 *   - Day/night cycle (animate the directional intensity + colour temp).
 *   - Point lights inside the tank to mimic a real planted LED bar.
 *   - Shadow maps. We deliberately keep `castShadow` off everywhere in v1
 *     because shadow maps are expensive and the visual win is marginal at
 *     typical mid-tier hardware framerates. Re-enable once the renderer
 *     has perf headroom.
 */

import type { Tank } from '@aquascape/domain/scene-model';
import { AmbientLight, DirectionalLight, Group, HemisphereLight, Vector3 } from 'three';

/**
 * Ambient fill — keeps shaded faces readable. v1 deliberately leans
 * bright because we don't have a HemisphereLight or environment map yet,
 * so without strong ambient the underside / back of every mesh would
 * read as a featureless dark blob against the dark clear color.
 */
const AMBIENT_INTENSITY = 0.7;
/** Directional key light intensity. */
const KEY_INTENSITY = 1.0;
/**
 * Soft "sky fill" hemisphere light — bluish from above, warm earthy from
 * below. Cheap and reads a lot more natural than a single directional
 * key against pure ambient, which is what v1 shipped initially.
 */
const HEMI_INTENSITY = 0.4;

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
  key.target.position.copy(new Vector3(tank.width / 2, tank.height / 2, tank.depth / 2));
  // Shadows OFF in v1. See the file header.
  key.castShadow = false;
  group.add(key);
  // Add the target as well so it participates in the scene graph and is
  // disposed cleanly when the group is removed.
  group.add(key.target);

  return group;
}
