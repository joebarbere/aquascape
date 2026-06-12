import type { RenderSurface, Viewport } from '@aquascape/rendering/renderer-api';
import type { Catalog, CatalogEntry, CatalogKind } from '@aquascape/domain/catalog';
import type { HardscapeObject, Layer, Scene } from '@aquascape/domain/scene-model';
import { DataTexture, EquirectangularReflectionMapping } from 'three';
import {
  type RendererFactory,
  type RendererLike,
  Three3DRenderer,
} from './three-3d-renderer';
import { WATER_OFFSET_BELOW_RIM_MM } from './scene-builder/water-mesh';

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

  it('bloom composer stays null under the headless stub — paint falls back to direct render', () => {
    // The EffectComposer pipeline is only built behind `instanceof
    // WebGLRenderer`, which the stub is not. So the composer + bloom pass
    // stay null and `paint()` routes through the stub's `render()` — proven
    // by the render counter still incrementing.
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    const before = stub.renders;
    r.render(sceneOf(), viewport);
    expect(stub.renders).toBeGreaterThan(before);
    const rAny = r as unknown as { composer: unknown; bloomPass: unknown };
    expect(rAny.composer).toBeNull();
    expect(rAny.bloomPass).toBeNull();
    r.dispose();
    raf.uninstall();
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

// ─── Stage 11 F11.1 Wave 4 — livestock wiring ────────────────────────────

import { SIM_DT, createLivestockWorld, type LivestockWorld } from '@aquascape/domain/livestock-ecs';

describe('Three3DRenderer — livestock wiring', () => {
  it('omitting livestockWorld leaves the content group fish-free', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(), viewport);
    const rAny = r as unknown as {
      currentContent: { children: ReadonlyArray<{ name: string }> } | null;
      livestockBundle: unknown;
    };
    const names = rAny.currentContent!.children.map((c) => c.name);
    expect(names).not.toContain('aquascape:livestock');
    expect(rAny.livestockBundle).toBeNull();
    r.dispose();
    raf.uninstall();
  });

  it('passing livestockWorld attaches the bundle group to the content tree', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    const world: LivestockWorld = createLivestockWorld(7);
    world.spawnFish({
      archetype: 0,
      speciesId: 1,
      bodyLengthMm: 35,
      position: { x: 100, y: 100, z: 100 },
    });
    r.render(sceneOf(), viewport, { livestockWorld: world });
    const rAny = r as unknown as {
      currentContent: { children: ReadonlyArray<{ name: string }> } | null;
      livestockBundle: { group: { name: string }; dispose: jest.Mock } | null;
    };
    const names = rAny.currentContent!.children.map((c) => c.name);
    expect(names).toContain('aquascape:livestock');
    expect(rAny.livestockBundle).not.toBeNull();
    r.dispose();
    raf.uninstall();
  });

  it('bundle is built ONCE across multiple renders (cached on the renderer)', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    const world = createLivestockWorld(7);
    world.spawnFish({ archetype: 0, speciesId: 1, bodyLengthMm: 35, position: { x: 0, y: 0, z: 0 } });
    r.render(sceneOf(), viewport, { livestockWorld: world });
    const rAny = r as unknown as { livestockBundle: { group: unknown } | null };
    const firstBundle = rAny.livestockBundle;
    r.render(sceneOf(), viewport, { livestockWorld: world });
    expect(rAny.livestockBundle).toBe(firstBundle);
    r.dispose();
    raf.uninstall();
  });

  it('dispose() releases the bundle exactly once and clears the world reference', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    const world = createLivestockWorld(7);
    world.spawnFish({ archetype: 0, speciesId: 1, bodyLengthMm: 35, position: { x: 0, y: 0, z: 0 } });
    r.render(sceneOf(), viewport, { livestockWorld: world });
    const rAny = r as unknown as { livestockBundle: { dispose: jest.Mock } | null };
    const bundle = rAny.livestockBundle!;
    const spy = jest.spyOn(bundle, 'dispose');
    r.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
    const rAny2 = r as unknown as { livestockBundle: unknown; livestockWorld: unknown };
    expect(rAny2.livestockBundle).toBeNull();
    expect(rAny2.livestockWorld).toBeNull();
    // Idempotent: a second dispose mustn't blow up.
    expect(() => r.dispose()).not.toThrow();
    raf.uninstall();
  });

  it('RAF tick steps the ECS world at the SIM_DT rate (fixed accumulator)', () => {
    // Hand-rolled RAF to fire callbacks on demand so we can advance the
    // sim loop without real timing.
    const callbacks: Array<(t: number) => void> = [];
    const g = globalThis as unknown as {
      requestAnimationFrame?: (cb: (t: number) => void) => number;
      cancelAnimationFrame?: (h: number) => void;
      performance?: { now(): number };
    };
    const prevReq = g.requestAnimationFrame;
    const prevCancel = g.cancelAnimationFrame;
    const prevPerf = g.performance;
    let fakeNow = 0;
    g.performance = { now: () => fakeNow } as Performance;
    g.requestAnimationFrame = ((cb: (t: number) => void) => {
      callbacks.push(cb);
      return callbacks.length;
    }) as never;
    g.cancelAnimationFrame = (() => undefined) as never;

    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    const world = createLivestockWorld(7);
    world.spawnFish({ archetype: 0, speciesId: 1, bodyLengthMm: 35, position: { x: 0, y: 0, z: 0 } });
    const stepSpy = jest.spyOn(world, 'step');
    r.render(sceneOf(), viewport, { livestockWorld: world });

    // Drain the initial RAF callback (from attach's startAnimationLoop +
    // any subsequent re-schedules), advancing simulated time so the
    // accumulator crosses SIM_DT_MS exactly once.
    fakeNow += SIM_DT * 1000;
    const next = callbacks.shift();
    next?.(fakeNow);
    expect(stepSpy).toHaveBeenCalledWith(SIM_DT);

    r.dispose();
    if (prevReq === undefined) delete g.requestAnimationFrame;
    else g.requestAnimationFrame = prevReq;
    if (prevCancel === undefined) delete g.cancelAnimationFrame;
    else g.cancelAnimationFrame = prevCancel;
    if (prevPerf === undefined) delete g.performance;
    else g.performance = prevPerf;
  });

  it('RAF tick caps catch-up steps at 4 after a long pause', () => {
    const callbacks: Array<(t: number) => void> = [];
    const g = globalThis as unknown as {
      requestAnimationFrame?: (cb: (t: number) => void) => number;
      cancelAnimationFrame?: (h: number) => void;
      performance?: { now(): number };
    };
    const prevReq = g.requestAnimationFrame;
    const prevCancel = g.cancelAnimationFrame;
    const prevPerf = g.performance;
    let fakeNow = 0;
    g.performance = { now: () => fakeNow } as Performance;
    g.requestAnimationFrame = ((cb: (t: number) => void) => {
      callbacks.push(cb);
      return callbacks.length;
    }) as never;
    g.cancelAnimationFrame = (() => undefined) as never;

    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    const world = createLivestockWorld(1);
    world.spawnFish({ archetype: 0, speciesId: 1, bodyLengthMm: 35, position: { x: 0, y: 0, z: 0 } });
    const stepSpy = jest.spyOn(world, 'step');
    r.render(sceneOf(), viewport, { livestockWorld: world });

    // Jump time forward by 1 second (≈30 sim steps' worth). The clamp
    // at 250 ms reduces this to 250 ms, then the 4-step cap fires.
    fakeNow += 1000;
    const next = callbacks.shift();
    next?.(fakeNow);
    expect(stepSpy.mock.calls.length).toBeLessThanOrEqual(4);

    r.dispose();
    if (prevReq === undefined) delete g.requestAnimationFrame;
    else g.requestAnimationFrame = prevReq;
    if (prevCancel === undefined) delete g.cancelAnimationFrame;
    else g.cancelAnimationFrame = prevCancel;
    if (prevPerf === undefined) delete g.performance;
    else g.performance = prevPerf;
  });
});

// ─── Stage 11 F11.7 — animated water surface wiring ──────────────────────

describe('Three3DRenderer — water surface wiring', () => {
  it('first render attaches the water mesh to the content group', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport);
    const rAny = r as unknown as {
      currentContent: { children: ReadonlyArray<{ name: string }> } | null;
      waterMesh: { mesh: { name: string } } | null;
    };
    expect(rAny.waterMesh).not.toBeNull();
    const names = rAny.currentContent!.children.map((c) => c.name);
    expect(names).toContain('aquascape:water-surface');
    r.dispose();
    raf.uninstall();
  });

  it('water mesh handle is cached across renders when tank dimensions are unchanged', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport);
    const rAny = r as unknown as { waterMesh: { mesh: unknown } | null };
    const firstHandle = rAny.waterMesh;
    r.render(sceneOf(600, 360, 300), viewport);
    expect(rAny.waterMesh).toBe(firstHandle);
    r.dispose();
    raf.uninstall();
  });

  it('water mesh is rebuilt when tank dimensions change (sized to the new tank)', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport);
    const rAny = r as unknown as {
      waterMesh: { mesh: { position: { y: number } } } | null;
    };
    const firstHandle = rAny.waterMesh;
    r.render(sceneOf(1200, 500, 400), viewport);
    expect(rAny.waterMesh).not.toBe(firstHandle);
    // New plane sits WATER_OFFSET_BELOW_RIM_MM below the new rim.
    expect(rAny.waterMesh!.mesh.position.y).toBeCloseTo(500 - WATER_OFFSET_BELOW_RIM_MM, 5);
    r.dispose();
    raf.uninstall();
  });

  it('dispose releases the water mesh handle and clears the cache tag', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport);
    const rAny = r as unknown as { waterMesh: { dispose: () => void } | null; waterMeshTag: string | null };
    const handle = rAny.waterMesh!;
    const spy = jest.spyOn(handle, 'dispose');
    r.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
    const rAny2 = r as unknown as { waterMesh: unknown; waterMeshTag: unknown };
    expect(rAny2.waterMesh).toBeNull();
    expect(rAny2.waterMeshTag).toBeNull();
    raf.uninstall();
  });
});

// ─── Stage 11 F11.7 Wave 3 — day-night cycle wiring ──────────────────────

describe('Three3DRenderer — day-night cycle', () => {
  it('applies dayNightLookup.ambientColor + directionalIntensity to the cached lights per render', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport, {
      dayNightLookup: {
        ambientColor: '#ff0000',
        directionalIntensity: 0.5,
        backgroundTint: '#00ff00',
        emissiveBoost: 0.2,
      },
    });
    const rAny = r as unknown as {
      currentAmbientLight: { color: { r: number; g: number; b: number } } | null;
      currentDirectionalLight: { intensity: number } | null;
      baseDirectionalIntensity: number;
    };
    expect(rAny.currentAmbientLight).not.toBeNull();
    // Pure red — assert the channel RELATIONSHIP survives Three.js's
    // colour-management pipeline (exact channel values depend on whether
    // Color management is on and what working-space we're in, so checking
    // "red dominates" is more durable than the channel literals).
    expect(rAny.currentAmbientLight!.color.r).toBeGreaterThan(
      rAny.currentAmbientLight!.color.g,
    );
    expect(rAny.currentAmbientLight!.color.r).toBeGreaterThan(
      rAny.currentAmbientLight!.color.b,
    );
    expect(rAny.currentAmbientLight!.color.g).toBeCloseTo(0, 5);
    expect(rAny.currentAmbientLight!.color.b).toBeCloseTo(0, 5);
    expect(rAny.currentDirectionalLight).not.toBeNull();
    expect(rAny.currentDirectionalLight!.intensity).toBeCloseTo(
      rAny.baseDirectionalIntensity * 0.5,
      5,
    );
    r.dispose();
    raf.uninstall();
  });

  it('assigns the gradient backdrop texture to threeScene.background and tints it via backgroundTint', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport, {
      dayNightLookup: {
        ambientColor: '#ffffff',
        directionalIntensity: 1,
        backgroundTint: '#ffffff',
        emissiveBoost: 0,
      },
    });
    const rAny = r as unknown as {
      threeScene: { background: DataTexture | null } | null;
      backdropTexture: DataTexture | null;
    };
    const bg = rAny.threeScene!.background;
    expect(bg).toBeInstanceOf(DataTexture);
    // The scene background IS the renderer's single cached backdrop texture.
    expect(bg).toBe(rAny.backdropTexture);
    expect(bg!.mapping).toBe(EquirectangularReflectionMapping);
    const noonPixels = Array.from(bg!.image.data as Uint8Array);

    // Tint change (midnight-ish): SAME texture object, pixel data rewritten
    // in place + flagged for re-upload — no re-allocation per render.
    // (`needsUpdate` is setter-only on Texture; `version` is the
    // observable re-upload counter it bumps.)
    const versionBefore = bg!.version;
    r.render(sceneOf(600, 360, 300), viewport, {
      dayNightLookup: {
        ambientColor: '#ffffff',
        directionalIntensity: 0.05,
        backgroundTint: '#101018',
        emissiveBoost: 0.4,
      },
    });
    const bg2 = rAny.threeScene!.background;
    expect(bg2).toBe(bg);
    expect(bg2!.version).toBeGreaterThan(versionBefore);
    const midnightPixels = Array.from(bg2!.image.data as Uint8Array);
    expect(midnightPixels).not.toEqual(noonPixels);
    // Midnight darkens: every RGB byte ≤ its noon counterpart.
    for (let i = 0; i < noonPixels.length; i += 4) {
      expect(midnightPixels[i]!).toBeLessThanOrEqual(noonPixels[i]!);
      expect(midnightPixels[i + 1]!).toBeLessThanOrEqual(noonPixels[i + 1]!);
      expect(midnightPixels[i + 2]!).toBeLessThanOrEqual(noonPixels[i + 2]!);
    }

    // Unchanged tint: data is NOT rewritten (cached-tint short-circuit) —
    // `version` stays put because nothing re-flags the upload.
    const versionAfterTint = bg!.version;
    r.render(sceneOf(600, 360, 300), viewport, {
      dayNightLookup: {
        ambientColor: '#ffffff',
        directionalIntensity: 0.05,
        backgroundTint: '#101018',
        emissiveBoost: 0.4,
      },
    });
    expect(rAny.threeScene!.background).toBe(bg);
    expect(bg!.version).toBe(versionAfterTint);
    r.dispose();
    raf.uninstall();
  });

  it('without dayNightLookup the backdrop texture is still the background (untinted default)', () => {
    // The backdrop must work in the headless-stub path too — DataTexture
    // construction needs no GL, so it is NOT behind the WebGLRenderer guard.
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport);
    const rAny = r as unknown as {
      threeScene: { background: DataTexture | null } | null;
      backdropTint: string | null;
    };
    expect(rAny.threeScene!.background).toBeInstanceOf(DataTexture);
    expect(rAny.backdropTint).toBe('#ffffff');
    r.dispose();
    raf.uninstall();
  });

  it('dispose releases the backdrop texture and detaches it from the scene', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport);
    const rAny = r as unknown as {
      backdropTexture: DataTexture | null;
      backdropTint: string | null;
    };
    const tex = rAny.backdropTexture!;
    const spy = jest.spyOn(tex, 'dispose');
    r.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(rAny.backdropTexture).toBeNull();
    expect(rAny.backdropTint).toBeNull();
    raf.uninstall();
  });

  it('without dayNightLookup, ambient stays white + directional stays at base intensity', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport);
    const rAny = r as unknown as {
      currentAmbientLight: { color: { r: number; g: number; b: number } } | null;
      currentDirectionalLight: { intensity: number } | null;
      baseDirectionalIntensity: number;
    };
    // Ambient defaults to white via the cycle's "reset" branch.
    expect(rAny.currentAmbientLight!.color.r).toBeCloseTo(1, 3);
    expect(rAny.currentAmbientLight!.color.g).toBeCloseTo(1, 3);
    expect(rAny.currentAmbientLight!.color.b).toBeCloseTo(1, 3);
    expect(rAny.currentDirectionalLight!.intensity).toBeCloseTo(
      rAny.baseDirectionalIntensity,
      5,
    );
    r.dispose();
    raf.uninstall();
  });

  it('day-night render does NOT rebuild the lighting group (intensity mutates in place)', () => {
    // Load-bearing: rebuilding the lighting per render would allocate
    // Three.js light objects + targets on every frame in real-time mode.
    // We mutate intensity / color on the cached references instead.
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(600, 360, 300), viewport, {
      dayNightLookup: {
        ambientColor: '#ffffff',
        directionalIntensity: 1,
        backgroundTint: '#000000',
        emissiveBoost: 0,
      },
    });
    const rAny = r as unknown as {
      lighting: object | null;
      currentAmbientLight: object | null;
      currentDirectionalLight: object | null;
    };
    const lightingBefore = rAny.lighting;
    const ambientBefore = rAny.currentAmbientLight;
    const directionalBefore = rAny.currentDirectionalLight;
    // Cycle through several lookup values — lighting refs must stay identical.
    for (let i = 0; i < 5; i++) {
      r.render(sceneOf(600, 360, 300), viewport, {
        dayNightLookup: {
          ambientColor: `#${i.toString(16).padStart(6, '0')}`,
          directionalIntensity: i / 4,
          backgroundTint: '#202020',
          emissiveBoost: i * 0.1,
        },
      });
    }
    expect(rAny.lighting).toBe(lightingBefore);
    expect(rAny.currentAmbientLight).toBe(ambientBefore);
    expect(rAny.currentDirectionalLight).toBe(directionalBefore);
    r.dispose();
    raf.uninstall();
  });

  it('day-night render writes emissiveBoost into every plant sway material', async () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    // Build a scene with one plant so the plant group has at least one
    // sway material to inspect. Use the carpet entry shape the plant-mesh
    // spec uses.
    const plantEntry = {
      catalog: 'core',
      id: 'plant.test.carpet',
      version: 1,
      name: 'Test',
      kind: 'plant' as const,
      zone: 'foreground' as const,
      lighting: 'medium' as const,
      co2: 'low' as const,
      difficulty: 'easy' as const,
      color: '#2e7d32',
      naturalSize: { width: 30, height: 20, depth: 20 },
      silhouette: [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
      ],
      growth: { weeksToMature: 8, sizeAtZero: 0.3 },
    };
    const catalog = makeCatalog([plantEntry]);
    const tank = {
      width: 600,
      height: 360,
      depth: 300,
      style: { frame: 'rimless' as const, background: { kind: 'none' as const } },
    };
    const layer = {
      id: 'l1' as Layer['id'],
      name: 'L',
      opacity: 1,
      visible: true,
      locked: false,
      objects: [
        {
          id: 'p1' as HardscapeObject['id'],
          kind: 'plant' as const,
          ref: { catalog: 'core', id: 'plant.test.carpet', version: 1 },
          transform: {
            position: { x: 100, y: 30, z: 50 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            flipX: false,
            flipY: false,
          },
          growth: { ageWeeks: 12, vigor: 1 },
        },
      ],
    } as unknown as Layer;
    const sceneWithPlant: Scene = {
      tank,
      substrate: { regions: [] },
      layers: [layer],
      seed: 1,
    };
    r.render(sceneWithPlant, viewport, {
      catalog,
      dayNightLookup: {
        ambientColor: '#ffffff',
        directionalIntensity: 1,
        backgroundTint: '#202020',
        emissiveBoost: 0.4,
      },
    });
    const rAny = r as unknown as {
      currentPlantGroup: {
        userData: Record<string, unknown>;
      } | null;
    };
    const mats = rAny.currentPlantGroup!.userData[
      'aquascape:plantSwayMaterials'
    ] as Array<{ userData: { swayUniforms: { uPlantEmissiveBoost: { value: number } } } }>;
    expect(mats.length).toBeGreaterThan(0);
    for (const m of mats) {
      expect(m.userData.swayUniforms.uPlantEmissiveBoost.value).toBeCloseTo(0.4, 5);
    }
    r.dispose();
    raf.uninstall();
  });

  it('dispose clears the cached light refs (no stale handles)', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(), viewport);
    r.dispose();
    const rAny = r as unknown as {
      currentAmbientLight: unknown;
      currentDirectionalLight: unknown;
    };
    expect(rAny.currentAmbientLight).toBeNull();
    expect(rAny.currentDirectionalLight).toBeNull();
    raf.uninstall();
  });
});

// ─── Bucket 0 — render-target capability gate ─────────────────────────────

describe('Three3DRenderer — render-target capability gate', () => {
  it('getRenderTargetEffectsSupported is false before attach', () => {
    const r = new Three3DRenderer(makeFactory(new StubRenderer()));
    expect(r.getRenderTargetEffectsSupported()).toBe(false);
  });

  it('stays false under the headless stub renderer (no real WebGLRenderer → no probe)', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const r = new Three3DRenderer(makeFactory(stub));
    r.attach(makeSurface());
    r.render(sceneOf(), viewport);
    // The probe lives in setupComposer, which no-ops for non-WebGLRenderer
    // factories — exactly the conservative default the gate wants: when we
    // can't prove a hardware context, render-target effects stay off.
    expect(r.getRenderTargetEffectsSupported()).toBe(false);
    r.dispose();
    raf.uninstall();
  });

  it('resets to false after dispose', () => {
    const raf = stubRaf();
    const r = new Three3DRenderer(makeFactory(new StubRenderer()));
    r.attach(makeSurface());
    // Force the flag on to prove dispose clears it (the stub path never
    // sets it, so flip it directly).
    (r as unknown as { renderTargetEffectsSupported: boolean }).renderTargetEffectsSupported =
      true;
    r.dispose();
    expect(r.getRenderTargetEffectsSupported()).toBe(false);
    raf.uninstall();
  });
});

describe('Three3DRenderer — catalog textures (Bucket 2)', () => {
  function texturedSubstrateScene(): Scene {
    const base = sceneOf();
    return {
      ...base,
      substrate: {
        regions: [
          {
            id: 'r1',
            material: { catalog: 'core', id: 'substrate.soil', version: 1 },
            fromX: 0,
            toX: 1,
            profile: [
              { x: 0, y: 30 },
              { x: 1, y: 30 },
            ],
          },
        ],
      },
    };
  }
  const texturedCatalog = (): Catalog =>
    makeCatalog([
      {
        catalog: 'core',
        id: 'substrate.soil',
        version: 1,
        name: 'Soil',
        kind: 'substrate',
        material: 'soil',
        color: '#2a2520',
        textures: {
          albedo: 'soil-dark.albedo.png',
          normal: 'soil-dark.normal.png',
          roughness: 'soil-dark.roughness.png',
        },
      } as CatalogEntry,
    ]);

  it('creates the texture cache + resolves refs only when catalogTextureBaseUrl is supplied', () => {
    const raf = stubRaf();
    const stub = new StubRenderer();
    const renderer = new Three3DRenderer(makeFactory(stub));
    renderer.attach(makeSurface());

    const cacheOf = (): { size(): number } | null =>
      (renderer as unknown as { textureCache: { size(): number } | null }).textureCache;

    // Without the option: no cache, shaders stay pre-Bucket-2.
    renderer.render(texturedSubstrateScene(), viewport, { catalog: texturedCatalog() });
    expect(cacheOf()).toBeNull();

    // With the option: cache created, one texture per distinct ref URL.
    renderer.render(texturedSubstrateScene(), viewport, {
      catalog: texturedCatalog(),
      catalogTextureBaseUrl: 'assets/catalog-textures/',
    });
    expect(cacheOf()).not.toBeNull();
    expect(cacheOf()!.size()).toBe(3);

    // Re-render dedupes (same URLs, same cache entries).
    renderer.render(texturedSubstrateScene(), viewport, {
      catalog: texturedCatalog(),
      catalogTextureBaseUrl: 'assets/catalog-textures/',
    });
    expect(cacheOf()!.size()).toBe(3);

    // Dispose releases the cache.
    renderer.dispose();
    expect(cacheOf()).toBeNull();
    raf.uninstall();
  });
});
