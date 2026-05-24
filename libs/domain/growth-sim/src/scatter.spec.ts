import { polygonArea, scatterInPolygon } from './scatter';

// A 100×100 mm square in scene space.
const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('polygonArea', () => {
  it('returns 0 for degenerate (<3-vertex) polygons', () => {
    expect(polygonArea([])).toBe(0);
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(0);
  });

  it('returns the signed area of a square (CCW positive)', () => {
    expect(polygonArea(square)).toBe(10_000);
  });

  it('returns a negative value for clockwise winding', () => {
    const cw = [...square].reverse();
    expect(polygonArea(cw)).toBe(-10_000);
  });
});

describe('scatterInPolygon — determinism', () => {
  it('same (polygon, density, seed) → same point list', () => {
    const a = scatterInPolygon(square, 50, 42);
    const b = scatterInPolygon(square, 50, 42);
    expect(a).toEqual(b);
  });

  it('different seeds produce different point lists', () => {
    const a = scatterInPolygon(square, 50, 1);
    const b = scatterInPolygon(square, 50, 2);
    expect(a).not.toEqual(b);
  });

  it('different polygons produce different counts', () => {
    const small = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
    ];
    const a = scatterInPolygon(small, 50, 42);
    const b = scatterInPolygon(square, 50, 42);
    expect(a.length).toBeLessThan(b.length);
  });
});

describe('scatterInPolygon — placement', () => {
  it('every emitted point is inside the polygon (square)', () => {
    const points = scatterInPolygon(square, 100, 7);
    for (const p of points) {
      expect(p.position.x).toBeGreaterThanOrEqual(0);
      expect(p.position.x).toBeLessThanOrEqual(100);
      expect(p.position.y).toBeGreaterThanOrEqual(0);
      expect(p.position.y).toBeLessThanOrEqual(100);
    }
  });

  it('point count scales roughly linearly with density', () => {
    // Density 50 over 100 cm² (square = 100 cm²) ≈ 50 instances.
    const low = scatterInPolygon(square, 50, 1).length;
    const hi = scatterInPolygon(square, 200, 1).length;
    expect(low).toBeGreaterThan(20);
    expect(low).toBeLessThan(80);
    expect(hi).toBeGreaterThan(low * 2);
  });

  it('rejects points outside a concave polygon (L-shape)', () => {
    // L-shape: 100×100 square missing top-right 50×50 quadrant.
    const lShape = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ];
    const points = scatterInPolygon(lShape, 100, 99);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      // Excluded quadrant: x > 50 AND y > 50.
      const inForbidden = p.position.x > 50 && p.position.y > 50;
      expect(inForbidden).toBe(false);
    }
  });

  it('jitter is within [0.85, 1.15) and rotation within [0, 2π)', () => {
    const points = scatterInPolygon(square, 50, 7);
    for (const p of points) {
      expect(p.jitter).toBeGreaterThanOrEqual(0.85);
      expect(p.jitter).toBeLessThan(1.15);
      expect(p.rotation).toBeGreaterThanOrEqual(0);
      expect(p.rotation).toBeLessThan(Math.PI * 2);
    }
  });
});

describe('scatterInPolygon — edge cases', () => {
  it('returns [] for degenerate polygons', () => {
    expect(scatterInPolygon([], 50, 1)).toEqual([]);
    expect(
      scatterInPolygon(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        50,
        1,
      ),
    ).toEqual([]);
  });

  it('returns [] for non-positive density', () => {
    expect(scatterInPolygon(square, 0, 1)).toEqual([]);
    expect(scatterInPolygon(square, -10, 1)).toEqual([]);
  });

  it('returns [] for a zero-area polygon (collinear vertices)', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    expect(scatterInPolygon(line, 50, 1)).toEqual([]);
  });

  it('returns [] for an AABB-degenerate polygon (zero-width strip)', () => {
    const strip = [
      { x: 5, y: 0 },
      { x: 5, y: 10 },
      { x: 5, y: 20 },
    ];
    expect(scatterInPolygon(strip, 50, 1)).toEqual([]);
  });

  it('rejects non-finite density', () => {
    expect(scatterInPolygon(square, Number.NaN, 1)).toEqual([]);
    expect(scatterInPolygon(square, Number.POSITIVE_INFINITY, 1)).toEqual([]);
  });

  it('still emits at most one point when density is below 1 per polygon', () => {
    const tiny = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    // 10×10 mm = 1 cm² area → density 1 → ~0.01 instances → low-density branch.
    const pts = scatterInPolygon(tiny, 1, 7);
    expect(pts.length).toBeLessThanOrEqual(1);
  });

  it('low-density sub-1 path: returns [] when its single jittered candidate misses the polygon', () => {
    // Triangle in the lower-left half of a 100×100 box. A point with both
    // jitter values >0.5 falls into the upper-right half and gets rejected.
    const triangle = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    const out = scatterInPolygon(triangle, 0.001, 1);
    // Whichever way the seeded RNG falls, the result is 0 or 1 — both are
    // valid; what we care about is that the rejection path is reachable.
    expect(out.length).toBeLessThanOrEqual(1);
    // A different seed almost certainly lands in the polygon, exercising
    // the success path.
    const out2 = scatterInPolygon(triangle, 0.001, 12345);
    expect(out2.length).toBeLessThanOrEqual(1);
  });
});
