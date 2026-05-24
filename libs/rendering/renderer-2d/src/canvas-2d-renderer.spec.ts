// Stage 0 F0.4 — Canvas2DRenderer specs.
//
// We use a hand-rolled FakeCanvas / FakeContext2D (see ./test-canvas.ts)
// that records every drawing op in order. The tests assert:
//
//   - attach sizes the canvas backing store to width * dpr × height * dpr,
//     writes the CSS size, and registers a window resize listener.
//   - render clears once, draws the tank rect, and draws the expected
//     number of grid lines.
//   - render is idempotent: two consecutive calls produce identical op
//     streams.
//   - render does not mutate the scene argument.
//   - dispose removes the resize listener.
//   - The recorded op stream at dpr=1 vs dpr=2 has the same WORLD-mm draw
//     calls; only the setTransform & clearRect absolute numbers scale.

import type { RenderSurface, Viewport } from '@aquascape/rendering/renderer-api';

import { Canvas2DRenderer } from './canvas-2d-renderer';
import {
  FakeCanvas,
  installFakeWindow,
  makeMinimalScene,
  uninstallFakeWindow,
} from './test-canvas';
import type { FakeWindow, RecordedOp } from './test-canvas';

// ─── Test helpers ─────────────────────────────────────────────────────────

function makeSurface(
  width = 800,
  height = 600,
  dpr = 1,
): { surface: RenderSurface; canvas: FakeCanvas } {
  const canvas = new FakeCanvas();
  const surface: RenderSurface = {
    canvas: canvas as unknown as HTMLCanvasElement,
    devicePixelRatio: dpr,
    width,
    height,
  };
  return { surface, canvas };
}

const upright: Viewport = { center: { x: 180, y: 110 }, zoom: 1, rotation: 0 };

/** Filter recorded ops to a particular set of method names. */
function only(ops: RecordedOp[], names: string[]): RecordedOp[] {
  const set = new Set(names);
  return ops.filter((op) => set.has(op.method));
}

// ─── Lifecycle: attach / dispose ──────────────────────────────────────────

describe('Canvas2DRenderer.attach', () => {
  let fakeWindow: FakeWindow;

  beforeEach(() => {
    fakeWindow = installFakeWindow();
  });

  afterEach(() => {
    uninstallFakeWindow();
  });

  it('sizes the backing store for the given DPR', () => {
    const { surface, canvas } = makeSurface(800, 600, 2);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
  });

  it('writes the CSS size in logical pixels', () => {
    const { surface, canvas } = makeSurface(800, 600, 2);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
  });

  it('registers a window resize listener', () => {
    const { surface } = makeSurface();
    const r = new Canvas2DRenderer();
    r.attach(surface);
    expect(fakeWindow.addEventListener).toHaveBeenCalledWith(
      'resize',
      expect.any(Function),
      expect.objectContaining({ passive: true }),
    );
  });

  it('registers a DPR-change matchMedia listener', () => {
    const { surface } = makeSurface(800, 600, 2);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    expect(fakeWindow.matchMedia).toHaveBeenCalledWith('(resolution: 2dppx)');
    const mql = fakeWindow.lastMql;
    expect(mql).not.toBeNull();
    expect(mql!.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('throws cleanly if the canvas refuses a 2D context', () => {
    const canvas = new FakeCanvas();
    // Force getContext to return null.
    (canvas as unknown as { getContext: () => null }).getContext = () => null;
    const surface: RenderSurface = {
      canvas: canvas as unknown as HTMLCanvasElement,
      devicePixelRatio: 1,
      width: 100,
      height: 100,
    };
    const r = new Canvas2DRenderer();
    expect(() => r.attach(surface)).toThrow(/getContext\("2d"\) returned null/);
  });

  it('is idempotent — attach twice does not leak listeners', () => {
    const { surface } = makeSurface();
    const r = new Canvas2DRenderer();
    r.attach(surface);
    // First attach registers 1 resize listener.
    expect(fakeWindow.addEventListener).toHaveBeenCalledTimes(1);
    // Re-attaching disposes first, then registers fresh listeners.
    r.attach(surface);
    expect(fakeWindow.removeEventListener).toHaveBeenCalledTimes(1);
    expect(fakeWindow.addEventListener).toHaveBeenCalledTimes(2);
  });

  it('works when no `window` global is available (SSR / Node)', () => {
    uninstallFakeWindow();
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    // No throw, no listener registration.
    expect(() => r.attach(surface)).not.toThrow();
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  it('resize listener re-syncs the canvas backing-store size', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    // Pull the registered callback out and invoke it after the host has
    // updated the surface's logical size (e.g. a window resize).
    const [, resizeCb] = fakeWindow.addEventListener.mock.calls[0]!;
    surface.width = 1024;
    surface.height = 768;
    resizeCb();
    expect(canvas.width).toBe(1024);
    expect(canvas.height).toBe(768);
  });

  it('DPR-change listener re-syncs the canvas backing store', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const mql = fakeWindow.lastMql!;
    const [, dprCb] = mql.addEventListener.mock.calls[0]!;
    // Host swaps DPR (e.g. monitor change). Renderer reads from `surface`.
    surface.devicePixelRatio = 2;
    dprCb();
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
  });
});

describe('Canvas2DRenderer.dispose', () => {
  let fakeWindow: FakeWindow;

  beforeEach(() => {
    fakeWindow = installFakeWindow();
  });

  afterEach(() => {
    uninstallFakeWindow();
  });

  it('removes the resize listener registered in attach', () => {
    const { surface } = makeSurface();
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const [, listener] = fakeWindow.addEventListener.mock.calls[0]!;
    r.dispose();
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith('resize', listener);
  });

  it('removes the DPR change listener', () => {
    const { surface } = makeSurface(800, 600, 2);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const mql = fakeWindow.lastMql!;
    const [, dprListener] = mql.addEventListener.mock.calls[0]!;
    r.dispose();
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', dprListener);
  });

  it('is safe to call without a prior attach', () => {
    const r = new Canvas2DRenderer();
    expect(() => r.dispose()).not.toThrow();
  });

  it('clears the canvas backing store', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(), upright);
    canvas.context.ops.length = 0; // reset op log
    r.dispose();
    const clears = only(canvas.context.ops, ['clearRect']);
    expect(clears.length).toBe(1);
    expect(clears[0]!.args).toEqual([0, 0, 800, 600]);
  });
});

// ─── render — shape & counts ──────────────────────────────────────────────

describe('Canvas2DRenderer.render', () => {
  let fakeWindow: FakeWindow;

  beforeEach(() => {
    fakeWindow = installFakeWindow();
    void fakeWindow;
  });

  afterEach(() => {
    uninstallFakeWindow();
  });

  it('clears the backing store exactly once per render', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(), upright);
    const clears = only(canvas.context.ops, ['clearRect']);
    expect(clears.length).toBe(1);
    expect(clears[0]!.args).toEqual([0, 0, 800, 600]);
  });

  it('sets a world-to-pixel transform — translate, scale (with y-flip), translate', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(360, 220, 220), upright);

    const ops = canvas.context.ops;
    // The first setTransform identity is for clearRect.
    // The second setTransform should be (1, 0, 0, 1, cxPx, cyPx).
    const transforms = ops.filter((o) => o.method === 'setTransform');
    expect(transforms.length).toBeGreaterThanOrEqual(2);
    expect(transforms[0]!.args).toEqual([1, 0, 0, 1, 0, 0]);
    expect(transforms[1]!.args).toEqual([1, 0, 0, 1, 400, 300]);

    const scales = ops.filter((o) => o.method === 'scale');
    // First scale call after setTransform should be (zoom*dpr, -(zoom*dpr)).
    expect(scales[0]!.args).toEqual([1, -1]);

    const translates = ops.filter((o) => o.method === 'translate');
    // Last translate before drawing is (-viewport.center.x, -viewport.center.y).
    expect(translates[0]!.args).toEqual([-180, -110]);
  });

  it('does not emit a rotate when viewport.rotation is 0', () => {
    const { surface, canvas } = makeSurface();
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(), upright);
    expect(canvas.context.ops.find((o) => o.method === 'rotate')).toBeUndefined();
  });

  it('emits a rotate (with -rotation) when viewport.rotation is non-zero', () => {
    const { surface, canvas } = makeSurface();
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const rotated: Viewport = { ...upright, rotation: Math.PI / 4 };
    r.render(makeMinimalScene(), rotated);
    const rots = canvas.context.ops.filter((o) => o.method === 'rotate');
    expect(rots.length).toBe(1);
    expect(rots[0]!.args).toEqual([-Math.PI / 4]);
  });

  it('draws the tank outline as a single strokeRect', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(360, 220, 220), upright);

    const strokeRects = canvas.context.ops.filter((o) => o.method === 'strokeRect');
    expect(strokeRects.length).toBe(1);
    // Tank rectangle in world-mm: from (0,0) to (360,220).
    expect(strokeRects[0]!.args).toEqual([0, 0, 360, 220]);
  });

  it('uses a 1-CSS-pixel stroke width for the tank outline', () => {
    const { surface, canvas } = makeSurface();
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(), { ...upright, zoom: 2 });
    // The last set:lineWidth before strokeRect must be 1/zoom = 0.5 mm.
    const ops = canvas.context.ops;
    const rectIdx = ops.findIndex((o) => o.method === 'strokeRect');
    const linesBeforeRect = ops.slice(0, rectIdx).filter((o) => o.method === 'set:lineWidth');
    expect(linesBeforeRect[linesBeforeRect.length - 1]!.args).toEqual([0.5]);
  });

  it('strokes the grid in exactly two passes (minor + major)', () => {
    const { surface, canvas } = makeSurface();
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(360, 220, 220), upright);

    // strokeRect is one tank op; the rest of the strokes are the two grid
    // passes. drawGrid always calls stroke() twice (minor pass + major
    // pass), regardless of how many lines exist.
    const strokes = canvas.context.ops.filter((o) => o.method === 'stroke');
    expect(strokes.length).toBe(2);
  });

  it('emits the right number of grid lines for a 360x220 tank', () => {
    const { surface, canvas } = makeSurface();
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(360, 220, 220), upright);

    // Minor pass: vertical minor lines at x in [0, 360] step 10, EXCLUDING
    // multiples of 50. x ∈ {0,10,…,360} → 37 values; 50-multiples in that
    // set: {0,50,100,150,200,250,300,350} → 8 values. Minor verticals =
    // 37 − 8 = 29 (note 360 % 50 = 10, so it counts).
    //
    // Horizontal minor y's: y ∈ {0,10,…,220} → 23 values; 50-multiples:
    // {0,50,100,150,200} → 5 values. Minor horizontals = 23 − 5 = 18 (note
    // 220 % 50 = 20, so it counts).
    //
    // Major pass: vertical major x's: {0,50,100,150,200,250,300,350} → 8.
    // Horizontal major y's: {0,50,100,150,200} → 5.
    //
    // Each line is one moveTo + one lineTo. We count moveTo calls in the
    // minor pass and the major pass separately.

    const ops = canvas.context.ops;
    const strokeIdx = ops.map((o, i) => (o.method === 'stroke' ? i : -1)).filter((i) => i >= 0);
    expect(strokeIdx.length).toBe(2);

    const minorEnd = strokeIdx[0]!;
    const majorEnd = strokeIdx[1]!;

    const minorOps = ops.slice(0, minorEnd);
    const majorOps = ops.slice(minorEnd + 1, majorEnd);

    const minorMoves = minorOps.filter((o) => o.method === 'moveTo').length;
    const majorMoves = majorOps.filter((o) => o.method === 'moveTo').length;

    expect(minorMoves).toBe(29 + 18);
    expect(majorMoves).toBe(8 + 5);
  });

  it('clips the grid to the tank interior', () => {
    const { surface, canvas } = makeSurface();
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(360, 220, 220), upright);
    // drawGrid uses save / rect / clip / … / restore.
    const ops = canvas.context.ops;
    expect(ops.find((o) => o.method === 'save')).toBeDefined();
    expect(ops.find((o) => o.method === 'clip')).toBeDefined();
    expect(ops.find((o) => o.method === 'restore')).toBeDefined();
    const clipRect = ops
      .filter((o) => o.method === 'rect')
      // Distinct from the tank strokeRect — `rect` is the clip path.
      .find((o) => JSON.stringify(o.args) === JSON.stringify([0, 0, 360, 220]));
    expect(clipRect).toBeDefined();
  });

  it('is idempotent — two consecutive renders produce identical op streams', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = makeMinimalScene();
    r.render(scene, upright);
    const firstOps = canvas.context.ops.slice();
    canvas.context.ops.length = 0;
    r.render(scene, upright);
    const secondOps = canvas.context.ops.slice();
    expect(secondOps).toEqual(firstOps);
  });

  it('does not mutate the scene', () => {
    const { surface } = makeSurface();
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = makeMinimalScene();
    const before = JSON.parse(JSON.stringify(scene));
    r.render(scene, upright);
    expect(scene).toEqual(before);
  });

  it('is a no-op when no surface is attached', () => {
    const r = new Canvas2DRenderer();
    expect(() => r.render(makeMinimalScene(), upright)).not.toThrow();
  });
});

// ─── DPR handling ─────────────────────────────────────────────────────────

describe('Canvas2DRenderer DPR handling', () => {
  let fakeWindow: FakeWindow;

  beforeEach(() => {
    fakeWindow = installFakeWindow();
    void fakeWindow;
  });

  afterEach(() => {
    uninstallFakeWindow();
  });

  it('renders the same WORLD-mm draws at dpr=1 and dpr=2', () => {
    const sceneA = makeMinimalScene();
    const sceneB = makeMinimalScene();

    const { surface: surfaceA, canvas: canvasA } = makeSurface(800, 600, 1);
    const rA = new Canvas2DRenderer();
    rA.attach(surfaceA);
    rA.render(sceneA, upright);

    const { surface: surfaceB, canvas: canvasB } = makeSurface(800, 600, 2);
    const rB = new Canvas2DRenderer();
    rB.attach(surfaceB);
    rB.render(sceneB, upright);

    // The drawing primitives in WORLD mm coordinates must be identical.
    const worldOps = (ops: RecordedOp[]): RecordedOp[] =>
      ops.filter(
        (o) =>
          o.method === 'strokeRect' ||
          o.method === 'moveTo' ||
          o.method === 'lineTo' ||
          o.method === 'rect',
      );

    expect(worldOps(canvasB.context.ops)).toEqual(worldOps(canvasA.context.ops));
  });

  it('scales the backing store size linearly with DPR', () => {
    const { surface: s1, canvas: c1 } = makeSurface(800, 600, 1);
    const { surface: s2, canvas: c2 } = makeSurface(800, 600, 2);
    new Canvas2DRenderer().attach(s1);
    new Canvas2DRenderer().attach(s2);
    expect(c1.width).toBe(800);
    expect(c1.height).toBe(600);
    expect(c2.width).toBe(1600);
    expect(c2.height).toBe(1200);
  });

  it('uses dpr in the absolute setTransform offsets', () => {
    const { surface, canvas } = makeSurface(800, 600, 2);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(), upright);
    const transforms = canvas.context.ops.filter((o) => o.method === 'setTransform');
    // First is identity (for the clear); the world transform is the second
    // and should translate to the BACKING-STORE center: (1600/2, 1200/2).
    expect(transforms[1]!.args).toEqual([1, 0, 0, 1, 800, 600]);
    const scales = canvas.context.ops.filter((o) => o.method === 'scale');
    // zoom=1, dpr=2 → scale(2, -2).
    expect(scales[0]!.args).toEqual([2, -2]);
  });
});

// ─── hitTest ──────────────────────────────────────────────────────────────

describe('Canvas2DRenderer.hitTest', () => {
  beforeEach(() => {
    installFakeWindow();
  });
  afterEach(() => {
    uninstallFakeWindow();
  });

  it('returns null in Stage 0 — object hit-testing lands in F3.3', () => {
    const { surface } = makeSurface();
    const r = new Canvas2DRenderer();
    r.attach(surface);
    expect(r.hitTest({ x: 100, y: 100 }, makeMinimalScene(), upright)).toBeNull();
  });
});

// ─── F1.2 Phase C — tank styling ─────────────────────────────────────────
//
// The renderer paints (in order):
//   1. Background — entire canvas, in pixel space.
//   2. Grid + tank outline — world-mm space.
//   3. Water tint — inside the tank rectangle, in world-mm space.
//   4. Frame overlay — top/bottom rims (framed/braced) + centre brace
//      (braced), in world-mm space.
//
// These tests use the op-recording fake canvas; pixel comparison is F6.1.

import type { TankStyle } from '@aquascape/domain/scene-model';

/**
 * Re-use the minimal scene fixture, but inject a specific TankStyle. We
 * deliberately do NOT add a fixture helper inside `test-canvas.ts` so the
 * styling permutations live next to the assertions that use them.
 */
function sceneWithStyle(style: TankStyle, width = 360, height = 220, depth = 220) {
  const scene = makeMinimalScene(width, height, depth);
  return { ...scene, tank: { ...scene.tank, style } };
}

/** Find the first op whose method matches `name` AT OR AFTER `from`. */
function indexOfOp(ops: RecordedOp[], name: string, from = 0): number {
  for (let i = from; i < ops.length; i++) {
    if (ops[i]!.method === name) return i;
  }
  return -1;
}

describe('Canvas2DRenderer.render — background', () => {
  beforeEach(() => {
    installFakeWindow();
  });
  afterEach(() => {
    uninstallFakeWindow();
  });

  it('"none" paints a default neutral fill across the canvas', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({ frame: 'rimless', background: { kind: 'none' } }), upright);
    const fillRects = canvas.context.ops.filter((o) => o.method === 'fillRect');
    // Exactly one full-canvas fillRect — no water tint, no frame, no extras.
    expect(fillRects.length).toBe(1);
    expect(fillRects[0]!.args).toEqual([0, 0, 800, 600]);
    // The fillStyle just before that fillRect must be the documented default.
    const ops = canvas.context.ops;
    const fillRectIdx = indexOfOp(ops, 'fillRect');
    const fillStyles = ops.slice(0, fillRectIdx).filter((o) => o.method === 'set:fillStyle');
    expect(fillStyles[fillStyles.length - 1]!.args).toEqual(['#fafafa']);
  });

  it('"color" paints a fillRect covering the canvas with the chosen color', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(
      sceneWithStyle({
        frame: 'rimless',
        background: { kind: 'color', color: '#0b0d0e' },
      }),
      upright,
    );
    const ops = canvas.context.ops;
    const fillRectIdx = indexOfOp(ops, 'fillRect');
    expect(fillRectIdx).toBeGreaterThanOrEqual(0);
    expect(ops[fillRectIdx]!.args).toEqual([0, 0, 800, 600]);
    const fillStyles = ops.slice(0, fillRectIdx).filter((o) => o.method === 'set:fillStyle');
    expect(fillStyles[fillStyles.length - 1]!.args).toEqual(['#0b0d0e']);
  });

  it('"image" is treated as "none" — TODO(F6.3)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(
      sceneWithStyle({
        frame: 'rimless',
        background: {
          kind: 'image',
          asset: {
            id: 'asset-1',
            uri: 'assets/asset-1.png',
            mimeType: 'image/png',
          },
        },
      }),
      upright,
    );
    const ops = canvas.context.ops;
    const fillRectIdx = indexOfOp(ops, 'fillRect');
    expect(fillRectIdx).toBeGreaterThanOrEqual(0);
    expect(ops[fillRectIdx]!.args).toEqual([0, 0, 800, 600]);
    // Default fill color, same as 'none'.
    const fillStyles = ops.slice(0, fillRectIdx).filter((o) => o.method === 'set:fillStyle');
    expect(fillStyles[fillStyles.length - 1]!.args).toEqual(['#fafafa']);
  });

  it('"gradient" creates a linear gradient spanning the canvas at angle=0', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(
      sceneWithStyle({
        frame: 'rimless',
        background: {
          kind: 'gradient',
          angle: 0, // left → right in WORLD space
          stops: [
            { at: 0, color: '#001122' },
            { at: 1, color: '#334455' },
          ],
        },
      }),
      upright,
    );
    const ops = canvas.context.ops;
    const gradIdx = indexOfOp(ops, 'createLinearGradient');
    expect(gradIdx).toBeGreaterThanOrEqual(0);
    // angle=0 → unit vector (1, 0); half-extent = w/2 = 400, center (400,300).
    // Endpoints: (0, 300) → (800, 300).
    expect(ops[gradIdx]!.args).toEqual([0, 300, 800, 300]);
    // addColorStop should have been called once per stop, in order.
    const stops = ops.filter((o) => o.method === 'addColorStop');
    expect(stops.length).toBe(2);
    expect(stops[0]!.args).toEqual([0, '#001122']);
    expect(stops[1]!.args).toEqual([1, '#334455']);
    // A fillRect over the canvas must come after the gradient is built.
    const fillRectIdx = indexOfOp(ops, 'fillRect', gradIdx);
    expect(fillRectIdx).toBeGreaterThan(gradIdx);
    expect(ops[fillRectIdx]!.args).toEqual([0, 0, 800, 600]);
  });

  it('"gradient" with angle=π/2 paints bottom-to-top in CANVAS pixels', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(
      sceneWithStyle({
        frame: 'rimless',
        background: {
          kind: 'gradient',
          angle: Math.PI / 2, // bottom → top in WORLD; ↑ in WORLD = ↓ in CANVAS y
          stops: [
            { at: 0, color: '#aaaaaa' },
            { at: 1, color: '#ffffff' },
          ],
        },
      }),
      upright,
    );
    const ops = canvas.context.ops;
    const gradIdx = indexOfOp(ops, 'createLinearGradient');
    // angle=π/2 → (cos, -sin) = (~0, -1); half = h/2 = 300, center (400,300).
    // Endpoints: (400, 300 - (-1)*300) = (400, 600) → (400, 300 + (-1)*300) = (400, 0).
    // So gradient at=0 sits at canvas y=600 (bottom) and at=1 at y=0 (top).
    const args = ops[gradIdx]!.args as number[];
    expect(args[0]).toBeCloseTo(400);
    expect(args[1]).toBeCloseTo(600);
    expect(args[2]).toBeCloseTo(400);
    expect(args[3]).toBeCloseTo(0);
  });

  it('"gradient" accepts >2 stops and forwards them in order', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(
      sceneWithStyle({
        frame: 'rimless',
        background: {
          kind: 'gradient',
          angle: 0,
          stops: [
            { at: 0, color: '#111111' },
            { at: 0.5, color: '#888888' },
            { at: 1, color: '#ffffff' },
          ],
        },
      }),
      upright,
    );
    const stops = canvas.context.ops.filter((o) => o.method === 'addColorStop');
    expect(stops.length).toBe(3);
    expect(stops.map((s) => s.args)).toEqual([
      [0, '#111111'],
      [0.5, '#888888'],
      [1, '#ffffff'],
    ]);
  });
});

describe('Canvas2DRenderer.render — water tint', () => {
  beforeEach(() => {
    installFakeWindow();
  });
  afterEach(() => {
    uninstallFakeWindow();
  });

  it('omits the tint when style.waterTint is undefined', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({ frame: 'rimless', background: { kind: 'none' } }), upright);
    // Only the background fillRect should exist; no second tint fillRect.
    const fillRects = canvas.context.ops.filter((o) => o.method === 'fillRect');
    expect(fillRects.length).toBe(1);
    // And no globalAlpha tweak.
    const alphas = canvas.context.ops.filter((o) => o.method === 'set:globalAlpha');
    expect(alphas.length).toBe(0);
  });

  it('paints a tinted fillRect inside the tank in world-mm', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(
      sceneWithStyle({
        frame: 'rimless',
        waterTint: '#88ccff',
        background: { kind: 'none' },
      }),
      upright,
    );
    const ops = canvas.context.ops;
    // The water tint fillRect must cover the tank interior in world-mm:
    // tank is (0, 0) to (360, 220) per sceneWithStyle defaults.
    const tankFills = ops.filter(
      (o) => o.method === 'fillRect' && JSON.stringify(o.args) === JSON.stringify([0, 0, 360, 220]),
    );
    expect(tankFills.length).toBe(1);
  });

  it('wraps the tint in save/restore with globalAlpha set', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(
      sceneWithStyle({
        frame: 'rimless',
        waterTint: '#88ccff',
        background: { kind: 'none' },
      }),
      upright,
    );
    const ops = canvas.context.ops;
    // Locate the tint fillRect by its world-mm args.
    const tintIdx = ops.findIndex(
      (o) => o.method === 'fillRect' && JSON.stringify(o.args) === JSON.stringify([0, 0, 360, 220]),
    );
    expect(tintIdx).toBeGreaterThanOrEqual(0);
    // Walk backwards to find the matching `save`. There must be a globalAlpha
    // set between save and the fillRect, and a restore after the fillRect.
    const saves = ops
      .slice(0, tintIdx)
      .map((o, i) => (o.method === 'save' ? i : -1))
      .filter((i) => i >= 0);
    const lastSaveIdx = saves[saves.length - 1]!;
    const between = ops.slice(lastSaveIdx, tintIdx);
    const alphaSet = between.find((o) => o.method === 'set:globalAlpha');
    expect(alphaSet).toBeDefined();
    expect(alphaSet!.args).toEqual([0.25]);
    // And the next op after the fillRect (skipping nothing else here) is
    // a restore.
    const restoreIdx = ops.findIndex((o, i) => i > tintIdx && o.method === 'restore');
    expect(restoreIdx).toBeGreaterThan(tintIdx);
  });

  it('uses the user-supplied hex (including alpha) as fillStyle', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(
      sceneWithStyle({
        frame: 'rimless',
        waterTint: '#88ccff80',
        background: { kind: 'none' },
      }),
      upright,
    );
    const ops = canvas.context.ops;
    const tintIdx = ops.findIndex(
      (o) => o.method === 'fillRect' && JSON.stringify(o.args) === JSON.stringify([0, 0, 360, 220]),
    );
    const fillStyles = ops.slice(0, tintIdx).filter((o) => o.method === 'set:fillStyle');
    // The most recent fillStyle before the tint fillRect must be the hex
    // the user picked — the renderer doesn't parse it.
    expect(fillStyles[fillStyles.length - 1]!.args).toEqual(['#88ccff80']);
  });
});

describe('Canvas2DRenderer.render — frame overlay', () => {
  beforeEach(() => {
    installFakeWindow();
  });
  afterEach(() => {
    uninstallFakeWindow();
  });

  it('"rimless" emits NO extra frame fillRects beyond the background', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({ frame: 'rimless', background: { kind: 'none' } }), upright);
    // Only the background fillRect; no rim, no brace, no water tint.
    const fillRects = canvas.context.ops.filter((o) => o.method === 'fillRect');
    expect(fillRects.length).toBe(1);
  });

  it('"framed" emits two rim fillRects (top + bottom) in world-mm', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({ frame: 'framed', background: { kind: 'none' } }), upright);
    const ops = canvas.context.ops;
    const fillRects = ops.filter((o) => o.method === 'fillRect');
    // background + top rim + bottom rim = 3 fillRects.
    expect(fillRects.length).toBe(3);
    // Tank rect: (0, 0, 360, 220). Bottom rim: (0, 0, 360, 8).
    //                              Top rim:    (0, 220-8=212, 360, 8).
    const bottomRim = fillRects.find(
      (o) => JSON.stringify(o.args) === JSON.stringify([0, 0, 360, 8]),
    );
    const topRim = fillRects.find(
      (o) => JSON.stringify(o.args) === JSON.stringify([0, 212, 360, 8]),
    );
    expect(bottomRim).toBeDefined();
    expect(topRim).toBeDefined();
  });

  it('"framed" defaults frameColor to #222 when undefined', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({ frame: 'framed', background: { kind: 'none' } }), upright);
    const ops = canvas.context.ops;
    // Find the first rim fillRect (bottom rim, args [0,0,360,8]) and check
    // the fillStyle that immediately precedes it.
    const rimIdx = ops.findIndex(
      (o) => o.method === 'fillRect' && JSON.stringify(o.args) === JSON.stringify([0, 0, 360, 8]),
    );
    const fillStyles = ops.slice(0, rimIdx).filter((o) => o.method === 'set:fillStyle');
    expect(fillStyles[fillStyles.length - 1]!.args).toEqual(['#222']);
  });

  it('"framed" honours explicit frameColor', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(
      sceneWithStyle({
        frame: 'framed',
        frameColor: '#8b4513', // wood
        background: { kind: 'none' },
      }),
      upright,
    );
    const ops = canvas.context.ops;
    const rimIdx = ops.findIndex(
      (o) => o.method === 'fillRect' && JSON.stringify(o.args) === JSON.stringify([0, 0, 360, 8]),
    );
    const fillStyles = ops.slice(0, rimIdx).filter((o) => o.method === 'set:fillStyle');
    expect(fillStyles[fillStyles.length - 1]!.args).toEqual(['#8b4513']);
  });

  it('"braced" emits three fillRects (top + bottom rim + centre brace)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({ frame: 'braced', background: { kind: 'none' } }), upright);
    const ops = canvas.context.ops;
    const fillRects = ops.filter((o) => o.method === 'fillRect');
    // background + top rim + bottom rim + centre brace = 4 fillRects.
    expect(fillRects.length).toBe(4);
    // Centre brace: width=10 mm, at x = (0+360)/2 - 5 = 175. Spans the
    // interior between rims: y from 8 to 220-8=212, so h = 204.
    const brace = fillRects.find(
      (o) => JSON.stringify(o.args) === JSON.stringify([175, 8, 10, 204]),
    );
    expect(brace).toBeDefined();
  });
});

describe('Canvas2DRenderer.render — styling: invariants', () => {
  beforeEach(() => {
    installFakeWindow();
  });
  afterEach(() => {
    uninstallFakeWindow();
  });

  // Cross-product of background variants × frame variants × tint presence.
  const styles: Array<[string, TankStyle]> = [
    ['none + rimless', { frame: 'rimless', background: { kind: 'none' } }],
    ['color + rimless', { frame: 'rimless', background: { kind: 'color', color: '#222' } }],
    [
      'gradient + rimless',
      {
        frame: 'rimless',
        background: {
          kind: 'gradient',
          angle: Math.PI / 2,
          stops: [
            { at: 0, color: '#000' },
            { at: 1, color: '#fff' },
          ],
        },
      },
    ],
    [
      'image + framed',
      {
        frame: 'framed',
        background: {
          kind: 'image',
          asset: { id: 'a', uri: 'assets/a.png', mimeType: 'image/png' },
        },
      },
    ],
    [
      'color + braced + tint',
      {
        frame: 'braced',
        frameColor: '#111',
        waterTint: '#22aaff',
        background: { kind: 'color', color: '#001' },
      },
    ],
  ];

  it.each(styles)('idempotent — %s', (_label, style) => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithStyle(style);
    r.render(scene, upright);
    const first = canvas.context.ops.slice();
    canvas.context.ops.length = 0;
    // Also reset gradients so the comparison is on op streams only.
    canvas.context.gradients.length = 0;
    r.render(scene, upright);
    const second = canvas.context.ops.slice();
    expect(second).toEqual(first);
  });

  it.each(styles)('does not mutate scene or style — %s', (_label, style) => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithStyle(style);
    const before = JSON.parse(JSON.stringify(scene));
    r.render(scene, upright);
    expect(JSON.parse(JSON.stringify(scene))).toEqual(before);
  });
});
