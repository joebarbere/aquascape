// Test harness — a hand-rolled fake canvas + 2D context that records every
// drawing operation in order. Used by the renderer-2d unit tests. Lives in
// `src/` rather than a separate test-utilities lib because it's only ever
// consumed from this lib's own spec files. NOT re-exported from
// `src/index.ts`.
//
// We picked this over jest-environment-jsdom because:
//   - jsdom has no real canvas implementation (it returns null from
//     `getContext('2d')` without an extra `canvas` native dep).
//   - Stage 0 only paints tank + grid; correctness can be verified by
//     counting ops and inspecting their arguments. Real-pixel snapshots
//     belong to F6.1 (image export).

// ─── Recorded operation type ──────────────────────────────────────────────

export interface RecordedOp {
  method: string;
  /** Args captured as `JSON.stringify`-able shapes (numbers/strings/bools). */
  args: ReadonlyArray<number | string | boolean | null | undefined>;
}

// ─── Fake CanvasRenderingContext2D ────────────────────────────────────────

/**
 * Marker object for a linear gradient. The renderer assigns this to
 * `fillStyle`; our fake `set:fillStyle` op stringifies it so the op stream
 * stays JSON-friendly. The instance is also recorded directly on the
 * `createLinearGradient` op so tests can inspect the recorded color stops.
 */
export interface FakeLinearGradient {
  readonly __kind: 'gradient';
  readonly endpoints: readonly [number, number, number, number];
  readonly stops: Array<{ at: number; color: string }>;
  addColorStop(at: number, color: string): void;
}

/**
 * Records every call onto `ops` along with its arguments. Supports the
 * subset of the CanvasRenderingContext2D API that Canvas2DRenderer touches.
 *
 * Property assignments (`lineWidth`, `strokeStyle`) are recorded as
 * synthetic ops with method names `set:lineWidth` / `set:strokeStyle` —
 * this keeps the spec's idempotency check sensitive to style changes too.
 */
export class FakeContext2D {
  readonly ops: RecordedOp[] = [];
  /** Gradients handed out by createLinearGradient, in call order. */
  readonly gradients: FakeLinearGradient[] = [];

  private _lineWidth = 1;
  private _strokeStyle: string | FakeLinearGradient = '#000';
  private _fillStyle: string | FakeLinearGradient = '#000';
  private _globalAlpha = 1;

  // Style properties — getters/setters so renderer code can assign normally.
  get lineWidth(): number {
    return this._lineWidth;
  }
  set lineWidth(v: number) {
    this._lineWidth = v;
    this.ops.push({ method: 'set:lineWidth', args: [v] });
  }
  get strokeStyle(): string | FakeLinearGradient {
    return this._strokeStyle;
  }
  set strokeStyle(v: string | FakeLinearGradient) {
    this._strokeStyle = v;
    this.ops.push({
      method: 'set:strokeStyle',
      args: [typeof v === 'string' ? v : '[[gradient]]'],
    });
  }
  get fillStyle(): string | FakeLinearGradient {
    return this._fillStyle;
  }
  set fillStyle(v: string | FakeLinearGradient) {
    this._fillStyle = v;
    this.ops.push({
      method: 'set:fillStyle',
      args: [typeof v === 'string' ? v : '[[gradient]]'],
    });
  }
  get globalAlpha(): number {
    return this._globalAlpha;
  }
  set globalAlpha(v: number) {
    this._globalAlpha = v;
    this.ops.push({ method: 'set:globalAlpha', args: [v] });
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.ops.push({ method: 'setTransform', args: [a, b, c, d, e, f] });
  }
  translate(x: number, y: number): void {
    this.ops.push({ method: 'translate', args: [x, y] });
  }
  scale(x: number, y: number): void {
    this.ops.push({ method: 'scale', args: [x, y] });
  }
  setLineDash(segments: ReadonlyArray<number>): void {
    this.ops.push({ method: 'setLineDash', args: [segments.slice()] });
  }
  rotate(r: number): void {
    this.ops.push({ method: 'rotate', args: [r] });
  }
  save(): void {
    this.ops.push({ method: 'save', args: [] });
  }
  restore(): void {
    this.ops.push({ method: 'restore', args: [] });
  }
  clip(): void {
    this.ops.push({ method: 'clip', args: [] });
  }
  beginPath(): void {
    this.ops.push({ method: 'beginPath', args: [] });
  }
  moveTo(x: number, y: number): void {
    this.ops.push({ method: 'moveTo', args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this.ops.push({ method: 'lineTo', args: [x, y] });
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.ops.push({ method: 'rect', args: [x, y, w, h] });
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.ops.push({ method: 'strokeRect', args: [x, y, w, h] });
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.ops.push({ method: 'fillRect', args: [x, y, w, h] });
  }
  stroke(): void {
    this.ops.push({ method: 'stroke', args: [] });
  }
  fill(): void {
    this.ops.push({ method: 'fill', args: [] });
  }
  closePath(): void {
    this.ops.push({ method: 'closePath', args: [] });
  }
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    this.ops.push({
      method: 'arc',
      args: [x, y, radius, startAngle, endAngle, counterclockwise],
    });
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.ops.push({ method: 'clearRect', args: [x, y, w, h] });
  }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): FakeLinearGradient {
    const stops: Array<{ at: number; color: string }> = [];
    const gradient: FakeLinearGradient = {
      __kind: 'gradient',
      endpoints: [x0, y0, x1, y1],
      stops,
      addColorStop: (at: number, color: string): void => {
        stops.push({ at, color });
        this.ops.push({ method: 'addColorStop', args: [at, color] });
      },
    };
    this.gradients.push(gradient);
    this.ops.push({ method: 'createLinearGradient', args: [x0, y0, x1, y1] });
    return gradient;
  }
}

// ─── Fake HTMLCanvasElement ───────────────────────────────────────────────

/**
 * Just enough surface to satisfy `RenderSurface.canvas` and the renderer's
 * `getContext('2d')` call.
 */
export class FakeCanvas {
  width = 0;
  height = 0;
  readonly style: { width: string; height: string } = { width: '', height: '' };

  private ctx = new FakeContext2D();

  getContext(kind: '2d'): FakeContext2D | null {
    if (kind !== '2d') return null;
    return this.ctx;
  }

  /** Convenience for tests — re-export the recorded context. */
  get context(): FakeContext2D {
    return this.ctx;
  }
}

// ─── Fake `window` for resize / DPR listener tests ────────────────────────

export interface FakeMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener: jest.Mock<void, [string, () => void]>;
  removeEventListener: jest.Mock<void, [string, () => void]>;
}

export interface FakeWindow {
  addEventListener: jest.Mock<void, [string, () => void, unknown?]>;
  removeEventListener: jest.Mock<void, [string, () => void]>;
  matchMedia: jest.Mock<FakeMediaQueryList, [string]>;
  /** Reference to the last MediaQueryList handed out by matchMedia. */
  lastMql: FakeMediaQueryList | null;
}

export function installFakeWindow(): FakeWindow {
  let lastMql: FakeMediaQueryList | null = null;
  const fake: FakeWindow = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    matchMedia: jest.fn((q: string) => {
      const mql: FakeMediaQueryList = {
        matches: false,
        media: q,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      };
      lastMql = mql;
      fake.lastMql = mql;
      return mql;
    }),
    lastMql: null,
  };
  (globalThis as unknown as { window: FakeWindow }).window = fake;
  void lastMql;
  return fake;
}

export function uninstallFakeWindow(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build a minimal scene fixture for renderer tests. Mirrors the shape of
 * `domain/scene-model`'s `makeScene` but keeps the test self-contained so
 * renderer tests don't pull in scene-model's test-fixtures (which aren't
 * part of its public API).
 */
export function makeMinimalScene(width = 360, height = 220, depth = 220) {
  return {
    tank: {
      width,
      height,
      depth,
      glassThickness: 5,
      style: {
        frame: 'rimless' as const,
        background: { kind: 'color' as const, color: '#0b0d0e' },
      },
    },
    substrate: { regions: [] },
    layers: [],
    seed: 1337,
  };
}
