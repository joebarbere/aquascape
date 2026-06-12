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

  it('does NOT write inline canvas.style.width / .height — host CSS owns the box', () => {
    // Regression for the "tank centered too high" bug. If the renderer
    // writes inline pixel sizes on first attach, the canvas freezes at
    // whatever interim dimensions it had before async-hydrated layout
    // (sidebar/rail widths, recovery banner) settled, and never grows
    // back. The renderer's job is the backing buffer; the host CSS
    // (`.scene-canvas { width: 100%; height: 100%; }`) owns the box.
    const { surface, canvas } = makeSurface(800, 600, 2);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    expect(canvas.style.width).toBe('');
    expect(canvas.style.height).toBe('');
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

  // Tank in sceneWithStyle defaults to 360 × 220 mm at the origin; the
  // background fillRect covers that rect in world-mm (no longer the whole
  // canvas — see the "centered card" change to drawBackground).
  it('"none" paints a default neutral fill inside the tank rect', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({ frame: 'rimless', background: { kind: 'none' } }), upright);
    const fillRects = canvas.context.ops.filter((o) => o.method === 'fillRect');
    // Exactly one tank-rect fillRect — no water tint, no frame, no extras.
    expect(fillRects.length).toBe(1);
    expect(fillRects[0]!.args).toEqual([0, 0, 360, 220]);
    // The fillStyle just before that fillRect must be the documented default.
    const ops = canvas.context.ops;
    const fillRectIdx = indexOfOp(ops, 'fillRect');
    const fillStyles = ops.slice(0, fillRectIdx).filter((o) => o.method === 'set:fillStyle');
    expect(fillStyles[fillStyles.length - 1]!.args).toEqual(['#fafafa']);
  });

  it('"color" paints a fillRect covering the tank rect with the chosen color', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({
        frame: 'rimless',
        background: { kind: 'color', color: '#0b0d0e' },
      }), upright);
    const ops = canvas.context.ops;
    const fillRectIdx = indexOfOp(ops, 'fillRect');
    expect(fillRectIdx).toBeGreaterThanOrEqual(0);
    expect(ops[fillRectIdx]!.args).toEqual([0, 0, 360, 220]);
    const fillStyles = ops.slice(0, fillRectIdx).filter((o) => o.method === 'set:fillStyle');
    expect(fillStyles[fillStyles.length - 1]!.args).toEqual(['#0b0d0e']);
  });

  it('"image" is treated as "none" — TODO(F6.3)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({
        frame: 'rimless',
        background: {
          kind: 'image',
          asset: {
            id: 'asset-1',
            uri: 'assets/asset-1.png',
            mimeType: 'image/png',
          },
        },
      }), upright);
    const ops = canvas.context.ops;
    const fillRectIdx = indexOfOp(ops, 'fillRect');
    expect(fillRectIdx).toBeGreaterThanOrEqual(0);
    expect(ops[fillRectIdx]!.args).toEqual([0, 0, 360, 220]);
    // Default fill color, same as 'none'.
    const fillStyles = ops.slice(0, fillRectIdx).filter((o) => o.method === 'set:fillStyle');
    expect(fillStyles[fillStyles.length - 1]!.args).toEqual(['#fafafa']);
  });

  it('"gradient" creates a linear gradient spanning the tank rect at angle=0', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({
        frame: 'rimless',
        background: {
          kind: 'gradient',
          angle: 0, // left → right in WORLD space
          stops: [
            { at: 0, color: '#001122' },
            { at: 1, color: '#334455' },
          ],
        },
      }), upright);
    const ops = canvas.context.ops;
    const gradIdx = indexOfOp(ops, 'createLinearGradient');
    expect(gradIdx).toBeGreaterThanOrEqual(0);
    // Tank is 360 × 220 at origin. angle=0 → unit vector (1, 0);
    // half-extent = w/2 = 180, center (180, 110).
    // Endpoints in world-mm: (0, 110) → (360, 110).
    expect(ops[gradIdx]!.args).toEqual([0, 110, 360, 110]);
    // addColorStop should have been called once per stop, in order.
    const stops = ops.filter((o) => o.method === 'addColorStop');
    expect(stops.length).toBe(2);
    expect(stops[0]!.args).toEqual([0, '#001122']);
    expect(stops[1]!.args).toEqual([1, '#334455']);
    // The tank-rect fillRect comes after the gradient is built.
    const fillRectIdx = indexOfOp(ops, 'fillRect', gradIdx);
    expect(fillRectIdx).toBeGreaterThan(gradIdx);
    expect(ops[fillRectIdx]!.args).toEqual([0, 0, 360, 220]);
  });

  it('"gradient" with angle=π/2 paints bottom-to-top in WORLD coords', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({
        frame: 'rimless',
        background: {
          kind: 'gradient',
          angle: Math.PI / 2, // bottom → top in WORLD; world +y is ↑ on screen
          stops: [
            { at: 0, color: '#aaaaaa' },
            { at: 1, color: '#ffffff' },
          ],
        },
      }), upright);
    const ops = canvas.context.ops;
    const gradIdx = indexOfOp(ops, 'createLinearGradient');
    // Drawn under the world transform (world +y up; renderer's negative
    // y-scale flips it to canvas +y down). angle=π/2 → (cos, sin) = (0, 1);
    // tank centre (180, 110); half-height 110 → endpoints
    // (180, 110 - 110) = (180, 0) → (180, 110 + 110) = (180, 220).
    // at=0 sits at world y=0 (tank bottom — bottom of screen);
    // at=1 sits at world y=220 (tank top — top of screen).
    const args = ops[gradIdx]!.args as number[];
    expect(args[0]).toBeCloseTo(180);
    expect(args[1]).toBeCloseTo(0);
    expect(args[2]).toBeCloseTo(180);
    expect(args[3]).toBeCloseTo(220);
  });

  it('"gradient" accepts >2 stops and forwards them in order', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({
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
      }), upright);
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

  // After the "centered card" change to drawBackground, the background
  // paints the full world-mm tank rect (0, 0, 360, 220) and the water tint
  // paints the SAME rect capped at the tank's EFFECTIVE water level —
  // (0, 0, 360, 195) for the 220 mm fixture tank (220 −
  // DEFAULT_WATER_GAP_BELOW_RIM_MM = 195). The tint is further
  // distinguishable by its save/globalAlpha/fillRect/restore wrap.
  const TANK_RECT_ARGS = JSON.stringify([0, 0, 360, 220]);
  const TINT_RECT_ARGS = JSON.stringify([0, 0, 360, 195]);
  const isTankRectFillRect = (o: { method: string; args: unknown[] }): boolean =>
    o.method === 'fillRect' && JSON.stringify(o.args) === TANK_RECT_ARGS;
  const isTintRectFillRect = (o: { method: string; args: unknown[] }): boolean =>
    o.method === 'fillRect' && JSON.stringify(o.args) === TINT_RECT_ARGS;
  /** Locate the WATER-TINT fillRect (the waterline-capped rect). */
  const findTintFillRectIdx = (ops: Array<{ method: string; args: unknown[] }>): number =>
    ops.findIndex(isTintRectFillRect);

  it('paints a tinted fillRect from the floor up to the effective water level', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({
        frame: 'rimless',
        waterTint: '#88ccff',
        background: { kind: 'none' },
      }), upright);
    const ops = canvas.context.ops;
    // One full-rect background fill + one waterline-capped tint fill.
    expect(ops.filter(isTankRectFillRect).length).toBe(1);
    expect(ops.filter(isTintRectFillRect).length).toBe(1);
    const tintIdx = findTintFillRectIdx(ops);
    expect(tintIdx).toBeGreaterThanOrEqual(0);
  });

  it('caps the tint at an authored tank.waterLevelMm', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithStyle({
      frame: 'rimless',
      waterTint: '#88ccff',
      background: { kind: 'none' },
    });
    r.render({ ...scene, tank: { ...scene.tank, waterLevelMm: 120 } }, upright);
    const tint = canvas.context.ops.find(
      (o) => o.method === 'fillRect' && JSON.stringify(o.args) === JSON.stringify([0, 0, 360, 120]),
    );
    expect(tint).toBeDefined();
  });

  it('wraps the tint in save/restore with globalAlpha set', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithStyle({
        frame: 'rimless',
        waterTint: '#88ccff',
        background: { kind: 'none' },
      }), upright);
    const ops = canvas.context.ops;
    const tintIdx = findTintFillRectIdx(ops);
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
    r.render(sceneWithStyle({
        frame: 'rimless',
        waterTint: '#88ccff80',
        background: { kind: 'none' },
      }), upright);
    const ops = canvas.context.ops;
    const tintIdx = findTintFillRectIdx(ops);
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
    r.render(sceneWithStyle({
        frame: 'framed',
        frameColor: '#8b4513', // wood
        background: { kind: 'none' },
      }), upright);
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
    const lookup = new Map<
      string,
      { catalog: string; id: string; color: string; kind: 'substrate' }
    >();
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
    expect(
      styles.some((op) => typeof op.args[0] === 'string' && op.args[0]!.toString().startsWith('#')),
    ).toBe(true);
  });

  it('uses the catalog color when a matching substrate entry is supplied', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const catalog = fakeCatalog([{ catalog: 'core', id: 'substrate.sand.x', color: '#abcdef' }]);
    r.render(sceneWithRegion([{ id: 'r-1', itemId: 'substrate.sand.x' }]), upright, { catalog });
    const styles = only(canvas.context.ops, ['set:fillStyle']);
    expect(styles.some((op) => op.args[0] === '#abcdef')).toBe(true);
  });

  it('falls back to the default color when the catalog lookup misses', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const catalog = fakeCatalog([{ catalog: 'core', id: 'substrate.OTHER', color: '#abcdef' }]);
    r.render(sceneWithRegion([{ id: 'r-1', itemId: 'substrate.missing' }]), upright, { catalog });
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
    r.render(sceneWithRegion([
        { id: 'r-1', itemId: 'a' },
        { id: 'r-2', itemId: 'b' },
      ]), upright, { catalog });
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
    r.render(sceneWithRegion([
        {
          id: 'r-wide',
          fromX: 0,
          toX: 1, // full 600 mm width — plenty for grain
          profile: [
            { x: 0, y: 40 },
            { x: 1, y: 40 },
          ],
        },
      ]), upright);
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
    r.render(sceneWithRegion([
        {
          id: 'r-narrow',
          fromX: 0,
          toX: 0.01, // ~6 mm wide on a 600 mm tank
          profile: [
            { x: 0, y: 10 },
            { x: 1, y: 10 },
          ],
        },
      ]), upright);
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
    r.render(sceneWithRegion([
        {
          id: 'r-degenerate',
          fromX: 0.5,
          toX: 0.5,
        },
      ]), upright);
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
    expect(r.hitTest({ x: 0, y: 0 }, sceneWithObject(), upright, { catalog: fakeCatalog })).toBeNull();
  });

  it('hits an object at the canvas centre when transform.position is at viewport.center', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    // Canvas centre is (400, 300) in CSS pixels.
    const result = r.hitTest({ x: 400, y: 300 }, sceneWithObject(), upright, { catalog: fakeCatalog });
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
    expect(r.hitTest({ x: 600, y: 300 }, sceneWithObject(), upright, { catalog: fakeCatalog })).toBeNull();
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
    const result = r.hitTest({ x: 400, y: 300 }, front, upright, { catalog: fakeCatalog });
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
    expect(r.hitTest({ x: 400, y: 300 }, hidden, upright, { catalog: fakeCatalog })).toBeNull();
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
    expect(r.hitTest({ x: 400, y: 300 }, scene, upright, { catalog: fakeCatalog })).not.toBeNull();
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
    expect(r.hitTest({ x: 400, y: 300 }, scene, upright, { catalog: fakeCatalog })).toBeNull();
  });

  it('honours flipX without changing the hit-test result for a symmetric silhouette', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithObject();
    scene.layers[0]!.objects[0]!.transform.flipX = true;
    expect(r.hitTest({ x: 400, y: 300 }, scene, upright, { catalog: fakeCatalog })).not.toBeNull();
  });

  it('returns null when transform.scale collapses the silhouette to zero area', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithObject();
    scene.layers[0]!.objects[0]!.transform.scale = { x: 0, y: 0, z: 0 };
    expect(r.hitTest({ x: 400, y: 300 }, scene, upright, { catalog: fakeCatalog })).toBeNull();
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
    r.render(makeMinimalScene(), upright, { catalog: fakeCatalog });
    const fillStyles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    expect(fillStyles).not.toContain('#444444');
  });

  it('paints a filled silhouette per hardscape object with the catalog color', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithHardscape([{ id: 'a' }]), upright, { catalog: fakeCatalog });
    const fillStyles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    expect(fillStyles).toContain('#444444');
  });

  it('skips an object whose catalog entry is missing', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithHardscape([{ id: 'a', refId: 'rock.missing' }]), upright, { catalog: fakeCatalog });
    const fillStyles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    expect(fillStyles).not.toContain('#444444');
  });

  it('paints in object order (back-to-front)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithHardscape([
        { id: 'a', refId: 'rock.tri' },
        { id: 'b', refId: 'wood.tri' },
      ]), upright, { catalog: fakeCatalog });
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
    r.render(sceneWithHardscape([{ id: 'a' }]), upright, { catalog: fakeCatalog });
    const noSelStrokes = only(canvas.context.ops, ['set:strokeStyle']).map((o) => o.args[0]);
    expect(noSelStrokes).not.toContain('#3a8eff');

    canvas.context.ops.length = 0;
    canvas.context.gradients.length = 0;
    r.render(sceneWithHardscape([{ id: 'a' }]), upright, { catalog: fakeCatalog, selection: ['a'] as never });
    const selStrokes = only(canvas.context.ops, ['set:strokeStyle']).map((o) => o.args[0]);
    expect(selStrokes).toContain('#3a8eff');
  });

  it('honours layer.opacity by setting globalAlpha', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithHardscape([{ id: 'a' }]);
    scene.layers[0]!.opacity = 0.5;
    r.render(scene, upright, { catalog: fakeCatalog });
    const alphaSets = only(canvas.context.ops, ['set:globalAlpha']).map((o) => o.args[0]);
    expect(alphaSets).toContain(0.5);
  });

  it('skips invisible layers entirely', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithHardscape([{ id: 'a' }]);
    scene.layers[0]!.visible = false;
    r.render(scene, upright, { catalog: fakeCatalog });
    const fillStyles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    expect(fillStyles).not.toContain('#444444');
  });

  it('skips zero-scale objects (degenerate)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithHardscape([{ id: 'a' }]);
    scene.layers[0]!.objects[0]!.transform.scale = { x: 0, y: 0, z: 0 };
    r.render(scene, upright, { catalog: fakeCatalog });
    const fillStyles = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    expect(fillStyles).not.toContain('#444444');
  });

  it('skips selection handles for objects with no catalog entry or zero size', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithHardscape([{ id: 'a' }]);
    scene.layers[0]!.objects[0]!.transform.scale = { x: 0, y: 0, z: 0 };
    r.render(scene, upright, { catalog: fakeCatalog, selection: ['a'] as never });
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
    r.render(scene, upright, { catalog: fakeCatalog, selection: ['a'] as never });
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
    r.render(sceneNaN, upright, { catalog: fakeCatalog });
    // NaN → 1, so globalAlpha is 1 (which appears at multiple points; just
    // assert the render didn't crash and the silhouette painted).
    const fills = only(canvas.context.ops, ['set:fillStyle']).map((o) => o.args[0]);
    expect(fills).toContain('#444444');

    // Negative opacity → 0.
    canvas.context.ops.length = 0;
    canvas.context.gradients.length = 0;
    const sceneNeg = sceneWithHardscape([{ id: 'a' }]);
    sceneNeg.layers[0]!.opacity = -0.5;
    r.render(sceneNeg, upright, { catalog: fakeCatalog });
    const alphaSetsNeg = only(canvas.context.ops, ['set:globalAlpha']).map((o) => o.args[0]);
    expect(alphaSetsNeg).toContain(0);

    // > 1 → 1.
    canvas.context.ops.length = 0;
    canvas.context.gradients.length = 0;
    const sceneHigh = sceneWithHardscape([{ id: 'a' }]);
    sceneHigh.layers[0]!.opacity = 2;
    r.render(sceneHigh, upright, { catalog: fakeCatalog });
    const alphaSetsHi = only(canvas.context.ops, ['set:globalAlpha']).map((o) => o.args[0]);
    expect(alphaSetsHi).toContain(1);
  });

  it('renders are idempotent in the hardscape path', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithHardscape([{ id: 'a' }]);
    r.render(scene, upright, { catalog: fakeCatalog, selection: ['a'] as never });
    const first = canvas.context.ops.slice();
    canvas.context.ops.length = 0;
    canvas.context.gradients.length = 0;
    r.render(scene, upright, { catalog: fakeCatalog, selection: ['a'] as never });
    expect(canvas.context.ops).toEqual(first);
  });
});

// ─── Stage 3.x — handle hit-testing ──────────────────────────────────────

describe('Canvas2DRenderer.hitTest (handles)', () => {
  let fakeWindow: FakeWindow;
  beforeEach(() => {
    fakeWindow = installFakeWindow();
  });
  afterEach(() => {
    uninstallFakeWindow();
    void fakeWindow;
  });

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

  function sceneWithObject() {
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
                position: { x: 180, y: 110, z: 0 },
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

  // 100mm × 100mm object centred at viewport center (180, 110) at zoom=1.
  // Canvas size 800×600 → canvas center (400, 300).
  // World ±50 → CSS ±50. y is flipped: world +y up → CSS −y.
  // Corners (world):  NE=(230,160), NW=(130,160), SE=(230,60), SW=(130,60).
  // Corners (CSS):    NE=(450,250), NW=(350,250), SE=(450,350), SW=(350,350).

  it('returns handle: scaleNE when the click is on the top-right scale handle', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const result = r.hitTest({ x: 450, y: 250 }, sceneWithObject(), upright, { catalog: fakeCatalog, selection: [
      'obj-1' as never,
    ] });
    expect(result?.handle).toBe('scaleNE');
  });

  it('returns handle: scaleSW for the bottom-left corner', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const result = r.hitTest({ x: 350, y: 350 }, sceneWithObject(), upright, { catalog: fakeCatalog, selection: [
      'obj-1' as never,
    ] });
    expect(result?.handle).toBe('scaleSW');
  });

  it('returns handle: scaleNW and scaleSE for the remaining two corners', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    expect(
      r.hitTest({ x: 350, y: 250 }, sceneWithObject(), upright, { catalog: fakeCatalog, selection: ['obj-1' as never] })
        ?.handle,
    ).toBe('scaleNW');
    expect(
      r.hitTest({ x: 450, y: 350 }, sceneWithObject(), upright, { catalog: fakeCatalog, selection: ['obj-1' as never] })
        ?.handle,
    ).toBe('scaleSE');
  });

  it('returns handle: rotate when the click is on the rotate dot above the bbox', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    // Rotate dot at local (0, halfH + stalk) = (0, 50 + 18) = (0, 68).
    // World (180, 178). CSS y = 300 - 68 = 232.
    const result = r.hitTest({ x: 400, y: 232 }, sceneWithObject(), upright, { catalog: fakeCatalog, selection: [
      'obj-1' as never,
    ] });
    expect(result?.handle).toBe('rotate');
  });

  it('returns body hit (no handle field) when selection list is empty', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const result = r.hitTest({ x: 450, y: 250 }, sceneWithObject(), upright, { catalog: fakeCatalog, selection: [] });
    expect(result?.objectId).toBe('obj-1');
    expect(result?.handle).toBeUndefined();
  });

  it('skips handle hit-test when the object is not in the selection list', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const result = r.hitTest({ x: 450, y: 250 }, sceneWithObject(), upright, { catalog: fakeCatalog, selection: [
      'unrelated' as never,
    ] });
    expect(result?.handle).toBeUndefined();
    expect(result?.objectId).toBe('obj-1');
  });

  it('returns null when the cursor is well outside the bbox + handles', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    expect(
      r.hitTest({ x: 200, y: 300 }, sceneWithObject(), upright, { catalog: fakeCatalog, selection: ['obj-1' as never] }),
    ).toBeNull();
  });

  it('honours object rotation for handle positions', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    // Rotate 90° CCW. The painted NE corner (local (50,50)) ends up at
    // world (180 - 50, 110 + 50) = (130, 160). CSS = (350, 250).
    const scene = sceneWithObject();
    scene.layers[0]!.objects[0]!.transform.rotation = { x: 0, y: 0, z: Math.PI / 2 };
    const result = r.hitTest({ x: 350, y: 250 }, scene, upright, { catalog: fakeCatalog, selection: ['obj-1' as never] });
    expect(result?.handle).toBe('scaleNE');
  });

  it('skips handle hit-test for objects with zero scale', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithObject();
    scene.layers[0]!.objects[0]!.transform.scale = { x: 0, y: 0, z: 0 };
    expect(
      r.hitTest({ x: 400, y: 300 }, scene, upright, { catalog: fakeCatalog, selection: ['obj-1' as never] }),
    ).toBeNull();
  });

  it('uses fallback naturalSize when no catalog is provided (still hits handles)', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const result = r.hitTest({ x: 450, y: 250 }, sceneWithObject(), upright, { selection: [
      'obj-1' as never,
    ] });
    expect(result?.handle).toBe('scaleNE');
  });
});

// ─── F4.4 — Plant rendering, growth + scatter, hit-test ──────────────────

describe('Canvas2DRenderer.render (plants)', () => {
  let fakeWindow: FakeWindow;
  beforeEach(() => {
    fakeWindow = installFakeWindow();
  });
  afterEach(() => {
    uninstallFakeWindow();
    void fakeWindow;
  });

  const plantEntry = {
    catalog: 'core',
    id: 'plant.test',
    version: 1,
    name: 'Test plant',
    kind: 'plant' as const,
    zone: 'foreground' as const,
    lighting: 'medium' as const,
    co2: 'low' as const,
    difficulty: 'easy' as const,
    color: '#3a8050',
    naturalSize: { width: 40, height: 60, depth: 40 },
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
    growth: { weeksToMature: 8, sizeAtZero: 0.3 },
  };
  const fakeCatalog = {
    entries: [plantEntry] as never,
    get({ catalog, id }: { catalog: string; id: string }) {
      if (catalog === 'core' && id === 'plant.test') return plantEntry;
      return null;
    },
    byKind() {
      return [] as never;
    },
  } as never;

  function sceneWithPlant(overrides?: {
    ageWeeks?: number;
    vigor?: number;
    refId?: string;
    scatter?: { polygon: Array<{ x: number; y: number }>; density: number; seed?: number };
  }) {
    const base = makeMinimalScene(600, 360, 360);
    const plant = {
      kind: 'plant' as const,
      id: 'p-1' as never,
      ref: { catalog: 'core', id: overrides?.refId ?? 'plant.test', version: 1 },
      transform: {
        position: { x: 300, y: 180, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        flipX: false,
        flipY: false,
      },
      growth: { ageWeeks: overrides?.ageWeeks ?? 8, vigor: overrides?.vigor ?? 1 },
      ...(overrides?.scatter !== undefined ? { scatter: overrides.scatter } : {}),
    };
    return {
      ...base,
      layers: [
        {
          id: 'layer-1' as never,
          name: 'L',
          opacity: 1,
          visible: true,
          locked: false,
          objects: [plant],
        },
      ],
    };
  }

  it('paints nothing when there are no plant objects (empty scene unchanged)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    canvas.context.ops.length = 0;
    r.render(makeMinimalScene(), upright, { catalog: fakeCatalog });
    // Plant-specific fills only happen on a non-empty plant set.
    const fills = only(canvas.context.ops, ['fill']);
    // The base scene paints background + tank ops; no per-plant fills.
    expect(fills.length).toBeLessThanOrEqual(1);
  });

  it('paints a single-specimen plant with the catalog fill color', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithPlant(), upright, { catalog: fakeCatalog });
    // The renderer issues fillStyle assignments for various passes; assert
    // the plant's color appears at least once.
    const styles = canvas.context.ops
      .filter((op) => op.method === 'set:fillStyle')
      .map((op) => op.args[0]);
    expect(styles).toContain(plantEntry.color);
  });

  it('skips plants whose catalog entry is missing (silent, no crash)', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    expect(() =>
      r.render(sceneWithPlant({ refId: 'plant.MISSING' }), upright, { catalog: fakeCatalog }),
    ).not.toThrow();
  });

  it('skips plants entirely when no catalog is supplied', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithPlant(), upright);
    const fills = canvas.context.ops.filter((op) => op.method === 'fillStyle');
    expect(fills.every((op) => op.args[0] !== plantEntry.color)).toBe(true);
  });

  it('paints LARGER bbox when previewAgeWeeks is past maturity vs week 0', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithPlant({ ageWeeks: 0 }), upright, { catalog: fakeCatalog, selection: [], previewAgeWeeks: 0 });
    const scalesAtZero = canvas.context.ops
      .filter((op) => op.method === 'scale')
      .map((op) => Math.abs(op.args[0] as number));
    canvas.context.ops.length = 0;
    r.render(sceneWithPlant({ ageWeeks: 0 }), upright, { catalog: fakeCatalog, selection: [], previewAgeWeeks: 24 });
    const scalesAtMature = canvas.context.ops
      .filter((op) => op.method === 'scale')
      .map((op) => Math.abs(op.args[0] as number));
    // The maximum scale recorded for the plant pass should grow with preview age.
    expect(Math.max(...scalesAtMature)).toBeGreaterThan(Math.max(...scalesAtZero));
  });

  it('single-specimen plant is base-anchored — the post-scale translate(0, 1) puts silhouette y=−1 at position.y', () => {
    // The renderer's plant pass should:
    //   1. translate(position.x, position.y)            ← move to anchor
    //   2. scale(sx, sy) with sy > 0                    ← grow upward
    //   3. translate(0, 1)                              ← anchor base
    // Step 3 is the load-bearing fix: without it the silhouette CENTRE
    // would land at position.y, so the silhouette base (y=-1) would
    // dangle below position.y by `sy` world-mm — i.e. roots would float
    // below the authored anchor.
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(sceneWithPlant({ ageWeeks: 12 }), upright, { catalog: fakeCatalog });
    // Find the contiguous (translate, scale, translate) trio with a
    // small positive sy and a [0, 1] post-scale anchor translate.
    let baseAnchorOps = 0;
    const ops = canvas.context.ops;
    for (let i = 0; i + 2 < ops.length; i++) {
      const a = ops[i]!;
      const b = ops[i + 1]!;
      const c = ops[i + 2]!;
      if (
        a.method === 'translate' &&
        b.method === 'scale' &&
        c.method === 'translate' &&
        Math.abs(b.args[0] as number) > 1 &&
        Math.abs(b.args[0] as number) < 200 && // per-instance scale (not world transform)
        (b.args[1] as number) > 0 &&            // sy positive (growth up)
        (c.args[0] as number) === 0 &&          // x anchor offset is 0
        (c.args[1] as number) === 1             // y anchor offset is 1 (base)
      ) {
        baseAnchorOps++;
      }
    }
    expect(baseAnchorOps).toBeGreaterThan(0);
  });

  it('plant growth extends ONLY UPWARD — sy is positive even when transform.flipY is true', () => {
    // Plants always grow up from the substrate; flipY on a plant must be
    // ignored at the render layer (the MirrorObject command also rejects
    // axis='y' on plant kind). Confirm sy stays positive across renders
    // where the document carries flipY: true (defence in depth for any
    // legacy doc that smuggled flipY through).
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant({ ageWeeks: 12 });
    scene.layers[0]!.objects[0]!.transform.flipY = true;
    r.render(scene, upright, { catalog: fakeCatalog });
    const plantScales = canvas.context.ops
      .filter((op) => op.method === 'scale')
      .map((op) => [op.args[0] as number, op.args[1] as number])
      .filter(([sx, sy]) => Math.abs(sx) > 1 && Math.abs(sx) < 200 && Math.abs(sy) > 1 && Math.abs(sy) < 200);
    expect(plantScales.length).toBeGreaterThan(0);
    expect(plantScales.every(([, sy]) => sy > 0)).toBe(true);
  });

  it('honours layer.opacity by setting globalAlpha before painting plants', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant();
    scene.layers[0]!.opacity = 0.4;
    r.render(scene, upright, { catalog: fakeCatalog });
    const alphas = canvas.context.ops
      .filter((op) => op.method === 'set:globalAlpha')
      .map((op) => op.args[0]);
    expect(alphas).toContain(0.4);
  });

  it('skips invisible layers (no plant fills painted)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant();
    scene.layers[0]!.visible = false;
    r.render(scene, upright, { catalog: fakeCatalog });
    const styles = canvas.context.ops
      .filter((op) => op.method === 'set:fillStyle')
      .map((op) => op.args[0]);
    expect(styles).not.toContain(plantEntry.color);
  });

  it('skips a single-specimen plant with zero transform scale', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant();
    scene.layers[0]!.objects[0]!.transform.scale = { x: 0, y: 0, z: 0 };
    r.render(scene, upright, { catalog: fakeCatalog });
    const styles = canvas.context.ops
      .filter((op) => op.method === 'set:fillStyle')
      .map((op) => op.args[0]);
    expect(styles).not.toContain(plantEntry.color);
  });

  it('paints multiple instances for a scatter patch', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant({
      scatter: {
        polygon: [
          { x: 200, y: 100 },
          { x: 400, y: 100 },
          { x: 400, y: 260 },
          { x: 200, y: 260 },
        ],
        density: 40,
        seed: 123,
      },
    });
    r.render(scene, upright, { catalog: fakeCatalog });
    // One `fill` per instance silhouette + outline strokes. Count fills with
    // the plant color set as the current fillStyle.
    const fillOps = canvas.context.ops.filter((op) => op.method === 'fill').length;
    expect(fillOps).toBeGreaterThan(5);
  });

  it('scatter is deterministic across consecutive renders (same op stream)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant({
      scatter: {
        polygon: [
          { x: 200, y: 100 },
          { x: 400, y: 100 },
          { x: 400, y: 260 },
          { x: 200, y: 260 },
        ],
        density: 30,
        seed: 7,
      },
    });
    r.render(scene, upright, { catalog: fakeCatalog });
    const first = canvas.context.ops.slice();
    canvas.context.ops.length = 0;
    r.render(scene, upright, { catalog: fakeCatalog });
    expect(canvas.context.ops).toEqual(first);
  });

  it('scatter renders nothing when the brush polygon is empty / degenerate', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant({
      scatter: {
        polygon: [{ x: 0, y: 0 }],
        density: 30,
        seed: 1,
      },
    });
    r.render(scene, upright, { catalog: fakeCatalog });
    const styles = canvas.context.ops
      .filter((op) => op.method === 'set:fillStyle')
      .map((op) => op.args[0]);
    expect(styles).not.toContain(plantEntry.color);
  });

  // The Mirror H / Mirror V buttons on the selection inspector toggle
  // `transform.flipX/Y`. For scatter (carpet) plants the renderer mirrors
  // (a) the brush polygon about its centroid (visible re-arrangement for
  // ASYMMETRIC polygons) and (b) each instance silhouette via a negative
  // scale arg (visible per-leaf flip for asymmetric silhouettes).
  // Symmetric polygons + silhouettes are invariant, which is the right
  // answer mathematically.

  function asymmetricScatterScene(flipX = false, flipY = false) {
    // Right-triangle polygon — distinctly NOT symmetric on either axis,
    // so polygon mirror produces a visibly different scatter footprint.
    const scene = sceneWithPlant({
      scatter: {
        polygon: [
          { x: 200, y: 100 },
          { x: 320, y: 100 },
          { x: 320, y: 220 },
        ],
        density: 80,
        seed: 42,
      },
    });
    scene.layers[0]!.objects[0]!.transform.flipX = flipX;
    scene.layers[0]!.objects[0]!.transform.flipY = flipY;
    return scene;
  }

  it('Mirror H on a scatter plant flips the silhouette per instance (negative x-scale)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(asymmetricScatterScene(true, false), upright, { catalog: fakeCatalog });
    // For an asymmetric polygon with flipX, every per-instance `ctx.scale(sx, sy)`
    // call from the scatter path uses a negative sx.
    const scales = canvas.context.ops
      .filter((op) => op.method === 'scale')
      .map((op) => [op.args[0], op.args[1]] as [number, number]);
    // Filter to the small per-instance scales (the world-transform scale
    // at the start of render is large). Instances are ~entry.naturalSize/2
    // × jitter × growthScale; for naturalSize=40 that's ≈ 20mm-sized.
    // The world-transform `ctx.scale(zoom, -zoom)` lands first with sx=1
    // for the upright viewport. Filter to per-instance scales (|sx| ≥ 5)
    // so the world transform doesn't drag the assertion's "every" past.
    const instanceScales = scales.filter(
      ([sx, sy]) => Math.abs(sx) >= 5 && Math.abs(sx) < 100 && Math.abs(sy) >= 5,
    );
    expect(instanceScales.length).toBeGreaterThan(0);
    expect(instanceScales.every(([sx]) => sx < 0)).toBe(true);
  });

  it('Mirror V on a scatter plant IS IGNORED — sy stays positive (plants always grow up)', () => {
    // Plants never flip vertically. The MirrorObject command rejects
    // axis='y' on plants, and the renderer doubles down: even if a legacy
    // document carries `flipY: true` on a plant, sy stays positive so
    // roots remain at the bottom.
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(asymmetricScatterScene(false, true), upright, { catalog: fakeCatalog });
    const scales = canvas.context.ops
      .filter((op) => op.method === 'scale')
      .map((op) => [op.args[0], op.args[1]] as [number, number]);
    const instanceScales = scales.filter(
      ([sx, sy]) => Math.abs(sx) >= 5 && Math.abs(sx) < 100 && Math.abs(sy) >= 5,
    );
    expect(instanceScales.length).toBeGreaterThan(0);
    // Every per-instance sy must be POSITIVE despite flipY=true.
    expect(instanceScales.every(([, sy]) => sy > 0)).toBe(true);
  });

  it('Mirror H rearranges instance positions for an asymmetric polygon (visible flip)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(asymmetricScatterScene(false), upright, { catalog: fakeCatalog });
    const original = canvas.context.ops
      .filter((op) => op.method === 'translate')
      .map((op) => [op.args[0], op.args[1]] as [number, number])
      .filter(([x]) => x > 100 && x < 500);
    canvas.context.ops.length = 0;
    r.render(asymmetricScatterScene(true), upright, { catalog: fakeCatalog });
    const mirrored = canvas.context.ops
      .filter((op) => op.method === 'translate')
      .map((op) => [op.args[0], op.args[1]] as [number, number])
      .filter(([x]) => x > 100 && x < 500);
    expect(mirrored).not.toEqual(original);
  });

  it('Mirror H on a symmetric polygon STILL re-arranges instances via seed XOR (visible feedback)', () => {
    // Polygon mirror is identity for a symmetric polygon (a square is
    // symmetric about both axes), so without the seed-XOR mix the render
    // would be byte-identical — Mirror on the default auto-created
    // circular brush would look like nothing happened. The renderer XORs
    // a magic constant into the effective seed when flipX/flipY is true
    // to force a visibly different scatter.
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const polygon = [
      { x: 200, y: 100 },
      { x: 320, y: 100 },
      { x: 320, y: 220 },
      { x: 200, y: 220 },
    ];
    const sceneFlat = sceneWithPlant({
      scatter: { polygon, density: 80, seed: 7 },
    });
    r.render(sceneFlat, upright, { catalog: fakeCatalog });
    const positionsFlat = canvas.context.ops
      .filter((op) => op.method === 'translate')
      .map((op) => [op.args[0], op.args[1]] as [number, number]);
    canvas.context.ops.length = 0;
    const sceneFlipped = sceneWithPlant({
      scatter: { polygon, density: 80, seed: 7 },
    });
    sceneFlipped.layers[0]!.objects[0]!.transform.flipX = true;
    r.render(sceneFlipped, upright, { catalog: fakeCatalog });
    const positionsFlipped = canvas.context.ops
      .filter((op) => op.method === 'translate')
      .map((op) => [op.args[0], op.args[1]] as [number, number]);
    expect(positionsFlipped).not.toEqual(positionsFlat);
  });

  it('selected scatter plant gets a non-interactive dashed bbox around the polygon AABB', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const polygon = [
      { x: 200, y: 100 },
      { x: 320, y: 100 },
      { x: 320, y: 220 },
      { x: 200, y: 220 },
    ];
    const scene = sceneWithPlant({ scatter: { polygon, density: 20, seed: 1 } });
    r.render(scene, upright, { catalog: fakeCatalog, selection: ['p-1' as never] });
    const rects = canvas.context.ops
      .filter((op) => op.method === 'strokeRect')
      .map((op) => op.args as [number, number, number, number]);
    expect(rects.length).toBeGreaterThan(0);
    const bbox = rects.find(
      ([x, y, w, h]) =>
        Math.round(x) === 200 &&
        Math.round(y) === 100 &&
        Math.round(w) === 120 &&
        Math.round(h) === 120,
    );
    expect(bbox).toBeDefined();
  });
});

describe('Canvas2DRenderer.hitTest (plants)', () => {
  let fakeWindow: FakeWindow;
  beforeEach(() => {
    fakeWindow = installFakeWindow();
  });
  afterEach(() => {
    uninstallFakeWindow();
    void fakeWindow;
  });

  const plantEntry = {
    catalog: 'core',
    id: 'plant.test',
    version: 1,
    name: 'Test plant',
    kind: 'plant' as const,
    zone: 'foreground' as const,
    lighting: 'medium' as const,
    co2: 'low' as const,
    difficulty: 'easy' as const,
    color: '#3a8050',
    naturalSize: { width: 100, height: 100, depth: 100 },
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
    growth: { weeksToMature: 8, sizeAtZero: 0.3 },
  };
  const fakeCatalog = {
    entries: [plantEntry] as never,
    get({ catalog, id }: { catalog: string; id: string }) {
      if (catalog === 'core' && id === 'plant.test') return plantEntry;
      return null;
    },
    byKind() {
      return [] as never;
    },
  } as never;

  function sceneWithPlant(overrides?: {
    ageWeeks?: number;
    scatter?: { polygon: Array<{ x: number; y: number }>; density: number; seed?: number };
  }) {
    return {
      ...makeMinimalScene(600, 360, 360),
      layers: [
        {
          id: 'layer-1' as never,
          name: 'L',
          opacity: 1,
          visible: true,
          locked: false,
          objects: [
            {
              kind: 'plant' as const,
              id: 'p-1' as never,
              ref: { catalog: 'core', id: 'plant.test', version: 1 },
              transform: {
                position: { x: 180, y: 110, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                flipX: false,
                flipY: false,
              },
              growth: { ageWeeks: overrides?.ageWeeks ?? 8, vigor: 1 },
              ...(overrides?.scatter !== undefined ? { scatter: overrides.scatter } : {}),
            },
          ],
        },
      ],
    };
  }

  it('hits a mature single-specimen plant at the canvas centre', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const result = r.hitTest({ x: 400, y: 300 }, sceneWithPlant(), upright, { catalog: fakeCatalog });
    expect(result?.objectId).toBe('p-1');
  });

  it('misses a tiny week-0 plant at a click far from its centre', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    // At week 0 the plant is ~30% of mature; a click 45 mm from centre is
    // outside the shrunk silhouette but inside the mature one.
    const result = r.hitTest({ x: 445, y: 300 }, sceneWithPlant({ ageWeeks: 0 }), upright, { catalog: fakeCatalog });
    expect(result).toBeNull();
  });

  it('previewAgeWeeks expands the hit-test bbox to match the rendered growth', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant({ ageWeeks: 0 });
    // Same click as above, now previewing at maturity — should hit.
    const result = r.hitTest({ x: 445, y: 300 }, scene, upright, { catalog: fakeCatalog, previewAgeWeeks: 24 });
    expect(result?.objectId).toBe('p-1');
  });

  it('hits a scatter patch via point-in-polygon against the brush outline', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant({
      scatter: {
        polygon: [
          { x: 150, y: 80 },
          { x: 250, y: 80 },
          { x: 250, y: 160 },
          { x: 150, y: 160 },
        ],
        density: 20,
        seed: 1,
      },
    });
    // World (200, 120) → CSS (420, 360) for the upright viewport at zoom=1.
    // Centre of brush polygon (200, 120): canvas-x = 400 + (200-180) = 420;
    // canvas-y = 300 - (120-110) = 290. Inside the polygon.
    const result = r.hitTest({ x: 420, y: 290 }, scene, upright, { catalog: fakeCatalog });
    expect(result?.objectId).toBe('p-1');
  });

  it('misses a scatter patch when the click is outside the brush polygon', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant({
      scatter: {
        polygon: [
          { x: 150, y: 80 },
          { x: 250, y: 80 },
          { x: 250, y: 160 },
          { x: 150, y: 160 },
        ],
        density: 20,
        seed: 1,
      },
    });
    const result = r.hitTest({ x: 100, y: 100 }, scene, upright, { catalog: fakeCatalog });
    expect(result).toBeNull();
  });

  it('returns null when the plant catalog entry is missing', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant();
    scene.layers[0]!.objects[0]!.ref = { catalog: 'core', id: 'plant.MISSING', version: 1 };
    expect(r.hitTest({ x: 400, y: 300 }, scene, upright, { catalog: fakeCatalog })).toBeNull();
  });

  it('returns null for a single-specimen plant with zero scale', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant();
    scene.layers[0]!.objects[0]!.transform.scale = { x: 0, y: 0, z: 0 };
    expect(r.hitTest({ x: 400, y: 300 }, scene, upright, { catalog: fakeCatalog })).toBeNull();
  });

  it('single-specimen plant participates in handle hit-test when selected', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    // Mature plant centered at (180, 110); silhouette extends ±50mm
    // (naturalSize 100 × growthScale ~0.99 ≈ 99 mm). Top-right corner at
    // world ≈ (229, 159); CSS (449, 251).
    const result = r.hitTest({ x: 449, y: 251 }, sceneWithPlant(), upright, { catalog: fakeCatalog, selection: [
      'p-1' as never,
    ] });
    expect(result?.handle).toBe('scaleNE');
  });

  it('scatter plants do NOT show selection handles (no handle hit from inside polygon)', () => {
    const { surface } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = sceneWithPlant({
      scatter: {
        polygon: [
          { x: 150, y: 80 },
          { x: 250, y: 80 },
          { x: 250, y: 160 },
          { x: 150, y: 160 },
        ],
        density: 20,
        seed: 1,
      },
    });
    const result = r.hitTest({ x: 420, y: 290 }, scene, upright, { catalog: fakeCatalog, selection: ['p-1' as never] });
    expect(result?.objectId).toBe('p-1');
    expect(result?.handle).toBeUndefined();
  });
});

// ─── F5.3 — Composition overlays ──────────────────────────────────────────
//
// Three view-only guides: golden-ratio lines, rule-of-thirds lines, and
// golden-ratio focal-point markers. Positions come from the same
// `goldenRatioLines` / `thirdsLines` / `focalPoints` helpers the renderer
// consumes (no magic numbers).

describe('Canvas2DRenderer.render (composition overlays — F5.3)', () => {
  const TANK_W = 360;
  const TANK_H = 220;

  const GOLDEN_STROKE = 'rgba(255, 215, 0, 0.45)';
  const THIRDS_STROKE = 'rgba(255, 255, 255, 0.45)';
  const FOCAL_FILL = 'rgba(255, 215, 0, 0.85)';

  // Mirror the geometry helpers locally — the renderer calls the same
  // exports, so we anchor expectations to the same maths instead of
  // hard-coding numbers.
  const PHI = (1 + Math.sqrt(5)) / 2;
  const goldenV = [TANK_W / PHI, TANK_W - TANK_W / PHI].sort((a, b) => a - b);
  const goldenH = [TANK_H / PHI, TANK_H - TANK_H / PHI].sort((a, b) => a - b);
  const thirdsV = [TANK_W / 3, (2 * TANK_W) / 3];
  const thirdsH = [TANK_H / 3, (2 * TANK_H) / 3];
  const focalPts = [
    { x: goldenV[0]!, y: goldenH[0]! },
    { x: goldenV[1]!, y: goldenH[0]! },
    { x: goldenV[0]!, y: goldenH[1]! },
    { x: goldenV[1]!, y: goldenH[1]! },
  ];

  let fakeWindow: FakeWindow;

  beforeEach(() => {
    fakeWindow = installFakeWindow();
    void fakeWindow;
  });

  afterEach(() => {
    uninstallFakeWindow();
  });

  function render(
    overlay: { goldenRatio: boolean; thirds: boolean; focalPoints: boolean } | undefined,
    viewport: Viewport = upright,
  ): { ops: RecordedOp[] } {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(TANK_W, TANK_H, TANK_H), viewport, { overlayOptions: overlay });
    return { ops: canvas.context.ops };
  }

  /** All `set:strokeStyle` values the renderer assigned. */
  function strokeStyles(ops: RecordedOp[]): string[] {
    return ops.filter((o) => o.method === 'set:strokeStyle').map((o) => String(o.args[0]));
  }

  /** All `set:fillStyle` values the renderer assigned. */
  function fillStyles(ops: RecordedOp[]): string[] {
    return ops.filter((o) => o.method === 'set:fillStyle').map((o) => String(o.args[0]));
  }

  it('is a no-op when overlayOptions is omitted', () => {
    const { ops } = render(undefined);
    expect(strokeStyles(ops)).not.toContain(GOLDEN_STROKE);
    expect(strokeStyles(ops)).not.toContain(THIRDS_STROKE);
    expect(fillStyles(ops)).not.toContain(FOCAL_FILL);
  });

  it('is a no-op when every overlay flag is false', () => {
    const { ops } = render({ goldenRatio: false, thirds: false, focalPoints: false });
    expect(strokeStyles(ops)).not.toContain(GOLDEN_STROKE);
    expect(strokeStyles(ops)).not.toContain(THIRDS_STROKE);
    expect(fillStyles(ops)).not.toContain(FOCAL_FILL);
  });

  it('goldenRatio only — paints 2 verticals + 2 horizontals at the φ positions in tank-mm', () => {
    const { ops } = render({ goldenRatio: true, thirds: false, focalPoints: false });

    expect(strokeStyles(ops)).toContain(GOLDEN_STROKE);
    expect(strokeStyles(ops)).not.toContain(THIRDS_STROKE);
    expect(fillStyles(ops)).not.toContain(FOCAL_FILL);

    // The overlay paint is wrapped in its own save/restore. Find that block
    // and assert the moveTo/lineTo pairs inside it match the φ positions.
    const goldenStyleIdx = ops.findIndex(
      (o) => o.method === 'set:strokeStyle' && o.args[0] === GOLDEN_STROKE,
    );
    expect(goldenStyleIdx).toBeGreaterThan(-1);
    const restoreIdx = ops.findIndex(
      (o, i) => i > goldenStyleIdx && o.method === 'restore',
    );
    expect(restoreIdx).toBeGreaterThan(goldenStyleIdx);
    const block = ops.slice(goldenStyleIdx, restoreIdx);

    const moves = block.filter((o) => o.method === 'moveTo').map((o) => o.args);
    const lines = block.filter((o) => o.method === 'lineTo').map((o) => o.args);
    expect(moves).toHaveLength(4);
    expect(lines).toHaveLength(4);

    // Verticals span 0 → TANK_H. Horizontals span 0 → TANK_W.
    expect(moves).toEqual(
      expect.arrayContaining([
        [goldenV[0], 0],
        [goldenV[1], 0],
        [0, goldenH[0]],
        [0, goldenH[1]],
      ]),
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        [goldenV[0], TANK_H],
        [goldenV[1], TANK_H],
        [TANK_W, goldenH[0]],
        [TANK_W, goldenH[1]],
      ]),
    );
  });

  it('thirds only — paints 2 verticals + 2 horizontals at the 1/3, 2/3 positions', () => {
    const { ops } = render({ goldenRatio: false, thirds: true, focalPoints: false });

    expect(strokeStyles(ops)).toContain(THIRDS_STROKE);
    expect(strokeStyles(ops)).not.toContain(GOLDEN_STROKE);
    expect(fillStyles(ops)).not.toContain(FOCAL_FILL);

    const thirdsStyleIdx = ops.findIndex(
      (o) => o.method === 'set:strokeStyle' && o.args[0] === THIRDS_STROKE,
    );
    const restoreIdx = ops.findIndex(
      (o, i) => i > thirdsStyleIdx && o.method === 'restore',
    );
    const block = ops.slice(thirdsStyleIdx, restoreIdx);

    const moves = block.filter((o) => o.method === 'moveTo').map((o) => o.args);
    const lines = block.filter((o) => o.method === 'lineTo').map((o) => o.args);
    expect(moves).toEqual(
      expect.arrayContaining([
        [thirdsV[0], 0],
        [thirdsV[1], 0],
        [0, thirdsH[0]],
        [0, thirdsH[1]],
      ]),
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        [thirdsV[0], TANK_H],
        [thirdsV[1], TANK_H],
        [TANK_W, thirdsH[0]],
        [TANK_W, thirdsH[1]],
      ]),
    );
  });

  it('focalPoints only — fills 4 dots at the golden-ratio intersections', () => {
    const { ops } = render({ goldenRatio: false, thirds: false, focalPoints: true });

    expect(fillStyles(ops)).toContain(FOCAL_FILL);
    expect(strokeStyles(ops)).not.toContain(GOLDEN_STROKE);
    expect(strokeStyles(ops)).not.toContain(THIRDS_STROKE);

    const focalStyleIdx = ops.findIndex(
      (o) => o.method === 'set:fillStyle' && o.args[0] === FOCAL_FILL,
    );
    const restoreIdx = ops.findIndex(
      (o, i) => i > focalStyleIdx && o.method === 'restore',
    );
    const block = ops.slice(focalStyleIdx, restoreIdx);

    const arcs = block.filter((o) => o.method === 'arc');
    expect(arcs).toHaveLength(4);

    // Each arc's first two args are (x, y). At zoom = 1, dpr = 1, the
    // radius is 4 CSS px × (1 mm / px) = 4 mm.
    const centres = arcs.map((o) => ({ x: o.args[0] as number, y: o.args[1] as number }));
    for (const pt of focalPts) {
      expect(
        centres.some((c) => Math.abs(c.x - pt.x) < 1e-6 && Math.abs(c.y - pt.y) < 1e-6),
      ).toBe(true);
    }
    for (const arc of arcs) {
      expect(arc.args[2]).toBeCloseTo(4, 6); // radius in mm at zoom = 1
      expect(arc.args[3]).toBe(0);
      expect(arc.args[4]).toBeCloseTo(Math.PI * 2, 6);
    }
  });

  it('all three overlays on — 8 lines + 4 dots, none of them mixed up', () => {
    const { ops } = render({ goldenRatio: true, thirds: true, focalPoints: true });

    const moves = ops.filter((o) => o.method === 'moveTo').length;
    const lines = ops.filter((o) => o.method === 'lineTo').length;
    // The minor + major grid passes already emit moveTo/lineTo. Verify the
    // overlay contributes exactly 4 + 4 = 8 additional moveTo / lineTo pairs
    // by re-rendering with overlays off and diffing.
    const baseline = render({ goldenRatio: false, thirds: false, focalPoints: false }).ops;
    const baselineMoves = baseline.filter((o) => o.method === 'moveTo').length;
    const baselineLines = baseline.filter((o) => o.method === 'lineTo').length;
    expect(moves - baselineMoves).toBe(8);
    expect(lines - baselineLines).toBe(8);

    // Focal-point dots: 4 arcs that aren't part of the baseline (grid +
    // tank + substrate emit zero arcs on the minimal scene).
    const baselineArcs = baseline.filter((o) => o.method === 'arc').length;
    const arcs = ops.filter((o) => o.method === 'arc').length;
    expect(arcs - baselineArcs).toBe(4);

    expect(strokeStyles(ops)).toContain(GOLDEN_STROKE);
    expect(strokeStyles(ops)).toContain(THIRDS_STROKE);
    expect(fillStyles(ops)).toContain(FOCAL_FILL);
  });

  it('line width and dash scale inversely with viewport zoom (look identical on screen)', () => {
    const zoomed: Viewport = { ...upright, zoom: 2 };
    const { ops } = render({ goldenRatio: true, thirds: false, focalPoints: false }, zoomed);

    const goldenStyleIdx = ops.findIndex(
      (o) => o.method === 'set:strokeStyle' && o.args[0] === GOLDEN_STROKE,
    );
    // The overlay paint wraps in save / … / restore. The renderer sets
    // lineWidth BEFORE strokeStyle, so the block window must extend back to
    // the matching `save()` to capture that op.
    const saveIdx = ops.findLastIndex(
      (o, i) => i < goldenStyleIdx && o.method === 'save',
    );
    const restoreIdx = ops.findIndex(
      (o, i) => i > goldenStyleIdx && o.method === 'restore',
    );
    const block = ops.slice(saveIdx, restoreIdx);

    // lineWidth = 1 CSS px × (1 mm / 2 px) = 0.5 mm at zoom = 2.
    const lineWidths = block.filter((o) => o.method === 'set:lineWidth').map((o) => o.args[0]);
    expect(lineWidths[lineWidths.length - 1]).toBe(0.5);

    // Dash pattern is 4 CSS px on / 4 CSS px off → 2 mm / 2 mm at zoom = 2.
    const dashes = block.filter((o) => o.method === 'setLineDash').map((o) => o.args[0]);
    expect(dashes[dashes.length - 1]).toEqual([2, 2]);
  });

  it('overlay positions are unchanged at non-default zoom (positions are world-mm)', () => {
    const a = render({ goldenRatio: true, thirds: false, focalPoints: false }).ops;
    const b = render(
      { goldenRatio: true, thirds: false, focalPoints: false },
      { ...upright, zoom: 3 },
    ).ops;

    function overlayMoves(ops: RecordedOp[]): ReadonlyArray<unknown> {
      const idx = ops.findIndex(
        (o) => o.method === 'set:strokeStyle' && o.args[0] === GOLDEN_STROKE,
      );
      const end = ops.findIndex((o, i) => i > idx && o.method === 'restore');
      return ops.slice(idx, end).filter((o) => o.method === 'moveTo').map((o) => o.args);
    }
    expect(overlayMoves(a)).toEqual(overlayMoves(b));
  });

  it('overlay paint sits BENEATH the selection-handle paint (handles win on top)', () => {
    // Reuse the hardscape spec's tiny triangle fixture: build a scene with
    // one selected hardscape and overlays on, then verify the last paint-
    // affecting style change is a handle style, NOT an overlay style.
    const triEntry = {
      kind: 'hardscape' as const,
      id: 'rock.tri',
      version: 1,
      name: 'Triangle',
      catalog: 'core',
      category: 'rock' as const,
      naturalSize: { x: 80, y: 60, z: 40 },
      silhouette: [
        { x: -40, y: -30 },
        { x: 40, y: -30 },
        { x: 0, y: 30 },
      ],
      fill: '#444444',
    };
    const catalog = {
      entries: [triEntry] as never,
      get({ catalog, id }: { catalog: string; id: string }) {
        return catalog === 'core' && id === 'rock.tri' ? (triEntry as never) : null;
      },
      byKind() {
        return [] as never;
      },
    } as never;
    const scene = {
      ...makeMinimalScene(TANK_W, TANK_H, TANK_H),
      layers: [
        {
          id: 'L' as never,
          name: 'L',
          opacity: 1,
          visible: true,
          locked: false,
          objects: [
            {
              kind: 'hardscape' as const,
              id: 'a' as never,
              ref: { catalog: 'core', id: 'rock.tri', version: 1 },
              transform: {
                position: { x: 180, y: 110, z: 0 },
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

    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(scene, upright, { catalog, selection: ['a' as never], overlayOptions: { goldenRatio: true, thirds: true, focalPoints: true } });
    const ops = canvas.context.ops;

    // Last strokeStyle change in the entire op stream MUST NOT be an
    // overlay colour — the selection-handle paint runs strictly after the
    // overlay paint.
    const lastStrokeStyle = strokeStyles(ops).pop();
    expect(lastStrokeStyle).not.toBe(GOLDEN_STROKE);
    expect(lastStrokeStyle).not.toBe(THIRDS_STROKE);

    // And: the overlay's `set:strokeStyle` ops appear earlier than the
    // final handle paint ops (any strokeRect for a corner-handle square).
    const lastOverlayStyleIdx = Math.max(
      ops.findLastIndex(
        (o) => o.method === 'set:strokeStyle' && o.args[0] === GOLDEN_STROKE,
      ),
      ops.findLastIndex(
        (o) => o.method === 'set:strokeStyle' && o.args[0] === THIRDS_STROKE,
      ),
      ops.findLastIndex(
        (o) => o.method === 'set:fillStyle' && o.args[0] === FOCAL_FILL,
      ),
    );
    const lastStrokeRectIdx = ops.findLastIndex((o) => o.method === 'strokeRect');
    expect(lastStrokeRectIdx).toBeGreaterThan(lastOverlayStyleIdx);
  });

  it('skips paint entirely when the tank has zero width or height (defensive)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    // Tank.width / height are constrained to be > 0 by validation, but the
    // overlay code includes a defensive guard. Verify it.
    const scene = {
      ...makeMinimalScene(TANK_W, TANK_H, TANK_H),
      tank: { ...makeMinimalScene(TANK_W, TANK_H, TANK_H).tank, width: 0, height: 0 },
    };
    r.render(scene, upright, { overlayOptions: {
      goldenRatio: true,
      thirds: true,
      focalPoints: true,
    } });
    const ops = canvas.context.ops;
    expect(strokeStyles(ops)).not.toContain(GOLDEN_STROKE);
    expect(strokeStyles(ops)).not.toContain(THIRDS_STROKE);
    expect(fillStyles(ops)).not.toContain(FOCAL_FILL);
  });
});

// ─── Stage 5.x — Wall background ──────────────────────────────────────────
//
// View-only room-wall rectangle painted behind the tank. Centred on the
// tank's geometric centre, sized in world-mm independently of the tank.

describe('Canvas2DRenderer.render (wall background — Stage 5.x)', () => {
  const TANK_W = 360;
  const TANK_H = 220;
  const WALL_COLOR = '#2a2d35';

  let fakeWindow: FakeWindow;

  beforeEach(() => {
    fakeWindow = installFakeWindow();
    void fakeWindow;
  });

  afterEach(() => {
    uninstallFakeWindow();
  });

  function renderWith(
    wall:
      | { enabled: boolean; color: string; widthMm: number; heightMm: number }
      | undefined,
  ): { ops: RecordedOp[] } {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(TANK_W, TANK_H, TANK_H), upright, { wallBackground: wall });
    return { ops: canvas.context.ops };
  }

  /** Find the `fillRect` op the wall paint emits — its fillStyle is the
   *  wall color and its position matches the configured rect. */
  function wallFillRect(ops: RecordedOp[], color: string): RecordedOp | null {
    // The wall paint is wrapped in save / set:fillStyle / fillRect /
    // restore. Locate the set:fillStyle with our color, then the next
    // fillRect inside that block.
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!;
      if (op.method === 'set:fillStyle' && op.args[0] === color) {
        // Look ahead for the matching fillRect (before the next restore).
        for (let j = i + 1; j < ops.length; j++) {
          if (ops[j]!.method === 'restore') break;
          if (ops[j]!.method === 'fillRect') return ops[j]!;
        }
      }
    }
    return null;
  }

  it('is a no-op when wallBackground is omitted', () => {
    const { ops } = renderWith(undefined);
    expect(wallFillRect(ops, WALL_COLOR)).toBeNull();
  });

  it('is a no-op when enabled is false', () => {
    const { ops } = renderWith({
      enabled: false,
      color: WALL_COLOR,
      widthMm: 1200,
      heightMm: 600,
    });
    expect(wallFillRect(ops, WALL_COLOR)).toBeNull();
  });

  it('is a no-op when widthMm is 0 (defensive)', () => {
    const { ops } = renderWith({
      enabled: true,
      color: WALL_COLOR,
      widthMm: 0,
      heightMm: 600,
    });
    expect(wallFillRect(ops, WALL_COLOR)).toBeNull();
  });

  it('is a no-op when heightMm is 0 (defensive)', () => {
    const { ops } = renderWith({
      enabled: true,
      color: WALL_COLOR,
      widthMm: 1200,
      heightMm: 0,
    });
    expect(wallFillRect(ops, WALL_COLOR)).toBeNull();
  });

  it('is a no-op when widthMm or heightMm is negative (defensive)', () => {
    const { ops } = renderWith({
      enabled: true,
      color: WALL_COLOR,
      widthMm: -100,
      heightMm: 600,
    });
    expect(wallFillRect(ops, WALL_COLOR)).toBeNull();
  });

  it('paints a fillRect centred on the tank at the configured size', () => {
    const widthMm = 1200;
    const heightMm = 600;
    const { ops } = renderWith({
      enabled: true,
      color: WALL_COLOR,
      widthMm,
      heightMm,
    });
    const rect = wallFillRect(ops, WALL_COLOR);
    expect(rect).not.toBeNull();
    // World-coord centre = (TANK_W/2, TANK_H/2). Wall corner = centre -
    // size/2.
    const expectedX = TANK_W / 2 - widthMm / 2;
    const expectedY = TANK_H / 2 - heightMm / 2;
    expect(rect!.args).toEqual([expectedX, expectedY, widthMm, heightMm]);
  });

  it('the wall paint precedes the tank outline so the tank covers it inside its rect', () => {
    const widthMm = 1200;
    const heightMm = 600;
    const { ops } = renderWith({
      enabled: true,
      color: WALL_COLOR,
      widthMm,
      heightMm,
    });
    // Wall = first fillRect with WALL_COLOR.
    const wallIdx = ops.findIndex(
      (o, i) =>
        o.method === 'fillRect' &&
        i > 0 &&
        ops[i - 1]?.method === 'set:fillStyle' &&
        ops[i - 1]?.args[0] === WALL_COLOR,
    );
    // Tank outline = strokeRect.
    const tankIdx = ops.findIndex((o) => o.method === 'strokeRect');
    expect(wallIdx).toBeGreaterThan(-1);
    expect(tankIdx).toBeGreaterThan(-1);
    expect(wallIdx).toBeLessThan(tankIdx);
  });

  it('wall save / restore brackets exactly one fillRect (no style leak)', () => {
    const { ops } = renderWith({
      enabled: true,
      color: WALL_COLOR,
      widthMm: 1200,
      heightMm: 600,
    });
    // Find the set:fillStyle for the wall color and the following save +
    // restore pair around it. Verify the fillRect sits between them.
    const styleIdx = ops.findIndex(
      (o) => o.method === 'set:fillStyle' && o.args[0] === WALL_COLOR,
    );
    expect(styleIdx).toBeGreaterThan(-1);
    // Walk back to the nearest save.
    let saveIdx = -1;
    for (let i = styleIdx; i >= 0; i--) {
      if (ops[i]!.method === 'save') {
        saveIdx = i;
        break;
      }
    }
    expect(saveIdx).toBeGreaterThan(-1);
    // Walk forward to the matching restore.
    let restoreIdx = -1;
    for (let i = styleIdx + 1; i < ops.length; i++) {
      if (ops[i]!.method === 'restore') {
        restoreIdx = i;
        break;
      }
    }
    expect(restoreIdx).toBeGreaterThan(styleIdx);
    const block = ops.slice(saveIdx, restoreIdx + 1);
    expect(block.filter((o) => o.method === 'fillRect')).toHaveLength(1);
  });

  it('paints with the configured color (not a default)', () => {
    const customColor = '#aabbcc';
    const { ops } = renderWith({
      enabled: true,
      color: customColor,
      widthMm: 1000,
      heightMm: 500,
    });
    const fills = ops
      .filter((o) => o.method === 'set:fillStyle')
      .map((o) => o.args[0]);
    expect(fills).toContain(customColor);
  });
});

// ─── Stage 5 F5.4 — snap alignment guides ─────────────────────────────────

describe('Canvas2DRenderer.render (snap guides — F5.4)', () => {
  const TANK_W = 360;
  const TANK_H = 220;
  const SNAP_STROKE = 'rgba(255, 64, 192, 0.95)';

  let fakeWindow: FakeWindow;

  beforeEach(() => {
    fakeWindow = installFakeWindow();
    void fakeWindow;
  });

  afterEach(() => {
    uninstallFakeWindow();
  });

  function render(
    guides: { xs: number[]; ys: number[] } | undefined,
  ): { ops: RecordedOp[] } {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(TANK_W, TANK_H, TANK_H), upright, { snapGuides: guides });
    return { ops: canvas.context.ops };
  }

  function strokeStyles(ops: RecordedOp[]): string[] {
    return ops.filter((o) => o.method === 'set:strokeStyle').map((o) => String(o.args[0]));
  }

  it('is a no-op when snapGuides is omitted', () => {
    const { ops } = render(undefined);
    expect(strokeStyles(ops)).not.toContain(SNAP_STROKE);
  });

  it('is a no-op when both arrays are empty', () => {
    const { ops } = render({ xs: [], ys: [] });
    expect(strokeStyles(ops)).not.toContain(SNAP_STROKE);
  });

  it('paints one vertical line per xs entry across the full tank height', () => {
    const { ops } = render({ xs: [180, 240], ys: [] });
    const idx = ops.findIndex(
      (o) => o.method === 'set:strokeStyle' && o.args[0] === SNAP_STROKE,
    );
    expect(idx).toBeGreaterThan(-1);
    const restoreIdx = ops.findIndex((o, i) => i > idx && o.method === 'restore');
    const block = ops.slice(idx, restoreIdx);
    const moves = block.filter((o) => o.method === 'moveTo').map((o) => o.args);
    const lines = block.filter((o) => o.method === 'lineTo').map((o) => o.args);
    expect(moves).toEqual([
      [180, 0],
      [240, 0],
    ]);
    expect(lines).toEqual([
      [180, TANK_H],
      [240, TANK_H],
    ]);
  });

  it('paints one horizontal line per ys entry across the full tank width', () => {
    const { ops } = render({ xs: [], ys: [110, 55] });
    const idx = ops.findIndex(
      (o) => o.method === 'set:strokeStyle' && o.args[0] === SNAP_STROKE,
    );
    const restoreIdx = ops.findIndex((o, i) => i > idx && o.method === 'restore');
    const block = ops.slice(idx, restoreIdx);
    const moves = block.filter((o) => o.method === 'moveTo').map((o) => o.args);
    const lines = block.filter((o) => o.method === 'lineTo').map((o) => o.args);
    expect(moves).toEqual([
      [0, 110],
      [0, 55],
    ]);
    expect(lines).toEqual([
      [TANK_W, 110],
      [TANK_W, 55],
    ]);
  });

  it('paints xs + ys mixed in a single stroke pass (one stroke call)', () => {
    const { ops } = render({ xs: [100], ys: [50] });
    const idx = ops.findIndex(
      (o) => o.method === 'set:strokeStyle' && o.args[0] === SNAP_STROKE,
    );
    const restoreIdx = ops.findIndex((o, i) => i > idx && o.method === 'restore');
    const block = ops.slice(idx, restoreIdx);
    expect(block.filter((o) => o.method === 'stroke')).toHaveLength(1);
  });

  it('uses solid lines (no setLineDash dash pattern leaks)', () => {
    const { ops } = render({ xs: [100], ys: [] });
    const idx = ops.findIndex(
      (o) => o.method === 'set:strokeStyle' && o.args[0] === SNAP_STROKE,
    );
    const restoreIdx = ops.findIndex((o, i) => i > idx && o.method === 'restore');
    const block = ops.slice(idx, restoreIdx);
    const lastDash = block
      .filter((o) => o.method === 'setLineDash')
      .map((o) => o.args[0])
      .pop();
    // Empty array = solid line.
    expect(lastDash).toEqual([]);
  });

  it('snap guides paint AFTER composition overlays so they sit on top', () => {
    // Render with both engaged: golden overlay AND a snap-guide line at
    // the same x. The snap guide stroke should appear at a higher index
    // than any overlay style change.
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(TANK_W, TANK_H, TANK_H), upright, { overlayOptions: { goldenRatio: true, thirds: false, focalPoints: false }, snapGuides: { xs: [180], ys: [] } });
    const ops = canvas.context.ops;
    const overlayIdx = ops.findIndex(
      (o) => o.method === 'set:strokeStyle' && o.args[0] === 'rgba(255, 215, 0, 0.45)',
    );
    const snapIdx = ops.findIndex(
      (o) => o.method === 'set:strokeStyle' && o.args[0] === SNAP_STROKE,
    );
    expect(overlayIdx).toBeGreaterThan(-1);
    expect(snapIdx).toBeGreaterThan(overlayIdx);
  });

  it('snap guides paint BEFORE selection handles (handles stay on top)', () => {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    const scene = {
      ...makeMinimalScene(TANK_W, TANK_H, TANK_H),
      layers: [
        {
          id: 'L' as never,
          name: 'L',
          opacity: 1,
          visible: true,
          locked: false,
          objects: [
            {
              kind: 'hardscape' as const,
              id: 'a' as never,
              ref: { catalog: 'core', id: 'rock', version: 1 },
              transform: {
                position: { x: 180, y: 110, z: 0 },
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
    r.render(scene, upright, { selection: ['a' as never], snapGuides: { xs: [180], ys: [110] } });
    const ops = canvas.context.ops;
    const snapIdx = ops.findLastIndex(
      (o) => o.method === 'set:strokeStyle' && o.args[0] === SNAP_STROKE,
    );
    const lastStrokeRect = ops.findLastIndex((o) => o.method === 'strokeRect');
    expect(snapIdx).toBeGreaterThan(-1);
    // Selection handle paint emits strokeRect (corner squares) AFTER the
    // snap guides.
    expect(lastStrokeRect).toBeGreaterThan(snapIdx);
  });
});

// ─── Stage 6 F6.3 — Backdrop image ────────────────────────────────────────

describe('Canvas2DRenderer.render (backdrop image — F6.3)', () => {
  const BACKDROP_TANK_W = 360;
  const BACKDROP_TANK_H = 220;
  const fakeImage = { __fake: true } as unknown as CanvasImageSource;

  let fakeWindow: FakeWindow;
  beforeEach(() => {
    fakeWindow = installFakeWindow();
    void fakeWindow;
  });
  afterEach(() => {
    uninstallFakeWindow();
  });

  function renderWith(
    backdrop: { image: CanvasImageSource; opacity: number } | undefined,
  ): { ops: RecordedOp[]; backingW: number; backingH: number } {
    const { surface, canvas } = makeSurface(800, 600, 1);
    const r = new Canvas2DRenderer();
    r.attach(surface);
    r.render(makeMinimalScene(BACKDROP_TANK_W, BACKDROP_TANK_H, BACKDROP_TANK_H), upright, { backdropImage: backdrop });
    return { ops: canvas.context.ops, backingW: 800, backingH: 600 };
  }

  it('is a no-op when backdropImage is omitted', () => {
    const { ops } = renderWith(undefined);
    expect(ops.find((o) => o.method === 'drawImage')).toBeUndefined();
  });

  it('is a no-op when opacity is 0', () => {
    const { ops } = renderWith({ image: fakeImage, opacity: 0 });
    expect(ops.find((o) => o.method === 'drawImage')).toBeUndefined();
  });

  it('is a no-op when opacity is negative or non-finite', () => {
    expect(
      renderWith({ image: fakeImage, opacity: -0.5 }).ops.find((o) => o.method === 'drawImage'),
    ).toBeUndefined();
    expect(
      renderWith({ image: fakeImage, opacity: Number.NaN }).ops.find((o) => o.method === 'drawImage'),
    ).toBeUndefined();
  });

  it('draws a single drawImage covering the full backing buffer', () => {
    const { ops, backingW, backingH } = renderWith({ image: fakeImage, opacity: 1 });
    const drawImages = ops.filter((o) => o.method === 'drawImage');
    expect(drawImages).toHaveLength(1);
    expect(drawImages[0]!.args).toEqual([0, 0, backingW, backingH]);
  });

  it('honours opacity via globalAlpha + clamps > 1 to 1', () => {
    const { ops } = renderWith({ image: fakeImage, opacity: 0.42 });
    const drawIdx = ops.findIndex((o) => o.method === 'drawImage');
    expect(drawIdx).toBeGreaterThan(0);
    const alphaOps = ops
      .slice(0, drawIdx)
      .filter((o) => o.method === 'set:globalAlpha')
      .map((o) => o.args[0]);
    expect(alphaOps[alphaOps.length - 1]).toBeCloseTo(0.42, 6);

    const high = renderWith({ image: fakeImage, opacity: 2 });
    const drawIdx2 = high.ops.findIndex((o) => o.method === 'drawImage');
    const alpha2 = high.ops
      .slice(0, drawIdx2)
      .filter((o) => o.method === 'set:globalAlpha')
      .map((o) => o.args[0])
      .pop();
    expect(alpha2).toBe(1);
  });

  it('paints BEFORE the world-transform setup so it sits behind every scene layer', () => {
    const { ops } = renderWith({ image: fakeImage, opacity: 1 });
    const drawIdx = ops.findIndex((o) => o.method === 'drawImage');
    const worldTransformIdx = ops.findIndex(
      (o, i) =>
        i > 0 &&
        o.method === 'setTransform' &&
        (Number(o.args[4]) !== 0 || Number(o.args[5]) !== 0),
    );
    expect(drawIdx).toBeGreaterThan(-1);
    expect(worldTransformIdx).toBeGreaterThan(-1);
    expect(drawIdx).toBeLessThan(worldTransformIdx);
  });

  it('wraps in save / restore so globalAlpha does not leak', () => {
    const { ops } = renderWith({ image: fakeImage, opacity: 0.5 });
    const drawIdx = ops.findIndex((o) => o.method === 'drawImage');
    let saveIdx = -1;
    for (let i = drawIdx - 1; i >= 0; i--) {
      if (ops[i]!.method === 'save') {
        saveIdx = i;
        break;
      }
    }
    let restoreIdx = -1;
    for (let i = drawIdx + 1; i < ops.length; i++) {
      if (ops[i]!.method === 'restore') {
        restoreIdx = i;
        break;
      }
    }
    expect(saveIdx).toBeGreaterThan(-1);
    expect(restoreIdx).toBeGreaterThan(drawIdx);
    const drawImages = ops.filter((o) => o.method === 'drawImage');
    expect(drawImages).toHaveLength(1);
  });
});
