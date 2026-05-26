import { PerspectiveCamera } from 'three';
import type { Tank } from '@aquascape/domain/scene-model';
import { buildCamera, tankCenter } from './camera';

function tank(width = 600, height = 360, depth = 300): Tank {
  return {
    width,
    height,
    depth,
    style: { frame: 'rimless', background: { kind: 'none' } },
  };
}

describe('camera builder', () => {
  it('produces a PerspectiveCamera framed in front of the tank', () => {
    const cam = buildCamera(tank(600, 360, 300), 16 / 9);
    expect(cam).toBeInstanceOf(PerspectiveCamera);
    // Sits at tank x centre.
    expect(cam.position.x).toBeCloseTo(300, 5);
    // Slightly above vertical centre (INITIAL_HEIGHT_FRACTION = 0.7).
    expect(cam.position.y).toBeCloseTo(360 * 0.7, 5);
    // Pulled back 2.5× depth along +Z.
    expect(cam.position.z).toBeCloseTo(300 * 2.5, 5);
  });

  it('respects supplied aspect ratio', () => {
    const cam = buildCamera(tank(), 2.5);
    expect(cam.aspect).toBeCloseTo(2.5, 5);
  });

  it('falls back to 1.0 aspect when the host supplies a degenerate value', () => {
    const camZero = buildCamera(tank(), 0);
    expect(camZero.aspect).toBe(1);
    const camInf = buildCamera(tank(), Number.NaN);
    expect(camInf.aspect).toBe(1);
    const camNeg = buildCamera(tank(), -3);
    expect(camNeg.aspect).toBe(1);
  });

  it('sets the far plane to 20× tank depth (with a floor for tiny tanks)', () => {
    const cam = buildCamera(tank(600, 360, 300), 1);
    expect(cam.far).toBeCloseTo(300 * 20, 5);
    const tiny = buildCamera(tank(10, 10, 0), 1);
    // Floor of 1mm * 20 = 20.
    expect(tiny.far).toBe(20);
  });

  it('tankCenter returns the geometric centre of the tank', () => {
    const c = tankCenter(tank(600, 360, 300));
    expect(c.x).toBe(300);
    expect(c.y).toBe(180);
    expect(c.z).toBe(150);
  });
});
