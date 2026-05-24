// Unit tests for the default scene factory. Stage 0 F0.6.

import {
  DEFAULT_TANK_DEPTH_MM,
  DEFAULT_TANK_HEIGHT_MM,
  DEFAULT_TANK_WIDTH_MM,
  defaultScene,
} from './default-scene';

describe('defaultScene', () => {
  it('returns the canonical 60 cm ADA-style tank dimensions', () => {
    const scene = defaultScene();
    expect(scene.tank.width).toBe(DEFAULT_TANK_WIDTH_MM);
    expect(scene.tank.height).toBe(DEFAULT_TANK_HEIGHT_MM);
    expect(scene.tank.depth).toBe(DEFAULT_TANK_DEPTH_MM);
    expect(scene.tank.width).toBe(600);
    expect(scene.tank.height).toBe(360);
    expect(scene.tank.depth).toBe(360);
  });

  it('uses rimless frame + no background', () => {
    const scene = defaultScene();
    expect(scene.tank.style.frame).toBe('rimless');
    expect(scene.tank.style.background).toEqual({ kind: 'none' });
  });

  it('starts with no substrate regions, no layers, and seed 0', () => {
    const scene = defaultScene();
    expect(scene.substrate.regions).toEqual([]);
    expect(scene.layers).toEqual([]);
    expect(scene.seed).toBe(0);
  });

  it('is JSON-roundtrip safe (no class instances, no functions)', () => {
    const scene = defaultScene();
    const cloned = JSON.parse(JSON.stringify(scene));
    expect(cloned).toEqual(scene);
  });

  it('returns a fresh object on each call (independent references)', () => {
    const a = defaultScene();
    const b = defaultScene();
    expect(a).not.toBe(b);
    expect(a.tank).not.toBe(b.tank);
    expect(a.substrate).not.toBe(b.substrate);
    expect(a.layers).not.toBe(b.layers);
  });
});
