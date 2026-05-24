// Unit tests for the default viewport computation. Stage 0 F0.6.

import { VIEWPORT_PADDING_FACTOR, defaultViewport } from './default-viewport';

describe('defaultViewport', () => {
  it('centers the viewport at the tank centre', () => {
    const v = defaultViewport({ width: 800, height: 600 }, { width: 600, height: 360 });
    expect(v.center).toEqual({ x: 300, y: 180 });
  });

  it('uses zero rotation in Stage 0', () => {
    const v = defaultViewport({ width: 800, height: 600 }, { width: 600, height: 360 });
    expect(v.rotation).toBe(0);
  });

  it('picks the smaller axis so the whole tank fits with padding', () => {
    // Wide canvas, narrow tank: limiting axis is height (600 / (360 * 1.1)).
    const v = defaultViewport({ width: 4000, height: 600 }, { width: 600, height: 360 });
    expect(v.zoom).toBeCloseTo(600 / (360 * VIEWPORT_PADDING_FACTOR), 6);

    // Tall canvas, square tank: limiting axis is width.
    const v2 = defaultViewport({ width: 400, height: 4000 }, { width: 400, height: 400 });
    expect(v2.zoom).toBeCloseTo(400 / (400 * VIEWPORT_PADDING_FACTOR), 6);
  });

  it('applies the configured padding factor on both axes', () => {
    const v = defaultViewport({ width: 1000, height: 1000 }, { width: 500, height: 500 });
    // Both axes equal; either ratio yields 1000 / (500 * 1.1).
    expect(v.zoom).toBeCloseTo(1000 / (500 * VIEWPORT_PADDING_FACTOR), 6);
  });

  it('returns zoom 0 (not NaN / Infinity) for degenerate inputs', () => {
    expect(defaultViewport({ width: 0, height: 600 }, { width: 600, height: 360 }).zoom).toBe(0);
    expect(defaultViewport({ width: 800, height: 0 }, { width: 600, height: 360 }).zoom).toBe(0);
    expect(defaultViewport({ width: 800, height: 600 }, { width: 0, height: 360 }).zoom).toBe(0);
    expect(defaultViewport({ width: 800, height: 600 }, { width: 600, height: 0 }).zoom).toBe(0);
    expect(defaultViewport({ width: -1, height: 600 }, { width: 600, height: 360 }).zoom).toBe(0);
  });

  it('still centers the viewport even for degenerate sizes', () => {
    const v = defaultViewport({ width: 0, height: 0 }, { width: 600, height: 360 });
    expect(v.center).toEqual({ x: 300, y: 180 });
    expect(v.rotation).toBe(0);
  });
});
