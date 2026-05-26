/**
 * Three.js WebGL implementation of `SceneRenderer`. Plan Stage 10 F10.1.
 *
 * SCOPE — V1 IS READ-ONLY / SIMULATION-ONLY
 * -----------------------------------------
 * - `hitTest` always returns `null`. No editing in 3D.
 * - No selection handles. No participation in drag / marquee / inspector
 *   flows — those remain 2D-only for v1.
 * - The toolbar 2D ↔ 3D toggle is wired in `apps/web` as a separate task;
 *   this file just supplies the `SceneRenderer` implementation.
 *
 * FUTURE SCOPE (NOT v1, but the structure leaves room)
 * ----------------------------------------------------
 * - Dynamic lighting (day / night cycle). `scene-builder/lighting.ts`
 *   already factors the rig as a function of the tank — extending it to
 *   take a time-of-day parameter is additive.
 * - Water surface dynamics (refraction, ripples). The current water
 *   plane is a flat `MeshPhysicalMaterial`; a future `shaderMaterial`
 *   swap replaces just that mesh.
 * - Animated plants (sway, growth-in-motion). `scene-builder/plant-mesh.
 *   ts` produces extruded leaves today; a future builder can hand back
 *   skinned meshes the renderer's animation tick advances.
 * - Fish behaviours. `livestock` is already on the scene; a future
 *   `scene-builder/livestock-mesh.ts` slots into the rebuild pipeline.
 *
 * INVARIANTS
 * ----------
 * - `render(scene, viewport)` is idempotent for a given (scene, viewport).
 *   The animation tick that runs OrbitControls' damping does NOT violate
 *   this when the user isn't dragging — damping settles to a fixed point.
 * - `render` does not mutate `scene`.
 * - `dispose` releases every resource the renderer attached: animation
 *   frame, controls, WebGL renderer, every mesh's geometry + material.
 *   The dispose-discipline test in the spec verifies counters don't grow
 *   without bound across many render/dispose cycles.
 *
 * COORDINATE SYSTEM
 * -----------------
 * Three.js convention is right-handed, +Y up, looking down −Z. The `.aqua`
 * document uses the EXACT same convention (+x right, +y up, +z back,
 * origin at the tank's front-bottom-left interior corner). So scene-model
 * coords map 1:1 to Three.js world space — no axis flip, no projection
 * juggle.
 *
 * The `Viewport` argument to `render` is a 2D framing concept (zoom in
 * CSS-px-per-mm + a world-mm centre + rotation). The 3D renderer
 * IGNORES it. OrbitControls is the camera state of truth in 3D.
 */

import type { Catalog } from '@aquascape/domain/catalog';
import type { Vec2 } from '@aquascape/domain/geometry';
import type { Scene } from '@aquascape/domain/scene-model';
import type {
  HitResult,
  HitTestOptions,
  RenderOptions,
  RenderSurface,
  SceneRenderer,
  Viewport,
} from '@aquascape/rendering/renderer-api';
import {
  InstancedMesh,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene as ThreeScene,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from 'three';
// Note: `three/examples/jsm/controls/OrbitControls` (no `.js` extension) is
// the form that resolves under the workspace's classic `node` module
// resolution — TypeScript picks up `@types/three/examples/jsm/controls/
// OrbitControls.d.ts` and the runtime picks up the matching `three/examples/
// jsm/controls/OrbitControls.js`. The `three/addons/*` alias requires
// `moduleResolution: bundler`/`node16` which the workspace doesn't use yet.
// Jest redirects this import to a CJS stub via `moduleNameMapper`; see
// `src/__mocks__/orbit-controls-stub.ts`.
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

/**
 * Subset of `WebGLRenderer` the orchestrator actually calls. Lets test
 * code inject a stub renderer (jsdom + happy-dom lack a WebGL context)
 * without standing up a real GL environment. Production constructs a
 * real `WebGLRenderer` via the default factory.
 */
export interface RendererLike {
  setPixelRatio(dpr: number): void;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  render(scene: ThreeScene, camera: PerspectiveCamera): void;
  dispose(): void;
}

/** Factory the orchestrator uses to instantiate its renderer. Injectable. */
export type RendererFactory = (canvas: HTMLCanvasElement) => RendererLike;

const defaultRendererFactory: RendererFactory = (canvas) =>
  new WebGLRenderer({ canvas, antialias: true, alpha: true });
import { buildCamera, tankCenter } from './scene-builder/camera';
import { buildHardscapeMeshes } from './scene-builder/hardscape-mesh';
import { buildLighting } from './scene-builder/lighting';
import { buildPlantMeshes } from './scene-builder/plant-mesh';
import { buildSubstrateMeshes } from './scene-builder/substrate-mesh';
import { buildTankMesh } from './scene-builder/tank-mesh';

/** Damping factor for orbit interactions. 0.08 reads smooth on mid-tier HW. */
const ORBIT_DAMPING = 0.08;
/** Minimum orbit distance as a fraction of tank depth. */
const ORBIT_MIN_DIST_MULT = 0.3;
/** Maximum orbit distance as a fraction of tank depth. */
const ORBIT_MAX_DIST_MULT = 10;

/**
 * The shim for `requestAnimationFrame` we use during the animation tick.
 * In Node test environments where the global doesn't exist, we install a
 * minimal stub so the renderer can still attach + dispose cleanly without
 * actually scheduling frames.
 */
interface RafLike {
  requestAnimationFrame(cb: (t: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

function getRaf(): RafLike | null {
  const g = globalThis as unknown as Partial<RafLike>;
  if (typeof g.requestAnimationFrame === 'function' && typeof g.cancelAnimationFrame === 'function') {
    return {
      requestAnimationFrame: g.requestAnimationFrame.bind(globalThis),
      cancelAnimationFrame: g.cancelAnimationFrame.bind(globalThis),
    };
  }
  return null;
}

export class Three3DRenderer implements SceneRenderer {
  private surface: RenderSurface | null = null;
  private renderer: RendererLike | null = null;
  private threeScene: ThreeScene | null = null;
  private camera: PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  /**
   * The transient content group built from the last `render` call. Each
   * call disposes the previous group and replaces it — see `disposeNode`
   * for the geometry/material dispose discipline this depends on.
   */
  private currentContent: Object3D | null = null;
  /** Lighting group, built once on `attach`. Disposed in `dispose`. */
  private lighting: Object3D | null = null;
  /** Active animation-frame handle, or null if no tick is scheduled. */
  private rafHandle: number | null = null;
  private rafShim: RafLike | null = null;
  /** Injectable factory; tests pass a stub renderer. */
  private readonly rendererFactory: RendererFactory;

  /**
   * @param rendererFactory injectable WebGLRenderer factory. The default
   * constructs a real `THREE.WebGLRenderer`; tests inject a stub so they
   * don't need a real WebGL context.
   */
  constructor(rendererFactory: RendererFactory = defaultRendererFactory) {
    this.rendererFactory = rendererFactory;
  }

  // ─── attach ───────────────────────────────────────────────────────────

  attach(surface: RenderSurface): void {
    if (this.surface !== null) {
      this.dispose();
    }

    this.surface = surface;
    let renderer: RendererLike;
    try {
      renderer = this.rendererFactory(surface.canvas);
    } catch (err) {
      // Surface the failure to the host; tests under a stub-WebGL
      // environment can still exercise the attach guard.
      this.surface = null;
      throw new Error(
        `Three3DRenderer.attach: WebGLRenderer init failed: ${(err as Error).message}`,
      );
    }
    renderer.setPixelRatio(surface.devicePixelRatio);
    renderer.setSize(surface.width, surface.height, false);
    this.renderer = renderer;

    this.threeScene = new ThreeScene();

    // Camera framed to a placeholder tank; the first `render` call
    // re-frames against the real tank. We DO build a camera here (rather
    // than waiting for the first render) so the animation tick can call
    // `renderer.render(scene, camera)` immediately for OrbitControls
    // damping. The placeholder is a 1 m cube — never seen, just sized.
    const aspect = surface.width === 0 ? 1 : surface.width / surface.height;
    this.camera = buildCamera({ width: 1000, height: 1000, depth: 1000, style: PLACEHOLDER_STYLE }, aspect);

    // OrbitControls binds pointer / wheel listeners to the canvas only;
    // no document-level listeners.
    const controls = new OrbitControls(this.camera, surface.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = ORBIT_DAMPING;
    controls.target.copy(tankCenter({ width: 1000, height: 1000, depth: 1000, style: PLACEHOLDER_STYLE }));
    controls.minDistance = 1000 * ORBIT_MIN_DIST_MULT;
    controls.maxDistance = 1000 * ORBIT_MAX_DIST_MULT;
    controls.autoRotate = false;
    this.controls = controls;

    // Built once on attach because tank dimensions affect the key-light
    // position, but the rig itself is otherwise stable across frames.
    // First `render` call re-builds it once we have the real tank.
    this.lighting = null;

    // Kick off the animation loop. It only runs OrbitControls' damping
    // tick and `renderer.render`; it does NOT rebuild the scene graph.
    // The scene graph is rebuilt only when `render()` is called.
    this.startAnimationLoop();
  }

  private startAnimationLoop(): void {
    const raf = getRaf();
    this.rafShim = raf;
    if (raf === null) return; // Node env without RAF — attach + dispose still work.
    const tick = (): void => {
      const r = this.renderer;
      const s = this.threeScene;
      const c = this.camera;
      const ctl = this.controls;
      if (r === null || s === null || c === null) return;
      ctl?.update();
      r.render(s, c);
      this.rafHandle = raf.requestAnimationFrame(tick);
    };
    this.rafHandle = raf.requestAnimationFrame(tick);
  }

  // ─── render ───────────────────────────────────────────────────────────

  render(scene: Scene, _viewport: Viewport, options: RenderOptions = {}): void {
    void _viewport; // 3D ignores 2D viewport — see header.
    const r = this.renderer;
    const tScene = this.threeScene;
    if (r === null || tScene === null || this.surface === null) return;

    const catalog: Catalog | undefined = options.catalog;
    const previewAgeWeeks: number | undefined = options.previewAgeWeeks;

    // 1) Re-frame the camera against the real tank dimensions on first
    //    render (or whenever the tank changes). We compare the camera's
    //    current target against the new tank centre — when they differ
    //    materially we rebuild. OrbitControls keeps the user's manual
    //    orbit otherwise.
    this.ensureCameraForTank(scene);

    // 2) Rebuild lighting if missing (first render) or if the tank
    //    dimensions changed (key-light position scales with the tank).
    this.ensureLightingForTank(scene, tScene);

    // 3) Rebuild content group from scratch. Cheap (~ms) for typical
    //    scenes and keeps idempotency trivial — same input, same graph.
    if (this.currentContent !== null) {
      tScene.remove(this.currentContent);
      disposeNode(this.currentContent);
      this.currentContent = null;
    }
    const content = new Object3D();
    content.name = 'aquascape:content';
    content.add(buildTankMesh(scene.tank));
    content.add(buildSubstrateMeshes(scene, catalog));
    content.add(buildHardscapeMeshes(scene, catalog));
    content.add(buildPlantMeshes(scene, catalog, previewAgeWeeks));
    tScene.add(content);
    this.currentContent = content;

    // 4) Paint one frame synchronously so render() has a visible effect
    //    even when no animation tick is running (Node tests, headless
    //    smoke). The animation tick will keep painting after this.
    const c = this.camera;
    if (c !== null) r.render(tScene, c);
  }

  /**
   * Reframe the camera target when the tank centre has moved (first
   * render or a tank-dimension change). The orbit DISTANCE is preserved
   * — only the target moves — so a user who panned in won't be yanked
   * back when the document loads.
   */
  private ensureCameraForTank(scene: Scene): void {
    const c = this.camera;
    const ctl = this.controls;
    if (c === null) return;
    const newCenter = tankCenter(scene.tank);
    if (ctl !== null && ctl.target.distanceToSquared(newCenter) < 1) return;
    // Move target + camera together so the orbit pose is preserved.
    if (ctl !== null) {
      const offset = c.position.clone().sub(ctl.target);
      ctl.target.copy(newCenter);
      c.position.copy(newCenter).add(offset);
      ctl.minDistance = Math.max(1, scene.tank.depth * ORBIT_MIN_DIST_MULT);
      ctl.maxDistance = Math.max(2, scene.tank.depth * ORBIT_MAX_DIST_MULT);
      ctl.update();
    } else {
      // No controls — reframe from scratch.
      const fresh = buildCamera(scene.tank, c.aspect);
      c.position.copy(fresh.position);
      c.lookAt(newCenter);
    }
    c.updateProjectionMatrix();
  }

  /**
   * Lazily build / rebuild the lighting rig. The key-light position
   * scales with tank dimensions, so we rebuild whenever the tank size
   * changes. We track the last-built tank dimensions on the lighting
   * Object3D's userData to compare cheaply.
   */
  private ensureLightingForTank(scene: Scene, tScene: ThreeScene): void {
    const tag = `${scene.tank.width}x${scene.tank.height}x${scene.tank.depth}`;
    if (this.lighting !== null) {
      const previous = this.lighting.userData['aquascape:lightingTag'] as string | undefined;
      if (previous === tag) return;
      tScene.remove(this.lighting);
      disposeNode(this.lighting);
      this.lighting = null;
    }
    const rig = buildLighting(scene.tank);
    rig.userData['aquascape:lightingTag'] = tag;
    tScene.add(rig);
    this.lighting = rig;
  }

  // ─── hitTest ──────────────────────────────────────────────────────────

  /**
   * Read-only contract for v1: returns `null` for every input. The 3D
   * renderer does not participate in the editor's pick/drag pipeline;
   * 3D is purely a viewer.
   */
  hitTest(_point: Vec2, _scene: Scene, _viewport: Viewport, _options?: HitTestOptions): HitResult | null {
    void _point;
    void _scene;
    void _viewport;
    void _options;
    return null;
  }

  // ─── dispose ──────────────────────────────────────────────────────────

  dispose(): void {
    if (this.rafHandle !== null && this.rafShim !== null) {
      this.rafShim.cancelAnimationFrame(this.rafHandle);
    }
    this.rafHandle = null;
    this.rafShim = null;

    if (this.controls !== null) {
      this.controls.dispose();
      this.controls = null;
    }

    if (this.currentContent !== null) {
      if (this.threeScene !== null) this.threeScene.remove(this.currentContent);
      disposeNode(this.currentContent);
      this.currentContent = null;
    }

    if (this.lighting !== null) {
      if (this.threeScene !== null) this.threeScene.remove(this.lighting);
      disposeNode(this.lighting);
      this.lighting = null;
    }

    if (this.renderer !== null) {
      this.renderer.dispose();
      this.renderer = null;
    }

    this.threeScene = null;
    this.camera = null;
    this.surface = null;
  }
}

/**
 * Walk an Object3D subtree and dispose every Mesh's geometry + material.
 * Three.js otherwise leaks WebGL resources because GC can't reach the GPU
 * handles. Called from `dispose()` AND from the rebuild path in
 * `render()`.
 *
 * Handles InstancedMesh too (single geometry + material reference; same
 * dispose calls).
 */
function disposeNode(root: Object3D): void {
  root.traverse((node) => {
    if ((node as Mesh).isMesh || (node as InstancedMesh).isInstancedMesh) {
      const m = node as Mesh;
      const geo = m.geometry as BufferGeometry | undefined;
      if (geo !== undefined && typeof geo.dispose === 'function') geo.dispose();
      const mat = m.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) {
        for (const x of mat) {
          if (x !== undefined && typeof x.dispose === 'function') x.dispose();
        }
      } else if (mat !== undefined && typeof mat.dispose === 'function') {
        mat.dispose();
      }
    }
  });
  root.clear();
}

/** Placeholder tank style for the pre-render camera build. */
const PLACEHOLDER_STYLE = {
  frame: 'rimless' as const,
  background: { kind: 'none' as const },
};
