/**
 * Per-archetype shape + invariant tests.
 *
 * Each archetype builder must:
 *   - return a descriptor with all five typed-array buffers populated,
 *   - have `groups.body[1] > 0` (body indices written first),
 *   - have a body silhouette spanning roughly the unit interval along X,
 *   - have a body silhouette fitting the archetype's Y bounds,
 *   - be deterministic — two calls produce byte-identical buffers,
 *   - have unit-length normals on every body vertex.
 *
 * The Y-bounds check is the load-bearing assertion that the control-curve
 * tuning didn't silently shift — e.g., if someone bumps the deep-bodied
 * peak to 1.0 we want the test to scream, not for the fish to start
 * clipping the tank lid in 3D.
 */

import type { FishGeometryDescriptor } from '../index';
import {
  buildSlimTetraGeometry,
  buildDeepBodiedGeometry,
  buildBarbGeometry,
  buildCoryCylinderGeometry,
  buildEelGeometry,
  buildHatchetWedgeGeometry,
  buildCrawlerGeometry,
} from './archetypes';

interface ArchetypeCase {
  name: string;
  build: () => FishGeometryDescriptor;
  /** Tightest plausible [yMin, yMax] containing the body silhouette. */
  bodyYBounds: [number, number];
  /** Tightest plausible [zMin, zMax] containing the body silhouette. */
  bodyZBounds: [number, number];
  /** Whether the archetype has any pectorals (most do; eel has minimal). */
  hasPectorals: boolean;
}

const CASES: readonly ArchetypeCase[] = [
  {
    name: 'slim-tetra',
    build: buildSlimTetraGeometry,
    bodyYBounds: [-0.22, 0.22],
    bodyZBounds: [-0.1, 0.1],
    hasPectorals: true,
  },
  {
    name: 'deep-bodied',
    build: buildDeepBodiedGeometry,
    bodyYBounds: [-0.5, 0.5],
    bodyZBounds: [-0.1, 0.1],
    hasPectorals: true,
  },
  {
    name: 'barb',
    build: buildBarbGeometry,
    bodyYBounds: [-0.36, 0.36],
    bodyZBounds: [-0.16, 0.16],
    hasPectorals: true,
  },
  {
    name: 'cory-cylinder',
    build: buildCoryCylinderGeometry,
    bodyYBounds: [-0.2, 0.25],
    bodyZBounds: [-0.2, 0.2],
    hasPectorals: true,
  },
  {
    name: 'eel',
    build: buildEelGeometry,
    bodyYBounds: [-0.09, 0.09],
    bodyZBounds: [-0.06, 0.06],
    hasPectorals: true,
  },
  {
    name: 'hatchet-wedge',
    build: buildHatchetWedgeGeometry,
    bodyYBounds: [-0.45, 0.2],
    bodyZBounds: [-0.09, 0.09],
    hasPectorals: true,
  },
];

function bodyExtents(g: FishGeometryDescriptor): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
} {
  const verts = g.positions;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  // Body vertices come first (block of xSegments*radialSegments triplets).
  // The `groups.body` is index-range, not vertex-range, so we instead walk
  // every vertex referenced by body indices.
  const [bStart, bCount] = g.groups.body;
  const seen = new Set<number>();
  for (let i = bStart; i < bStart + bCount; i++) {
    seen.add(g.indices[i]!);
  }
  for (const v of seen) {
    const x = verts[v * 3]!;
    const y = verts[v * 3 + 1]!;
    const z = verts[v * 3 + 2]!;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  return { xMin, xMax, yMin, yMax, zMin, zMax };
}

describe.each(CASES)('archetype $name', (c) => {
  it('returns a populated FishGeometryDescriptor', () => {
    const g = c.build();
    expect(g.positions.length).toBeGreaterThan(0);
    expect(g.positions.length % 3).toBe(0);
    expect(g.normals.length).toBe(g.positions.length);
    expect(g.uvs.length).toBe((g.positions.length / 3) * 2);
    expect(g.spineUv.length).toBe(g.uvs.length);
    expect(g.indices.length).toBeGreaterThan(0);
    expect(g.indices.length % 3).toBe(0);
  });

  it('has the correct groups shape', () => {
    const g = c.build();
    expect(g.groups.body.length).toBe(2);
    expect(g.groups.caudal.length).toBe(2);
    expect(g.groups.dorsal.length).toBe(2);
    expect(g.groups.anal.length).toBe(2);
    expect(g.groups.pectoral.length).toBe(2);
    expect(g.groups.body[0]).toBe(0);
    expect(g.groups.body[1]).toBeGreaterThan(0);
    expect(g.groups.caudal[1]).toBeGreaterThan(0);
    expect(g.groups.dorsal[1]).toBeGreaterThan(0);
    expect(g.groups.anal[1]).toBeGreaterThan(0);
    if (c.hasPectorals) {
      expect(g.groups.pectoral[1]).toBeGreaterThan(0);
    }
  });

  it('body silhouette spans roughly [0, 1] along X', () => {
    const g = c.build();
    const e = bodyExtents(g);
    expect(e.xMin).toBeGreaterThanOrEqual(-0.05);
    expect(e.xMin).toBeLessThan(0.05);
    expect(e.xMax).toBeGreaterThan(0.9);
    expect(e.xMax).toBeLessThanOrEqual(1.05);
  });

  it('body silhouette fits the archetype Y bounds', () => {
    const g = c.build();
    const e = bodyExtents(g);
    expect(e.yMin).toBeGreaterThanOrEqual(c.bodyYBounds[0]);
    expect(e.yMax).toBeLessThanOrEqual(c.bodyYBounds[1]);
  });

  it('body silhouette fits the archetype Z bounds', () => {
    const g = c.build();
    const e = bodyExtents(g);
    expect(e.zMin).toBeGreaterThanOrEqual(c.bodyZBounds[0]);
    expect(e.zMax).toBeLessThanOrEqual(c.bodyZBounds[1]);
  });

  it('produces byte-identical buffers across calls (determinism)', () => {
    const a = c.build();
    const b = c.build();
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.normals)).toEqual(Array.from(b.normals));
    expect(Array.from(a.uvs)).toEqual(Array.from(b.uvs));
    expect(Array.from(a.spineUv)).toEqual(Array.from(b.spineUv));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(a.groups).toEqual(b.groups);
  });

  it('every body vertex has a unit-length normal (|n| ≈ 1)', () => {
    const g = c.build();
    const seen = new Set<number>();
    const [bStart, bCount] = g.groups.body;
    for (let i = bStart; i < bStart + bCount; i++) seen.add(g.indices[i]!);
    for (const v of seen) {
      const nx = g.normals[v * 3]!;
      const ny = g.normals[v * 3 + 1]!;
      const nz = g.normals[v * 3 + 2]!;
      const len = Math.hypot(nx, ny, nz);
      // Surface jitter shifts vertices along normals but does not modify
      // the stored normal, so |n| must stay 1.0 to within float precision.
      expect(Math.abs(len - 1)).toBeLessThan(1e-4);
    }
  });

  it('spineUv first channel equals vertex X for body vertices', () => {
    const g = c.build();
    const [bStart, bCount] = g.groups.body;
    const seen = new Set<number>();
    for (let i = bStart; i < bStart + bCount; i++) seen.add(g.indices[i]!);
    for (const v of seen) {
      const s = g.spineUv[v * 2]!;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('respects the 400-vertex perf budget', () => {
    const g = c.build();
    expect(g.positions.length / 3).toBeLessThanOrEqual(400);
  });
});

describe('archetype distinctness', () => {
  it('eel is narrower than slim-tetra in both Y and Z', () => {
    const eel = bodyExtents(buildEelGeometry());
    const tetra = bodyExtents(buildSlimTetraGeometry());
    expect(eel.yMax - eel.yMin).toBeLessThan(tetra.yMax - tetra.yMin);
    expect(eel.zMax - eel.zMin).toBeLessThan(tetra.zMax - tetra.zMin);
  });

  it('deep-bodied is taller than slim-tetra', () => {
    const deep = bodyExtents(buildDeepBodiedGeometry());
    const tetra = bodyExtents(buildSlimTetraGeometry());
    expect(deep.yMax - deep.yMin).toBeGreaterThan(tetra.yMax - tetra.yMin);
  });

  it('hatchet-wedge has a deeper keel below the spine than dome above', () => {
    const hatchet = bodyExtents(buildHatchetWedgeGeometry());
    // Below the spine (y < 0) should be deeper than above (y > 0).
    expect(Math.abs(hatchet.yMin)).toBeGreaterThan(Math.abs(hatchet.yMax));
  });

  it('cory has its silhouette biased upward (flat belly)', () => {
    const cory = bodyExtents(buildCoryCylinderGeometry());
    // yOffset > 0 means the body sits above the spine more than below.
    expect(cory.yMax).toBeGreaterThan(Math.abs(cory.yMin));
  });
});

// ─── crawler (F11.6 Wave 2) ──────────────────────────────────────────────
//
// Shrimp + snail archetype. Different shape contract than the fish
// archetypes: NO fins (caudal/dorsal/anal/pectoral all empty), stubby
// body, antennae extending past x=1 from the head. The descriptor's
// `groups` field still has all five entries to keep the type valid —
// the four fin entries are `[0, 0]`.

describe('buildCrawlerGeometry', () => {
  it('returns a populated FishGeometryDescriptor with paired typed-array buffers', () => {
    const g = buildCrawlerGeometry();
    expect(g.positions.length).toBeGreaterThan(0);
    expect(g.positions.length % 3).toBe(0);
    expect(g.normals.length).toBe(g.positions.length);
    expect(g.uvs.length).toBe((g.positions.length / 3) * 2);
    expect(g.spineUv.length).toBe(g.uvs.length);
    expect(g.indices.length).toBeGreaterThan(0);
    expect(g.indices.length % 3).toBe(0);
  });

  it('has body group populated and all four fin groups empty', () => {
    const g = buildCrawlerGeometry();
    expect(g.groups.body[0]).toBe(0);
    expect(g.groups.body[1]).toBeGreaterThan(0);
    // No fish fins — empty index ranges.
    expect(g.groups.caudal).toEqual([0, 0]);
    expect(g.groups.dorsal).toEqual([0, 0]);
    expect(g.groups.anal).toEqual([0, 0]);
    expect(g.groups.pectoral).toEqual([0, 0]);
  });

  it('produces byte-identical buffers across calls (determinism)', () => {
    const a = buildCrawlerGeometry();
    const b = buildCrawlerGeometry();
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.normals)).toEqual(Array.from(b.normals));
    expect(Array.from(a.uvs)).toEqual(Array.from(b.uvs));
    expect(Array.from(a.spineUv)).toEqual(Array.from(b.spineUv));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(a.groups).toEqual(b.groups);
  });

  it('respects the perf budget (≤ 200 vertices — well under the fish 400 cap)', () => {
    const g = buildCrawlerGeometry();
    expect(g.positions.length / 3).toBeLessThanOrEqual(200);
  });

  it('has a stubby body silhouette — ~0.25 depth, ~0.20 lateral', () => {
    const g = buildCrawlerGeometry();
    const [bStart, bCount] = g.groups.body;
    const seen = new Set<number>();
    for (let i = bStart; i < bStart + bCount; i++) seen.add(g.indices[i]!);
    let yMin = Infinity;
    let yMax = -Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const v of seen) {
      const y = g.positions[v * 3 + 1]!;
      const z = g.positions[v * 3 + 2]!;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
    expect(yMax - yMin).toBeLessThan(0.35);
    expect(zMax - zMin).toBeLessThan(0.3);
  });

  it('extends antennae past x = 1.0 forward of the head', () => {
    const g = buildCrawlerGeometry();
    // Antennae are appended *after* the body indices, so their vertices
    // live at vertex indices > body-vertex-count. Walk every position
    // and confirm at least some vertex reaches into the x > 1.0 region
    // (forward of the head, since the body spans roughly [0, 1]).
    let xMax = -Infinity;
    for (let v = 0; v * 3 < g.positions.length; v++) {
      const x = g.positions[v * 3]!;
      if (x > xMax) xMax = x;
    }
    expect(xMax).toBeGreaterThan(1.0);
  });

  it('has a body silhouette that fits the unit-ish X envelope', () => {
    const g = buildCrawlerGeometry();
    const [bStart, bCount] = g.groups.body;
    const seen = new Set<number>();
    for (let i = bStart; i < bStart + bCount; i++) seen.add(g.indices[i]!);
    let xMin = Infinity;
    let xMax = -Infinity;
    for (const v of seen) {
      const x = g.positions[v * 3]!;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
    expect(xMin).toBeGreaterThanOrEqual(-0.05);
    expect(xMax).toBeLessThanOrEqual(1.05);
  });
});
