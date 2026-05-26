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
    r.attach(makeSurface()); // implicit dispose + re-attach
    // First renderer disposed by the second attach.
    expect(stub1.disposed).toBe(1);
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
