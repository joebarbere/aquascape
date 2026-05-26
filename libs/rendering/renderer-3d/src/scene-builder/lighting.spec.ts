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
  it('produces an ambient + directional key light', () => {
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

  it('places the key light front-top-right of the tank', () => {
    const rig = buildLighting(tank(600, 360, 300));
    const directional = rig.children.find(
      (l) => l instanceof DirectionalLight,
    ) as DirectionalLight;
    // (0.7w, 1.8h, 1.2d).
    expect(directional.position.x).toBeCloseTo(600 * 0.7, 5);
    expect(directional.position.y).toBeCloseTo(360 * 1.8, 5);
    expect(directional.position.z).toBeCloseTo(300 * 1.2, 5);
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

  it('leaves shadow casting off in v1', () => {
    const rig = buildLighting(tank());
    const directional = rig.children.find(
      (l) => l instanceof DirectionalLight,
    ) as DirectionalLight;
    expect(directional.castShadow).toBe(false);
  });
});
