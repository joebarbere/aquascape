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

// ─── F2.3 — substrate rendering ─────────────────────────────────────────

describe('Canvas2DRenderer.render (substrate)', () => {
  let fakeWindow: FakeWindow;
  beforeEach(() => {
    fakeWindow = installFakeWindow();
  });
  afterEach(() => {
    uninstallFakeWindow();
    void fakeWindow;
  });

  // A small fake catalog implementing only what the renderer reads.
  function fakeCatalog(entries: Array<{ catalog: string; id: string; color: string }>) {
    const lookup = new Map<string, { catalog: string; id: string; color: string; kind: 'substrate' }>();
    for (const e of entries) {
      lookup.set(`${e.catalog}|${e.id}`, { ...e, kind: 'substrate' });
    }
    return {
      entries: entries as never,
      get({ catalog, id }: { catalog: string; id: string }) {
        return lookup.get(`${catalog}|${id}`) ?? null;
      },
      byKind() {
        return [] as never;
      },
    } as never;
  }

  function sceneWithRegion(
    regions: Array<{
      id: string;
      catalog?: string;
      itemId?: string;
      fromX?: number;
      toX?: number;
      profile?: Array<{ x: number; y: number }>;
    }>,
  ) {
    return {
      ...makeMinimalScene(600, 360, 360),
      substrate: {
        regions: regions.map((r) => ({
          id: r.id,
          material: { catalog: r.catalog ?? 'core', id: r.itemId ?? 'substrate.x', version: 1 },
          fromX: r.fromX ?? 0,
          toX: r.toX ?? 1,
          profile: r.profile ?? [
            { x: 0, y: 40 },
            { x: 0.5, y: 80 },
            { x: 1, y: 40 },
          ],
        })),
      },
    };
  }

  it('paints nothing when substrate.regions is empty (Stage 0 behaviour preserved)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(), upright);
    // No fill ops at all when there's no substrate.
    expect(only(canvas.context.ops, ['fill']).length).toBe(0);
  });

  it('paints one filled silhouette per region (no catalog → fallback color)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithRegion([{ id: 'r-1' }]), upright);
    const fills = only(canvas.context.ops, ['fill']);
    expect(fills.length).toBeGreaterThanOrEqual(1);
    // fillStyle was set to a string color (not "[[gradient]]") before the fill.
    const styles = only(canvas.context.ops, ['set:fillStyle']);
    expect(styles.some((op) => typeof op.args[0] === 'string' && op.args[0]!.toString().startsWith('#'))).toBe(
      true,
    );
  });

  it('uses the catalog color when a matching substrate entry is supplied', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const catalog = fakeCatalog([{ catalog: 'core', id: 'substrate.sand.x', color: '#abcdef' }]);
    r.render(
      sceneWithRegion([{ id: 'r-1', itemId: 'substrate.sand.x' }]),
      upright,
      catalog,
    );
    const styles = only(canvas.context.ops, ['set:fillStyle']);
    expect(styles.some((op) => op.args[0] === '#abcdef')).toBe(true);
  });

  it('falls back to the default color when the catalog lookup misses', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const catalog = fakeCatalog([{ catalog: 'core', id: 'substrate.OTHER', color: '#abcdef' }]);
    r.render(
      sceneWithRegion([{ id: 'r-1', itemId: 'substrate.missing' }]),
      upright,
      catalog,
    );
    const styles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    // Fallback is #6b5a45 per the module constant.
    expect(styles).toContain('#6b5a45');
  });

  it('paints regions in scene order (later draws over earlier)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const catalog = fakeCatalog([
      { catalog: 'core', id: 'a', color: '#111111' },
      { catalog: 'core', id: 'b', color: '#222222' },
    ]);
    r.render(
      sceneWithRegion([
        { id: 'r-1', itemId: 'a' },
        { id: 'r-2', itemId: 'b' },
      ]),
      upright,
      catalog,
    );
    const styles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    const idxA = styles.indexOf('#111111');
    const idxB = styles.indexOf('#222222');
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);
  });

  it('issues a clip + fill sequence for grain noise when the region is wide enough', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(
      sceneWithRegion([
        {
          id: 'r-wide',
          fromX: 0,
          toX: 1, // full 600 mm width — plenty for grain
          profile: [
            { x: 0, y: 40 },
            { x: 1, y: 40 },
          ],
        },
      ]),
      upright,
    );
    const clips = only(canvas.context.ops, ['clip']);
    expect(clips.length).toBeGreaterThanOrEqual(1);
    const fillRects = only(canvas.context.ops, ['fillRect']);
    expect(fillRects.length).toBeGreaterThan(0);
  });

  it('skips grain noise on very narrow regions (< 20 mm wide)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    // Baseline render: no substrate. Records the background's fillRects.
    r.render(makeMinimalScene(600, 360, 360), upright);
    const baselineFillRects = only(canvas.context.ops, ['fillRect']).length;
    canvas.context.ops.length = 0;
    canvas.context.gradients.length = 0;
    // Now render with a narrow substrate region.
    r.render(
      sceneWithRegion([
        {
          id: 'r-narrow',
          fromX: 0,
          toX: 0.01, // ~6 mm wide on a 600 mm tank
          profile: [
            { x: 0, y: 10 },
            { x: 1, y: 10 },
          ],
        },
      ]),
      upright,
    );
    // The silhouette `fill` IS emitted; substrate-grain `fillRect`s are NOT.
    expect(only(canvas.context.ops, ['fill']).length).toBeGreaterThanOrEqual(1);
    expect(only(canvas.context.ops, ['fillRect']).length).toBe(baselineFillRects);
  });

  it('renders are idempotent in the substrate path (deterministic noise)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithRegion([{ id: 'r-1' }]);
    r.render(scene, upright);
    const first = canvas.context.ops.slice();
    canvas.context.ops.length = 0;
    canvas.context.gradients.length = 0;
    r.render(scene, upright);
    expect(canvas.context.ops).toEqual(first);
  });

  it('skips a degenerate region with zero width', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(
      sceneWithRegion([
        {
          id: 'r-degenerate',
          fromX: 0.5,
          toX: 0.5,
        },
      ]),
      upright,
    );
    // No substrate fills emitted for a zero-width region.
    expect(only(canvas.context.ops, ['fill']).length).toBe(0);
  });

  it('skips substrate rendering entirely when tank.width is 0 (defensive)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = {
      ...sceneWithRegion([{ id: 'r' }]),
      tank: { ...makeMinimalScene(600, 360, 360).tank, width: 0 },
    };
    r.render(scene, upright);
    expect(only(canvas.context.ops, ['fill']).length).toBe(0);
  });
});

// ─── F3.3 — hitTest ───────────────────────────────────────────────────────

describe('Canvas2DRenderer.hitTest', () => {
  let fakeWindow: FakeWindow;
  beforeEach(() => {
    fakeWindow = installFakeWindow();
  });
  afterEach(() => {
    uninstallFakeWindow();
    void fakeWindow;
  });

  // Square hardscape entry centered around the origin with naturalSize 100×100
  // so a transform at (300, 180) with scale = 1 hits a square from
  // (250..350, 130..230) in world mm.
  const squareEntry = {
    catalog: 'core',
    id: 'rock.test',
    version: 1,
    name: 'Test',
    kind: 'hardscape' as const,
    category: 'rock' as const,
    naturalSize: { width: 100, height: 100, depth: 100 },
    color: '#888888',
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
  };
  const fakeCatalog = {
    entries: [squareEntry] as never,
    get({ catalog, id }: { catalog: string; id: string }) {
      if (catalog === 'core' && id === 'rock.test') return squareEntry;
      return null;
    },
    byKind() {
      return [] as never;
    },
  } as never;

  // Position the object exactly at the `upright` viewport's center so a
  // click at the canvas centre maps to the object's origin.
  function sceneWithObject(transformPosition = { x: 180, y: 110, z: 0 }) {
    const base = makeMinimalScene(600, 360, 360);
    return {
      ...base,
      layers: [
        {
          id: 'layer-1' as never,
          name: 'L',
          opacity: 1,
          visible: true,
          locked: false,
          objects: [
            {
              kind: 'hardscape' as const,
              id: 'obj-1' as never,
              ref: { catalog: 'core', id: 'rock.test', version: 1 },
              transform: {
                position: transformPosition,
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                flipX: false,
                flipY: false,
              },
            },
          ],
        },
      ],
    };
  }

  // The default upright viewport centers world (300, 180) at canvas center,
  // zoom = 1 (1 mm per CSS pixel).
  it('returns null when no surface is attached', () => {
    const r = new Canvas2DRenderer();
    expect(r.hitTest({ x: 0, y: 0 }, sceneWithObject(), upright, fakeCatalog)).toBeNull();
  });

  it('hits an object at the canvas centre when transform.position is at viewport.center', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    // Canvas centre is (400, 300) in CSS pixels.
    const result = r.hitTest({ x: 400, y: 300 }, sceneWithObject(), upright, fakeCatalog);
    expect(result).not.toBeNull();
    expect(result?.objectId).toBe('obj-1');
    expect(result?.layerId).toBe('layer-1');
  });

  it('misses when the click is outside the silhouette', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    // 200 pixels right of centre → 200 mm right of viewport.center = (380, 110),
    // far outside the 100×100 silhouette around (180, 110).
    expect(r.hitTest({ x: 600, y: 300 }, sceneWithObject(), upright, fakeCatalog)).toBeNull();
  });

  it('falls back to AABB hit-test when no catalog is supplied', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const result = r.hitTest({ x: 400, y: 300 }, sceneWithObject(), upright);
    expect(result).not.toBeNull();
  });

  it('returns the front-most object when two overlap at the click point', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const back = sceneWithObject();
    const front = {
      ...back,
      layers: [
        {
          ...back.layers[0]!,
          objects: [
            { ...back.layers[0]!.objects[0]!, id: 'obj-back' as never },
            { ...back.layers[0]!.objects[0]!, id: 'obj-front' as never },
          ],
        },
      ],
    };
    const result = r.hitTest({ x: 400, y: 300 }, front, upright, fakeCatalog);
    expect(result?.objectId).toBe('obj-front');
  });

  it('skips invisible layers', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithObject();
    const hidden = {
      ...scene,
      layers: [{ ...scene.layers[0]!, visible: false }],
    };
    expect(r.hitTest({ x: 400, y: 300 }, hidden, upright, fakeCatalog)).toBeNull();
  });

  it('honours object rotation when transforming the click point', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    // Rotate 45° and shrink so the silhouette covers a small diamond.
    // A point along the rotated axis still inside the diamond should hit.
    const scene = sceneWithObject();
    scene.layers[0]!.objects[0]!.transform.rotation = { x: 0, y: 0, z: Math.PI / 4 };
    scene.layers[0]!.objects[0]!.transform.scale = { x: 0.5, y: 0.5, z: 0.5 };
    // Canvas centre is the object centre — definitely inside.
    expect(r.hitTest({ x: 400, y: 300 }, scene, upright, fakeCatalog)).not.toBeNull();
  });

  it('returns null for a non-hardscape object (substrate ignored)', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = {
      ...makeMinimalScene(600, 360, 360),
      layers: [
        {
          id: 'l' as never,
          name: '',
          opacity: 1,
          visible: true,
          locked: false,
          objects: [
            {
              kind: 'plant' as const,
              id: 'p-1' as never,
              ref: { catalog: 'core', id: 'plant.x', version: 1 },
              transform: {
                position: { x: 300, y: 180, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                flipX: false,
                flipY: false,
              },
              growth: { ageWeeks: 0, vigor: 1 },
            },
          ],
        },
      ],
    };
    expect(r.hitTest({ x: 400, y: 300 }, scene, upright, fakeCatalog)).toBeNull();
  });

  it('honours flipX without changing the hit-test result for a symmetric silhouette', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithObject();
    scene.layers[0]!.objects[0]!.transform.flipX = true;
    expect(r.hitTest({ x: 400, y: 300 }, scene, upright, fakeCatalog)).not.toBeNull();
  });

  it('returns null when transform.scale collapses the silhouette to zero area', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithObject();
    scene.layers[0]!.objects[0]!.transform.scale = { x: 0, y: 0, z: 0 };
    expect(r.hitTest({ x: 400, y: 300 }, scene, upright, fakeCatalog)).toBeNull();
  });
});

// ─── F3.3 / F3.5 — Hardscape rendering + selection handles ──────────────

describe('Canvas2DRenderer.render (hardscape)', () => {
  let fakeWindow: FakeWindow;
  beforeEach(() => {
    fakeWindow = installFakeWindow();
  });
  afterEach(() => {
    uninstallFakeWindow();
    void fakeWindow;
  });

  const triangleEntry = {
    catalog: 'core',
    id: 'rock.tri',
    version: 1,
    name: 'Tri',
    kind: 'hardscape' as const,
    category: 'rock' as const,
    naturalSize: { width: 100, height: 100, depth: 100 },
    color: '#444444',
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 0, y: 1 },
    ],
  };
  const woodEntry = {
    ...triangleEntry,
    id: 'wood.tri',
    category: 'wood' as const,
    color: '#7a4422',
  };
  const fakeCatalog = {
    entries: [triangleEntry, woodEntry] as never,
    get({ catalog, id }: { catalog: string; id: string }) {
      if (catalog === 'core' && id === 'rock.tri') return triangleEntry;
      if (catalog === 'core' && id === 'wood.tri') return woodEntry;
      return null;
    },
    byKind() {
      return [] as never;
    },
  } as never;

  function sceneWithHardscape(items: Array<{ id: string; refId?: string }>) {
    const base = makeMinimalScene(600, 360, 360);
    return {
      ...base,
      layers: [
        {
          id: 'layer-1' as never,
          name: 'L',
          opacity: 1,
          visible: true,
          locked: false,
          objects: items.map((o) => ({
            kind: 'hardscape' as const,
            id: o.id as never,
            ref: { catalog: 'core', id: o.refId ?? 'rock.tri', version: 1 },
            transform: {
              position: { x: 180, y: 110, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              flipX: false,
              flipY: false,
            },
          })),
        },
      ],
    };
  }

  it('paints nothing when there are no hardscape objects', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(), upright, fakeCatalog);
    const fillStyles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    expect(fillStyles).not.toContain('#444444');
  });

  it('paints a filled silhouette per hardscape object with the catalog color', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithHardscape([{ id: 'a' }]), upright, fakeCatalog);
    const fillStyles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    expect(fillStyles).toContain('#444444');
  });

  it('skips an object whose catalog entry is missing', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithHardscape([{ id: 'a', refId: 'rock.missing' }]), upright, fakeCatalog);
    const fillStyles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    expect(fillStyles).not.toContain('#444444');
  });

  it('paints in object order (back-to-front)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(
      sceneWithHardscape([
        { id: 'a', refId: 'rock.tri' },
        { id: 'b', refId: 'wood.tri' },
      ]),
      upright,
      fakeCatalog,
    );
    const fillStyles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    const idxA = fillStyles.indexOf('#444444');
    const idxB = fillStyles.indexOf('#7a4422');
    expect(idxA).toBeGreaterThan(0);
    expect(idxB).toBeGreaterThan(idxA);
  });

  it('paints handles only for selected objects', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithHardscape([{ id: 'a' }]), upright, fakeCatalog);
    const noSelStrokes = only(canvas.context.ops, ['set:strokeStyle']).map((o) => o.args[0]);
    expect(noSelStrokes).not.toContain('#3a8eff');

    canvas.context.ops.length = 0;
    canvas.context.gradients.length = 0;
    r.render(sceneWithHardscape([{ id: 'a' }]), upright, fakeCatalog, ['a'] as never);
    const selStrokes = only(canvas.context.ops, ['set:strokeStyle']).map((o) => o.args[0]);
    expect(selStrokes).toContain('#3a8eff');
  });

  it('honours layer.opacity by setting globalAlpha', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithHardscape([{ id: 'a' }]);
    scene.layers[0]!.opacity = 0.5;
    r.render(scene, upright, fakeCatalog);
    const alphaSets = only(canvas.context.ops, ['set:globalAlpha']).map((o) => o.args[0]);
    expect(alphaSets).toContain(0.5);
  });

  it('skips invisible layers entirely', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithHardscape([{ id: 'a' }]);
    scene.layers[0]!.visible = false;
    r.render(scene, upright, fakeCatalog);
    const fillStyles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    expect(fillStyles).not.toContain('#444444');
  });

  it('skips zero-scale objects (degenerate)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithHardscape([{ id: 'a' }]);
    scene.layers[0]!.objects[0]!.transform.scale = { x: 0, y: 0, z: 0 };
    r.render(scene, upright, fakeCatalog);
    const fillStyles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    expect(fillStyles).not.toContain('#444444');
  });

  it('skips selection handles for objects with no catalog entry or zero size', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithHardscape([{ id: 'a' }]);
    scene.layers[0]!.objects[0]!.transform.scale = { x: 0, y: 0, z: 0 };
    r.render(scene, upright, fakeCatalog, ['a'] as never);
    // No handle stroke because the bbox is degenerate.
    const selStrokes = only(canvas.context.ops, ['set:strokeStyle']).map((o) => o.args[0]);
    expect(selStrokes).not.toContain('#3a8eff');
  });

  it('applies object rotation (paints + handles both rotate the world transform)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithHardscape([{ id: 'a' }]);
    scene.layers[0]!.objects[0]!.transform.rotation = { x: 0, y: 0, z: Math.PI / 6 };
    r.render(scene, upright, fakeCatalog, ['a'] as never);
    const rotateOps = only(canvas.context.ops, ['rotate']).map((o) => o.args[0]);
    // The rotation should appear at least twice: once for the object body
    // and once for its selection-handle paint.
    const matches = rotateOps.filter((a) => a === Math.PI / 6);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('clamps non-finite / out-of-range layer.opacity safely', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const sceneNaN = sceneWithHardscape([{ id: 'a' }]);
    sceneNaN.layers[0]!.opacity = Number.NaN;
    r.render(sceneNaN, upright, fakeCatalog);
    // NaN → 1, so globalAlpha is 1 (which appears at multiple points; just
    // assert the render didn't crash and the silhouette painted).
    const fills = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    expect(fills).toContain('#444444');

    // Negative opacity → 0.
    canvas.context.ops.length = 0;
    canvas.context.gradients.length = 0;
    const sceneNeg = sceneWithHardscape([{ id: 'a' }]);
    sceneNeg.layers[0]!.opacity = -0.5;
    r.render(sceneNeg, upright, fakeCatalog);
    const alphaSetsNeg = only(canvas.context.ops, ['set:globalAlpha']).map((o) => o.args[0]);
    expect(alphaSetsNeg).toContain(0);

    // > 1 → 1.
    canvas.context.ops.length = 0;
    canvas.context.gradients.length = 0;
    const sceneHigh = sceneWithHardscape([{ id: 'a' }]);
    sceneHigh.layers[0]!.opacity = 2;
    r.render(sceneHigh, upright, fakeCatalog);
    const alphaSetsHi = only(canvas.context.ops, ['set:globalAlpha']).map((o) => o.args[0]);
    expect(alphaSetsHi).toContain(1);
  });

  it('renders are idempotent in the hardscape path', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithHardscape([{ id: 'a' }]);
    r.render(scene, upright, fakeCatalog, ['a'] as never);
    const first = canvas.context.ops.slice();
    canvas.context.ops.length = 0;
    canvas.context.gradients.length = 0;
    r.render(scene, upright, fakeCatalog, ['a'] as never);
    expect(canvas.context.ops).toEqual(first);
  });
});
