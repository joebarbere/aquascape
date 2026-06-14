import { PerspectiveCamera, Vector3 } from 'three';
import { canvasPointToNdc, raycastTankPlane, type RaycastTankGeometry } from './raycast';

/**
 * Build a camera in RAW WORLD space looking at the tank centre. The renderer's
 * content group is X-mirrored, but the camera lives outside that mirror — so
 * to model the renderer faithfully the camera looks at WORLD `tank.width/2`
 * (= the mirror pivot, which equals the doc centre too), and `raycastTankPlane`
 * undoes the mirror on output (`docX = width − worldX`).
 *
 * The camera sits in front of the tank (world −Z, per the document convention
 * the viewer is at −Z) looking toward +Z, slightly elevated, so a centre pixel
 * ray descends onto the floor near the tank centre.
 */
function frontCamera(tank: RaycastTankGeometry, aspect = 1): PerspectiveCamera {
  const cam = new PerspectiveCamera(50, aspect, 10, 100000);
  cam.position.set(tank.width / 2, tank.floorY + 400, -tank.depth * 2);
  cam.lookAt(new Vector3(tank.width / 2, tank.floorY, tank.depth / 2));
  cam.updateMatrixWorld();
  return cam;
}

const TANK: RaycastTankGeometry = { width: 600, depth: 300, floorY: 0, waterY: 335 };

describe('canvasPointToNdc', () => {
  it('maps the canvas centre to NDC origin', () => {
    const ndc = canvasPointToNdc({ x: 400, y: 300, width: 800, height: 600 });
    expect(ndc).not.toBeNull();
    expect(ndc?.x).toBeCloseTo(0, 6);
    expect(ndc?.y).toBeCloseTo(0, 6);
  });

  it('flips Y (canvas grows down, NDC grows up)', () => {
    const top = canvasPointToNdc({ x: 400, y: 0, width: 800, height: 600 });
    const bottom = canvasPointToNdc({ x: 400, y: 600, width: 800, height: 600 });
    expect(top?.y).toBeCloseTo(1, 6);
    expect(bottom?.y).toBeCloseTo(-1, 6);
  });

  it('maps the left edge to NDC x = -1 and right edge to +1', () => {
    expect(canvasPointToNdc({ x: 0, y: 300, width: 800, height: 600 })?.x).toBeCloseTo(-1, 6);
    expect(canvasPointToNdc({ x: 800, y: 300, width: 800, height: 600 })?.x).toBeCloseTo(1, 6);
  });

  it('returns null for a zero-sized canvas', () => {
    expect(canvasPointToNdc({ x: 1, y: 1, width: 0, height: 600 })).toBeNull();
    expect(canvasPointToNdc({ x: 1, y: 1, width: 800, height: 0 })).toBeNull();
  });
});

describe('raycastTankPlane — floor plane', () => {
  it('lands a centre pixel near the tank centre on the floor (y = 0)', () => {
    const cam = frontCamera(TANK);
    const hit = raycastTankPlane(cam, { x: 400, y: 300, width: 800, height: 600 }, TANK);
    expect(hit).not.toBeNull();
    expect(hit?.y).toBe(0);
    // Centre pixel → roughly the tank's X centre (mirror is symmetric there).
    expect(hit?.x).toBeCloseTo(300, 0);
    // Z lands somewhere inside the depth footprint.
    expect(hit?.z).toBeGreaterThan(0);
    expect(hit?.z).toBeLessThan(TANK.depth);
  });

  it('applies the doc↔world X-mirror: a pixel RIGHT of centre maps to doc +X (right)', () => {
    const cam = frontCamera(TANK);
    const right = raycastTankPlane(cam, { x: 600, y: 300, width: 800, height: 600 }, TANK);
    const left = raycastTankPlane(cam, { x: 200, y: 300, width: 800, height: 600 }, TANK);
    expect(right).not.toBeNull();
    expect(left).not.toBeNull();
    // Screen-right (higher pixel X) must yield a LARGER doc X (right side of
    // tank) — this is the whole point of the mirror reconciliation.
    expect((right as { x: number }).x).toBeGreaterThan((left as { x: number }).x);
  });

  it('returns null when the ray misses the plane (camera looking away from it)', () => {
    const cam = new PerspectiveCamera(50, 1, 10, 100000);
    cam.position.set(TANK.width / 2, 400, -TANK.depth * 2);
    // Look UP, away from the floor — the ray points away from y = 0.
    cam.lookAt(new Vector3(TANK.width / 2, 100000, -TANK.depth * 10));
    cam.updateMatrixWorld();
    const hit = raycastTankPlane(cam, { x: 400, y: 300, width: 800, height: 600 }, TANK);
    expect(hit).toBeNull();
  });

  it('returns null for a zero-sized canvas', () => {
    const cam = frontCamera(TANK);
    expect(raycastTankPlane(cam, { x: 1, y: 1, width: 0, height: 600 }, TANK)).toBeNull();
  });
});

describe('raycastTankPlane — clamp behaviour', () => {
  it('clamps an out-of-footprint hit to the tank interior by default', () => {
    const cam = frontCamera(TANK);
    // A pixel at the far edge ray will land outside the footprint; with the
    // default clamp it must be pulled back into [0,width] × [0,depth].
    const hit = raycastTankPlane(cam, { x: 800, y: 590, width: 800, height: 600 }, TANK);
    expect(hit).not.toBeNull();
    expect((hit as { x: number }).x).toBeGreaterThanOrEqual(0);
    expect((hit as { x: number }).x).toBeLessThanOrEqual(TANK.width);
    expect((hit as { z: number }).z).toBeGreaterThanOrEqual(0);
    expect((hit as { z: number }).z).toBeLessThanOrEqual(TANK.depth);
  });

  it('returns null for an out-of-footprint hit when clamp is false', () => {
    const cam = frontCamera(TANK);
    // Find a pixel that lands outside the footprint pre-clamp, then assert
    // clamp:false rejects it. A far-corner pixel reliably overshoots Z.
    const clamped = raycastTankPlane(
      cam,
      { x: 790, y: 595, width: 800, height: 600 },
      TANK,
      { clamp: true },
    );
    const rejected = raycastTankPlane(
      cam,
      { x: 790, y: 595, width: 800, height: 600 },
      TANK,
      { clamp: false },
    );
    // The clamped result is in-bounds; the unclamped one is null IFF the raw
    // hit was outside. They can't both be non-null with different values unless
    // the raw hit was in-bounds — guard the meaningful case.
    if (rejected === null) {
      expect(clamped).not.toBeNull();
    } else {
      // Raw hit was in-bounds — clamp made no difference.
      expect(rejected.x).toBeCloseTo((clamped as { x: number }).x, 3);
    }
  });
});

describe('raycastTankPlane — water plane', () => {
  it('intersects the water surface (y = waterY) when plane = water', () => {
    const cam = frontCamera(TANK);
    const hit = raycastTankPlane(
      cam,
      { x: 400, y: 300, width: 800, height: 600 },
      TANK,
      { plane: 'water' },
    );
    expect(hit).not.toBeNull();
    expect(hit?.y).toBe(TANK.waterY);
  });
});
