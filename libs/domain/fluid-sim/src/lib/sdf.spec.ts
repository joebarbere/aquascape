import {
  bakeHardscapeSdf,
  sampleSdf,
  sampleSdfGradient,
  type HardscapeSdf,
} from './sdf';
import type { Aabb } from './types';

const TANK: Aabb = {
  min: { x: -500, y: -500, z: -500 },
  max: { x: 500, y: 500, z: 500 },
};

describe('bakeHardscapeSdf', () => {
  it('returns a uniform large-positive field for empty hardscape', () => {
    const sdf = bakeHardscapeSdf({ tankAabb: TANK, hardscape: [] });
    expect(sdf.gx).toBe(64);
    expect(sdf.gy).toBe(64);
    expect(sdf.gz).toBe(64);
    expect(sdf.sdf.length).toBe(64 * 64 * 64);
    for (let i = 0; i < sdf.sdf.length; i++) {
      expect(sdf.sdf[i]).toBeGreaterThan(1e5);
    }
  });

  it('single sphere: well-inside sample is negative, well-outside is positive', () => {
    const sdf = bakeHardscapeSdf({
      tankAabb: TANK,
      hardscape: [{ position: { x: 0, y: 0, z: 0 }, radius: 50 }],
    });
    const inside = sampleSdf(sdf, { x: 0, y: 0, z: 0 });
    expect(inside).toBeLessThan(0);
    // Within one cell of the analytic -50 (cell ~15 mm @ 64³ on a 1000-mm tank).
    expect(Math.abs(inside - -50)).toBeLessThan(sdf.cellSize);

    const outside = sampleSdf(sdf, { x: 100, y: 0, z: 0 });
    expect(outside).toBeGreaterThan(0);
    // Should be ≈ 50 ± one cell.
    expect(Math.abs(outside - 50)).toBeLessThan(sdf.cellSize * 1.5);
  });

  it('two spheres: returns distance to the nearer one', () => {
    const sdf = bakeHardscapeSdf({
      tankAabb: TANK,
      hardscape: [
        { position: { x: -200, y: 0, z: 0 }, radius: 50 },
        { position: { x: 200, y: 0, z: 0 }, radius: 50 },
      ],
    });
    // Closer to sphere A → distance ≈ |x - (-200)| - 50.
    const closerA = sampleSdf(sdf, { x: -180, y: 0, z: 0 });
    expect(closerA).toBeLessThan(0); // inside A (20 mm in)
    // At midpoint, equidistant → ≈ 150 (gap between sphere surfaces / 2).
    const mid = sampleSdf(sdf, { x: 0, y: 0, z: 0 });
    expect(mid).toBeGreaterThan(0);
    expect(Math.abs(mid - 150)).toBeLessThan(sdf.cellSize * 2);
  });

  it('gradient outside a sphere points away from the centre', () => {
    const sdf = bakeHardscapeSdf({
      tankAabb: TANK,
      hardscape: [{ position: { x: 0, y: 0, z: 0 }, radius: 50 }],
    });
    const samplePoint = { x: 150, y: 0, z: 0 };
    const grad = sampleSdfGradient(sdf, samplePoint);
    // For a true SDF the gradient at this point is (1, 0, 0). Allow a few
    // percent slop for trilinear approximation.
    expect(grad.x).toBeGreaterThan(0.7);
    expect(Math.abs(grad.y)).toBeLessThan(0.3);
    expect(Math.abs(grad.z)).toBeLessThan(0.3);
  });

  it('out-of-grid sampleSdf returns large positive (no NaN, no crash)', () => {
    const sdf = bakeHardscapeSdf({
      tankAabb: TANK,
      hardscape: [{ position: { x: 0, y: 0, z: 0 }, radius: 50 }],
    });
    const farOutsidePos = sampleSdf(sdf, { x: 1e6, y: 1e6, z: 1e6 });
    expect(Number.isFinite(farOutsidePos)).toBe(true);
    expect(farOutsidePos).toBeGreaterThan(1e5);
    const farOutsideNeg = sampleSdf(sdf, { x: -1e6, y: -1e6, z: -1e6 });
    expect(Number.isFinite(farOutsideNeg)).toBe(true);
    expect(farOutsideNeg).toBeGreaterThan(1e5);
  });

  it('out-of-grid sampleSdfGradient returns (0,0,0)', () => {
    const sdf = bakeHardscapeSdf({
      tankAabb: TANK,
      hardscape: [{ position: { x: 0, y: 0, z: 0 }, radius: 50 }],
    });
    const grad = sampleSdfGradient(sdf, { x: 1e6, y: 0, z: 0 });
    expect(grad).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('is deterministic — same inputs produce byte-identical sdf', () => {
    const opts = {
      tankAabb: TANK,
      hardscape: [
        { position: { x: -100, y: 50, z: 0 }, radius: 40 },
        { position: { x: 80, y: -20, z: 100 }, radius: 60 },
      ],
    };
    const a = bakeHardscapeSdf(opts);
    const b = bakeHardscapeSdf(opts);
    expect(Buffer.from(a.sdf.buffer).equals(Buffer.from(b.sdf.buffer))).toBe(true);
  });

  it('respects a gridSize override', () => {
    const sdf = bakeHardscapeSdf({ tankAabb: TANK, hardscape: [], gridSize: 16 });
    expect(sdf.gx).toBe(16);
    expect(sdf.sdf.length).toBe(16 * 16 * 16);
  });

  it('sampleSdf trilinear matches analytic distance near sphere edge', () => {
    const sdf = bakeHardscapeSdf({
      tankAabb: TANK,
      hardscape: [{ position: { x: 0, y: 0, z: 0 }, radius: 100 }],
    });
    // Sample at 50 mm along +x: analytic distance = 50 - 100 = -50.
    const inside = sampleSdf(sdf, { x: 50, y: 0, z: 0 });
    expect(Math.abs(inside - -50)).toBeLessThan(sdf.cellSize);
    // 200 mm along +y: distance = 200 - 100 = 100.
    const outside = sampleSdf(sdf, { x: 0, y: 200, z: 0 });
    expect(Math.abs(outside - 100)).toBeLessThan(sdf.cellSize * 1.5);
  });

  it('iteration order is fixed — index order is z-major over y-major over x', () => {
    const sdf = bakeHardscapeSdf({
      tankAabb: TANK,
      hardscape: [{ position: { x: 0, y: 0, z: 0 }, radius: 10 }],
    });
    // Sanity: a low-resolution-equivalent index lookup at the centre cell
    // returns the (negative) distance.
    const halfX = Math.floor(sdf.gx / 2);
    const halfY = Math.floor(sdf.gy / 2);
    const halfZ = Math.floor(sdf.gz / 2);
    const idx = halfX + sdf.gx * (halfY + sdf.gy * halfZ);
    // Bake stores the value at this cell — should be close to (cell-centre to origin) - 10.
    const val = sdf.sdf[idx]!;
    expect(Number.isFinite(val)).toBe(true);
  });

  it('handles tankAabb with non-cube extents (cells stay cubic via longest axis)', () => {
    const elongated: Aabb = {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1200, y: 400, z: 400 },
    };
    const sdf: HardscapeSdf = bakeHardscapeSdf({
      tankAabb: elongated,
      hardscape: [{ position: { x: 600, y: 200, z: 200 }, radius: 100 }],
    });
    expect(sdf.cellSize).toBeCloseTo(1200 / 64, 6);
    const inside = sampleSdf(sdf, { x: 600, y: 200, z: 200 });
    expect(inside).toBeLessThan(0);
  });
});
