import { createBubbleSlice, stepBubbleSlice, type BubbleSlice } from './bubble-slice';

function totalDensity(slice: BubbleSlice): number {
  let s = 0;
  for (let i = 0; i < slice.density.length; i++) s += slice.density[i]!;
  return s;
}

function totalAbs(arr: Float32Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += Math.abs(arr[i]!);
  return s;
}

function hasNaN(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i++) if (Number.isNaN(arr[i])) return true;
  return false;
}

function seedDensity(slice: BubbleSlice, value: number): void {
  // Inject density in a small interior square (mimics an air-stone source
  // that's already deposited some bubbles).
  const n = slice.n;
  const ci = Math.floor((n + 2) / 2);
  const cj = Math.floor((n + 2) / 4); // lower-third of the slice
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      slice.density[(ci + di) + (n + 2) * (cj + dj)] = value;
    }
  }
}

describe('createBubbleSlice', () => {
  it('returns a 32×32 slice at the requested origin', () => {
    const origin = { x: 100, y: 0, z: 100 };
    const slice = createBubbleSlice({ origin });
    expect(slice.n).toBe(32);
    expect(slice.origin).toEqual(origin);
    expect(slice.cellSize).toBe(20);
    expect(slice.u.length).toBe((32 + 2) * (32 + 2));
    expect(slice.v.length).toBe(slice.u.length);
    expect(slice.density.length).toBe(slice.u.length);
    // Scratch arrays exist + are zeroed.
    expect(slice.scratchU.length).toBe(slice.u.length);
    expect(slice.scratchV.length).toBe(slice.u.length);
    expect(slice.scratchDensity.length).toBe(slice.u.length);
    expect(slice.pressure.length).toBe(slice.u.length);
    expect(slice.divergence.length).toBe(slice.u.length);
    for (let i = 0; i < slice.u.length; i++) {
      expect(slice.u[i]).toBe(0);
      expect(slice.v[i]).toBe(0);
      expect(slice.density[i]).toBe(0);
    }
  });

  it('honours gridSize and cellSize overrides', () => {
    const slice = createBubbleSlice({
      origin: { x: 0, y: 0, z: 0 },
      gridSize: 16,
      cellSize: 10,
    });
    expect(slice.n).toBe(16);
    expect(slice.cellSize).toBe(10);
    expect(slice.u.length).toBe(18 * 18);
  });
});

describe('stepBubbleSlice', () => {
  it('does not introduce NaNs across 1000 steps with no forces', () => {
    const slice = createBubbleSlice({ origin: { x: 0, y: 0, z: 0 } });
    seedDensity(slice, 1.0);
    for (let i = 0; i < 1000; i++) {
      stepBubbleSlice(slice, 1 / 60);
    }
    expect(hasNaN(slice.u)).toBe(false);
    expect(hasNaN(slice.v)).toBe(false);
    expect(hasNaN(slice.density)).toBe(false);
  });

  it('keeps total density roughly conserved over 100 steps with no forces', () => {
    const slice = createBubbleSlice({ origin: { x: 0, y: 0, z: 0 } });
    seedDensity(slice, 1.0);
    const start = totalDensity(slice);
    for (let i = 0; i < 100; i++) {
      stepBubbleSlice(slice, 1 / 60);
    }
    const end = totalDensity(slice);
    // Semi-Lagrangian advection isn't conservative but loses/gains gently.
    // Demand the magnitude doesn't explode or vanish — between 25% and 250%
    // of the starting total.
    expect(end).toBeGreaterThan(start * 0.25);
    expect(end).toBeLessThan(start * 2.5);
  });

  it('advects density along the force direction (upward when +v force is injected)', () => {
    const slice = createBubbleSlice({ origin: { x: 0, y: 0, z: 0 } });
    seedDensity(slice, 1.0);
    const n = slice.n;
    const size = (n + 2) * (n + 2);

    // Build a gentle upward (+v) force field — buoyancy proxy. Forces are
    // applied as field += dt * force, so over 60 frames at dt=1/60 the
    // accumulated velocity is ~force units; we want sub-cell-per-tick
    // advection magnitude so density stays within the grid.
    const fU = new Float32Array(size);
    const fV = new Float32Array(size);
    for (let i = 0; i < size; i++) fV[i] = 0.5;

    // Density centroid (weighted average row) before stepping.
    function centroidRow(): number {
      let mass = 0;
      let rowMass = 0;
      for (let j = 0; j < n + 2; j++) {
        for (let i = 0; i < n + 2; i++) {
          const d = slice.density[i + (n + 2) * j]!;
          mass += d;
          rowMass += d * j;
        }
      }
      return mass > 1e-9 ? rowMass / mass : 0;
    }
    const startCentroid = centroidRow();

    for (let i = 0; i < 60; i++) {
      stepBubbleSlice(slice, 1 / 60, { u: fU, v: fV });
    }

    const endCentroid = centroidRow();
    // The centroid should have moved in the +v direction (higher row index).
    expect(endCentroid).toBeGreaterThan(startCentroid);
  });

  it('runs without externalForces (the optional-arg path)', () => {
    const slice = createBubbleSlice({ origin: { x: 0, y: 0, z: 0 } });
    expect(() => stepBubbleSlice(slice, 1 / 60)).not.toThrow();
  });

  it('is deterministic — identical inputs reproduce the density field byte-for-byte', () => {
    const a = createBubbleSlice({ origin: { x: 50, y: 50, z: 50 } });
    const b = createBubbleSlice({ origin: { x: 50, y: 50, z: 50 } });
    seedDensity(a, 0.5);
    seedDensity(b, 0.5);
    const size = a.u.length;
    const fU = new Float32Array(size);
    const fV = new Float32Array(size);
    for (let i = 0; i < size; i++) fV[i] = 0.3;
    for (let s = 0; s < 50; s++) {
      stepBubbleSlice(a, 1 / 60, { u: fU, v: fV });
      stepBubbleSlice(b, 1 / 60, { u: fU, v: fV });
    }
    expect(Buffer.from(a.density.buffer).equals(Buffer.from(b.density.buffer))).toBe(true);
    expect(Buffer.from(a.u.buffer).equals(Buffer.from(b.u.buffer))).toBe(true);
    expect(Buffer.from(a.v.buffer).equals(Buffer.from(b.v.buffer))).toBe(true);
  });

  it('keeps velocity magnitudes bounded even under sustained large forces', () => {
    const slice = createBubbleSlice({ origin: { x: 0, y: 0, z: 0 } });
    const size = slice.u.length;
    const fU = new Float32Array(size);
    const fV = new Float32Array(size);
    for (let i = 0; i < size; i++) fV[i] = 1000;
    for (let i = 0; i < 200; i++) {
      stepBubbleSlice(slice, 1 / 60, { u: fU, v: fV });
    }
    expect(hasNaN(slice.u)).toBe(false);
    expect(hasNaN(slice.v)).toBe(false);
    // Total |v| should remain finite and not blow up to infinity.
    expect(Number.isFinite(totalAbs(slice.v))).toBe(true);
  });
});
