import { clampToTank, clampToScene } from './tank-clamp';
import type { Scene } from '@aquascape/domain/scene-model';

const tank = { width: 360, depth: 300 };

describe('clampToTank', () => {
  it('passes through a position whose AABB already fits inside the tank', () => {
    const out = clampToTank({ x: 180, y: 0, z: 150 }, { x: 30, z: 20 }, tank);
    expect(out).toEqual({ x: 180, y: 0, z: 150 });
  });

  it('clamps X to the left wall (position − halfW < 0)', () => {
    // halfW = 50, so the rock would extend from x = -20 to x = 80. Clamp
    // x → 50 so the bbox starts at 0.
    const out = clampToTank({ x: 30, y: 0, z: 150 }, { x: 50, z: 20 }, tank);
    expect(out.x).toBe(50);
    expect(out.z).toBe(150);
  });

  it('clamps X to the right wall (position + halfW > tank.width)', () => {
    // halfW = 50, position 340 → bbox 290–390 (right wall at 360). Clamp
    // to 310 so the bbox ends at 360.
    const out = clampToTank({ x: 340, y: 0, z: 150 }, { x: 50, z: 20 }, tank);
    expect(out.x).toBe(310);
  });

  it('clamps Z to the front glass (position − halfD < 0)', () => {
    const out = clampToTank({ x: 180, y: 0, z: 5 }, { x: 30, z: 40 }, tank);
    expect(out.z).toBe(40);
  });

  it('clamps Z to the back glass (position + halfD > tank.depth)', () => {
    const out = clampToTank({ x: 180, y: 0, z: 290 }, { x: 30, z: 40 }, tank);
    expect(out.z).toBe(260);
  });

  it('centres X when the object is wider than the tank (2 × halfW ≥ width)', () => {
    // halfW = 200 → object is 400 wide, tank only 360 wide. Centre on x.
    const out = clampToTank({ x: 50, y: 0, z: 150 }, { x: 200, z: 20 }, tank);
    expect(out.x).toBe(180);
  });

  it('centres Z when the object is deeper than the tank', () => {
    const out = clampToTank({ x: 180, y: 0, z: 50 }, { x: 30, z: 200 }, tank);
    expect(out.z).toBe(150);
  });

  it('does not modify Y', () => {
    const out = clampToTank({ x: 180, y: 999, z: 150 }, { x: 30, z: 20 }, tank);
    expect(out.y).toBe(999);
  });

  it('treats negative or non-finite half-extents as zero (defensive)', () => {
    const out = clampToTank(
      { x: 100, y: 0, z: 100 },
      { x: -10, z: Number.NaN },
      tank,
    );
    expect(out.x).toBe(100);
    expect(out.z).toBe(100);
  });

  it('returns the input axis unchanged when the tank extent is 0 or non-finite (degenerate)', () => {
    const out = clampToTank(
      { x: 100, y: 0, z: 100 },
      { x: 30, z: 20 },
      { width: 0, depth: Number.POSITIVE_INFINITY },
    );
    expect(out.x).toBe(100);
    expect(out.z).toBe(100);
  });
});

describe('clampToScene', () => {
  it('reads tank dimensions out of the Scene and clamps accordingly', () => {
    const scene: Scene = {
      tank: {
        width: 200,
        height: 200,
        depth: 200,
        style: { frame: 'rimless', background: { kind: 'none' } },
      },
      substrate: { regions: [] },
      layers: [],
      seed: 0,
    };
    const out = clampToScene({ x: 250, y: 0, z: 250 }, { x: 30, z: 30 }, scene);
    expect(out.x).toBe(170);
    expect(out.z).toBe(170);
  });
});
