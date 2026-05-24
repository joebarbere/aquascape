import { identityTransform } from '@aquascape/domain/scene-model';
import type { Transform } from '@aquascape/domain/scene-model';

import { applyMoveDrag, applyRotateDrag, applyScaleDrag } from './drag-math';

function transformAt(x: number, y: number, scale = 1, rotationZ = 0): Transform {
  return {
    ...identityTransform(),
    position: { x, y, z: 0 },
    scale: { x: scale, y: scale, z: scale },
    rotation: { x: 0, y: 0, z: rotationZ },
  };
}

describe('applyMoveDrag', () => {
  it('translates position by the supplied delta', () => {
    const result = applyMoveDrag(transformAt(100, 50), { x: 30, y: -20 });
    expect(result.position).toEqual({ x: 130, y: 30, z: 0 });
  });

  it('returns identity on zero delta', () => {
    const before = transformAt(0, 0);
    const after = applyMoveDrag(before, { x: 0, y: 0 });
    expect(after.position).toEqual(before.position);
  });

  it('does not mutate the input transform', () => {
    const before = transformAt(0, 0);
    const before2 = JSON.parse(JSON.stringify(before));
    applyMoveDrag(before, { x: 100, y: 100 });
    expect(before).toEqual(before2);
  });

  it('preserves scale and rotation', () => {
    const before = transformAt(0, 0, 1.5, Math.PI / 4);
    const after = applyMoveDrag(before, { x: 1, y: 1 });
    expect(after.scale).toEqual(before.scale);
    expect(after.rotation).toEqual(before.rotation);
  });
});

describe('applyScaleDrag', () => {
  it('returns the original transform when cursor === start', () => {
    const original = transformAt(0, 0, 1);
    const out = applyScaleDrag({
      original,
      cursorWorld: { x: 50, y: 50 },
      startWorld: { x: 50, y: 50 },
    });
    expect(out.scale).toEqual(original.scale);
  });

  it('scales by the cursor-distance / start-distance ratio', () => {
    // Object at origin, start at (10, 0), cursor at (20, 0) → ratio = 2.
    const original = transformAt(0, 0, 1);
    const out = applyScaleDrag({
      original,
      startWorld: { x: 10, y: 0 },
      cursorWorld: { x: 20, y: 0 },
    });
    expect(out.scale.x).toBe(2);
    expect(out.scale.y).toBe(2);
  });

  it('returns identity when start coincides with the object centre', () => {
    const original = transformAt(0, 0, 1);
    const out = applyScaleDrag({
      original,
      startWorld: { x: 0, y: 0 },
      cursorWorld: { x: 50, y: 50 },
    });
    expect(out).toEqual(original);
  });

  it('clamps shrink ratio at the MIN_SCALE_RATIO floor', () => {
    const original = transformAt(0, 0, 1);
    const out = applyScaleDrag({
      original,
      startWorld: { x: 100, y: 0 },
      cursorWorld: { x: 0.0001, y: 0 },
    });
    // The clamp keeps scale ≥ 1 × 0.01 = 0.01.
    expect(out.scale.x).toBeGreaterThanOrEqual(0.01);
  });

  it('uses the object centre, not the world origin, for the ratio', () => {
    // Object centred at (100, 100). Start at (110, 100) (distance 10),
    // cursor at (130, 100) (distance 30) → ratio 3.
    const original = transformAt(100, 100, 2);
    const out = applyScaleDrag({
      original,
      startWorld: { x: 110, y: 100 },
      cursorWorld: { x: 130, y: 100 },
    });
    expect(out.scale.x).toBeCloseTo(6, 9);
  });

  it('preserves position and rotation', () => {
    const original = transformAt(50, 50, 1, Math.PI / 6);
    const out = applyScaleDrag({
      original,
      startWorld: { x: 60, y: 50 },
      cursorWorld: { x: 80, y: 50 },
    });
    expect(out.position).toEqual(original.position);
    expect(out.rotation).toEqual(original.rotation);
  });
});

describe('applyRotateDrag', () => {
  it('returns the original transform when start coincides with the centre', () => {
    const original = transformAt(0, 0, 1, 0);
    const out = applyRotateDrag({
      original,
      startWorld: { x: 0, y: 0 },
      cursorWorld: { x: 10, y: 10 },
    });
    expect(out).toEqual(original);
  });

  it('rotates by 90° when the cursor sweeps from +x to +y', () => {
    const original = transformAt(0, 0, 1, 0);
    const out = applyRotateDrag({
      original,
      startWorld: { x: 10, y: 0 },
      cursorWorld: { x: 0, y: 10 },
    });
    expect(out.rotation.z).toBeCloseTo(Math.PI / 2, 9);
  });

  it('rotates by -90° when the cursor sweeps the other way', () => {
    const original = transformAt(0, 0, 1, 0);
    const out = applyRotateDrag({
      original,
      startWorld: { x: 10, y: 0 },
      cursorWorld: { x: 0, y: -10 },
    });
    expect(out.rotation.z).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('returns near-zero delta when the cursor matches the start (no rotation)', () => {
    const original = transformAt(0, 0, 1, Math.PI / 4);
    const out = applyRotateDrag({
      original,
      startWorld: { x: 10, y: 0 },
      cursorWorld: { x: 10, y: 0 },
    });
    expect(out.rotation.z).toBeCloseTo(Math.PI / 4, 9);
  });

  it('accumulates onto the existing rotation', () => {
    const original = transformAt(0, 0, 1, Math.PI / 4);
    const out = applyRotateDrag({
      original,
      startWorld: { x: 10, y: 0 },
      cursorWorld: { x: 0, y: 10 },
    });
    // 90° more than the existing 45° = 135°.
    expect(out.rotation.z).toBeCloseTo(Math.PI / 4 + Math.PI / 2, 9);
  });

  it('preserves position and scale', () => {
    const original = transformAt(50, 50, 1.5, 0);
    const out = applyRotateDrag({
      original,
      startWorld: { x: 60, y: 50 },
      cursorWorld: { x: 50, y: 60 },
    });
    expect(out.position).toEqual(original.position);
    expect(out.scale).toEqual(original.scale);
  });
});
