/**
 * Compose a `FishGeometryDescriptor` from body + fin specs. Each archetype
 * builder calls into this with its species-specific control curve + fin
 * placements; the body builder generates the revolved tube, the fin
 * helpers append fin triangles, and we package the lot into typed arrays
 * with each fin's `[indexStart, indexCount]` range recorded in `groups`.
 *
 * One archetype = one call to `composeFish`. The function is deterministic
 * (no `Math.random()`) — every per-vertex perturbation is keyed off the
 * supplied seed via `seededHash01`.
 */

import type { FishGeometryDescriptor } from '../index';
import { buildRevolvedBody, type BodyControlPoint } from './body-builder';
import {
  buildCaudalFin,
  buildPectoralFin,
  buildSpineRibbonFin,
  type FinBuilderContext,
} from './fin-builder';

export interface CaudalSpec {
  /** Spine-X of the body attachment point. */
  attachX: number;
  /** Y at the attachment (usually 0; the spine). */
  attachY: number;
  /** How far past the body the tail tips extend. */
  tipExtension: number;
  /** Vertical half-span of the tail tips. 0 = pointed (eel). */
  tipSpread: number;
  /** Fork depth ∈ [0, 1]. 0 = straight, 1 = deep fork. */
  forkDepth: number;
}

export interface RibbonFinSpec {
  /** Front attachment spine-X. */
  frontX: number;
  /** Back attachment spine-X. */
  backX: number;
  /** Y at the body surface for the front attachment. */
  frontY: number;
  /** Y at the body surface for the back attachment. */
  backY: number;
  /** Peak height above (dorsal) or below (anal) the attachment. */
  peakHeight: number;
  /** Peak position along the attachment, 0 = front-biased, 1 = back-biased. */
  peakX01: number;
}

export interface PectoralSpec {
  /** Spine-X of the pectoral root. */
  rootX: number;
  /** Y of the pectoral root (relative to spine). */
  rootY: number;
  /** Lateral offset of the root from the spine (positive = right side). */
  rootZ: number;
  /** Spine-X of the fin tip. */
  tipX: number;
  /** Y of the fin tip. */
  tipY: number;
  /** Lateral position of the fin tip. */
  tipZ: number;
  /** Base width along the spine. */
  baseWidth: number;
}

export interface ArchetypeSpec {
  body: readonly BodyControlPoint[];
  caudal: CaudalSpec;
  dorsal: RibbonFinSpec;
  anal: RibbonFinSpec;
  /** Two pectoral specs (right + left), or empty if archetype has none. */
  pectorals: readonly PectoralSpec[];
  /** Optional per-vertex jitter amplitude in BL units. */
  surfaceJitter?: number;
  /** Seed for deterministic jitter. */
  seed: number;
  /** Spine X-station count. Plan: ≥ 16. */
  xSegments?: number;
  /** Radial samples per cross-section. Plan: ≥ 12. */
  radialSegments?: number;
}

export function composeFish(spec: ArchetypeSpec): FishGeometryDescriptor {
  const xSegments = spec.xSegments ?? 16;
  const radialSegments = spec.radialSegments ?? 12;

  const body = buildRevolvedBody(spec.body, {
    xSegments,
    radialSegments,
    surfaceJitter: spec.surfaceJitter ?? 0,
    seed: spec.seed,
  });

  const bodyIndexStart = 0;
  const bodyIndexCount = body.indexCount;

  const ctx: FinBuilderContext = {
    positions: body.positions,
    normals: body.normals,
    uvs: body.uvs,
    indices: body.indices,
    spineUv: body.spineUv,
  };

  // Caudal — attach at the tail of the body, two tips above/below the spine.
  const c = spec.caudal;
  const tailX = c.attachX + c.tipExtension;
  const caudal = buildCaudalFin(
    ctx,
    { x: c.attachX, y: c.attachY, z: 0 },
    { x: tailX, y: c.attachY + c.tipSpread, z: 0 },
    { x: tailX, y: c.attachY - c.tipSpread, z: 0 },
    c.forkDepth,
  );

  // Dorsal — peak above the body.
  const d = spec.dorsal;
  const dorsal = buildSpineRibbonFin(
    ctx,
    { x: d.frontX, y: d.frontY, z: 0 },
    { x: d.backX, y: d.backY, z: 0 },
    d.peakHeight,
    d.peakX01,
    1,
  );

  // Anal — peak below the body.
  const a = spec.anal;
  const anal = buildSpineRibbonFin(
    ctx,
    { x: a.frontX, y: a.frontY, z: 0 },
    { x: a.backX, y: a.backY, z: 0 },
    a.peakHeight,
    a.peakX01,
    -1,
  );

  // Pectorals — 0..2 fins; first is right side (+z), second is left.
  let pectoralStart = ctx.indices.length;
  let pectoralCount = 0;
  for (let i = 0; i < spec.pectorals.length; i++) {
    const p = spec.pectorals[i]!;
    const side: 1 | -1 = p.rootZ >= 0 ? 1 : -1;
    const r = buildPectoralFin(
      ctx,
      { x: p.rootX, y: p.rootY, z: p.rootZ },
      { x: p.tipX, y: p.tipY, z: p.tipZ },
      p.baseWidth,
      side,
    );
    if (i === 0) pectoralStart = r.indexStart;
    pectoralCount += r.indexCount;
  }

  // Index buffer fits inside Uint16Array if vertex count < 65536. The
  // largest archetype produces ~200 verts, well under the limit.
  if (ctx.positions.length / 3 >= 65536) {
    throw new Error('composeFish: vertex count exceeds Uint16Array range');
  }

  return {
    positions: new Float32Array(ctx.positions),
    normals: new Float32Array(ctx.normals),
    uvs: new Float32Array(ctx.uvs),
    indices: new Uint16Array(ctx.indices),
    spineUv: new Float32Array(ctx.spineUv),
    groups: {
      body: [bodyIndexStart, bodyIndexCount],
      caudal: [caudal.indexStart, caudal.indexCount],
      dorsal: [dorsal.indexStart, dorsal.indexCount],
      anal: [anal.indexStart, anal.indexCount],
      pectoral: [pectoralStart, pectoralCount],
    },
  };
}
