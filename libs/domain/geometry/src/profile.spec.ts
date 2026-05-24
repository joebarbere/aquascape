import { sampleCatmullRom, seededHash01 } from './profile';

describe('sampleCatmullRom', () => {
  it('hits the first and last control points exactly', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
    ];
    const samples = sampleCatmullRom(points, 11);
    expect(samples[0]).toEqual({ x: 0, y: 0 });
    expect(samples[samples.length - 1]).toEqual({ x: 2, y: 0 });
  });

  it('hits every control point at the matching sample index', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 3, y: 2 },
    ];
    const segments = points.length - 1;
    const samplesPerSeg = 10;
    const samples = sampleCatmullRom(points, segments * samplesPerSeg + 1);
    for (let i = 0; i < points.length; i++) {
      const sample = samples[i * samplesPerSeg]!;
      expect(sample.x).toBeCloseTo(points[i]!.x, 9);
      expect(sample.y).toBeCloseTo(points[i]!.y, 9);
    }
  });

  it('returns evenly-spaced samples (count matches input)', () => {
    const samples = sampleCatmullRom(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      50,
    );
    expect(samples.length).toBe(50);
  });

  it('is monotonic in x for monotonic input control points', () => {
    const samples = sampleCatmullRom(
      [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
        { x: 3, y: 3 },
      ],
      40,
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.x).toBeGreaterThanOrEqual(samples[i - 1]!.x);
    }
  });

  it('handles two control points (degenerate spline → linear)', () => {
    const samples = sampleCatmullRom(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      11,
    );
    expect(samples[0]).toEqual({ x: 0, y: 0 });
    expect(samples[10]).toEqual({ x: 10, y: 10 });
    expect(samples[5]?.x).toBeCloseTo(5, 9);
    expect(samples[5]?.y).toBeCloseTo(5, 9);
  });

  it('handles coincident neighbour points without dividing by zero', () => {
    const samples = sampleCatmullRom(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 1 }, // coincident with prev
        { x: 2, y: 0 },
      ],
      20,
    );
    for (const s of samples) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
    }
  });

  it('throws on fewer than 2 control points', () => {
    expect(() => sampleCatmullRom([{ x: 0, y: 0 }], 10)).toThrow(/control points/);
  });

  it('throws on fewer than 2 samples', () => {
    expect(() =>
      sampleCatmullRom(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        1,
      ),
    ).toThrow(/samples/);
  });
});

describe('seededHash01', () => {
  it('returns a value in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const v = seededHash01(i, i * 17, i * 31);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic — same inputs → same output', () => {
    expect(seededHash01(42, 1, 2, 3)).toBe(seededHash01(42, 1, 2, 3));
    expect(seededHash01(7, 0)).toBe(seededHash01(7, 0));
  });

  it('different seeds produce different outputs (no fixed-point clash)', () => {
    const a = seededHash01(1, 100);
    const b = seededHash01(2, 100);
    expect(a).not.toBe(b);
  });

  it('different keys produce different outputs', () => {
    const a = seededHash01(0, 1);
    const b = seededHash01(0, 2);
    expect(a).not.toBe(b);
  });

  it('zero keys still produces a value', () => {
    expect(seededHash01(123)).toBeGreaterThanOrEqual(0);
  });
});
