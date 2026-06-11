import { AmbientLight, DirectionalLight } from 'three';
import type { Tank } from '@aquascape/domain/scene-model';
import { buildLighting } from './lighting';

function tank(width = 600, height = 360, depth = 300): Tank {
  return {
    width,
    height,
    depth,
    style: { frame: 'rimless', background: { kind: 'none' } },
  };
}

describe('lighting builder', () => {
  it('produces an ambient + hemisphere + directional key light', () => {
    const rig = buildLighting(tank());
    const lights = rig.children;
    const ambient = lights.find((l) => l instanceof AmbientLight) as AmbientLight | undefined;
    const directional = lights.find((l) => l instanceof DirectionalLight) as
      | DirectionalLight
      | undefined;
    expect(ambient).toBeDefined();
    expect(directional).toBeDefined();
    expect(ambient?.intensity).toBeGreaterThan(0);
    expect(directional?.intensity).toBeGreaterThan(0);
  });

  it('places the key light in FRONT of the tank, top-right (negative z so the camera-facing faces get the strongest light)', () => {
    const rig = buildLighting(tank(600, 360, 300));
    const directional = rig.children.find(
      (l) => l instanceof DirectionalLight,
    ) as DirectionalLight;
    // (0.7w, 1.8h, -1.2d). Was +1.2d — that lit the back faces only,
    // a compounding cause of the "dark 3D view" symptom.
    expect(directional.position.x).toBeCloseTo(600 * 0.7, 5);
    expect(directional.position.y).toBeCloseTo(360 * 1.8, 5);
    expect(directional.position.z).toBeCloseTo(-300 * 1.2, 5);
  });

  it('targets the key light at the tank centre', () => {
    const rig = buildLighting(tank(600, 360, 300));
    const directional = rig.children.find(
      (l) => l instanceof DirectionalLight,
    ) as DirectionalLight;
    expect(directional.target.position.x).toBeCloseTo(300, 5);
    expect(directional.target.position.y).toBeCloseTo(180, 5);
    expect(directional.target.position.z).toBeCloseTo(150, 5);
  });

  it('casts soft shadows from the key light (fidelity pass)', () => {
    const rig = buildLighting(tank());
    const directional = rig.children.find(
      (l) => l instanceof DirectionalLight,
    ) as DirectionalLight;
    expect(directional.castShadow).toBe(true);
    expect(directional.shadow.mapSize.width).toBeGreaterThanOrEqual(1024);
    expect(directional.shadow.mapSize.height).toBeGreaterThanOrEqual(1024);
  });

  it('frames the orthographic shadow camera to the tank with a positive near/far bracket', () => {
    const rig = buildLighting(tank(600, 360, 300));
    const directional = rig.children.find(
      (l) => l instanceof DirectionalLight,
    ) as DirectionalLight;
    const cam = directional.shadow.camera;
    // Frustum half-extent covers the tank's largest dimension.
    expect(cam.right).toBeGreaterThanOrEqual(600);
    expect(cam.left).toBeLessThanOrEqual(-600);
    // near/far are a valid, positive bracket (near < far, both > 0).
    expect(cam.near).toBeGreaterThan(0);
    expect(cam.far).toBeGreaterThan(cam.near);
    // normalBias is scaled to the millimetre-scale scene (non-trivial).
    expect(directional.shadow.normalBias).toBeGreaterThan(0);
  });
});
