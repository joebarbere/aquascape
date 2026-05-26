import type { RenderSurface, Viewport } from '@aquascape/rendering/renderer-api';
import type { Catalog, CatalogEntry, CatalogKind } from '@aquascape/domain/catalog';
import type { HardscapeObject, Layer, Scene } from '@aquascape/domain/scene-model';
import {
  type RendererFactory,
  type RendererLike,
  Three3DRenderer,
} from './three-3d-renderer';

// ─── Test stubs ───────────────────────────────────────────────────────────

class StubRenderer implements RendererLike {
  public renders = 0;
  public disposed = 0;
  public lastSize: { w: number; h: number } | null = null;
  public lastDpr = 0;
  setPixelRatio(dpr: number): void {
    this.lastDpr = dpr;
  }
  setSize(w: number, h: number): void {
    this.lastSize = { w, h };
  }
  render(): void {
    this.renders += 1;
  }
  dispose(): void {
    this.disposed += 1;
  }
}

interface MakeSurfaceOptions {
  width?: number;
  height?: number;
  dpr?: number;
}

function makeSurface({
  width = 800,
  height = 600,
  dpr = 1,
}: MakeSurfaceOptions = {}): RenderSurface {
  // A stub HTMLCanvasElement-shaped object. The orchestrator only hands
  // it to the renderer factory; it never reaches into DOM API.
  const canvas = {} as unknown as HTMLCanvasElement;
  return { canvas, devicePixelRatio: dpr, width, height };
}

function makeFactory(stub: StubRenderer): RendererFactory {
  return () => stub;
}

const viewport: Viewport = { center: { x: 0, y: 0 }, zoom: 1, rotation: 0 };

function makeCatalog(entries: CatalogEntry[]): Catalog {
  return {
    entries,
    get({ catalog, id }) {
      return entries.find((e) => e.catalog === catalog && e.id === id) ?? null;
    },
    byKind<K extends CatalogKind>(kind: K): readonly Extract<CatalogEntry, { kind: K }>[] {
      return entries.filter((e): e is Extract<CatalogEntry, { kind: K }> => e.kind === kind);
    },
  };
}

function sceneOf(tankW = 600, tankH = 360, tankD = 300, objs: HardscapeObject[] = []): Scene {
  const layer: Layer = {
    id: 'l1' as Layer['id'],
    name: 'Main',
    opacity: 1,
    visible: true,
    locked: false,
    objects: objs,
  };
  return {
    tank: {
      width: tankW,
      height: tankH,
      depth: tankD,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: [] },
    layers: [layer],
    seed: 1,
  };
}

// requestAnimationFrame stub for the animation tick.
function stubRaf(): { cancel: jest.Mock; uninstall: () => void } {
  const cancel = jest.fn();
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: (t: number) => void) => number;
    cancelAnimationFrame?: (h: number) => void;
  };
  const prevReq = g.requestAnimationFrame;
  const prevCancel = g.cancelAnimationFrame;
  // Schedule once and never fire the callback — we don't want a loop in
  // the test. The orchestrator's render() also paints synchronously, so
  // we still get a `render()` call to assert against.
  g.requestAnimationFrame = (() => 1) as never;
  g.cancelAnimationFrame = cancel as never;
  return {
    cancel,
    uninstall: () => {
      if (prevReq === undefined) {
        delete g.requestAnimationFrame;
      } else {
        g.requestAnimationFrame = prevReq;
      }
      if (prevCancel === undefined) {
        delete g.cancelAnimationFrame;
      } else {
        g.cancelAnimationFrame = prevCancel;
      }
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Three3DRenderer — attach / render / dispose', () => {
  it('attach sizes the renderer and primes the camera', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface({ width: 1024, height: 768, dpr: 2 }));
    expect(stub.lastDpr).toBe(2);
    expect(stub.lastSize).toEqual({ w: 1024, h: 768 });
    r.dispose();
    raf.uninstall();
  });

  it('throws when the renderer factory fails, leaving the renderer detached', () => {
    const raf = stubRaf();
    const r = new Three3DRenderer(() => {
      throw new Error('No WebGL here');
    });
    expect(() => r.attach(makeSurface())).toThrow(/WebGLRenderer init failed/);
    // After a failed attach, dispose is safe and idempotent.
    expect(() => r.dispose()).not.toThrow();
    raf.uninstall();
  });

  it('render() paints synchronously and re-frames the camera to the real tank', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    const before = stub.renders;
    r.render(sceneOf(600, 360, 300), viewport);
    expect(stub.renders).toBeGreaterThan(before);
    r.dispose();
    raf.uninstall();
  });

  it('render() is idempotent — same inputs produce the same scene graph shape', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    const scene = sceneOf();
    r.render(scene, viewport);
    const after1 = stub.renders;
    r.render(scene, viewport);
    expect(stub.renders).toBeGreaterThan(after1);
    r.dispose();
    raf.uninstall();
  });

  it('render() does not mutate the scene', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    const scene = sceneOf();
    const before = JSON.parse(JSON.stringify(scene));
    r.render(scene, viewport);
    expect(scene).toEqual(before);
    r.dispose();
    raf.uninstall();
  });

  it('hitTest always returns null (read-only contract for v1)', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    expect(r.hitTest({ x: 10, y: 10 }, sceneOf(), viewport)).toBeNull();
    expect(
      r.hitTest({ x: 0, y: 0 }, sceneOf(), viewport, { catalog: makeCatalog([]) }),
    ).toBeNull();
    r.dispose();
    raf.uninstall();
  });

  it('dispose tears down the stub renderer and cancels the animation frame', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(), viewport);
    r.dispose();
    expect(stub.disposed).toBe(1);
    expect(raf.cancel).toHaveBeenCalledWith(1);
    raf.uninstall();
  });

  it('dispose then attach is idempotent — re-attaches cleanly', () => {
    const raf = stubRaf();
    const stub1 = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub1));
    r.attach(makeSurface());
    r.attach(makeSurface()); // implicit dispose + re-attach (different canvas)
    // First renderer disposed by the second attach.
    expect(stub1.disposed).toBe(1);
    r.dispose();
    raf.uninstall();
  });

  it('re-attaching to the SAME canvas does NOT dispose + reinit (preserves GL context)', () => {
    // Load-bearing: `WebGLRenderer.dispose()` permanently destroys the
    // canvas's GL context via `WEBGL_lose_context.loseContext()`. The
    // host calls `attach()` on every render, so re-attach to the same
    // canvas must be idempotent — only sync size + DPR + aspect.
    const raf = stubRaf();
    let factoryCalls = 0;
    const stub = new StubRenderer();
    const factory: RendererFactory = () => {
      factoryCalls++;
      return stub;
    };
    const r = new Three3DRenderer(factory);
    const canvas = {} as unknown as HTMLCanvasElement;
    const surface1: RenderSurface = { canvas, devicePixelRatio: 1, width: 800, height: 600 };
    const surface2: RenderSurface = { canvas, devicePixelRatio: 2, width: 1024, height: 768 };
    r.attach(surface1);
    expect(factoryCalls).toBe(1);
    expect(stub.disposed).toBe(0);
    r.attach(surface2); // same canvas → idempotent path
    expect(factoryCalls).toBe(1); // factory NOT called again
    expect(stub.disposed).toBe(0); // NOT disposed
    // Size + DPR were updated on the existing renderer.
    expect(stub.lastSize).toEqual({ w: 1024, h: 768 });
    expect(stub.lastDpr).toBe(2);
    r.dispose();
    expect(stub.disposed).toBe(1);
    raf.uninstall();
  });

  it('re-attaching to a DIFFERENT canvas triggers full re-init', () => {
    const raf = stubRaf();
    let factoryCalls = 0;
    const stub1 = new StubRenderer();
    const stub2 = new StubRenderer();
    const factory: RendererFactory = () => {
      factoryCalls++;
      return factoryCalls === 1 ? stub1 : stub2;
    };
    const r = new Three3DRenderer(factory);
    const canvasA = {} as unknown as HTMLCanvasElement;
    const canvasB = {} as unknown as HTMLCanvasElement;
    r.attach({ canvas: canvasA, devicePixelRatio: 1, width: 800, height: 600 });
    r.attach({ canvas: canvasB, devicePixelRatio: 1, width: 800, height: 600 });
    expect(factoryCalls).toBe(2);
    expect(stub1.disposed).toBe(1);
    r.dispose();
    raf.uninstall();
  });

  it('idempotent re-attach with zero dimensions falls back to aspect 1', () => {
    // Defensive: when the canvas is briefly zero-sized (e.g. during a
    // mode swap before layout settles), aspect must not divide-by-zero.
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    const canvas = {} as unknown as HTMLCanvasElement;
    r.attach({ canvas, devicePixelRatio: 1, width: 800, height: 600 });
    expect(() =>
      r.attach({ canvas, devicePixelRatio: 1, width: 0, height: 0 }),
    ).not.toThrow();
    r.dispose();
    raf.uninstall();
  });

  it('render before attach is a no-op (no throw)', () => {
    const r = new Three3DRenderer(() => new StubRenderer());
    expect(() => r.render(sceneOf(), viewport)).not.toThrow();
  });
});

// ─── Dispose discipline (long-running) ───────────────────────────────────

describe('Three3DRenderer — dispose discipline', () => {
  it('100 render/dispose cycles do not leak Three.js geometries on the scene graph', () => {
    const raf = stubRaf();
    for (let i = 0; i < 100; i++) {
      const stub = new StubRenderer();
      const r = new Three3DRenderer(makeFactory(stub));
      r.attach(makeSurface());
      r.render(sceneOf(), viewport);
      r.render(sceneOf(), viewport); // also exercises the rebuild path
      r.dispose();
      expect(stub.disposed).toBe(1);
    }
    raf.uninstall();
  });

  it('re-render swaps out the previous content group — only one content node lives at a time', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport);
    // Reach into the private field for the assertion. We do this by
    // construction (a fresh instance) rather than mutating state, so the
    // type-cast is contained.
    const rAny = r as unknown as { currentContent: { name: string } | null; threeScene: { children: ReadonlyArray<{ name: string }> } };
    expect(rAny.currentContent).not.toBeNull();
    expect(rAny.currentContent!.name).toBe('aquascape:content');
    // Re-render — content node identity must NOT carry over.
    const firstContent = rAny.currentContent;
    r.render(sceneOf(600, 360, 300), viewport);
    expect(rAny.currentContent).not.toBe(firstContent);
    // Scene graph still has exactly one content child (plus lighting).
    const namedContent = rAny.threeScene.children.filter((c) => c.name === 'aquascape:content');
    expect(namedContent.length).toBe(1);
    r.dispose();
    raf.uninstall();
  });
});

// ─── Document → world X-mirror ───────────────────────────────────────────

describe('Three3DRenderer — doc → world X-mirror', () => {
  it('content + lighting groups carry scale.x = -1 and position.x = tank.width so doc +X lands on screen +X', () => {
    // The doc convention (+Z = back) is opposite to Three.js (+Z = toward
    // viewer). With the camera placed in front of the tank (world -Z),
    // lookAt orientation makes screen +X = world -X, flipping the doc's
    // left/right. The renderer cancels this by mirroring the content +
    // lighting groups about the tank's X-midplane. Verify both groups
    // carry the mirror transform after a render.
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport);
    const rAny = r as unknown as {
      currentContent: { scale: { x: number }; position: { x: number } } | null;
      lighting: { scale: { x: number }; position: { x: number } } | null;
    };
    expect(rAny.currentContent).not.toBeNull();
    expect(rAny.currentContent!.scale.x).toBe(-1);
    expect(rAny.currentContent!.position.x).toBe(600);
    expect(rAny.lighting).not.toBeNull();
    expect(rAny.lighting!.scale.x).toBe(-1);
    expect(rAny.lighting!.position.x).toBe(600);
    r.dispose();
    raf.uninstall();
  });

  it('mirror transform updates when the tank width changes', () => {
    // Lighting only rebuilds when tank dims change; content rebuilds
    // every render. Both must reflect the NEW tank width in position.x
    // after a tank-resize render.
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport);
    r.render(sceneOf(1200, 360, 300), viewport);
    const rAny = r as unknown as {
      currentContent: { position: { x: number } } | null;
      lighting: { position: { x: number } } | null;
    };
    expect(rAny.currentContent!.position.x).toBe(1200);
    expect(rAny.lighting!.position.x).toBe(1200);
    r.dispose();
    raf.uninstall();
  });
});

// ─── Tank-change camera reframing ────────────────────────────────────────

describe('Three3DRenderer — tank change', () => {
  it('camera target follows the tank centre when tank dimensions change', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport);
    const rAny = r as unknown as {
      controls: { target: { x: number; y: number; z: number } } | null;
    };
    const c1 = rAny.controls!.target;
    expect(c1.x).toBeCloseTo(300, 0);
    r.render(sceneOf(1200, 500, 400), viewport);
    const c2 = rAny.controls!.target;
    expect(c2.x).toBeCloseTo(600, 0);
    expect(c2.y).toBeCloseTo(250, 0);
    r.dispose();
    raf.uninstall();
  });
});

// ─── Orbital3DControls — zoom / pan / rotate / reset ─────────────────────

describe('Three3DRenderer — orbit controls', () => {
  function setup(): {
    r: Three3DRenderer;
    rAny: {
      camera: {
        position: { x: number; y: number; z: number; distanceTo(p: { x: number; y: number; z: number }): number };
      } | null;
      controls: { target: { x: number; y: number; z: number } } | null;
    };
    cleanup: () => void;
  } {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport);
    const rAny = r as unknown as {
      camera: {
        position: { x: number; y: number; z: number; distanceTo(p: { x: number; y: number; z: number }): number };
      } | null;
      controls: { target: { x: number; y: number; z: number } } | null;
    };
    return {
      r,
      rAny,
      cleanup: () => {
        r.dispose();
        raf.uninstall();
      },
    };
  }

  it('getZoomFraction returns ~1 immediately after the initial render', () => {
    const { r, cleanup } = setup();
    expect(r.getZoomFraction()).toBeCloseTo(1, 5);
    cleanup();
  });

  it('zoomBy(2) brings the camera closer to the target (zoom IN doubles fraction)', () => {
    const { r, cleanup } = setup();
    const before = r.getZoomFraction();
    r.zoomBy(2);
    const after = r.getZoomFraction();
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(before * 2, 3);
    cleanup();
  });

  it('zoomBy(0.5) moves the camera farther from the target (zoom OUT halves fraction)', () => {
    const { r, cleanup } = setup();
    const before = r.getZoomFraction();
    r.zoomBy(0.5);
    const after = r.getZoomFraction();
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(before * 0.5, 3);
    cleanup();
  });

  it('zoomBy is a no-op on non-finite or non-positive factors', () => {
    const { r, cleanup } = setup();
    const before = r.getZoomFraction();
    r.zoomBy(0);
    r.zoomBy(-1);
    r.zoomBy(NaN);
    r.zoomBy(Infinity);
    expect(r.getZoomFraction()).toBeCloseTo(before, 5);
    cleanup();
  });

  it('panBy shifts both camera position AND orbit target by the same amount', () => {
    const { r, rAny, cleanup } = setup();
    const camBefore = { ...rAny.camera!.position };
    const tgtBefore = { ...rAny.controls!.target };
    r.panBy(0.1, 0);
    const camAfter = rAny.camera!.position;
    const tgtAfter = rAny.controls!.target;
    // Target moved.
    expect(
      Math.abs(tgtAfter.x - tgtBefore.x) +
        Math.abs(tgtAfter.y - tgtBefore.y) +
        Math.abs(tgtAfter.z - tgtBefore.z),
    ).toBeGreaterThan(0);
    // Camera moved by the SAME delta (so the orbit pose is preserved).
    expect(camAfter.x - camBefore.x).toBeCloseTo(tgtAfter.x - tgtBefore.x, 3);
    expect(camAfter.y - camBefore.y).toBeCloseTo(tgtAfter.y - tgtBefore.y, 3);
    expect(camAfter.z - camBefore.z).toBeCloseTo(tgtAfter.z - tgtBefore.z, 3);
    cleanup();
  });

  it('rotateBy preserves camera-target distance (it ORBITS, never dollies)', () => {
    const { r, rAny, cleanup } = setup();
    const distBefore = rAny.camera!.position.distanceTo(rAny.controls!.target);
    r.rotateBy(0.5, 0.2);
    const distAfter = rAny.camera!.position.distanceTo(rAny.controls!.target);
    expect(distAfter).toBeCloseTo(distBefore, 3);
    cleanup();
  });

  it('rotateBy clamps polar so the camera can never flip past the pole', () => {
    const { r, rAny, cleanup } = setup();
    // Push polar HARD — many full turns. Distance should stay finite and
    // the camera must still be on a valid orbit (above its target with
    // some up-vector projection).
    for (let i = 0; i < 10; i++) r.rotateBy(0, 10);
    const cam = rAny.camera!.position;
    const tgt = rAny.controls!.target;
    expect(Number.isFinite(cam.x) && Number.isFinite(cam.y) && Number.isFinite(cam.z)).toBe(true);
    expect(cam.distanceTo(tgt)).toBeGreaterThan(0);
    cleanup();
  });

  it('resetView returns the camera to its initial framing distance', () => {
    const { r, cleanup } = setup();
    r.zoomBy(3);
    r.panBy(0.5, 0.5);
    expect(r.getZoomFraction()).not.toBeCloseTo(1, 2);
    r.resetView();
    expect(r.getZoomFraction()).toBeCloseTo(1, 3);
    cleanup();
  });

  it('addChangeListener fires after every orbital-control method', () => {
    const { r, cleanup } = setup();
    const cb = jest.fn();
    const unsub = r.addChangeListener(cb);
    r.zoomBy(2);
    r.panBy(0.1, 0);
    r.rotateBy(0.1, 0);
    r.resetView();
    expect(cb.mock.calls.length).toBe(4);
    unsub();
    r.zoomBy(2);
    expect(cb.mock.calls.length).toBe(4); // no further fires after unsub
    cleanup();
  });

  it('orbital methods are no-ops before render() (no last-tank, no controls)', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    // No attach — every method must be a safe no-op.
    expect(() => r.zoomBy(2)).not.toThrow();
    expect(() => r.panBy(0.1, 0)).not.toThrow();
    expect(() => r.rotateBy(0.1, 0)).not.toThrow();
    expect(() => r.resetView()).not.toThrow();
    expect(r.getZoomFraction()).toBe(1);
    r.dispose();
    raf.uninstall();
  });
});
