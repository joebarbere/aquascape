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
 * The `.aqua` document and Three.js are BOTH right-handed +Y-up, but they
 * differ on what +Z means: the document treats +Z as "back of tank" with
 * the viewer at −Z, whereas Three.js's default camera looks down −Z (so
 * its "front of view" is +Z). When the renderer places the camera in
 * front of the tank (world −Z) and aims it at world +Z, the lookAt math
 * lands screen-right on world −X — doc +X (right side of tank) ends up
 * on screen LEFT.
 *
 * To cancel the flip without changing every builder's coordinate
 * convention, both the content and lighting groups carry a top-level
 * `scale.x = -1, position.x = tank.width` mirror (`applyDocToWorldMirror`
 * at the bottom of this file). Three.js's `WebGLRenderer` detects the
 * negative-determinant world matrix per-mesh and flips `gl.frontFace`
 * accordingly so winding-order / culling stay correct.
 *
 * See `docs/caveats/renderer-3d.md` → "Coordinate system" for the long
 * explanation, and `three-3d-renderer.spec.ts` → "doc → world X-mirror"
 * for the regression coverage.
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
  Spherical,
  Vector3,
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
  /** Optional — real `WebGLRenderer` has it; the test stub may omit. */
  setClearColor?(color: number, alpha?: number): void;
}

/** Factory the orchestrator uses to instantiate its renderer. Injectable. */
export type RendererFactory = (canvas: HTMLCanvasElement) => RendererLike;

/**
 * Programmatic camera-control surface for the 3D renderer. Exposed
 * separately from the `SceneRenderer` interface because these operations
 * only make sense in 3D — the 2D canvas renderer doesn't have a camera
 * to orbit. The editor-shell's zoom + pan/rotate UI binds to this
 * surface (the `Three3DRenderer` instance itself implements it; see
 * `apps/web` for the DI token wiring).
 *
 * All deltas use simple unit conventions chosen for button-step UI:
 * - `zoomBy(factor)`: factor > 1 = zoom in (camera moves closer to
 *   target); factor < 1 = zoom out. Clamped to OrbitControls's
 *   min / max distance.
 * - `panBy(dx, dy)`: deltas are FRACTIONS OF CURRENT CAMERA-TARGET
 *   DISTANCE — a +0.1 dx pans right by 10% of the current view's
 *   scale, so button steps feel consistent regardless of zoom level.
 * - `rotateBy(azimuth, polar)`: radians around the orbit target. Polar
 *   is clamped to (0, π) so the camera can't flip over the pole.
 *
 * `getZoomFraction()` returns 1 at the initial framing distance,
 * greater than 1 when zoomed in, less than 1 when zoomed out — the same
 * convention the 2D `ViewportService.userZoomMult` uses, so the zoom
 * percent label reads consistently across modes.
 *
 * `addChangeListener(cb)` fires whenever the camera state changes —
 * from programmatic calls AND from user mouse/wheel input through
 * OrbitControls. Returns an unsubscribe function.
 */
export interface Orbital3DControls {
  zoomBy(factor: number): void;
  panBy(deltaX: number, deltaY: number): void;
  rotateBy(azimuthDelta: number, polarDelta: number): void;
  resetView(): void;
  getZoomFraction(): number;
  addChangeListener(cb: () => void): () => void;
}

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

export class Three3DRenderer implements SceneRenderer, Orbital3DControls {
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
   * Last tank rendered, retained so `resetView()` + `getZoomFraction()`
   * can rebuild the initial camera framing without a fresh `render()`
   * call. Updated at the end of every `render()`. Null until the first
   * render.
   */
  private lastRenderedTank: { width: number; height: number; depth: number } | null = null;
  /**
   * Subscribers notified whenever the camera state changes. Programmatic
   * orbital-control calls invoke `notifyChange()` directly; user mouse /
   * wheel input flows through OrbitControls' `'change'` event, which we
   * wire to `notifyChange()` in `attach()`.
   */
  private readonly changeListeners = new Set<() => void>();
  /**
   * Unsubscribe handle for the OrbitControls 'change' event listener.
   * Stored so `dispose()` can detach it before destroying the controls.
   */
  private controlsChangeUnsub: (() => void) | null = null;

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
    // Idempotent re-attach to the same canvas: just sync size + DPR and
    // keep the existing GL context alive. **This is load-bearing.**
    // `WebGLRenderer.dispose()` calls `WEBGL_lose_context.loseContext()`
    // which PERMANENTLY destroys the canvas's GL context — the next
    // `getContext('webgl2')` returns a lost context that renders nothing.
    // So calling `attach()` on every renderCurrent() (which the host
    // does, matching the Canvas2DRenderer's contract) would tear down
    // the renderer on the second call and leave the user staring at a
    // blank 3D view. Only do full re-init when the canvas itself
    // changes (which never happens in the current host, but is still
    // the correct contract — the canvas pair lives for the app's
    // lifetime).
    if (
      this.surface !== null &&
      this.surface.canvas === surface.canvas &&
      this.renderer !== null
    ) {
      this.surface = surface;
      this.renderer.setPixelRatio(surface.devicePixelRatio);
      this.renderer.setSize(surface.width, surface.height, false);
      if (this.camera !== null) {
        const aspect = surface.width === 0 || surface.height === 0
          ? 1
          : surface.width / surface.height;
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
      }
      // Reuse existing OrbitControls + lighting + content. The next
      // `render()` call rebuilds the content group from scratch (its
      // existing contract), and ensureLightingForTank / ensureCameraForTank
      // handle tank-dimension changes.
      return;
    }

    // Canvas changed (or first attach) — full re-init.
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
    // Soft dark-blue clear color so the canvas reads as "3D scene" not
    // "the renderer is broken" even when the scene is empty. Matches
    // the 2D renderer's wall-background default in spirit.
    renderer.setClearColor?.(0x1a2030, 1);
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

    // Forward OrbitControls 'change' (fired on user mouse / wheel input
    // AND on programmatic `update()`) to our listener set so the editor-
    // shell zoom percent + orbit UI can re-read state when the user spins
    // the camera with the mouse. The orbit-controls-stub used in Jest
    // omits `addEventListener`, so guard the binding.
    const addListener = (controls as unknown as {
      addEventListener?: (event: string, cb: () => void) => void;
    }).addEventListener;
    const removeListener = (controls as unknown as {
      removeEventListener?: (event: string, cb: () => void) => void;
    }).removeEventListener;
    if (typeof addListener === 'function' && typeof removeListener === 'function') {
      const onChange = (): void => this.notifyChange();
      addListener.call(controls, 'change', onChange);
      this.controlsChangeUnsub = () => removeListener.call(controls, 'change', onChange);
    }

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
    // **Document → Three.js X-mirror (load-bearing).** The .aqua document
    // uses `+Z = back of tank, +X = right` with the viewer at `-Z`. Three.js
    // is also right-handed, but its default camera looks down `-Z`, so the
    // "viewer-side" of the world is `+Z`. When the renderer places the
    // camera in front of the tank (at world `-Z`) looking at world `+Z`,
    // the lookAt-derived camera basis points its screen-right axis at
    // world `-X` — i.e., doc `+X` (right side of tank) lands on screen
    // LEFT. Mirroring the scene about its X-midplane cancels that flip:
    // doc `+X` → world `-X` → screen `+X` (right). The transform is
    // `scale.x = -1, position.x = tank.width`, applied to both content
    // and lighting (so the key light's authored "front-top-right" intent
    // also lands on the user's screen-right). Three.js handles the
    // negative-determinant world matrix automatically — `WebGLRenderer`
    // flips `gl.frontFace` per-mesh — so winding-order / culling stays
    // correct without per-material side adjustments.
    applyDocToWorldMirror(content, scene.tank.width);
    tScene.add(content);
    this.currentContent = content;

    // Cache the tank dimensions so `resetView()` / `getZoomFraction()`
    // can rebuild the initial framing without needing the full scene.
    this.lastRenderedTank = {
      width: scene.tank.width,
      height: scene.tank.height,
      depth: scene.tank.depth,
    };

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
    // First render: re-frame from scratch against the real tank so the
    // initial pose is the proper 3/4 view for THIS tank, not the
    // placeholder framing computed in `attach()`. The placeholder is a
    // 1 m cube — preserving its offset would land the camera at a wildly
    // off-axis pose on small tanks. After the first render we switch to
    // the "preserve orbit pose" path so a tank-resize doesn't yank the
    // camera away from the user's manual orbit.
    if (this.lastRenderedTank === null) {
      const fresh = buildCamera(scene.tank, c.aspect);
      c.position.copy(fresh.position);
      if (ctl !== null) {
        ctl.target.copy(newCenter);
        ctl.minDistance = Math.max(1, scene.tank.depth * ORBIT_MIN_DIST_MULT);
        ctl.maxDistance = Math.max(2, scene.tank.depth * ORBIT_MAX_DIST_MULT);
        ctl.update();
      } else {
        c.lookAt(newCenter);
      }
      c.updateProjectionMatrix();
      return;
    }
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
    // Mirror the lighting on the same axis as the content (see the long
    // comment in `render()`). The key light is authored "front-top-right"
    // in doc terms; without this mirror it would land on the user's
    // screen-LEFT and the scene would look lit from the wrong side.
    applyDocToWorldMirror(rig, scene.tank.width);
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

  // ─── orbital 3D controls ──────────────────────────────────────────────

  /**
   * Multiply the camera's distance to its orbit target by `1 / factor`.
   * `factor > 1` = zoom IN (camera moves closer); `factor < 1` = zoom OUT.
   * The resulting distance is clamped to OrbitControls's `minDistance` /
   * `maxDistance` bounds (which scale with tank depth, see `attach`). No-op
   * if the renderer hasn't been attached yet, the factor is non-finite, or
   * the factor is non-positive (would invert direction).
   */
  zoomBy(factor: number): void {
    const c = this.camera;
    const ctl = this.controls;
    if (c === null || ctl === null) return;
    if (!Number.isFinite(factor) || factor <= 0) return;
    const offset = c.position.clone().sub(ctl.target);
    const currentDist = offset.length();
    if (currentDist === 0) return;
    const targetDist = clampDistance(currentDist / factor, ctl);
    offset.setLength(targetDist);
    c.position.copy(ctl.target).add(offset);
    ctl.update();
    this.notifyChange();
  }

  /**
   * Pan the orbit target + camera together. `deltaX` / `deltaY` are
   * fractions of the current camera-target distance — so a `+0.1` dx
   * shifts the view right by ~10 % of the visible scene regardless of
   * zoom level, which is what makes button-step pan feel consistent.
   * The translation happens in the camera's local right / up basis so it
   * always reads as "shift the picture left/right/up/down".
   */
  panBy(deltaX: number, deltaY: number): void {
    const c = this.camera;
    const ctl = this.controls;
    if (c === null || ctl === null) return;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    const offset = c.position.clone().sub(ctl.target);
    const distance = offset.length();
    if (distance === 0) return;
    // Camera local right axis: `up × forward` (with forward = target-eye,
    // i.e. -offset). Equivalently: `up × -offset` = `offset × up`.
    const right = new Vector3().crossVectors(offset, c.up).normalize();
    if (right.lengthSq() === 0) return;
    const up = new Vector3().crossVectors(right, offset).normalize();
    const panVec = new Vector3()
      .addScaledVector(right, deltaX * distance)
      .addScaledVector(up, deltaY * distance);
    ctl.target.add(panVec);
    c.position.add(panVec);
    ctl.update();
    this.notifyChange();
  }

  /**
   * Rotate the camera around the orbit target by `azimuthDelta` (around
   * the Y axis) and `polarDelta` (around the local X axis through the
   * target). Both are in radians. Polar is clamped to `[ε, π - ε]` so the
   * camera can't flip past the pole and end up upside-down.
   */
  rotateBy(azimuthDelta: number, polarDelta: number): void {
    const c = this.camera;
    const ctl = this.controls;
    if (c === null || ctl === null) return;
    if (!Number.isFinite(azimuthDelta) || !Number.isFinite(polarDelta)) return;
    const offset = c.position.clone().sub(ctl.target);
    const spherical = new Spherical().setFromVector3(offset);
    spherical.theta += azimuthDelta;
    spherical.phi = Math.max(
      POLAR_EPSILON,
      Math.min(Math.PI - POLAR_EPSILON, spherical.phi + polarDelta),
    );
    offset.setFromSpherical(spherical);
    c.position.copy(ctl.target).add(offset);
    c.lookAt(ctl.target);
    ctl.update();
    this.notifyChange();
  }

  /**
   * Reset the camera to the initial 3/4-view framing for the last-
   * rendered tank. No-op if `render()` has never been called (no tank
   * dimensions to frame against).
   */
  resetView(): void {
    const tank = this.lastRenderedTank;
    const c = this.camera;
    const ctl = this.controls;
    if (tank === null || c === null) return;
    const fresh = buildCamera({ ...tank, style: PLACEHOLDER_STYLE }, c.aspect);
    c.position.copy(fresh.position);
    if (ctl !== null) {
      ctl.target.copy(tankCenter({ ...tank, style: PLACEHOLDER_STYLE }));
      ctl.update();
    } else {
      c.lookAt(tankCenter({ ...tank, style: PLACEHOLDER_STYLE }));
    }
    c.updateProjectionMatrix();
    this.notifyChange();
  }

  /**
   * Current zoom fraction, with `1` at the initial framing distance. The
   * editor-shell uses this to drive the zoom percent label so the 3D mode
   * reads the same as 2D ("100%" = default, "200%" = 2× zoom). Returns
   * `1` when no tank has been rendered or when the renderer is detached.
   */
  getZoomFraction(): number {
    const tank = this.lastRenderedTank;
    const c = this.camera;
    const ctl = this.controls;
    if (tank === null || c === null) return 1;
    const initialCam = buildCamera({ ...tank, style: PLACEHOLDER_STYLE }, c.aspect);
    const initialTarget = tankCenter({ ...tank, style: PLACEHOLDER_STYLE });
    const initialDist = initialCam.position.distanceTo(initialTarget);
    const currentTarget = ctl !== null ? ctl.target : initialTarget;
    const currentDist = c.position.distanceTo(currentTarget);
    if (currentDist === 0) return 1;
    return initialDist / currentDist;
  }

  /**
   * Subscribe to camera-state changes. The callback fires after any
   * programmatic orbital-control call (`zoomBy` / `panBy` / `rotateBy` /
   * `resetView`) AND after user mouse / wheel interaction routed through
   * OrbitControls' `'change'` event. Returns an unsubscribe function.
   */
  addChangeListener(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => {
      this.changeListeners.delete(cb);
    };
  }

  private notifyChange(): void {
    for (const cb of this.changeListeners) cb();
  }

  // ─── dispose ──────────────────────────────────────────────────────────

  dispose(): void {
    if (this.rafHandle !== null && this.rafShim !== null) {
      this.rafShim.cancelAnimationFrame(this.rafHandle);
    }
    this.rafHandle = null;
    this.rafShim = null;

    if (this.controlsChangeUnsub !== null) {
      this.controlsChangeUnsub();
      this.controlsChangeUnsub = null;
    }

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
    this.lastRenderedTank = null;
    // changeListeners deliberately retained — subscribers (e.g. the
    // editor-shell's Orbit3DService) outlive a single attach/dispose
    // cycle. The listener set is small + cheap to keep.
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

/**
 * Smallest polar offset from the pole to leave at the rotation extremes.
 * `OrbitControls` uses ~1e-6 internally; ours is a touch larger so a UI
 * button-press stop doesn't sit visually on the singularity (where the
 * camera basis math gets noisy).
 */
const POLAR_EPSILON = 0.01;

/**
 * Clamp `distance` to OrbitControls's `[minDistance, maxDistance]`
 * window. Defensive against non-finite bounds in stub controls used by
 * tests.
 */
function clampDistance(distance: number, ctl: OrbitControls): number {
  const min = Number.isFinite(ctl.minDistance) ? ctl.minDistance : 0;
  const max = Number.isFinite(ctl.maxDistance) ? ctl.maxDistance : Infinity;
  if (distance < min) return min;
  if (distance > max) return max;
  return distance;
}

/**
 * Apply the document → Three.js X-mirror transform to a group: reflect
 * about the tank's X-midplane (`scale.x = -1, position.x = tank.width`).
 * Combined with the camera's `_x = world (-X, 0, +Z)` orientation, this
 * cancels the otherwise-visible left/right flip between 2D and 3D —
 * doc `+X` (right side of tank) lands on screen `+X` (right side of view).
 *
 * Three.js's `WebGLRenderer` detects the negative-determinant world
 * matrix per-mesh and flips `gl.frontFace` accordingly, so triangle
 * winding / culling stays correct without per-material side adjustments.
 */
function applyDocToWorldMirror(group: Object3D, tankWidthMm: number): void {
  group.scale.x = -1;
  group.position.x = tankWidthMm;
}
