/**
 * Six procedural fish archetypes. Each builder produces a
 * `FishGeometryDescriptor` whose body is normalised to body-length 1.0
 * along +X (nose at x=0, tail tip somewhere near x=1). The renderer
 * scales per-instance from the catalog's `adultSize` mm value.
 *
 * Body proportions per archetype come from the Stage 11 plan
 * (see `plans/stage-11-animated-livestock.md`) and §3 of
 * `docs/research/stage-11-livestock-subsystem.md`. The control curves
 * intentionally use ≤ 8 stations so they stay readable + easy to tune.
 *
 * Determinism: each builder uses a stable per-archetype seed so calling
 * the same builder twice produces byte-identical typed arrays. There is
 * no `Math.random()` anywhere in this module.
 */

import type { FishGeometryDescriptor } from '../index';
import { composeFish } from './compose';
import type { BodyControlPoint } from './body-builder';

// ─── slim-tetra ───────────────────────────────────────────────────────────
//
// Fusiform body. Neutral depth ~0.18, lateral ~0.08. Forward-positioned
// dorsal, modest fork tail. Default for unknown species.

const SLIM_TETRA_BODY: BodyControlPoint[] = [
  { s: 0.0, ry: 0.005, rz: 0.005 },
  { s: 0.1, ry: 0.1, rz: 0.05 },
  { s: 0.3, ry: 0.17, rz: 0.075 },
  { s: 0.5, ry: 0.18, rz: 0.08 },
  { s: 0.7, ry: 0.14, rz: 0.065 },
  { s: 0.88, ry: 0.06, rz: 0.03 },
  { s: 1.0, ry: 0.01, rz: 0.005 },
];

export function buildSlimTetraGeometry(): FishGeometryDescriptor {
  return composeFish({
    body: SLIM_TETRA_BODY,
    caudal: {
      attachX: 1.0,
      attachY: 0,
      tipExtension: 0.18,
      tipSpread: 0.13,
      forkDepth: 0.45,
    },
    dorsal: {
      frontX: 0.4,
      backX: 0.6,
      frontY: 0.17,
      backY: 0.16,
      peakHeight: 0.1,
      peakX01: 0.4,
    },
    anal: {
      frontX: 0.55,
      backX: 0.78,
      frontY: -0.15,
      backY: -0.1,
      peakHeight: 0.07,
      peakX01: 0.4,
    },
    pectorals: [
      {
        rootX: 0.22,
        rootY: -0.05,
        rootZ: 0.07,
        tipX: 0.32,
        tipY: -0.1,
        tipZ: 0.16,
        baseWidth: 0.06,
      },
      {
        rootX: 0.22,
        rootY: -0.05,
        rootZ: -0.07,
        tipX: 0.32,
        tipY: -0.1,
        tipZ: -0.16,
        baseWidth: 0.06,
      },
    ],
    surfaceJitter: 0.001,
    seed: 0xa1ce,
  });
}

// ─── deep-bodied ──────────────────────────────────────────────────────────
//
// Tall + laterally compressed (angelfish, discus, gourami territory).
// Body depth ~0.45 with long trailing dorsal + anal fins.

const DEEP_BODIED_BODY: BodyControlPoint[] = [
  { s: 0.0, ry: 0.01, rz: 0.005 },
  { s: 0.1, ry: 0.18, rz: 0.04 },
  { s: 0.3, ry: 0.4, rz: 0.07 },
  { s: 0.5, ry: 0.45, rz: 0.08 },
  { s: 0.7, ry: 0.32, rz: 0.06 },
  { s: 0.88, ry: 0.12, rz: 0.025 },
  { s: 1.0, ry: 0.02, rz: 0.005 },
];

export function buildDeepBodiedGeometry(): FishGeometryDescriptor {
  return composeFish({
    body: DEEP_BODIED_BODY,
    caudal: {
      attachX: 1.0,
      attachY: 0,
      tipExtension: 0.2,
      tipSpread: 0.2,
      forkDepth: 0.2,
    },
    dorsal: {
      frontX: 0.25,
      backX: 0.88,
      frontY: 0.38,
      backY: 0.16,
      peakHeight: 0.25,
      peakX01: 0.75,
    },
    anal: {
      frontX: 0.4,
      backX: 0.88,
      frontY: -0.42,
      backY: -0.16,
      peakHeight: 0.2,
      peakX01: 0.75,
    },
    pectorals: [
      {
        rootX: 0.2,
        rootY: 0,
        rootZ: 0.07,
        tipX: 0.28,
        tipY: -0.1,
        tipZ: 0.2,
        baseWidth: 0.05,
      },
      {
        rootX: 0.2,
        rootY: 0,
        rootZ: -0.07,
        tipX: 0.28,
        tipY: -0.1,
        tipZ: -0.2,
        baseWidth: 0.05,
      },
    ],
    surfaceJitter: 0.0015,
    seed: 0xdeeb,
  });
}

// ─── barb ─────────────────────────────────────────────────────────────────
//
// Robust ovoid (cherry / tiger barbs). Depth ~0.32, length:depth ≈ 3:1.
// Modest forked tail, prominent dorsal.

const BARB_BODY: BodyControlPoint[] = [
  { s: 0.0, ry: 0.01, rz: 0.005 },
  { s: 0.12, ry: 0.17, rz: 0.075 },
  { s: 0.35, ry: 0.3, rz: 0.13 },
  { s: 0.5, ry: 0.32, rz: 0.14 },
  { s: 0.7, ry: 0.23, rz: 0.11 },
  { s: 0.88, ry: 0.09, rz: 0.045 },
  { s: 1.0, ry: 0.015, rz: 0.005 },
];

export function buildBarbGeometry(): FishGeometryDescriptor {
  return composeFish({
    body: BARB_BODY,
    caudal: {
      attachX: 1.0,
      attachY: 0,
      tipExtension: 0.2,
      tipSpread: 0.2,
      forkDepth: 0.4,
    },
    dorsal: {
      frontX: 0.4,
      backX: 0.65,
      frontY: 0.3,
      backY: 0.25,
      peakHeight: 0.18,
      peakX01: 0.45,
    },
    anal: {
      frontX: 0.62,
      backX: 0.82,
      frontY: -0.26,
      backY: -0.16,
      peakHeight: 0.1,
      peakX01: 0.4,
    },
    pectorals: [
      {
        rootX: 0.22,
        rootY: -0.05,
        rootZ: 0.12,
        tipX: 0.34,
        tipY: -0.12,
        tipZ: 0.22,
        baseWidth: 0.07,
      },
      {
        rootX: 0.22,
        rootY: -0.05,
        rootZ: -0.12,
        tipX: 0.34,
        tipY: -0.12,
        tipZ: -0.22,
        baseWidth: 0.07,
      },
    ],
    surfaceJitter: 0.0015,
    seed: 0xba12,
  });
}

// ─── cory-cylinder ────────────────────────────────────────────────────────
//
// Ventrally flat (corydoras). Body depth ~0.2, but the bottom is flatter
// than the top so the silhouette has a flat belly. Achieved via the
// `yOffset` control to bias the spine up; the bottom radius is smaller.
// Pectorals are lower + splayed outward.

const CORY_BODY: BodyControlPoint[] = [
  { s: 0.0, ry: 0.01, rz: 0.01, yOffset: 0.0 },
  { s: 0.12, ry: 0.13, rz: 0.13, yOffset: 0.025 },
  { s: 0.35, ry: 0.18, rz: 0.18, yOffset: 0.04 },
  { s: 0.55, ry: 0.2, rz: 0.18, yOffset: 0.04 },
  { s: 0.75, ry: 0.15, rz: 0.13, yOffset: 0.03 },
  { s: 0.9, ry: 0.07, rz: 0.05, yOffset: 0.01 },
  { s: 1.0, ry: 0.01, rz: 0.01, yOffset: 0.0 },
];

export function buildCoryCylinderGeometry(): FishGeometryDescriptor {
  return composeFish({
    body: CORY_BODY,
    caudal: {
      attachX: 1.0,
      attachY: 0,
      tipExtension: 0.16,
      tipSpread: 0.13,
      forkDepth: 0.3,
    },
    dorsal: {
      frontX: 0.3,
      backX: 0.5,
      frontY: 0.22,
      backY: 0.18,
      peakHeight: 0.14,
      peakX01: 0.4,
    },
    anal: {
      frontX: 0.7,
      backX: 0.85,
      frontY: -0.13,
      backY: -0.08,
      peakHeight: 0.06,
      peakX01: 0.4,
    },
    pectorals: [
      {
        rootX: 0.22,
        rootY: -0.05,
        rootZ: 0.15,
        tipX: 0.32,
        tipY: -0.12,
        tipZ: 0.3,
        baseWidth: 0.08,
      },
      {
        rootX: 0.22,
        rootY: -0.05,
        rootZ: -0.15,
        tipX: 0.32,
        tipY: -0.12,
        tipZ: -0.3,
        baseWidth: 0.08,
      },
    ],
    surfaceJitter: 0.002,
    seed: 0xc01a,
  });
}

// ─── eel ──────────────────────────────────────────────────────────────────
//
// Kuhli-loach proportions: depth ~0.07, lateral ~0.05, tapers to a point.
// Single continuous dorsal+anal ridge along most of the spine. No fork.

const EEL_BODY: BodyControlPoint[] = [
  { s: 0.0, ry: 0.005, rz: 0.005 },
  { s: 0.08, ry: 0.05, rz: 0.04 },
  { s: 0.3, ry: 0.07, rz: 0.05 },
  { s: 0.6, ry: 0.07, rz: 0.05 },
  { s: 0.85, ry: 0.05, rz: 0.035 },
  { s: 1.0, ry: 0.005, rz: 0.005 },
];

export function buildEelGeometry(): FishGeometryDescriptor {
  return composeFish({
    body: EEL_BODY,
    caudal: {
      attachX: 1.0,
      attachY: 0,
      tipExtension: 0.04,
      tipSpread: 0.0,
      forkDepth: 0.0,
    },
    dorsal: {
      frontX: 0.2,
      backX: 0.85,
      frontY: 0.06,
      backY: 0.05,
      peakHeight: 0.03,
      peakX01: 0.5,
    },
    anal: {
      frontX: 0.35,
      backX: 0.85,
      frontY: -0.06,
      backY: -0.05,
      peakHeight: 0.025,
      peakX01: 0.5,
    },
    pectorals: [
      {
        rootX: 0.1,
        rootY: 0,
        rootZ: 0.04,
        tipX: 0.15,
        tipY: -0.03,
        tipZ: 0.09,
        baseWidth: 0.04,
      },
      {
        rootX: 0.1,
        rootY: 0,
        rootZ: -0.04,
        tipX: 0.15,
        tipY: -0.03,
        tipZ: -0.09,
        baseWidth: 0.04,
      },
    ],
    surfaceJitter: 0.0008,
    seed: 0xee10,
  });
}

// ─── hatchet-wedge ────────────────────────────────────────────────────────
//
// Hatchetfish profile: deep keel below the spine (~0.4), small dome above
// (~0.1). Forward-facing long pectorals. The asymmetric silhouette is
// authored via a positive `yOffset` (lift the spine up so the larger
// half-axis goes below it).

// Hatchet keel: the ellipse-centre sits BELOW the spine (negative yOffset),
// so absolute Y spans roughly [yOffset - ry, yOffset + ry] with the
// negative half (deep keel) dominating the positive half (small dome
// above the spine).
const HATCHET_BODY: BodyControlPoint[] = [
  { s: 0.0, ry: 0.04, rz: 0.005, yOffset: -0.08 },
  { s: 0.15, ry: 0.18, rz: 0.05, yOffset: -0.13 },
  { s: 0.4, ry: 0.25, rz: 0.07, yOffset: -0.15 },
  { s: 0.55, ry: 0.24, rz: 0.07, yOffset: -0.14 },
  { s: 0.75, ry: 0.16, rz: 0.05, yOffset: -0.1 },
  { s: 0.9, ry: 0.06, rz: 0.025, yOffset: -0.04 },
  { s: 1.0, ry: 0.01, rz: 0.005, yOffset: 0.0 },
];

export function buildHatchetWedgeGeometry(): FishGeometryDescriptor {
  return composeFish({
    body: HATCHET_BODY,
    caudal: {
      attachX: 1.0,
      attachY: 0,
      tipExtension: 0.15,
      tipSpread: 0.1,
      forkDepth: 0.3,
    },
    dorsal: {
      // Small dome above the spine — at hatchet's posterior the top of
      // the body sits near y = +0.1 (yOffset + ry), so anchor here.
      frontX: 0.5,
      backX: 0.68,
      frontY: 0.09,
      backY: 0.07,
      peakHeight: 0.06,
      peakX01: 0.4,
    },
    anal: {
      // Hangs from the deep keel — body bottom is roughly y = -0.4 at
      // mid-body, tapering toward y ≈ -0.1 at 0.85.
      frontX: 0.55,
      backX: 0.85,
      frontY: -0.32,
      backY: -0.18,
      peakHeight: 0.06,
      peakX01: 0.5,
    },
    pectorals: [
      // Long, forward-facing — extend ahead of and away from the body.
      // Roots near the spine (high on the keel); tips swept out + slightly
      // up so the fin reads as the characteristic "winged" pectoral.
      {
        rootX: 0.22,
        rootY: -0.05,
        rootZ: 0.06,
        tipX: 0.45,
        tipY: 0.0,
        tipZ: 0.28,
        baseWidth: 0.05,
      },
      {
        rootX: 0.22,
        rootY: -0.05,
        rootZ: -0.06,
        tipX: 0.45,
        tipY: 0.0,
        tipZ: -0.28,
        baseWidth: 0.05,
      },
    ],
    surfaceJitter: 0.0012,
    seed: 0x4a7c,
  });
}
