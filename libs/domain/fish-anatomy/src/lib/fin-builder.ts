/**
 * Fin geometry helpers — pure-triangle constructors for caudal (tail),
 * dorsal, anal, and pectoral fins.
 *
 * Each helper appends triangles to the shared body buffer arrays via a
 * tiny `FinBuilderContext` so fins live in the same `positions` / `normals`
 * / `uvs` / `indices` / `spineUv` buffers as the body — the renderer then
 * tags each fin's index range via the `groups` field and applies a fin
 * material (often a translucent shader) per group.
 *
 * Normals are face-normals computed via cross-product; UVs are 0..1 along
 * the fin's local primary axis. The fin's `spineUv` is pinned to the spine
 * X of the attachment point so the carangiform vertex shader treats fins
 * as belonging to whichever body station they sprout from — fins move
 * with their body segment.
 */

import { crossVec3, normalizeVec3, type Vec3 } from '@aquascape/domain/geometry';
import { FIN_TYPE, type FinTypeCode } from './fin-type';

export interface FinBuilderContext {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  spineUv: number[];
  /** One `FIN_TYPE` code per vertex; each fin builder pushes its own. */
  finType: number[];
}

function pushVertex(
  ctx: FinBuilderContext,
  v: Vec3,
  n: Vec3,
  u: number,
  vCoord: number,
  spineS: number,
  finCode: FinTypeCode,
): number {
  const index = ctx.positions.length / 3;
  ctx.positions.push(v.x, v.y, v.z);
  ctx.normals.push(n.x, n.y, n.z);
  ctx.uvs.push(u, vCoord);
  ctx.spineUv.push(spineS, 0);
  ctx.finType.push(finCode);
  return index;
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab: Vec3 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac: Vec3 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  return normalizeVec3(crossVec3(ab, ac));
}

/**
 * Caudal (tail) fin. Two triangles forming a fan from the body's posterior
 * pole `attach` to two tip points `tipUpper` and `tipLower`. Forked tails
 * leave a gap between the two tips; pointed tails collapse the two tips
 * to a single point.
 *
 * For a forked tail we generate two triangles sharing the `attach` vertex,
 * one going to the upper lobe and one to the lower lobe, joined by a thin
 * trapezoid quad along the spine.
 *
 * `forkDepth` ∈ [0, 1] — 0 = straight back-edge, 1 = full fork (recessed
 * to the spine attachment).
 */
export function buildCaudalFin(
  ctx: FinBuilderContext,
  attach: Vec3,
  tipUpper: Vec3,
  tipLower: Vec3,
  forkDepth: number,
): { indexStart: number; indexCount: number } {
  const indexStart = ctx.indices.length;
  const spineS = attach.x;

  // Midpoint between the two tips, on the spine plane.
  const tipMid: Vec3 = {
    x: tipUpper.x + (tipLower.x - tipUpper.x) * 0.5,
    y: 0,
    z: 0,
  };

  // The fork point sits between `attach` and `tipMid`, controlled by
  // `forkDepth`. `forkDepth=0` => fork point at `tipMid` (no fork).
  // `forkDepth=1` => fork point at `attach` (deep fork).
  const fork: Vec3 = {
    x: attach.x + (tipMid.x - attach.x) * (1 - forkDepth),
    y: attach.y,
    z: 0,
  };

  // Upper lobe triangle: attach, tipUpper, fork (CCW when seen from +z).
  const n1 = faceNormal(attach, tipUpper, fork);
  const a1 = pushVertex(ctx, attach, n1, 0, 0.5, spineS, FIN_TYPE.CAUDAL);
  const b1 = pushVertex(ctx, tipUpper, n1, 1, 1, spineS, FIN_TYPE.CAUDAL);
  const c1 = pushVertex(ctx, fork, n1, 0.5, 0.5, spineS, FIN_TYPE.CAUDAL);
  ctx.indices.push(a1, b1, c1);

  // Lower lobe triangle: attach, fork, tipLower.
  const n2 = faceNormal(attach, fork, tipLower);
  const a2 = pushVertex(ctx, attach, n2, 0, 0.5, spineS, FIN_TYPE.CAUDAL);
  const b2 = pushVertex(ctx, fork, n2, 0.5, 0.5, spineS, FIN_TYPE.CAUDAL);
  const c2 = pushVertex(ctx, tipLower, n2, 1, 0, spineS, FIN_TYPE.CAUDAL);
  ctx.indices.push(a2, b2, c2);

  return { indexStart, indexCount: ctx.indices.length - indexStart };
}

/**
 * Dorsal / anal fin — a triangle fan along the spine. Given two
 * attachment points on the body (front + back) and a tip height (the fin
 * peak in Y), build a 2-triangle quad. `tipPeakX01` ∈ [0, 1] biases the
 * fin's peak forward (0) or backward (1) within the attachment range —
 * deep-bodied trailing fins set this near 1 to elongate the back of the
 * fin.
 *
 * `sign` ∈ {+1, -1}: +1 for dorsal (peak above), -1 for anal (peak below).
 */
export function buildSpineRibbonFin(
  ctx: FinBuilderContext,
  attachFront: Vec3,
  attachBack: Vec3,
  peakHeight: number,
  tipPeakX01: number,
  sign: 1 | -1,
): { indexStart: number; indexCount: number } {
  const indexStart = ctx.indices.length;

  const peakX = attachFront.x + (attachBack.x - attachFront.x) * tipPeakX01;
  const peakBaseY = attachFront.y + (attachBack.y - attachFront.y) * tipPeakX01;
  const peak: Vec3 = { x: peakX, y: peakBaseY + sign * peakHeight, z: 0 };
  const spineS = (attachFront.x + attachBack.x) * 0.5;

  // Single triangle (front, peak, back) — a wider fin would subdivide,
  // but the silhouette reads fine with one triangle and saves verts.
  // `winding` swaps for sign=-1 (anal fin, below the spine) so the face
  // normal points the right way after the cross product.
  const [w0, w1, w2] =
    sign === 1 ? [attachFront, peak, attachBack] : [attachFront, attachBack, peak];
  // Fin-type code follows the sign: +1 = dorsal (above), -1 = anal (below).
  const finCode = sign === 1 ? FIN_TYPE.DORSAL : FIN_TYPE.ANAL;
  const n = faceNormal(w0, w1, w2);
  const a = pushVertex(ctx, w0, n, 0, 0, spineS, finCode);
  const b = pushVertex(ctx, w1, n, 0.5, 1, spineS, finCode);
  const c = pushVertex(ctx, w2, n, 1, 0, spineS, finCode);
  ctx.indices.push(a, b, c);

  return { indexStart, indexCount: ctx.indices.length - indexStart };
}

/**
 * Pectoral fin — a small triangle pair on each side of the body (z > 0 and
 * z < 0). `root` is the attachment point on the body surface; `tip` is
 * the far point of the fin. `sign` is the lateral side: +1 for right
 * (+z), -1 for left (-z). The fin is generated as a single triangle
 * (root, tip, midline-anchor) where the midline anchor is offset slightly
 * downstream from `root` to give the fin a base width.
 */
export function buildPectoralFin(
  ctx: FinBuilderContext,
  root: Vec3,
  tip: Vec3,
  baseWidth: number,
  sign: 1 | -1,
): { indexStart: number; indexCount: number } {
  const indexStart = ctx.indices.length;
  const back: Vec3 = { x: root.x + baseWidth, y: root.y, z: root.z };
  const spineS = root.x;
  const [w0, w1, w2] = sign === 1 ? [root, tip, back] : [root, back, tip];
  const n = faceNormal(w0, w1, w2);
  const a = pushVertex(ctx, w0, n, 0, 0, spineS, FIN_TYPE.PECTORAL);
  const b = pushVertex(ctx, w1, n, 1, 1, spineS, FIN_TYPE.PECTORAL);
  const c = pushVertex(ctx, w2, n, 1, 0, spineS, FIN_TYPE.PECTORAL);
  ctx.indices.push(a, b, c);
  return { indexStart, indexCount: ctx.indices.length - indexStart };
}
