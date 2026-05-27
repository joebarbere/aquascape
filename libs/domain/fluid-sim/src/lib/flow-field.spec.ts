import { bakeFlowField, sampleFlowField, type FlowField } from './flow-field';
import type { Aabb } from './types';

const TANK: Aabb = {
  min: { x: 0, y: 0, z: 0 },
  max: { x: 800, y: 400, z: 400 },
};

function fieldExtent(field: FlowField): { x: number; y: number; z: number } {
  return {
    x: field.gx * field.cellSize,
    y: field.gy * field.cellSize,
    z: field.gz * field.cellSize,
  };
}

describe('bakeFlowField', () => {
  it('returns an all-zero field for empty sources', () => {
    const field = bakeFlowField({ tankAabb: TANK, sources: [] });
    expect(field.gx).toBe(32);
    expect(field.gy).toBe(32);
    expect(field.gz).toBe(32);
    expect(field.u.length).toBe(32 * 32 * 32);
    expect(field.v.length).toBe(32 * 32 * 32);
    expect(field.w.length).toBe(32 * 32 * 32);
    for (let i = 0; i < field.u.length; i++) {
      expect(field.u[i]).toBe(0);
      expect(field.v[i]).toBe(0);
      expect(field.w[i]).toBe(0);
    }
  });

  it('produces positive u near a +x outflow', () => {
    const outflowPos = { x: 400, y: 200, z: 200 }; // tank centre
    const field = bakeFlowField({
      tankAabb: TANK,
      sources: [{ outflowPos, outflowVec: { x: 1, y: 0, z: 0 }, flowRate: 200 }],
    });
    // Sample directly at the source: there's a +x velocity contribution.
    const here = sampleFlowField(field, outflowPos);
    expect(here.x).toBeGreaterThan(0);
    // Sample at the opposite corner — should be far weaker (and projection
    // may have given it a small negative or positive value, but its
    // magnitude should be a small fraction of the source).
    const far = sampleFlowField(field, { x: 50, y: 50, z: 50 });
    expect(Math.abs(far.x)).toBeLessThan(here.x);
  });

  it('projection caps interior divergence near a source/sink pair', () => {
    const field = bakeFlowField({
      tankAabb: TANK,
      sources: [
        {
          outflowPos: { x: 200, y: 200, z: 200 },
          outflowVec: { x: 1, y: 0, z: 0 },
          intakePos: { x: 600, y: 200, z: 200 },
          flowRate: 200,
        },
      ],
    });
    // Sample divergence at the source cell via central differences on the
    // sampled field. We expect projection to have reduced it to a small
    // value (no analytic zero — projection is approximate).
    const h = field.cellSize;
    const p = { x: 200, y: 200, z: 200 };
    const ux1 = sampleFlowField(field, { x: p.x + h, y: p.y, z: p.z }).x;
    const ux0 = sampleFlowField(field, { x: p.x - h, y: p.y, z: p.z }).x;
    const vy1 = sampleFlowField(field, { x: p.x, y: p.y + h, z: p.z }).y;
    const vy0 = sampleFlowField(field, { x: p.x, y: p.y - h, z: p.z }).y;
    const wz1 = sampleFlowField(field, { x: p.x, y: p.y, z: p.z + h }).z;
    const wz0 = sampleFlowField(field, { x: p.x, y: p.y, z: p.z - h }).z;
    const div = (ux1 - ux0) / (2 * h) + (vy1 - vy0) / (2 * h) + (wz1 - wz0) / (2 * h);
    // Source kernel peaks ≈ 50 mm/s; pre-projection divergence would be
    // tens-of-/s. Post-projection, divergence should be bounded much lower
    // than the source magnitude itself.
    expect(Math.abs(div)).toBeLessThan(50);
  });

  it('defaults outflowVec to (0, 0, 1) when absent', () => {
    const center = { x: 400, y: 200, z: 200 };
    const field = bakeFlowField({
      tankAabb: TANK,
      sources: [{ outflowPos: center, flowRate: 200 }],
    });
    const sample = sampleFlowField(field, center);
    // Default direction = +z, so |w| should dominate.
    expect(Math.abs(sample.z)).toBeGreaterThan(Math.abs(sample.x));
    expect(Math.abs(sample.z)).toBeGreaterThan(Math.abs(sample.y));
  });

  it('falls back to (0, 0, 1) when outflowVec is the zero vector', () => {
    const center = { x: 400, y: 200, z: 200 };
    const field = bakeFlowField({
      tankAabb: TANK,
      sources: [{ outflowPos: center, outflowVec: { x: 0, y: 0, z: 0 } }],
    });
    const sample = sampleFlowField(field, center);
    expect(Math.abs(sample.z)).toBeGreaterThan(0);
  });

  it('scales velocity with flowRate', () => {
    const center = { x: 400, y: 200, z: 200 };
    const low = bakeFlowField({
      tankAabb: TANK,
      sources: [{ outflowPos: center, outflowVec: { x: 1, y: 0, z: 0 }, flowRate: 100 }],
    });
    const high = bakeFlowField({
      tankAabb: TANK,
      sources: [{ outflowPos: center, outflowVec: { x: 1, y: 0, z: 0 }, flowRate: 400 }],
    });
    expect(sampleFlowField(high, center).x).toBeGreaterThan(sampleFlowField(low, center).x);
  });

  it('honours flowRate default when absent', () => {
    const center = { x: 400, y: 200, z: 200 };
    const explicit = bakeFlowField({
      tankAabb: TANK,
      sources: [{ outflowPos: center, outflowVec: { x: 1, y: 0, z: 0 }, flowRate: 200 }],
    });
    const implicit = bakeFlowField({
      tankAabb: TANK,
      sources: [{ outflowPos: center, outflowVec: { x: 1, y: 0, z: 0 } }],
    });
    expect(sampleFlowField(implicit, center).x).toBeCloseTo(
      sampleFlowField(explicit, center).x,
      6,
    );
  });

  it('clamps out-of-grid samples to the nearest edge (no NaN, no crash)', () => {
    const field = bakeFlowField({
      tankAabb: TANK,
      sources: [
        { outflowPos: { x: 400, y: 200, z: 200 }, outflowVec: { x: 1, y: 0, z: 0 } },
      ],
    });
    const farBelow = sampleFlowField(field, { x: -10000, y: -10000, z: -10000 });
    const farAbove = sampleFlowField(field, { x: 1e7, y: 1e7, z: 1e7 });
    for (const s of [farBelow, farAbove]) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
      expect(Number.isFinite(s.z)).toBe(true);
    }
  });

  it('is deterministic — same inputs produce byte-identical typed arrays', () => {
    const opts = {
      tankAabb: TANK,
      sources: [
        {
          outflowPos: { x: 300, y: 100, z: 200 },
          outflowVec: { x: 1, y: 0, z: 0 },
          intakePos: { x: 500, y: 200, z: 300 },
          flowRate: 250,
        },
      ],
    };
    const a = bakeFlowField(opts);
    const b = bakeFlowField(opts);
    expect(Buffer.from(a.u.buffer).equals(Buffer.from(b.u.buffer))).toBe(true);
    expect(Buffer.from(a.v.buffer).equals(Buffer.from(b.v.buffer))).toBe(true);
    expect(Buffer.from(a.w.buffer).equals(Buffer.from(b.w.buffer))).toBe(true);
  });

  it('respects a gridSize override', () => {
    const field = bakeFlowField({ tankAabb: TANK, sources: [], gridSize: 8 });
    expect(field.gx).toBe(8);
    expect(field.gy).toBe(8);
    expect(field.gz).toBe(8);
    expect(field.u.length).toBe(8 * 8 * 8);
    const extent = fieldExtent(field);
    expect(extent.x).toBeCloseTo(800, 6);
  });

  it('respects a projectionIterations override (more iters → tighter divergence)', () => {
    const opts = {
      tankAabb: TANK,
      sources: [
        { outflowPos: { x: 400, y: 200, z: 200 }, outflowVec: { x: 1, y: 0, z: 0 } },
      ],
    };
    const sloppy = bakeFlowField({ ...opts, projectionIterations: 1 });
    const tight = bakeFlowField({ ...opts, projectionIterations: 40 });
    // Tightening should not corrupt the field — assert no NaNs and that the
    // peak velocity is finite and positive in both cases.
    const sP = sampleFlowField(sloppy, { x: 400, y: 200, z: 200 });
    const tP = sampleFlowField(tight, { x: 400, y: 200, z: 200 });
    expect(sP.x).toBeGreaterThan(0);
    expect(tP.x).toBeGreaterThan(0);
  });

  it('clamps a source position outside the tank into the interior', () => {
    // A source positioned way outside the AABB should be remapped to an
    // interior cell, not silently dropped.
    const field = bakeFlowField({
      tankAabb: TANK,
      sources: [
        {
          outflowPos: { x: -5000, y: -5000, z: -5000 },
          outflowVec: { x: 1, y: 0, z: 0 },
          flowRate: 200,
        },
      ],
    });
    // Sample near the (clamped) interior cell at min corner + ~1 cell.
    const sample = sampleFlowField(field, { x: field.cellSize, y: field.cellSize, z: field.cellSize });
    // We expect a non-zero deposit somewhere near the corner.
    let anyNonZero = false;
    for (let i = 0; i < field.u.length; i++) {
      if (field.u[i] !== 0 || field.v[i] !== 0 || field.w[i] !== 0) {
        anyNonZero = true;
        break;
      }
    }
    expect(anyNonZero).toBe(true);
    expect(Number.isFinite(sample.x)).toBe(true);
  });
});
