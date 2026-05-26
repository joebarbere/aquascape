import { buildRevolvedBody, type BodyControlPoint } from './body-builder';

const STRAIGHT_TUBE: BodyControlPoint[] = [
  { s: 0, ry: 0.1, rz: 0.1 },
  { s: 0.5, ry: 0.1, rz: 0.1 },
  { s: 1, ry: 0.1, rz: 0.1 },
];

describe('buildRevolvedBody', () => {
  it('produces the expected vertex count for a given segment grid', () => {
    const body = buildRevolvedBody(STRAIGHT_TUBE, {
      xSegments: 8,
      radialSegments: 12,
    });
    expect(body.vertexCount).toBe(8 * 12);
    expect(body.positions.length / 3).toBe(8 * 12);
    expect(body.normals.length / 3).toBe(8 * 12);
    expect(body.uvs.length / 2).toBe(8 * 12);
    expect(body.spineUv.length / 2).toBe(8 * 12);
  });

  it('produces 6 indices per quad (= 2 triangles)', () => {
    const body = buildRevolvedBody(STRAIGHT_TUBE, {
      xSegments: 8,
      radialSegments: 12,
    });
    // (xSegments - 1) * radialSegments quads × 6 indices per quad.
    expect(body.indexCount).toBe((8 - 1) * 12 * 6);
  });

  it('throws when fewer than 2 control points are supplied', () => {
    expect(() =>
      buildRevolvedBody([{ s: 0, ry: 0.1, rz: 0.1 }], {
        xSegments: 8,
        radialSegments: 12,
      }),
    ).toThrow(/>= 2 control points/);
  });

  it('throws when xSegments < 4', () => {
    expect(() =>
      buildRevolvedBody(STRAIGHT_TUBE, { xSegments: 3, radialSegments: 12 }),
    ).toThrow(/xSegments/);
  });

  it('throws when radialSegments < 6', () => {
    expect(() =>
      buildRevolvedBody(STRAIGHT_TUBE, { xSegments: 8, radialSegments: 5 }),
    ).toThrow(/radialSegments/);
  });

  it('throws when control curve does not span 0..1', () => {
    expect(() =>
      buildRevolvedBody(
        [
          { s: 0.1, ry: 0.1, rz: 0.1 },
          { s: 0.9, ry: 0.1, rz: 0.1 },
        ],
        { xSegments: 8, radialSegments: 12 },
      ),
    ).toThrow(/span s=0..1/);
  });

  it('applies surface jitter deterministically given the same seed', () => {
    const a = buildRevolvedBody(STRAIGHT_TUBE, {
      xSegments: 8,
      radialSegments: 12,
      surfaceJitter: 0.01,
      seed: 42,
    });
    const b = buildRevolvedBody(STRAIGHT_TUBE, {
      xSegments: 8,
      radialSegments: 12,
      surfaceJitter: 0.01,
      seed: 42,
    });
    expect(a.positions).toEqual(b.positions);
  });

  it('produces different vertices for different seeds when jitter > 0', () => {
    const a = buildRevolvedBody(STRAIGHT_TUBE, {
      xSegments: 8,
      radialSegments: 12,
      surfaceJitter: 0.01,
      seed: 1,
    });
    const b = buildRevolvedBody(STRAIGHT_TUBE, {
      xSegments: 8,
      radialSegments: 12,
      surfaceJitter: 0.01,
      seed: 2,
    });
    expect(a.positions).not.toEqual(b.positions);
  });

  it('keeps zero jitter when surfaceJitter is omitted', () => {
    const a = buildRevolvedBody(STRAIGHT_TUBE, {
      xSegments: 8,
      radialSegments: 12,
    });
    // With no jitter, every radial pole at x=0 has the same |r| from the spine.
    // Pick a few vertices on the first ring and check their distance to the centreline.
    for (let ir = 0; ir < 12; ir++) {
      const x = a.positions[ir * 3]!;
      const y = a.positions[ir * 3 + 1]!;
      const z = a.positions[ir * 3 + 2]!;
      expect(x).toBeCloseTo(0, 10);
      const r = Math.hypot(y, z);
      expect(r).toBeCloseTo(0.1, 10);
    }
  });

  it('writes spineUv.s = vertex X for the straight tube', () => {
    const a = buildRevolvedBody(STRAIGHT_TUBE, {
      xSegments: 8,
      radialSegments: 12,
    });
    for (let v = 0; v < a.vertexCount; v++) {
      const x = a.positions[v * 3]!;
      const s = a.spineUv[v * 2]!;
      expect(s).toBeCloseTo(x, 10);
    }
  });

  it('honours yOffset to shift the cross-section centre', () => {
    const curve: BodyControlPoint[] = [
      { s: 0, ry: 0.1, rz: 0.1, yOffset: 0.05 },
      { s: 1, ry: 0.1, rz: 0.1, yOffset: 0.05 },
    ];
    const a = buildRevolvedBody(curve, { xSegments: 4, radialSegments: 6 });
    // The mean Y of the first ring should equal the yOffset (0.05).
    let sumY = 0;
    for (let ir = 0; ir < 6; ir++) sumY += a.positions[ir * 3 + 1]!;
    expect(sumY / 6).toBeCloseTo(0.05, 6);
  });
});
