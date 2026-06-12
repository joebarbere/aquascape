/**
 * Generic revolved-ellipse body builder shared by every archetype.
 *
 * The body is generated as a tube along the X axis (nose at X=0, tail tip
 * at X=1). At each X sample we build an elliptical cross-section with
 * vertical radius `ry(x)` and lateral radius `rz(x)`. The cross-section
 * is sampled radially at `radialSegments` evenly spaced angles, producing
 * a regular grid of vertices we stitch into a triangle mesh.
 *
 * Outputs are framework-free typed-array buffers; the renderer wraps them
 * into a Three.js `BufferGeometry` with `addGroup(start, count, materialIndex)`
 * — that's why we return `[indexStart, indexCount]` rather than vertex
 * ranges for fin groups.
 *
 * Determinism: no `Math.random()`; any jitter applied during the build
 * pulls from `seededHash01` and is keyed by the vertex index.
 *
 * ## Control curve format
 *
 * Each archetype declares an array of `BodyControlPoint`s:
 *   `{ s, ry, rz, yOffset? }`
 * - `s` ∈ [0, 1] is the position along the spine (0 = nose, 1 = tail tip).
 * - `ry` is the half-height of the ellipse at that station.
 * - `rz` is the half-width (lateral) of the ellipse at that station.
 * - `yOffset` (optional) lets us slide the cross-section centre vertically
 *   so we can build the asymmetric cory (flat-bellied) and hatchet (deep
 *   keel) silhouettes by offsetting the spine away from the geometric
 *   centre. Defaults to 0.
 *
 * The control points must be sorted by `s` and must span 0..1 (the first
 * point's `s` must be 0 and the last must be 1). Intermediate spine X
 * positions are linearly interpolated between control points; that's
 * deliberate — a Catmull-Rom would produce nicer curves but `sampleCatmullRom`
 * works on Vec2s and we have three channels to interpolate, plus linear is
 * adequate for a fish silhouette at 192 vertices.
 */

import { seededHash01 } from '@aquascape/domain/geometry';
import { FIN_TYPE } from './fin-type';

/** One station along the spine. */
export interface BodyControlPoint {
  /** Position along the spine, 0 = nose, 1 = tail tip. */
  s: number;
  /** Half-height (Y extent) of the ellipse at this station. */
  ry: number;
  /** Half-width (Z extent) of the ellipse at this station. */
  rz: number;
  /**
   * Vertical offset of the ellipse centre relative to the nominal spine.
   * Used to break the up/down symmetry for cory (flat belly) and hatchet
   * (deep keel). Defaults to 0 (symmetric).
   */
  yOffset?: number;
}

export interface BodyBuildOptions {
  /** Curve sample count along X. Plan: ≥ 16. */
  xSegments: number;
  /** Radial sample count around each cross-section. Plan: ≥ 12. */
  radialSegments: number;
  /**
   * Optional surface jitter amplitude (added along the surface normal).
   * Always seeded; `0` disables. Keep small (~0.002 BL) — used to break the
   * perfectly-revolved look without producing visible spikes.
   */
  surfaceJitter?: number;
  /** Seed for the jitter PRNG. Ignored if `surfaceJitter` is 0. */
  seed?: number;
}

export interface BodyBuildResult {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  spineUv: number[];
  /** One `FIN_TYPE` code per vertex — the body writes `FIN_TYPE.BODY` (0). */
  finType: number[];
  /** Vertex count produced by the body alone (caller appends fins after). */
  vertexCount: number;
  /** Index count produced by the body alone (caller appends fin indices). */
  indexCount: number;
}

/**
 * Linear-interpolate the cross-section radii + Y offset at spine position
 * `s` from a sorted list of control points.
 *
 * Edge handling: if `s` is at or beyond an endpoint, we pin to that
 * endpoint's values — control points are required to span 0..1 so the
 * caller guarantees this works without out-of-bounds clamping logic.
 */
function sampleControlCurve(
  curve: readonly BodyControlPoint[],
  s: number,
): { ry: number; rz: number; yOffset: number } {
  // Find the two control points bracketing `s`. Linear scan is fine — we
  // have ≤ 8 control points per archetype.
  let i0 = 0;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]!;
    const b = curve[i + 1]!;
    if (s >= a.s && s <= b.s) {
      i0 = i;
      break;
    }
    // Past last bracket — pin to the final segment.
    if (i === curve.length - 2) i0 = i;
  }
  const a = curve[i0]!;
  const b = curve[i0 + 1]!;
  const span = b.s - a.s;
  const t = span === 0 ? 0 : (s - a.s) / span;
  const u = Math.max(0, Math.min(1, t));
  const aY = a.yOffset ?? 0;
  const bY = b.yOffset ?? 0;
  return {
    ry: a.ry + (b.ry - a.ry) * u,
    rz: a.rz + (b.rz - a.rz) * u,
    yOffset: aY + (bY - aY) * u,
  };
}

/**
 * Build a revolved tube along X from a list of cross-section control
 * points. Returns a `BodyBuildResult` whose buffers are plain `number[]`
 * (the archetype builder concatenates fins onto these arrays before
 * converting to typed arrays — concatenating plain arrays is much cheaper
 * than re-allocating typed arrays).
 *
 * Vertex layout: row-major (X-major, radial inner). Vertex at sample
 * `(ix, ir)` has index `ix * radialSegments + ir`.
 *
 * Normals are computed from the partial derivatives of the parametric
 * surface — `du/ds × du/dθ` — then normalised. Cheap closed-form versus
 * face-averaging.
 */
export function buildRevolvedBody(
  curve: readonly BodyControlPoint[],
  options: BodyBuildOptions,
): BodyBuildResult {
  const { xSegments, radialSegments } = options;
  const jitter = options.surfaceJitter ?? 0;
  const seed = options.seed ?? 0x5eed;

  if (xSegments < 4) {
    throw new Error('buildRevolvedBody: xSegments must be >= 4');
  }
  if (radialSegments < 6) {
    throw new Error('buildRevolvedBody: radialSegments must be >= 6');
  }
  if (curve.length < 2) {
    throw new Error('buildRevolvedBody: need >= 2 control points');
  }
  if (curve[0]!.s !== 0 || curve[curve.length - 1]!.s !== 1) {
    throw new Error('buildRevolvedBody: control curve must span s=0..1');
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const spineUv: number[] = [];
  const finType: number[] = [];
  const indices: number[] = [];

  // Step 1 — sample the surface.
  for (let ix = 0; ix < xSegments; ix++) {
    const s = ix / (xSegments - 1);
    const { ry, rz, yOffset } = sampleControlCurve(curve, s);
    // Finite-difference for the slope of ry/rz/yOffset along s — used by
    // the analytic normal. Cheap; we already paid for two samples on each
    // adjacent station.
    const ds = 1 / (xSegments - 1);
    const sNext = Math.min(1, s + ds * 0.5);
    const sPrev = Math.max(0, s - ds * 0.5);
    const next = sampleControlCurve(curve, sNext);
    const prev = sampleControlCurve(curve, sPrev);
    const dRyDs = (next.ry - prev.ry) / (sNext - sPrev || 1);
    const dRzDs = (next.rz - prev.rz) / (sNext - sPrev || 1);
    const dYDs = (next.yOffset - prev.yOffset) / (sNext - sPrev || 1);

    for (let ir = 0; ir < radialSegments; ir++) {
      const theta = (ir / radialSegments) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // Spine position is at X = s, Y = yOffset, Z = 0.
      let x = s;
      let y = yOffset + ry * cosT;
      let z = rz * sinT;

      // Analytic normal: gradient of the implicit surface
      //   F(x, y, z) = ((y - yOffset(x)) / ry(x))^2 + (z / rz(x))^2 - 1
      // Normal direction = (-∂F/∂x, ∂F/∂y, ∂F/∂z) (negate ∂F/∂x because
      // the surface advances in +x as F decreases interior-ward).
      //
      // For points on the surface, (y - yOffset)/ry = cosT and z/rz = sinT,
      // so ∂F/∂x simplifies considerably; we keep the closed form for
      // clarity rather than micro-optimising.
      const nyComponent = (2 * cosT) / ry;
      const nzComponent = (2 * sinT) / rz;
      const nxComponent =
        -2 *
        ((cosT * (-dYDs)) / ry +
          (cosT * cosT * -dRyDs) / ry +
          (sinT * sinT * -dRzDs) / rz);
      let nx = nxComponent;
      let ny = nyComponent;
      let nz = nzComponent;
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-8) {
        nx /= len;
        ny /= len;
        nz /= len;
      } else {
        // Degenerate (zero-radius pole) — fall back to spine tangent.
        nx = ix === 0 ? -1 : 1;
        ny = 0;
        nz = 0;
      }

      if (jitter > 0) {
        const j = seededHash01(seed, ix, ir) - 0.5;
        const amt = jitter * j;
        x += nx * amt;
        y += ny * amt;
        z += nz * amt;
      }

      positions.push(x, y, z);
      normals.push(nx, ny, nz);
      uvs.push(s, ir / radialSegments);
      spineUv.push(s, 0);
      finType.push(FIN_TYPE.BODY);
    }
  }

  // Step 2 — stitch quads into two triangles each. Each quad joins ring
  // ix to ring ix+1 at radial position ir / ir+1, wrapping the radial
  // index modulo `radialSegments` so the surface closes on itself.
  for (let ix = 0; ix < xSegments - 1; ix++) {
    for (let ir = 0; ir < radialSegments; ir++) {
      const irNext = (ir + 1) % radialSegments;
      const a = ix * radialSegments + ir;
      const b = ix * radialSegments + irNext;
      const c = (ix + 1) * radialSegments + ir;
      const d = (ix + 1) * radialSegments + irNext;
      // Triangle 1: a, c, b. Triangle 2: b, c, d. Winding chosen so the
      // outward normal points away from the spine (right-hand rule with
      // +x heading toward the tail).
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    spineUv,
    finType,
    vertexCount: xSegments * radialSegments,
    indexCount: indices.length,
  };
}
