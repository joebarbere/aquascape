import { ExtrudeGeometry, Shape } from 'three';
import { applyHardscapeNoise, seedFromHardscape } from './hardscape-noise';

function makeExtrude(): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(-50, -40);
  shape.lineTo(50, -40);
  shape.lineTo(50, 40);
  shape.lineTo(-50, 40);
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth: 60, bevelEnabled: false, steps: 1 });
}

function positionsBytes(geo: ExtrudeGeometry): string {
  const arr = geo.attributes['position']!.array as Float32Array;
  // Compact comparable representation; toString on a typed array is enough
  // for byte-identity comparisons inside one process.
  return Array.from(arr).map((v) => v.toFixed(6)).join(',');
}

describe('seedFromHardscape', () => {
  it('is pure — same input yields same seed', () => {
    expect(seedFromHardscape('rock.dragonstone', 'obj-1')).toBe(
      seedFromHardscape('rock.dragonstone', 'obj-1'),
    );
  });

  it('differs across different object ids', () => {
    const a = seedFromHardscape('rock.dragonstone', 'obj-1');
    const b = seedFromHardscape('rock.dragonstone', 'obj-2');
    expect(a).not.toBe(b);
  });

  it('differs across different catalog ids', () => {
    const a = seedFromHardscape('rock.dragonstone', 'obj-1');
    const b = seedFromHardscape('rock.seiryu', 'obj-1');
    expect(a).not.toBe(b);
  });

  it('returns a 32-bit unsigned integer', () => {
    const v = seedFromHardscape('rock.x', 'obj.y');
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('applyHardscapeNoise', () => {
  it('is idempotent — same seed + same geometry produces byte-identical position buffers', () => {
    const geoA = makeExtrude();
    const geoB = makeExtrude();
    applyHardscapeNoise(geoA, { seed: 12345, minNaturalMm: 60 });
    applyHardscapeNoise(geoB, { seed: 12345, minNaturalMm: 60 });
    expect(positionsBytes(geoA)).toBe(positionsBytes(geoB));
  });

  it('different seeds produce different vertex buffers (no accidental constant)', () => {
    const geoA = makeExtrude();
    const geoB = makeExtrude();
    applyHardscapeNoise(geoA, { seed: 1, minNaturalMm: 60 });
    applyHardscapeNoise(geoB, { seed: 2, minNaturalMm: 60 });
    expect(positionsBytes(geoA)).not.toBe(positionsBytes(geoB));
  });

  it('recomputes vertex normals (geometry.attributes.normal is populated post-displacement)', () => {
    const geo = makeExtrude();
    applyHardscapeNoise(geo, { seed: 42, minNaturalMm: 60 });
    const normalAttr = geo.attributes['normal'];
    expect(normalAttr).toBeDefined();
    let nonZero = 0;
    const arr = normalAttr!.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(0);
  });

  it('actually moves vertices when magnitude > 0', () => {
    const original = makeExtrude();
    const displaced = makeExtrude();
    applyHardscapeNoise(displaced, { seed: 7, minNaturalMm: 100 });
    expect(positionsBytes(displaced)).not.toBe(positionsBytes(original));
  });

  it('is a no-op (no vertex moves) when magnitude resolves to zero', () => {
    const original = makeExtrude();
    const displaced = makeExtrude();
    applyHardscapeNoise(displaced, { seed: 7, minNaturalMm: 0 });
    expect(positionsBytes(displaced)).toBe(positionsBytes(original));
  });

  it('does not crash when minNaturalMm is negative (treated as zero magnitude)', () => {
    const geo = makeExtrude();
    expect(() => applyHardscapeNoise(geo, { seed: 9, minNaturalMm: -10 })).not.toThrow();
  });

  it('produces noise in the expected ±magnitude band', () => {
    // With min natural 100 and the 18% default fraction, primary
    // magnitude = 18. Second octave adds at most 0.5 × magnitude on top,
    // so the combined per-component cap is 18 × 1.5 = 27 (unit direction
    // vector, max component magnitude 1).
    const a = makeExtrude();
    const b = makeExtrude();
    applyHardscapeNoise(b, { seed: 99, minNaturalMm: 100 });
    const arrA = a.attributes['position']!.array as Float32Array;
    const arrB = b.attributes['position']!.array as Float32Array;
    let maxAbsDelta = 0;
    for (let i = 0; i < arrA.length; i++) {
      const d = Math.abs(arrB[i]! - arrA[i]!);
      if (d > maxAbsDelta) maxAbsDelta = d;
    }
    expect(maxAbsDelta).toBeGreaterThan(0);
    expect(maxAbsDelta).toBeLessThanOrEqual(27 + 1e-3);
  });

  it('keeps the surface watertight at seams — coincident pre-displacement vertices stay coincident post-displacement', () => {
    // ExtrudeGeometry duplicates positions where the front face, side
    // walls and back face meet. Hashing the vertex index, OR displacing
    // along per-face normals, makes those duplicated vertices move
    // independently and the rock develops visible cracks. This test
    // groups pre-displacement vertices by their (qx, qy, qz) and asserts
    // every member of each group lands at the same post-displacement
    // position.
    const before = makeExtrude();
    const after = makeExtrude();
    applyHardscapeNoise(after, { seed: 4242, minNaturalMm: 100 });

    const preArr = before.attributes['position']!.array as Float32Array;
    const postArr = after.attributes['position']!.array as Float32Array;
    const count = before.attributes['position']!.count;

    // Group vertex indices by quantised pre-displacement position.
    const groups = new Map<string, number[]>();
    for (let i = 0; i < count; i++) {
      const qx = Math.round(preArr[i * 3]!);
      const qy = Math.round(preArr[i * 3 + 1]!);
      const qz = Math.round(preArr[i * 3 + 2]!);
      const key = `${qx},${qy},${qz}`;
      const list = groups.get(key);
      if (list === undefined) groups.set(key, [i]);
      else list.push(i);
    }

    // For every group with >1 member, all post-displacement positions
    // must match within float tolerance.
    let seamsChecked = 0;
    for (const indices of groups.values()) {
      if (indices.length < 2) continue;
      seamsChecked++;
      const refX = postArr[indices[0]! * 3]!;
      const refY = postArr[indices[0]! * 3 + 1]!;
      const refZ = postArr[indices[0]! * 3 + 2]!;
      for (let k = 1; k < indices.length; k++) {
        const j = indices[k]!;
        expect(postArr[j * 3]).toBeCloseTo(refX, 4);
        expect(postArr[j * 3 + 1]).toBeCloseTo(refY, 4);
        expect(postArr[j * 3 + 2]).toBeCloseTo(refZ, 4);
      }
    }
    // Guard the guard — `ExtrudeGeometry` for a quad-with-depth has
    // four corners each shared across front/side/back/side, so we expect
    // a non-trivial number of seam clusters. If this is zero, the test
    // is silently vacuous and someone changed how Three.js builds the
    // extrusion or our quad fixture.
    expect(seamsChecked).toBeGreaterThan(0);
  });
});
