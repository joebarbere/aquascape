import { pointInCircle, pointInPolygon, pointInRect, pointInRotatedRect } from './hit-test';

describe('hit-test', () => {
  describe('pointInRect', () => {
    const rect = { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } };

    it.each([
      [{ x: 5, y: 5 }, true], // interior
      [{ x: 0, y: 0 }, true], // corner (inclusive)
      [{ x: 10, y: 5 }, true], // edge (inclusive)
      [{ x: -1, y: 5 }, false],
      [{ x: 11, y: 5 }, false],
    ])('pointInRect(%j) = %s', (p, expected) => {
      expect(pointInRect(p, rect)).toBe(expected);
    });
  });

  describe('pointInRotatedRect', () => {
    it('axis-aligned (rotation = 0) matches AABB behavior', () => {
      // Centered at origin, half-extents 5x5, no rotation.
      expect(pointInRotatedRect({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 }, 0)).toBe(true);
      expect(pointInRotatedRect({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 }, 0)).toBe(true); // edge
      expect(pointInRotatedRect({ x: 6, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 }, 0)).toBe(false);
    });

    it('rotated 45°: a point on the long diagonal stays inside, axis points exit', () => {
      // Square half-extent 1, centered at origin. After 45° rotation,
      // (sqrt(2), 0) is on the corner (just outside since corners are
      // (±sqrt(2), 0) and (0, ±sqrt(2)) after rotation).
      const center = { x: 0, y: 0 };
      const half = { x: 1, y: 1 };
      const rot = Math.PI / 4;
      // Point (0.5, 0.5) is inside the unrotated square; after rotating
      // the rect by 45°, the local-frame mapping rotates (0.5, 0.5) by
      // -45° to (sqrt(0.5), 0) — still inside.
      expect(pointInRotatedRect({ x: 0.5, y: 0.5 }, center, half, rot)).toBe(true);
      // Point (1.5, 0) is outside the rotated rect: inverse-rotated to
      // local frame becomes (~1.06, ~-1.06) — outside half-extents.
      expect(pointInRotatedRect({ x: 1.5, y: 0 }, center, half, rot)).toBe(false);
    });

    it('rotation by +π/2 about (0,0,1) is right-handed (counter-clockwise in screen +y-up)', () => {
      // Rect half-extents (2, 1), so unrotated it's wider than tall.
      // After +π/2 rotation it's taller than wide.
      const center = { x: 0, y: 0 };
      const half = { x: 2, y: 1 };
      // Point (0, 2): outside the unrotated rect (|y| > 1), inside the
      // rotated rect (after rotation, the rect spans y in [-2, 2]).
      expect(pointInRotatedRect({ x: 0, y: 2 }, center, half, 0)).toBe(false);
      expect(pointInRotatedRect({ x: 0, y: 2 }, center, half, Math.PI / 2)).toBe(true);
    });
  });

  describe('pointInCircle', () => {
    const c = { x: 0, y: 0 };
    it.each([
      [{ x: 0, y: 0 }, 5, true],
      [{ x: 3, y: 4 }, 5, true], // on boundary (inclusive)
      [{ x: 3, y: 4 }, 4.99, false],
      [{ x: 6, y: 0 }, 5, false],
    ])('pointInCircle(%j, r=%s) = %s', (p, r, expected) => {
      expect(pointInCircle(p, c, r)).toBe(expected);
    });

    it('zero radius: only the center counts as inside', () => {
      expect(pointInCircle({ x: 0, y: 0 }, c, 0)).toBe(true);
      expect(pointInCircle({ x: 0.0001, y: 0 }, c, 0)).toBe(false);
    });
  });

  describe('pointInPolygon', () => {
    // A simple square polygon (CCW in +y-up).
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    it.each([
      [{ x: 5, y: 5 }, true], // interior
      [{ x: 0, y: 0 }, true], // vertex (on-edge, inclusive)
      [{ x: 5, y: 0 }, true], // on bottom edge
      [{ x: 10, y: 5 }, true], // on right edge
      [{ x: -1, y: 5 }, false], // outside left
      [{ x: 11, y: 5 }, false], // outside right
      [{ x: 5, y: 11 }, false], // outside top
    ])('pointInPolygon(square, %j) = %s', (p, expected) => {
      expect(pointInPolygon(p, square)).toBe(expected);
    });

    it('returns false for polygons with fewer than 3 vertices', () => {
      expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
      expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(false);
      expect(
        pointInPolygon({ x: 0, y: 0 }, [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]),
      ).toBe(false);
    });

    it('handles a concave polygon (L-shape)', () => {
      const lShape = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 10 },
        { x: 0, y: 10 },
      ];
      // Inside the vertical arm.
      expect(pointInPolygon({ x: 2, y: 7 }, lShape)).toBe(true);
      // Inside the horizontal arm.
      expect(pointInPolygon({ x: 7, y: 2 }, lShape)).toBe(true);
      // In the "notch" — outside the L.
      expect(pointInPolygon({ x: 7, y: 7 }, lShape)).toBe(false);
    });

    it('handles a polygon with a degenerate edge (coincident vertices)', () => {
      const withDegenerate = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 0 }, // duplicate
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      expect(pointInPolygon({ x: 5, y: 5 }, withDegenerate)).toBe(true);
      expect(pointInPolygon({ x: 10, y: 0 }, withDegenerate)).toBe(true);
    });

    it('point collinear with an edge but outside the segment is NOT classified as on-edge', () => {
      // Triangle, then test a point on the line through (0,0)-(10,0)
      // but past the endpoint and outside the triangle.
      const tri = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 5 },
      ];
      // (15, 0): collinear with the bottom edge, past the right endpoint
      // (dot > segLenSq path in isOnSegment).
      expect(pointInPolygon({ x: 15, y: 0 }, tri)).toBe(false);
      // (-5, 0): collinear, before the left endpoint (dot < 0 path).
      expect(pointInPolygon({ x: -5, y: 0 }, tri)).toBe(false);
    });

    it('treats the exact endpoint of a degenerate (zero-length) edge as on-edge', () => {
      // Triangle with a triple vertex causing a zero-length edge from
      // (0,0) to (0,0). Querying (0, 0) returns true via the zero-length
      // endpoint match.
      const triWithDegenerate = [
        { x: 0, y: 0 },
        { x: 0, y: 0 }, // degenerate edge: (0,0) → (0,0)
        { x: 10, y: 0 },
        { x: 5, y: 5 },
      ];
      expect(pointInPolygon({ x: 0, y: 0 }, triWithDegenerate)).toBe(true);
    });
  });
});
