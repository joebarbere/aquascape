// Pure-math tests for the user-zoom composition layer.

import type { Viewport } from '@aquascape/rendering/renderer-api';

import {
  ZOOM_MULT_MAX,
  ZOOM_MULT_MIN,
  clampZoomMult,
  composeViewport,
  cursorToWorld,
  formatZoomPercent,
  panForCursorAnchor,
  wheelDeltaToZoomFactor,
} from './zoom-math';

const def: Viewport = { center: { x: 180, y: 110 }, zoom: 2, rotation: 0 };

describe('clampZoomMult', () => {
  it('returns the input when within range', () => {
    expect(clampZoomMult(1)).toBe(1);
    expect(clampZoomMult(0.5)).toBe(0.5);
    expect(clampZoomMult(5)).toBe(5);
  });

  it('clamps below ZOOM_MULT_MIN', () => {
    expect(clampZoomMult(0)).toBe(ZOOM_MULT_MIN);
    expect(clampZoomMult(-1)).toBe(ZOOM_MULT_MIN);
    expect(clampZoomMult(0.05)).toBe(ZOOM_MULT_MIN);
  });

  it('clamps above ZOOM_MULT_MAX', () => {
    expect(clampZoomMult(15)).toBe(ZOOM_MULT_MAX);
    expect(clampZoomMult(Number.MAX_SAFE_INTEGER)).toBe(ZOOM_MULT_MAX);
  });

  it('non-finite inputs fall back to 1', () => {
    expect(clampZoomMult(NaN)).toBe(1);
    expect(clampZoomMult(Infinity)).toBe(1);
    expect(clampZoomMult(-Infinity)).toBe(1);
  });
});

describe('composeViewport', () => {
  it('returns def unchanged when both overrides are null', () => {
    expect(composeViewport(def, null, null)).toEqual(def);
  });

  it('scales zoom by userZoomMult', () => {
    expect(composeViewport(def, 1.5, null).zoom).toBeCloseTo(3, 10);
    expect(composeViewport(def, 0.5, null).zoom).toBeCloseTo(1, 10);
  });

  it('shifts centre by userPan', () => {
    const out = composeViewport(def, null, { x: 20, y: -5 });
    expect(out.center).toEqual({ x: 200, y: 105 });
  });

  it('composes zoom AND pan together', () => {
    const out = composeViewport(def, 2, { x: 10, y: 10 });
    expect(out.zoom).toBeCloseTo(4, 10);
    expect(out.center).toEqual({ x: 190, y: 120 });
  });

  it('clamps the multiplier before applying', () => {
    expect(composeViewport(def, 100, null).zoom).toBeCloseTo(def.zoom * ZOOM_MULT_MAX, 10);
    expect(composeViewport(def, 0, null).zoom).toBeCloseTo(def.zoom * ZOOM_MULT_MIN, 10);
  });

  it('non-finite multiplier collapses to 1', () => {
    expect(composeViewport(def, NaN, null).zoom).toBeCloseTo(def.zoom, 10);
  });

  it('preserves rotation', () => {
    const rotated = { ...def, rotation: Math.PI / 4 };
    expect(composeViewport(rotated, 1.5, { x: 5, y: 5 }).rotation).toBe(Math.PI / 4);
  });

  it('degenerate zoom = 0 stays 0 even with a multiplier', () => {
    const zero = { ...def, zoom: 0 };
    expect(composeViewport(zero, 2, null).zoom).toBe(0);
  });
});

describe('cursorToWorld', () => {
  it('returns viewport.center for a cursor at canvas centre', () => {
    const out = cursorToWorld({ x: 400, y: 300 }, def, { width: 800, height: 600 });
    expect(out.x).toBeCloseTo(180, 10);
    expect(out.y).toBeCloseTo(110, 10);
  });

  it('a cursor 100 CSS px to the right of centre at zoom = 2 is +50 mm in world x', () => {
    const out = cursorToWorld({ x: 500, y: 300 }, def, { width: 800, height: 600 });
    expect(out.x).toBeCloseTo(230, 10);
    expect(out.y).toBeCloseTo(110, 10);
  });

  it('y axis is flipped: cursor BELOW centre maps to LOWER world y', () => {
    const out = cursorToWorld({ x: 400, y: 400 }, def, { width: 800, height: 600 });
    // dy = 100 px DOWN; worldY = centerY - 100/2 = 110 - 50 = 60.
    expect(out.y).toBeCloseTo(60, 10);
  });

  it('zoom of zero returns viewport.center (defensive)', () => {
    const zero = { ...def, zoom: 0 };
    expect(cursorToWorld({ x: 0, y: 0 }, zero, { width: 800, height: 600 })).toEqual(zero.center);
  });
});

describe('panForCursorAnchor — round-trip invariant', () => {
  // The invariant we care about: zooming around a cursor point keeps that
  // world point under the cursor. We assemble the full round-trip:
  //   1. Find world point under cursor at zoom₀.
  //   2. Compute pan needed to keep it under cursor at zoom₁.
  //   3. Apply: composeViewport with new mult + pan.
  //   4. Verify: cursorToWorld(cursor, viewport₁) ≈ worldAtCursor₀.

  function roundTrip(
    initialMult: number | null,
    initialPan: { x: number; y: number } | null,
    cursor: { x: number; y: number },
    canvas: { width: number; height: number },
    zoomFactor: number,
  ): { before: { x: number; y: number }; after: { x: number; y: number } } {
    const vp0 = composeViewport(def, initialMult, initialPan);
    const worldAtCursor = cursorToWorld(cursor, vp0, canvas);

    const currentMult = initialMult ?? 1;
    const newMult = clampZoomMult(currentMult * zoomFactor);
    const effectiveZoom = def.zoom * newMult;
    const newPan = panForCursorAnchor(cursor, worldAtCursor, canvas, effectiveZoom, def.center);

    const vp1 = composeViewport(def, newMult, newPan);
    const worldAtCursorAfter = cursorToWorld(cursor, vp1, canvas);
    return { before: worldAtCursor, after: worldAtCursorAfter };
  }

  it('zoom IN from fit (no prior pan) keeps cursor world point fixed', () => {
    const { before, after } = roundTrip(
      null,
      null,
      { x: 600, y: 200 },
      { width: 800, height: 600 },
      1.25,
    );
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('zoom OUT keeps cursor world point fixed', () => {
    const { before, after } = roundTrip(
      1.5,
      { x: 30, y: -20 },
      { x: 250, y: 480 },
      { width: 800, height: 600 },
      1 / 1.25,
    );
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('cursor at canvas centre — pan stays 0 across any zoom factor', () => {
    const out = panForCursorAnchor(
      { x: 400, y: 300 },
      def.center,
      { width: 800, height: 600 },
      def.zoom * 3,
      def.center,
    );
    expect(out.x).toBeCloseTo(0, 10);
    expect(out.y).toBeCloseTo(0, 10);
  });

  it('returns zero pan when effectiveZoom is non-positive (defensive)', () => {
    const out = panForCursorAnchor(
      { x: 100, y: 100 },
      { x: 50, y: 50 },
      { width: 800, height: 600 },
      0,
      def.center,
    );
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('round-trip survives the zoom clamp at the ceiling', () => {
    // Start at the max — a further zoom-in stays at max via clamp.
    const { before, after } = roundTrip(
      ZOOM_MULT_MAX,
      null,
      { x: 100, y: 100 },
      { width: 800, height: 600 },
      2,
    );
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe('wheelDeltaToZoomFactor', () => {
  it('positive deltaY (scroll down) zooms OUT (factor < 1)', () => {
    expect(wheelDeltaToZoomFactor(100)).toBeLessThan(1);
  });

  it('negative deltaY (scroll up) zooms IN (factor > 1)', () => {
    expect(wheelDeltaToZoomFactor(-100)).toBeGreaterThan(1);
  });

  it('zero deltaY is exactly 1 (no change)', () => {
    expect(wheelDeltaToZoomFactor(0)).toBe(1);
  });

  it('non-finite delta returns 1', () => {
    expect(wheelDeltaToZoomFactor(NaN)).toBe(1);
    expect(wheelDeltaToZoomFactor(Infinity)).toBe(1);
  });

  it('symmetric: equal-magnitude opposite deltas multiply to 1', () => {
    expect(wheelDeltaToZoomFactor(50) * wheelDeltaToZoomFactor(-50)).toBeCloseTo(1, 10);
  });
});

describe('formatZoomPercent', () => {
  it('null → 100%', () => {
    expect(formatZoomPercent(null)).toBe('100%');
  });

  it('rounds to whole percent', () => {
    expect(formatZoomPercent(1)).toBe('100%');
    expect(formatZoomPercent(1.26)).toBe('126%');
    expect(formatZoomPercent(0.333)).toBe('33%');
    expect(formatZoomPercent(2)).toBe('200%');
  });

  it('handles fractional multipliers below 1', () => {
    expect(formatZoomPercent(0.5)).toBe('50%');
    expect(formatZoomPercent(0.1)).toBe('10%');
  });
});
