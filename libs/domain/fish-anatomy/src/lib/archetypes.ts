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
import { buildRevolvedBody, type BodyControlPoint } from './body-builder';

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

// ─── crawler ──────────────────────────────────────────────────────────────
//
// Shared archetype for shrimp + snails (Stage 11 F11.6 Wave 2). A stubby
// low ovoid — depth ~0.25, lateral compression ~0.20 — with two thin
// forward-pointing antennae (snail eye-stalks / shrimp antennae). NO
// caudal / dorsal / anal / pectoral fins — fins don't apply to crustacean
// or gastropod silhouettes, and the renderer's per-instance amp zeroing
// suppresses the carangiform tail-beat for this archetype anyway (the
// kinematic model for crawlers is substrate-glued slow wander, not
// schooling fish swim).
//
// We bypass `composeFish` (which always builds the four fin groups) and
// drive the body builder directly, then append the antennae as two thin
// triangle pairs. Empty `[0, 0]` fin groups keep the descriptor's
// `groups` shape valid.

/** Stubby ovoid body — substrate-hugging proportions for shrimp + snail. */
const CRAWLER_BODY: BodyControlPoint[] = [
  { s: 0.0, ry: 0.005, rz: 0.005 },
  { s: 0.15, ry: 0.09, rz: 0.07 },
  { s: 0.4, ry: 0.125, rz: 0.1 },
  { s: 0.6, ry: 0.125, rz: 0.1 },
  { s: 0.85, ry: 0.08, rz: 0.06 },
  { s: 1.0, ry: 0.01, rz: 0.005 },
];

/**
 * Antenna half-thickness — drives the cross-section of the thin triangle
 * pair. Tiny on purpose: antennae read as "lines" against the body, not
 * as flat blades.
 */
const ANTENNA_HALF_THICKNESS = 0.006;
/** Antenna forward extension from the head (in BL units). */
const ANTENNA_LENGTH = 0.4;
/** Lateral spread of antennae from the spine centreline. */
const ANTENNA_LATERAL = 0.04;
/** Slight upward tilt of antennae tip vs. root (shrimp + snail both lift theirs). */
const ANTENNA_UP_TILT = 0.04;

/**
 * Append a single thin "antenna" — modelled as two triangles forming a
 * narrow blade in the XZ plane near the head. Returns nothing; mutates
 * the context arrays in place.
 */
function pushAntenna(
  ctx: {
    positions: number[];
    normals: number[];
    uvs: number[];
    indices: number[];
    spineUv: number[];
    finType: number[];
  },
  rootZ: number,
): void {
  // Root at the head (s≈0.05), small Z offset to the side.
  const rx = 0.05;
  const ry = 0.02; // attach slightly above the spine (head-top)
  const rz = rootZ;
  // Tip — forward + slightly lateral + tilted up.
  const tx = rx + ANTENNA_LENGTH;
  const ty = ry + ANTENNA_UP_TILT;
  const tz = rootZ + Math.sign(rootZ) * ANTENNA_LATERAL;

  // Build a thin blade: 4 verts (root-near, root-far, tip-near, tip-far)
  // joined by 2 triangles. The "near/far" offset is along Y so the
  // antenna reads from any orbit angle (top-down + side-on both catch
  // edge thickness).
  const baseIdx = ctx.positions.length / 3;

  // Up-normal — every vertex shares the same upward face normal; the
  // antennae are too thin for a per-face lighting story to matter.
  const nx = 0;
  const ny = 1;
  const nz = 0;

  // Antennae are body geometry as far as the fin-flutter shader is
  // concerned — `FIN_TYPE.BODY` (0) keeps them riding the carangiform
  // wave only (which the renderer zeroes for crawlers anyway).
  // root-lower
  ctx.positions.push(rx, ry - ANTENNA_HALF_THICKNESS, rz);
  ctx.normals.push(nx, ny, nz);
  ctx.uvs.push(0, 0);
  ctx.spineUv.push(rx, 0);
  ctx.finType.push(0);
  // root-upper
  ctx.positions.push(rx, ry + ANTENNA_HALF_THICKNESS, rz);
  ctx.normals.push(nx, ny, nz);
  ctx.uvs.push(0, 1);
  ctx.spineUv.push(rx, 0);
  ctx.finType.push(0);
  // tip-lower
  ctx.positions.push(tx, ty - ANTENNA_HALF_THICKNESS, tz);
  ctx.normals.push(nx, ny, nz);
  ctx.uvs.push(1, 0);
  ctx.spineUv.push(tx, 0);
  ctx.finType.push(0);
  // tip-upper
  ctx.positions.push(tx, ty + ANTENNA_HALF_THICKNESS, tz);
  ctx.normals.push(nx, ny, nz);
  ctx.uvs.push(1, 1);
  ctx.spineUv.push(tx, 0);
  ctx.finType.push(0);

  // Two triangles: (root-lower, tip-lower, root-upper),
  // (root-upper, tip-lower, tip-upper).
  ctx.indices.push(baseIdx + 0, baseIdx + 2, baseIdx + 1);
  ctx.indices.push(baseIdx + 1, baseIdx + 2, baseIdx + 3);
}

export function buildCrawlerGeometry(): FishGeometryDescriptor {
  // 'craw' folded — stable per-build seed (passed to the body builder so
  // its jitter PRNG produces byte-identical output across calls).
  const CRAWLER_SEED = 0xc7a4;
  // Drive the body builder directly so we can append antennae (rather
  // than fins) afterwards.
  const xSegments = 12;
  const radialSegments = 10;
  const body = buildRevolvedBody(CRAWLER_BODY, {
    xSegments,
    radialSegments,
    surfaceJitter: 0.0008,
    seed: CRAWLER_SEED,
  });

  // The body builder hands us plain `number[]` buffers; we append the
  // antennae onto the same arrays so the final descriptor still has one
  // contiguous vertex / index buffer (matches every other archetype).
  const ctx = {
    positions: body.positions,
    normals: body.normals,
    uvs: body.uvs,
    indices: body.indices,
    spineUv: body.spineUv,
    finType: body.finType,
  };

  const bodyIndexCount = body.indexCount;

  // Two antennae — right (+z) and left (-z).
  pushAntenna(ctx, 0.025);
  pushAntenna(ctx, -0.025);

  if (ctx.positions.length / 3 >= 65536) {
    throw new Error('buildCrawlerGeometry: vertex count exceeds Uint16Array range');
  }

  return {
    positions: new Float32Array(ctx.positions),
    normals: new Float32Array(ctx.normals),
    uvs: new Float32Array(ctx.uvs),
    indices: new Uint16Array(ctx.indices),
    spineUv: new Float32Array(ctx.spineUv),
    // Crawler has no fins, so the whole buffer is FIN_TYPE.BODY (0).
    finType: new Float32Array(ctx.finType),
    groups: {
      // Body is one contiguous index range starting at 0.
      body: [0, bodyIndexCount],
      // No fins — empty index ranges keep the descriptor type valid
      // without confusing per-fin material passes.
      caudal: [0, 0],
      dorsal: [0, 0],
      anal: [0, 0],
      pectoral: [0, 0],
    },
  };
}
