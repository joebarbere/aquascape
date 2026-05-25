// Tank-volume math. Stage 6 F6.2.
//
// Given a tank's interior dimensions + the substrate profile, compute:
//   - the gross tank volume in litres + US gallons
//   - the substrate volume that displaces water (integrated under the
//     profile curve, capped by the tank's interior height)
//   - the net water volume = gross − substrate
//
// All inputs are in millimetres / fractions per the `Scene` types; outputs
// are floating-point litres and US gallons. The numbers are useful for
// dosing + livestock-stocking estimates, NOT for legal volume claims.
//
// Substrate-region profile: each region has a list of `(x, y)` control
// points where `x ∈ [0, 1]` along the tank's front face and `y` is the
// height in mm. The integration uses the trapezoid rule over the control
// points, weighted by the region's `fromX..toX` extent (also fractions
// of the tank width). The 2D profile is multiplied by the tank's depth
// (front-to-back) to get a 3D volume.

import type { Scene, SubstrateRegion } from '@aquascape/domain/scene-model';

/** Cubic millimetres → litres. 1 L = 1 000 000 mm³. */
const MM3_PER_LITRE = 1_000_000;

/** Litres → US gallons. 1 US gal = 3.785411784 L. */
const LITRES_PER_US_GALLON = 3.785411784;

export interface VolumeBreakdown {
  /** Gross tank volume (width × height × depth) in litres. */
  readonly grossLitres: number;
  /** Gross tank volume in US gallons. */
  readonly grossGallons: number;
  /** Volume occupied by substrate in litres. Counts toward displacement. */
  readonly substrateLitres: number;
  /** Volume of WATER after substrate displacement, in litres. */
  readonly waterLitres: number;
  /** Volume of water after displacement, in US gallons. */
  readonly waterGallons: number;
}

/**
 * Compute every volume breakdown for the given scene. Pure, deterministic
 * for a given Scene shape.
 */
export function computeVolumeBreakdown(scene: Scene): VolumeBreakdown {
  const { width, height, depth } = scene.tank;
  if (width <= 0 || height <= 0 || depth <= 0) {
    return {
      grossLitres: 0,
      grossGallons: 0,
      substrateLitres: 0,
      waterLitres: 0,
      waterGallons: 0,
    };
  }
  const grossMm3 = width * height * depth;
  const substrateMm3 = scene.substrate.regions.reduce(
    (sum, region) => sum + substrateRegionVolumeMm3(region, width, height, depth),
    0,
  );
  // The substrate could in theory overflow the tank if a profile point
  // exceeds the tank height — clamp the integration result so the water
  // volume never goes negative.
  const clampedSubstrate = Math.min(substrateMm3, grossMm3);
  const waterMm3 = Math.max(0, grossMm3 - clampedSubstrate);
  const grossLitres = grossMm3 / MM3_PER_LITRE;
  const substrateLitres = clampedSubstrate / MM3_PER_LITRE;
  const waterLitres = waterMm3 / MM3_PER_LITRE;
  return {
    grossLitres,
    grossGallons: grossLitres / LITRES_PER_US_GALLON,
    substrateLitres,
    waterLitres,
    waterGallons: waterLitres / LITRES_PER_US_GALLON,
  };
}

/**
 * Integrate one substrate region's profile (in tank-width-relative `x`
 * and absolute mm `y`) over the region's `fromX..toX` window, multiply
 * by the tank's depth to convert the 2D cross-section into a 3D volume.
 *
 * Profile points are clamped: profile `y` exceeding tank height is
 * trimmed (no substrate above the rim), profile `y` below 0 is treated
 * as 0.
 */
function substrateRegionVolumeMm3(
  region: SubstrateRegion,
  tankWidthMm: number,
  tankHeightMm: number,
  tankDepthMm: number,
): number {
  if (region.profile.length < 2) return 0;
  const fromX = Math.max(0, Math.min(1, region.fromX));
  const toX = Math.max(0, Math.min(1, region.toX));
  if (toX <= fromX) return 0;
  const regionWidthMm = (toX - fromX) * tankWidthMm;

  // Trapezoid integration over profile points. Profile x is in [0, 1]
  // local to the tank's full width; multiply by tank width to get mm.
  // Then convert the 2D area (mm × mm) into 3D by multiplying by depth.
  let areaMm2 = 0;
  const pts = region.profile;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const xa = Math.max(0, Math.min(1, a.x)) * tankWidthMm;
    const xb = Math.max(0, Math.min(1, b.x)) * tankWidthMm;
    if (xb <= xa) continue;
    const ya = Math.max(0, Math.min(tankHeightMm, a.y));
    const yb = Math.max(0, Math.min(tankHeightMm, b.y));
    areaMm2 += ((ya + yb) / 2) * (xb - xa);
  }
  // The profile spans 0..1 of the tank, but the region's effective
  // window is fromX..toX. We approximate the in-window area by
  // scaling by the window width over the profile's total horizontal
  // extent.
  const profileStart = pts[0]!.x * tankWidthMm;
  const profileEnd = pts[pts.length - 1]!.x * tankWidthMm;
  const profileWidthMm = Math.max(1e-9, profileEnd - profileStart);
  const scaledAreaMm2 = (areaMm2 * regionWidthMm) / profileWidthMm;
  return scaledAreaMm2 * tankDepthMm;
}
