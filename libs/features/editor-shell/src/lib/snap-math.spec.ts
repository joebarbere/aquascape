// Pure-math tests for the snap engine. Stage 5 F5.4.

import {
  focalPoints,
  goldenRatioLines,
  thirdsLines,
} from '@aquascape/domain/geometry';
import type { ObjectId, Scene } from '@aquascape/domain/scene-model';

import {
  DEFAULT_GRID_SIZE_MM,
  gridTargets,
  guideTargets,
  mergeTargets,
  objectTargets,
  snapAxis,
  snapPosition,
  toleranceCssPxToMm,
} from './snap-math';

// ─── Fixtures ─────────────────────────────────────────────────────────────

function sceneWithObjects(objs: Array<{ id: string; x: number; y: number }>): Scene {
  return {
    tank: {
      width: 360,
      height: 220,
      depth: 220,
      glassThickness: 5,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: [] },
    layers: [
      {
        id: 'L' as never,
        name: 'L',
        opacity: 1,
        visible: true,
        locked: false,
        objects: objs.map(
          ({ id, x, y }) =>
            ({
              kind: 'hardscape' as const,
              id: id as never,
              ref: { catalog: 'core', id: 'rock', version: 1 },
              transform: {
                position: { x, y, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                flipX: false,
                flipY: false,
              },
            }) as never,
        ),
      },
    ],
    seed: 1337,
  } as Scene;
}

// ─── gridTargets ──────────────────────────────────────────────────────────

describe('gridTargets', () => {
  it('returns the expected lines for a 360×220 tank at 10 mm spacing', () => {
    const t = gridTargets(360, 220, 10);
    expect(t.xs).toContain(0);
    expect(t.xs).toContain(360);
    expect(t.xs).toContain(180);
    // 37 lines from 0 to 360 step 10.
    expect(t.xs).toHaveLength(37);
    expect(t.ys).toHaveLength(23);
  });

  it('clamps the last entry to the tank edge when spacing does not divide evenly', () => {
    const t = gridTargets(105, 100, 50);
    // 0, 50, 100, then 105 clamped to 105.
    expect(t.xs).toEqual([0, 50, 100, 105]);
    // 0, 50, 100.
    expect(t.ys).toEqual([0, 50, 100]);
  });

  it('empty when gridSizeMm is 0 or negative', () => {
    expect(gridTargets(100, 100, 0)).toEqual({ xs: [], ys: [] });
    expect(gridTargets(100, 100, -5)).toEqual({ xs: [], ys: [] });
  });

  it('empty when either tank dimension is non-positive', () => {
    expect(gridTargets(0, 100, 10)).toEqual({ xs: [], ys: [] });
    expect(gridTargets(100, -1, 10)).toEqual({ xs: [], ys: [] });
  });

  it('uses DEFAULT_GRID_SIZE_MM = 10 (parity with renderer)', () => {
    expect(DEFAULT_GRID_SIZE_MM).toBe(10);
  });
});

// ─── guideTargets ─────────────────────────────────────────────────────────

describe('guideTargets', () => {
  it('includes every golden-ratio + thirds line + focal point', () => {
    const t = guideTargets(360, 220);
    const golden = goldenRatioLines(360, 220);
    const thirds = thirdsLines(360, 220);
    const focals = focalPoints(360, 220);
    for (const v of golden.vertical) expect(t.xs).toContain(v);
    for (const v of thirds.vertical) expect(t.xs).toContain(v);
    for (const v of focals.map((p) => p.x)) expect(t.xs).toContain(v);
    for (const h of golden.horizontal) expect(t.ys).toContain(h);
    for (const h of thirds.horizontal) expect(t.ys).toContain(h);
    for (const h of focals.map((p) => p.y)) expect(t.ys).toContain(h);
  });

  it('de-dupes coordinates appearing in multiple sources', () => {
    // The focal points are intersections of golden-ratio lines, so their
    // x / y values are already in `golden.vertical / horizontal`. The
    // merged set must NOT carry duplicates.
    const t = guideTargets(360, 220);
    const xCounts = new Map<number, number>();
    for (const x of t.xs) xCounts.set(x, (xCounts.get(x) ?? 0) + 1);
    for (const c of xCounts.values()) expect(c).toBe(1);
  });

  it('returns sorted ascending', () => {
    const t = guideTargets(360, 220);
    const sortedX = [...t.xs].sort((a, b) => a - b);
    const sortedY = [...t.ys].sort((a, b) => a - b);
    expect(t.xs).toEqual(sortedX);
    expect(t.ys).toEqual(sortedY);
  });

  it('empty when tank size is non-positive', () => {
    expect(guideTargets(0, 220)).toEqual({ xs: [], ys: [] });
    expect(guideTargets(360, -1)).toEqual({ xs: [], ys: [] });
  });
});

// ─── objectTargets ────────────────────────────────────────────────────────

describe('objectTargets', () => {
  it('returns each object centre on both axes', () => {
    const scene = sceneWithObjects([
      { id: 'a', x: 100, y: 50 },
      { id: 'b', x: 200, y: 80 },
    ]);
    const t = objectTargets(scene, null);
    expect(t.xs).toEqual(expect.arrayContaining([100, 200]));
    expect(t.ys).toEqual(expect.arrayContaining([50, 80]));
  });

  it('excludes the dragged object via `excludeId`', () => {
    const scene = sceneWithObjects([
      { id: 'a', x: 100, y: 50 },
      { id: 'b', x: 200, y: 80 },
    ]);
    const t = objectTargets(scene, 'a' as ObjectId);
    expect(t.xs).not.toContain(100);
    expect(t.ys).not.toContain(50);
    expect(t.xs).toContain(200);
    expect(t.ys).toContain(80);
  });

  it('skips invisible layers', () => {
    const scene: Scene = {
      ...sceneWithObjects([{ id: 'a', x: 100, y: 50 }]),
    };
    (scene.layers as Array<{ visible: boolean }>)[0]!.visible = false;
    const t = objectTargets(scene, null);
    expect(t).toEqual({ xs: [], ys: [] });
  });

  it('empty when scene has no objects', () => {
    const scene = sceneWithObjects([]);
    expect(objectTargets(scene, null)).toEqual({ xs: [], ys: [] });
  });
});

// ─── mergeTargets ─────────────────────────────────────────────────────────

describe('mergeTargets', () => {
  it('unions xs + ys across all groups, de-dupes, sorts ascending', () => {
    const m = mergeTargets({ xs: [10, 20, 30], ys: [5] }, { xs: [20, 40], ys: [5, 15] });
    expect(m.xs).toEqual([10, 20, 30, 40]);
    expect(m.ys).toEqual([5, 15]);
  });

  it('returns empty when every group is empty', () => {
    const m = mergeTargets({ xs: [], ys: [] }, { xs: [], ys: [] });
    expect(m).toEqual({ xs: [], ys: [] });
  });

  it('handles zero groups', () => {
    expect(mergeTargets()).toEqual({ xs: [], ys: [] });
  });
});

// ─── snapAxis ─────────────────────────────────────────────────────────────

describe('snapAxis', () => {
  it('snaps to the nearest target within tolerance', () => {
    const r = snapAxis(102, [100, 200], 5);
    expect(r.value).toBe(100);
    expect(r.target).toBe(100);
  });

  it('does not snap when no target is within tolerance', () => {
    const r = snapAxis(150, [100, 200], 5);
    expect(r.value).toBe(150);
    expect(r.target).toBeNull();
  });

  it('picks the strictly closer target on a tie-breaker contest', () => {
    const r = snapAxis(103, [100, 110], 8);
    expect(r.target).toBe(100); // closer (dist 3 vs 7)
  });

  it('honours tolerance equality (distance == tolerance still snaps)', () => {
    const r = snapAxis(105, [100], 5);
    expect(r.target).toBe(100);
  });

  it('returns value unchanged when tolerance is 0', () => {
    const r = snapAxis(100, [100], 0);
    expect(r.value).toBe(100);
    expect(r.target).toBeNull();
  });

  it('returns value unchanged when targets is empty', () => {
    const r = snapAxis(100, [], 10);
    expect(r.target).toBeNull();
  });

  it('returns value unchanged for non-finite input', () => {
    expect(snapAxis(Number.NaN, [100], 5).target).toBeNull();
    expect(snapAxis(Number.POSITIVE_INFINITY, [100], 5).target).toBeNull();
  });
});

// ─── snapPosition ─────────────────────────────────────────────────────────

describe('snapPosition', () => {
  it('snaps both axes independently — one snaps, the other does not', () => {
    // x=102 within tolerance 5 of 100 → snaps. y=60 at distance 10 from 50,
    // outside tolerance 5 → does NOT snap. Confirms the axes don't share
    // tolerance state.
    const r = snapPosition({ x: 102, y: 60 }, { xs: [100, 200], ys: [50, 80] }, 5);
    expect(r.position).toEqual({ x: 100, y: 60 });
    expect(r.snappedX).toBe(100);
    expect(r.snappedY).toBeNull();
  });

  it('snaps to both axes when both are within tolerance', () => {
    const r = snapPosition({ x: 101, y: 51 }, { xs: [100], ys: [50] }, 5);
    expect(r.position).toEqual({ x: 100, y: 50 });
    expect(r.snappedX).toBe(100);
    expect(r.snappedY).toBe(50);
  });

  it('returns the input unchanged when nothing snaps', () => {
    const r = snapPosition({ x: 150, y: 150 }, { xs: [100], ys: [50] }, 5);
    expect(r.position).toEqual({ x: 150, y: 150 });
    expect(r.snappedX).toBeNull();
    expect(r.snappedY).toBeNull();
  });

  it('returns the input unchanged with empty targets', () => {
    const r = snapPosition({ x: 1, y: 2 }, { xs: [], ys: [] }, 10);
    expect(r.position).toEqual({ x: 1, y: 2 });
    expect(r.snappedX).toBeNull();
    expect(r.snappedY).toBeNull();
  });
});

// ─── toleranceCssPxToMm ───────────────────────────────────────────────────

describe('toleranceCssPxToMm', () => {
  it('divides CSS px by zoom to get world mm', () => {
    expect(toleranceCssPxToMm(8, 2)).toBe(4);
    expect(toleranceCssPxToMm(10, 5)).toBe(2);
  });

  it('returns 0 at zoom = 0 (degenerate viewport)', () => {
    expect(toleranceCssPxToMm(8, 0)).toBe(0);
  });

  it('returns 0 for negative or non-finite inputs', () => {
    expect(toleranceCssPxToMm(8, -1)).toBe(0);
    expect(toleranceCssPxToMm(-5, 2)).toBe(0);
    expect(toleranceCssPxToMm(Number.NaN, 2)).toBe(0);
    expect(toleranceCssPxToMm(8, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
