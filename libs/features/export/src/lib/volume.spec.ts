// Volume-math tests. Stage 6 F6.2.

import type { Scene, SubstrateRegion } from '@aquascape/domain/scene-model';

import { computeVolumeBreakdown } from './volume';

function makeScene(overrides: {
  width?: number;
  height?: number;
  depth?: number;
  regions?: ReadonlyArray<SubstrateRegion>;
} = {}): Scene {
  return {
    tank: {
      width: overrides.width ?? 600,
      height: overrides.height ?? 360,
      depth: overrides.depth ?? 360,
      glassThickness: 5,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: overrides.regions ?? [] },
    layers: [],
    seed: 1,
  } as Scene;
}

function flatRegion(yMm: number): SubstrateRegion {
  return {
    id: 'r' as never,
    material: { catalog: 'core', id: 'substrate.x', version: 1 },
    fromX: 0,
    toX: 1,
    profile: [
      { x: 0, y: yMm },
      { x: 1, y: yMm },
    ],
  };
}

describe('computeVolumeBreakdown — gross volume', () => {
  it('computes 600 × 360 × 360 mm = ~77.76 L gross / ~20.54 US gal', () => {
    const b = computeVolumeBreakdown(makeScene());
    expect(b.grossLitres).toBeCloseTo(77.76, 2);
    // 77.76 ÷ 3.785411784 ≈ 20.5420
    expect(b.grossGallons).toBeCloseTo(20.542, 2);
  });

  it('zero / negative dimensions return all zeros', () => {
    expect(computeVolumeBreakdown(makeScene({ width: 0 }))).toEqual({
      grossLitres: 0,
      grossGallons: 0,
      substrateLitres: 0,
      waterLitres: 0,
      waterGallons: 0,
    });
    expect(computeVolumeBreakdown(makeScene({ height: -1 }))).toEqual({
      grossLitres: 0,
      grossGallons: 0,
      substrateLitres: 0,
      waterLitres: 0,
      waterGallons: 0,
    });
  });

  it('water volume == gross when there is no substrate', () => {
    const b = computeVolumeBreakdown(makeScene());
    expect(b.waterLitres).toBeCloseTo(b.grossLitres, 9);
    expect(b.substrateLitres).toBe(0);
  });
});

describe('computeVolumeBreakdown — substrate displacement', () => {
  it('flat 50 mm layer over full width displaces width × 50 × depth = 10.8 L on a 600×360×360 tank', () => {
    // 600 mm × 50 mm × 360 mm = 10_800_000 mm³ = 10.8 L
    const b = computeVolumeBreakdown(makeScene({ regions: [flatRegion(50)] }));
    expect(b.substrateLitres).toBeCloseTo(10.8, 6);
    expect(b.waterLitres).toBeCloseTo(b.grossLitres - 10.8, 6);
  });

  it('triangular slope from 0 → 100 mm displaces half the rectangle (= width × 50 × depth)', () => {
    const region: SubstrateRegion = {
      id: 'r' as never,
      material: { catalog: 'core', id: 'substrate.x', version: 1 },
      fromX: 0,
      toX: 1,
      profile: [
        { x: 0, y: 0 },
        { x: 1, y: 100 },
      ],
    };
    const b = computeVolumeBreakdown(makeScene({ regions: [region] }));
    // Triangle area = 1/2 × width × 100 mm × depth = 0.5 × 600 × 100 × 360
    // = 10_800_000 mm³ = 10.8 L.
    expect(b.substrateLitres).toBeCloseTo(10.8, 6);
  });

  it('half-tank region (fromX 0 → 0.5) at 50 mm displaces half the flat-region case', () => {
    const region: SubstrateRegion = {
      id: 'r' as never,
      material: { catalog: 'core', id: 'substrate.x', version: 1 },
      fromX: 0,
      toX: 0.5,
      profile: [
        { x: 0, y: 50 },
        { x: 1, y: 50 },
      ],
    };
    const b = computeVolumeBreakdown(makeScene({ regions: [region] }));
    // 5.4 L (half of 10.8) instead of 10.8.
    expect(b.substrateLitres).toBeCloseTo(5.4, 6);
  });

  it('multiple regions sum their volumes', () => {
    const r1: SubstrateRegion = {
      id: 'r1' as never,
      material: { catalog: 'core', id: 's', version: 1 },
      fromX: 0,
      toX: 0.5,
      profile: [
        { x: 0, y: 30 },
        { x: 1, y: 30 },
      ],
    };
    const r2: SubstrateRegion = {
      id: 'r2' as never,
      material: { catalog: 'core', id: 's', version: 1 },
      fromX: 0.5,
      toX: 1,
      profile: [
        { x: 0, y: 30 },
        { x: 1, y: 30 },
      ],
    };
    const b1 = computeVolumeBreakdown(makeScene({ regions: [r1] }));
    const b2 = computeVolumeBreakdown(makeScene({ regions: [r2] }));
    const bBoth = computeVolumeBreakdown(makeScene({ regions: [r1, r2] }));
    expect(bBoth.substrateLitres).toBeCloseTo(b1.substrateLitres + b2.substrateLitres, 6);
  });

  it('profile y exceeding tank height is clamped (no negative water)', () => {
    // 1000mm-tall substrate on a 360mm tank: clamp y to 360.
    const b = computeVolumeBreakdown(
      makeScene({ regions: [flatRegion(1000)] }),
    );
    // Substrate clamped to tank height fills the tank → water == 0.
    expect(b.waterLitres).toBe(0);
    expect(b.substrateLitres).toBeCloseTo(b.grossLitres, 6);
  });

  it('skips zero-width regions (fromX === toX)', () => {
    const r: SubstrateRegion = {
      id: 'r' as never,
      material: { catalog: 'core', id: 's', version: 1 },
      fromX: 0.3,
      toX: 0.3,
      profile: [
        { x: 0, y: 50 },
        { x: 1, y: 50 },
      ],
    };
    const b = computeVolumeBreakdown(makeScene({ regions: [r] }));
    expect(b.substrateLitres).toBe(0);
  });

  it('skips regions with fewer than 2 profile points', () => {
    const r: SubstrateRegion = {
      id: 'r' as never,
      material: { catalog: 'core', id: 's', version: 1 },
      fromX: 0,
      toX: 1,
      profile: [{ x: 0, y: 50 }],
    };
    const b = computeVolumeBreakdown(makeScene({ regions: [r] }));
    expect(b.substrateLitres).toBe(0);
  });

  it('honours profile point order (later points override earlier on integration)', () => {
    // Profile zigzag: 0 → 50 → 0 → 50. Average height = 25.
    const r: SubstrateRegion = {
      id: 'r' as never,
      material: { catalog: 'core', id: 's', version: 1 },
      fromX: 0,
      toX: 1,
      profile: [
        { x: 0, y: 0 },
        { x: 0.33, y: 50 },
        { x: 0.66, y: 0 },
        { x: 1, y: 50 },
      ],
    };
    const b = computeVolumeBreakdown(makeScene({ regions: [r] }));
    // Average y ≈ 25 mm; volume ≈ 25 × 600 × 360 = 5.4 L
    expect(b.substrateLitres).toBeCloseTo(5.4, 1);
  });
});

describe('computeVolumeBreakdown — unit conversions', () => {
  it('1 L of water == 0.2641720523 US gallons', () => {
    // 100 × 100 × 100 mm = 1 L exactly.
    const b = computeVolumeBreakdown(
      makeScene({ width: 100, height: 100, depth: 100 }),
    );
    expect(b.grossLitres).toBeCloseTo(1, 9);
    expect(b.grossGallons).toBeCloseTo(0.2641720523, 9);
  });
});
