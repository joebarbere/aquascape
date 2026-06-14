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
import type { Vec2, Vec3 } from '@aquascape/domain/geometry';
import { SIM_DT, type LivestockWorld, type WorldSnapshot } from '@aquascape/domain/livestock-ecs';
import { effectiveWaterLevelMm } from '@aquascape/domain/scene-model';
import type { Scene } from '@aquascape/domain/scene-model';
import {
  buildLivestockMeshes,
  type LivestockMeshBundle,
} from '@aquascape/rendering/livestock-renderer-3d';
import {
  NEUTRAL_DAY_NIGHT_LOOKUP,
  type CanvasRaycastPoint,
  type DayNightLookupValues,
  type HitResult,
  type HitTestOptions,
  type RaycastTargetPlane,
  type RenderOptions,
  type RenderSurface,
  type SceneRenderer,
  type SimulationInteractionRenderer,
  type SiphonRenderMode,
  type Viewport,
} from '@aquascape/rendering/renderer-api';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Group,
  InstancedMesh,
  Mesh,
  Object3D,
  PCFSoftShadowMap,
  type MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene as ThreeScene,
  Spherical,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type DataTexture,
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
// Fidelity pass (bloom) — postprocessing addons. Same ESM-addon resolution
// story as OrbitControls (tsconfig path-map + ambient shim in the app; a Jest
// stub in this lib + the app). Only constructed behind an `instanceof
// WebGLRenderer` guard, so the headless test stub never touches them.
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
// Bucket 1a (SSAO) — render-target ambient-occlusion pass. GATED behind the
// Bucket-0 capability probe (`getRenderTargetEffectsSupported`): its
// depth/normal MRT passes render a blank canvas under software WebGL
// (SwiftShader), so it is only constructed on a provably hardware-accelerated
// context. Same ESM-addon resolution story as the bloom passes above.
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass';

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

const defaultRendererFactory: RendererFactory = (canvas) => {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  // Fidelity pass — colour management + filmic tone mapping. ACES rolls off
  // the bright water specular + bubble highlights instead of clipping them
  // to flat white, and the sRGB output space makes the catalog colours read
  // as authored (Three.js interprets material colours as sRGB and works in
  // linear space internally). `outputColorSpace` is the modern-Three default
  // but we set it explicitly so a future Three bump can't silently change it.
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  // Soft shadows from the single directional key light (configured in
  // `scene-builder/lighting.ts`).
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  return renderer;
};
import {
  detectRenderTargetEffectsSupport,
  type RenderTargetGlContextLike,
} from './render-target-support';
import { buildBackdropTexture, updateBackdropTint } from './scene-builder/backdrop';
import { buildCamera, tankCenter, FOV_DEGREES } from './scene-builder/camera';
import {
  buildEquipmentLights,
  equipmentLightsTag,
  type EquipmentLightsHandle,
} from './scene-builder/equipment-lights';
import type { CatalogTextureResolver } from './scene-builder/catalog-texture';
import {
  CAUSTIC_MATERIALS_KEY,
  setCausticIntensity,
  updateCausticTime,
} from './scene-builder/caustics';
import { buildDecorMeshes, type DecorModelOptions } from './scene-builder/decor-mesh';
import { buildEnvEquirectTexture, ENV_INTENSITY } from './scene-builder/environment';
import { buildHardscapeMeshes } from './scene-builder/hardscape-mesh';
import { buildLighting } from './scene-builder/lighting';
import {
  buildPlantMeshes,
  updatePlantEmissiveBoost,
  updatePlantSwayTime,
} from './scene-builder/plant-mesh';
import { buildSubstrateMeshes } from './scene-builder/substrate-mesh';
import { buildTankMesh } from './scene-builder/tank-mesh';
import { buildWaterMesh, type WaterMeshHandle } from './scene-builder/water-mesh';
import { buildSiphonTool, type SiphonToolHandle } from './scene-builder/siphon-tool';
import { raycastTankPlane } from './raycast';
import { ModelCache, type ModelLoadFn } from './model-cache';
import { TextureCache } from './texture-cache';

/**
 * Fidelity pass (bloom) — UnrealBloomPass tuning. High threshold so only the
 * brightest pixels (water specular, caustic filaments, bubble + night
 * highlights) bloom; modest strength + radius so it reads as a gentle wet
 * sheen, not a haze.
 */
const BLOOM_STRENGTH = 0.35;
const BLOOM_RADIUS = 0.4;
const BLOOM_THRESHOLD = 0.85;

/**
 * Bucket 1a (SSAO) — tuning, in MILLIMETRES because the scene is mm-scale.
 * `SSAOPass`'s metre-scale defaults (kernelRadius 8, min 0.005, max 0.1) would
 * sample a sub-millimetre neighbourhood in this scene and produce no visible
 * occlusion. These are world-space (view-space) distances:
 * - `KERNEL_RADIUS` — how far around each fragment we look for occluders.
 *   40 mm reads the rock-on-substrate + plant-base + leaf-cluster contacts
 *   without darkening broad open substrate (the plan's starting 18 mm was
 *   nearly invisible on the validation scene — convex rocks + thin plant
 *   cards generate little AO, so the radius has to reach the contact zone).
 * - `MIN_DISTANCE` — depth deltas below this are ignored (self-occlusion /
 *   depth-precision noise). 1 mm.
 * - `MAX_DISTANCE` — depth deltas above this don't occlude (a far wall behind
 *   a near rock shouldn't cast AO onto it). 180 mm.
 * `MIN`/`MAX` are converted to the shader's NORMALISED-depth space at build
 * time (see `setupComposer`); `KERNEL_RADIUS` is view-space mm and used as-is.
 * Tuned on the AMD RX 7600 XT real-GPU validation loop (`tools/demo/
 * validate-3d.mjs`): AO darkens ~2.3 % of pixels (93 % of them darker), all at
 * contacts — substrate is NOT re-crushed to black.
 */
const SSAO_KERNEL_RADIUS_MM = 40;
const SSAO_MIN_DISTANCE_MM = 1;
const SSAO_MAX_DISTANCE_MM = 180;

/**
 * Fish-eye view — wide field of view (degrees) while the camera rides a
 * fish. ~95° reads as the through-a-fish-eye distortion the mode promises
 * without the extreme rectilinear stretching a true 150°+ FOV produces on
 * a perspective camera.
 */
const FISH_EYE_FOV_DEGREES = 95;
/** Eye offset forward of the fish's body centre, as a fraction of body length. */
const FISH_EYE_FORWARD_FRACTION = 0.35;
/** Eye offset above the fish's body centre, as a fraction of body length. */
const FISH_EYE_UP_FRACTION = 0.15;

/**
 * Flicker fix — per-frame easing factor for the caustic strength toward its
 * target. 0.2 reaches ~visually-settled in ~12 frames (≈0.2 s at 60 fps) so a
 * directional-level change fades rather than snaps, with no perceptible lag.
 */
const CAUSTIC_STRENGTH_LERP = 0.2;
/** Below this absolute delta the caustic strength snaps to target (no shimmer). */
const CAUSTIC_STRENGTH_EPSILON = 1e-3;

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
  if (
    typeof g.requestAnimationFrame === 'function' &&
    typeof g.cancelAnimationFrame === 'function'
  ) {
    return {
      requestAnimationFrame: g.requestAnimationFrame.bind(globalThis),
      cancelAnimationFrame: g.cancelAnimationFrame.bind(globalThis),
    };
  }
  return null;
}

export class Three3DRenderer
  implements SceneRenderer, Orbital3DControls, SimulationInteractionRenderer
{
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
   * Stage 11 F11.1 — the bitECS world the RAF loop steps + drains into
   * the InstancedMesh attributes each frame. Set by `render()` from
   * `options.livestockWorld`, cleared on `dispose()`. The world itself
   * is OWNED by the host's `LivestockSimulationService` so it survives
   * a 2D↔3D toggle (which disposes the renderer + bundle but keeps the
   * sim alive).
   */
  private livestockWorld: LivestockWorld | null = null;
  /**
   * Stage 11 F11.1 — cached six-archetype InstancedMesh bundle. Built
   * lazily the first time `render()` sees a `livestockWorld` and reused
   * across renders (the bundle is expensive: six BufferGeometries + a
   * ShaderMaterial). Disposed on `dispose()`.
   *
   * The host renderer rebuilds `currentContent` on every `render()`;
   * the bundle's `Group` is re-added to the new content group each
   * time (it's just an `Object3D` re-parent, not a GPU rebuild).
   */
  private livestockBundle: LivestockMeshBundle | null = null;
  /**
   * Stage 11 F11.7 — cached animated water surface handle. Built lazily on
   * the first `render()` after `attach()` and rebuilt only when the tank
   * dimensions change (mirroring the lighting rig's "tag the last-built
   * dimensions" pattern). The shader is otherwise stable across renders;
   * only `updateTime()` from the RAF tick mutates per-frame state. The
   * mesh is re-parented into each freshly-built content group rather than
   * rebuilt — same caching rationale as the livestock bundle, just smaller
   * GPU cost (single ShaderMaterial + 16×16 plane).
   */
  private waterMesh: WaterMeshHandle | null = null;
  /**
   * Tank-dimensions tag for the last-built water mesh. When the tank
   * changes (resize), the cached water mesh is disposed + rebuilt so the
   * plane stays sized to the new tank footprint.
   */
  private waterMeshTag: string | null = null;
  /**
   * Stage 15 F15.2 — the shared siphon nozzle tool. Built lazily the first
   * time `render()` sees `options.siphonTool === true` and reused across
   * renders (re-parented into each freshly-built content group, NOT rebuilt
   * — same persistent-handle discipline as the water mesh). Null when the
   * tool isn't mounted (the opt-in flag is absent/false ⇒ byte-identical to
   * the pre-Stage-15 render). Driven in place via `setSiphonPosition` /
   * `setSiphonMode` (the `SimulationInteractionRenderer` surface). Disposed
   * on tool-exit (a render WITHOUT the flag) and on renderer `dispose()`.
   */
  private siphonTool: SiphonToolHandle | null = null;
  /**
   * Effective water level (mm above floor) of the last-rendered tank — the
   * `raycastTankPoint` water-plane height. Captured each render alongside
   * `lastRenderedTank` so the raycast can intersect the water surface without
   * re-deriving the selector.
   */
  private lastWaterLevelMm = 0;
  /**
   * Stage 11 F11.7 — handle on the plant group built by `buildPlantMeshes`
   * during the last `render()`. The RAF tick uses it to advance the sway
   * shader's `uTime` uniform without re-traversing the content tree.
   * Re-assigned on every render; cleared on `dispose()`.
   *
   * The plants themselves are rebuilt from scratch every render (their
   * geometries + materials are cheap), so unlike the water mesh or
   * livestock bundle we don't cache them across renders — we just hold
   * a reference to whichever group is currently mounted so the per-
   * frame `uTime` advance has somewhere to land.
   */
  private currentPlantGroup: Group | null = null;
  /**
   * Fidelity pass (caustics) — the flat list of substrate + hardscape
   * materials patched with the animated caustic shader. Re-collected every
   * `render()` from the freshly-built substrate + hardscape groups; the RAF
   * tick advances each one's `uCausticTime`. The materials are owned by their
   * meshes (disposed by `disposeNode`), so this is just a non-owning view —
   * cleared on rebuild + dispose.
   */
  private causticMaterials: MeshStandardMaterial[] = [];
  /**
   * Decor — the LIVE caustic-material array stashed on the decor group's
   * `userData[CAUSTIC_MATERIALS_KEY]`. Held by REFERENCE (not flattened
   * into `causticMaterials`) because GLB loads resolve asynchronously and
   * push freshly-patched materials into this same array AFTER the render
   * that built the group — keeping the reference live means the RAF tick
   * animates late-attached models without waiting for the next `render()`.
   * Re-pointed on every rebuild; reset on dispose.
   */
  private decorCausticMaterials: MeshStandardMaterial[] = [];
  /**
   * Stage 11 F11.7 Wave 3 — cached references to the lighting rig's
   * Ambient + Directional lights. Set in `ensureLightingForTank` after
   * every (re)build of the lighting group; nulled in `dispose()`. The
   * day-night cycle mutates `color` (ambient) + `intensity` (directional)
   * IN PLACE every render so the cycle interpolates smoothly without
   * rebuilding the lighting group per frame (rebuild allocates Three.js
   * objects + light targets; per-frame allocation under a typical 60 fps
   * RAF would shred GC).
   *
   * `baseDirectionalIntensity` captures the rig's authored noon intensity
   * (today: `KEY_INTENSITY = 1.0` in `lighting.ts`) so the multiplier from
   * `DayNightLookup.directionalIntensity` is applied as a fraction-of-noon
   * rather than an absolute. If the lighting builder ever upgrades the
   * key light's intensity, this captured value flows through without a
   * coordinated change here.
   */
  private currentAmbientLight: AmbientLight | null = null;
  private currentDirectionalLight: DirectionalLight | null = null;
  private baseDirectionalIntensity = 1;
  /**
   * Flicker fix — the SINGLE SOURCE OF TRUTH for day-night lighting. The
   * latest lookup latched by `render()` (defaulting to the neutral / noon
   * lookup when the host omits it). The RAF tick applies it ONCE PER FRAME
   * (idempotent, no allocation, no rebuild) so lighting is decoupled from
   * how many event-driven `render()` calls fire during an interaction —
   * which previously let the cycle and the renderer defaults fight
   * frame-to-frame and produced a visible brightness flicker while
   * orbiting. `render()` no longer applies lighting directly; it only
   * updates this cache + the build-time-only writes (plant emissive boost,
   * which lands on the freshly-built plant group, and the equipment-light
   * level). See `docs/caveats/renderer-3d.md` → "Lighting is applied once
   * per frame from cached options".
   */
  private dayNightLookup: DayNightLookupValues = NEUTRAL_DAY_NIGHT_LOOKUP;
  /**
   * Flicker fix — the current (smoothed) caustic-strength FACTOR actually
   * written to the patched materials. Each frame `applyLightingFrame` eases
   * it toward the latched lookup's `directionalIntensity` so a day-night
   * scrub (or the per-render reset when the content group is rebuilt) fades
   * the caustic shimmer in over a few frames instead of snapping. Defaults to
   * 1 (full daylight). The factor multiplies `CAUSTIC_STRENGTH` inside
   * `setCausticIntensity`.
   */
  private causticStrengthCurrent = 1;
  /**
   * The conceptual base of the scene background — also the `setClearColor`
   * value in `attach()` (the gradient backdrop covers the clear colour, but
   * an empty pre-render canvas still reads as "3D scene"). The backdrop's
   * mid-band gradient stop (`scene-builder/backdrop.ts`) is this same
   * `0x1a2030` tone so the default look stays in the pre-fidelity family.
   *
   * The neutral (cycle-off) ambient colour + backdrop tint live in
   * `NEUTRAL_DAY_NIGHT_LOOKUP` (renderer-api): when the host omits
   * `dayNightLookup`, `render()` latches that neutral lookup, so the
   * single-source `applyLightingFrame` resets ambient to white + the
   * backdrop to its untinted gradient via the same path as a live cycle —
   * no separate reset constants required.
   */
  private static readonly DEFAULT_BACKGROUND_COLOR = 0x1a2030;

  /**
   * Fidelity pass — image-based-lighting environment. Built once on
   * `attach()` (only when a real `WebGLRenderer` is present — the PMREM
   * pre-filter needs a GL context), assigned to `threeScene.environment`,
   * and disposed on teardown. `envSourceTexture` is the raw equirect
   * gradient; `envTexture` is its PMREM-filtered product (what materials
   * actually sample). Both need explicit disposal — Three.js leaks GPU
   * textures otherwise.
   */
  private envSourceTexture: DataTexture | null = null;
  private envTexture: Texture | null = null;
  /**
   * Fidelity follow-up (scenic backdrop) — the ONE cached gradient backdrop
   * texture assigned to `threeScene.background`. Built lazily on the first
   * `applyLightingFrame` run (i.e. the first paint); when the
   * effective tint changes, the pixel data is rewritten IN PLACE +
   * `needsUpdate` (a few KB, per render, never per frame) instead of
   * re-allocating. `backdropTint` caches the last-applied tint so an
   * unchanged tint costs one string compare. NOT gated behind
   * `instanceof WebGLRenderer` — `DataTexture` construction needs no GL,
   * so the headless stub path gets the same background object. Disposed in
   * `dispose()` alongside the env textures.
   */
  private backdropTexture: DataTexture | null = null;
  private backdropTint: string | null = null;
  /**
   * Fidelity pass (bloom) — the postprocessing pipeline. Built once on
   * `attach()` (only with a real `WebGLRenderer`); when present, the render
   * loop paints through `composer.render()` instead of `renderer.render()`.
   * RenderPass → a subtle UnrealBloomPass (water specular / caustics / bubble
   * highlights glow) → OutputPass (tone mapping + sRGB). Disposed on teardown;
   * the headless stub leaves all three null and falls back to direct render.
   */
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  /**
   * Bucket 1a (SSAO) — the ambient-occlusion pass, inserted into the composer
   * AFTER the RenderPass beauty + BEFORE bloom, but ONLY when the Bucket-0
   * capability gate (`renderTargetEffectsSupported`) clears. Null under the
   * headless stub, on software WebGL (SwiftShader), before attach, and after
   * dispose — in those cases the composer is the plain RenderPass → bloom →
   * OutputPass chain and the view never blanks. Resized alongside the composer
   * + bloom in `attach()`, disposed in `dispose()`.
   *
   * NOTE on ordering: three 0.184's `SSAOPass` does NOT render its own beauty
   * (older versions did). With `output = Default` it MULTIPLIES the blurred AO
   * onto the read buffer via CustomBlending (`needsSwap = false`), so it must
   * sit downstream of a RenderPass that fills that buffer — it augments, it
   * doesn't replace.
   */
  private ssaoPass: SSAOPass | null = null;
  /**
   * Bucket 2 (catalog textures) — URL-keyed texture cache, created lazily
   * on the first render that supplies `options.catalogTextureBaseUrl` and
   * kept for the renderer's LIFETIME (textures survive content rebuilds —
   * the patched materials hold them via `onBeforeCompile` uniforms, which
   * `disposeNode`'s map-dispose walk never sees). Disposed exactly once,
   * in `dispose()`. See `texture-cache.ts` for the placeholder-upgrade
   * contract that keeps still-loading textures visually neutral.
   */
  private textureCache: TextureCache | null = null;
  /**
   * Decor models — URL-keyed GLB cache, created lazily on the first render
   * that supplies `options.catalogModelBaseUrl` and kept for the renderer's
   * LIFETIME (loaded GLB sources survive content rebuilds; per-render the
   * builders just get fresh containers + clones). Disposed exactly once,
   * in `dispose()`. See `model-cache.ts` for the container / clone /
   * fallback contracts.
   */
  private modelCache: ModelCache | null = null;
  /**
   * Injectable GLB loader forwarded to the lazily-created `ModelCache` —
   * tests pass a fake; production omits it and the cache builds its own
   * `GLTFLoader`-backed default (null under jsdom-less envs → permanent
   * extruded-silhouette fallback, headless-test-safe).
   */
  private readonly loadModel: ModelLoadFn | undefined;
  /**
   * Bucket-0 capability gate — whether render-target / multi-pass effects
   * (SSAO, screen-space refraction) are safe on the attached GL context.
   * Computed in `setupComposer` (real `WebGLRenderer` only) via
   * `detectRenderTargetEffectsSupport`; `false` before attach, under the
   * headless test stub, and after `dispose()`. Read via
   * `getRenderTargetEffectsSupported()`.
   */
  private renderTargetEffectsSupported = false;
  /**
   * Overhead equipment lighting — one SpotLight + fixture mesh per
   * `category: 'light'` equipment entry attached to the scene. Cached +
   * tagged like the lighting rig: rebuilt only when the tank dims or the
   * attached-light set change (`equipmentLightsTag`). `setLevel` is
   * mutated per render from the day-night directional level. Null when
   * the scene has no light equipment.
   */
  private equipmentLights: EquipmentLightsHandle | null = null;
  private equipmentLightsCacheTag: string | null = null;
  /**
   * Fish-eye view — the camera mode requested by the last `render()` call
   * (`RenderOptions.cameraMode`, default `'orbit'`). The RAF tick reads it
   * each frame: while `'fish-eye'` AND a livestock snapshot has at least
   * one fish, the tick parks the camera at fish 0's eye and SKIPS
   * `controls.update()` (OrbitControls would otherwise re-derive the
   * camera from its own spherical state and fight the follow-cam).
   */
  private cameraMode: 'orbit' | 'fish-eye' = 'orbit';
  /**
   * Whether the fish-eye follow-cam drove the camera on the previous
   * tick. Used to detect the enter/exit transitions: enter widens the
   * FOV + disables OrbitControls; exit restores `FOV_DEGREES`, re-enables
   * controls, and re-frames via `resetView()` (the follow-cam left the
   * camera somewhere inside the tank — OrbitControls' internal state
   * must be resynced from a sane pose).
   */
  private fishEyeWasActive = false;

  /**
   * @param rendererFactory injectable WebGLRenderer factory. The default
   * constructs a real `THREE.WebGLRenderer`; tests inject a stub so they
   * don't need a real WebGL context.
   * @param options.loadModel injectable GLB loader for the decor
   * `ModelCache` — tests pass a synchronous fake; production omits it.
   */
  constructor(
    rendererFactory: RendererFactory = defaultRendererFactory,
    options: { loadModel?: ModelLoadFn } = {},
  ) {
    this.rendererFactory = rendererFactory;
    this.loadModel = options.loadModel;
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
    if (this.surface !== null && this.surface.canvas === surface.canvas && this.renderer !== null) {
      this.surface = surface;
      this.renderer.setPixelRatio(surface.devicePixelRatio);
      this.renderer.setSize(surface.width, surface.height, false);
      // Keep the bloom composer's render targets sized to the canvas.
      this.composer?.setSize(surface.width, surface.height);
      this.bloomPass?.setSize(surface.width, surface.height);
      // Bucket 1a (SSAO) — its normal/depth/ssao/blur render targets must
      // track the canvas too (null when gated out).
      this.ssaoPass?.setSize(surface.width, surface.height);
      if (this.camera !== null) {
        const aspect =
          surface.width === 0 || surface.height === 0 ? 1 : surface.width / surface.height;
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
    // the 2D renderer's wall-background default in spirit. The gradient
    // backdrop assigned on the first render covers it; this is just the
    // pre-render fallback.
    renderer.setClearColor?.(Three3DRenderer.DEFAULT_BACKGROUND_COLOR, 1);
    this.renderer = renderer;

    this.threeScene = new ThreeScene();

    // Fidelity pass — build + attach the IBL environment. Guarded on a real
    // `WebGLRenderer` because `PMREMGenerator` needs a GL context; the test
    // stub skips this branch (materials simply render without reflections in
    // the headless unit env, which never paints pixels anyway).
    this.setupEnvironment(renderer, this.threeScene);

    // Camera framed to a placeholder tank; the first `render` call
    // re-frames against the real tank. We DO build a camera here (rather
    // than waiting for the first render) so the animation tick can call
    // `renderer.render(scene, camera)` immediately for OrbitControls
    // damping. The placeholder is a 1 m cube — never seen, just sized.
    const aspect = surface.width === 0 ? 1 : surface.width / surface.height;
    this.camera = buildCamera(
      { width: 1000, height: 1000, depth: 1000, style: PLACEHOLDER_STYLE },
      aspect,
    );

    // OrbitControls binds pointer / wheel listeners to the canvas only;
    // no document-level listeners.
    const controls = new OrbitControls(this.camera, surface.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = ORBIT_DAMPING;
    controls.target.copy(
      tankCenter({ width: 1000, height: 1000, depth: 1000, style: PLACEHOLDER_STYLE }),
    );
    controls.minDistance = 1000 * ORBIT_MIN_DIST_MULT;
    controls.maxDistance = 1000 * ORBIT_MAX_DIST_MULT;
    controls.autoRotate = false;
    this.controls = controls;

    // Forward OrbitControls 'change' (fired on user mouse / wheel input
    // AND on programmatic `update()`) to our listener set so the editor-
    // shell zoom percent + orbit UI can re-read state when the user spins
    // the camera with the mouse. The orbit-controls-stub used in Jest
    // omits `addEventListener`, so guard the binding.
    const addListener = (
      controls as unknown as {
        addEventListener?: (event: string, cb: () => void) => void;
      }
    ).addEventListener;
    const removeListener = (
      controls as unknown as {
        removeEventListener?: (event: string, cb: () => void) => void;
      }
    ).removeEventListener;
    if (typeof addListener === 'function' && typeof removeListener === 'function') {
      const onChange = (): void => this.notifyChange();
      addListener.call(controls, 'change', onChange);
      this.controlsChangeUnsub = () => removeListener.call(controls, 'change', onChange);
    }

    // Built once on attach because tank dimensions affect the key-light
    // position, but the rig itself is otherwise stable across frames.
    // First `render` call re-builds it once we have the real tank.
    this.lighting = null;

    // Fidelity pass (bloom) — build the postprocessing pipeline now that the
    // scene + camera exist. No-op under the headless stub renderer.
    this.setupComposer(renderer, this.threeScene, this.camera, surface);

    // Kick off the animation loop. It only runs OrbitControls' damping
    // tick and `renderer.render`; it does NOT rebuild the scene graph.
    // The scene graph is rebuilt only when `render()` is called.
    this.startAnimationLoop();
  }

  private startAnimationLoop(): void {
    const raf = getRaf();
    this.rafShim = raf;
    if (raf === null) return; // Node env without RAF — attach + dispose still work.

    // Stage 11 F11.1 — fixed-dt accumulator drives the ECS at SIM_DT (30 Hz)
    // independent of the render rate. `dtMs` is clamped to 250 ms so a tab
    // pause doesn't release a torrent of catch-up steps when the user
    // returns; the inner `while` is also capped at 4 steps for the same
    // reason (and the accumulator is dropped entirely if we're still
    // behind after that — better one visible hitch than a spiral).
    let lastTime = performance.now();
    let accumulator = 0;
    const SIM_DT_MS = SIM_DT * 1000;

    const tick = (): void => {
      const r = this.renderer;
      const s = this.threeScene;
      const c = this.camera;
      const ctl = this.controls;
      if (r === null || s === null || c === null) return;

      const now = performance.now();
      const dtMs = Math.min(now - lastTime, 250);
      lastTime = now;

      const world = this.livestockWorld;
      const bundle = this.livestockBundle;
      let snap: WorldSnapshot | null = null;
      if (world !== null && bundle !== null) {
        accumulator += dtMs;
        let steps = 0;
        while (accumulator >= SIM_DT_MS && steps < 4) {
          world.step(SIM_DT);
          accumulator -= SIM_DT_MS;
          steps++;
        }
        if (steps === 4 && accumulator > SIM_DT_MS) {
          // Still behind after the safety cap — drop the residue so we
          // don't spiral on a slow frame.
          accumulator = 0;
        }
        const alpha = accumulator / SIM_DT_MS;
        snap = world.snapshot(alpha);
        bundle.syncFromSnapshot(snap, now / 1000);
      }

      // Fish-eye view — when active, the follow-cam owns the camera this
      // frame and OrbitControls' update must NOT run (it re-derives the
      // camera pose from its own spherical state and would yank the
      // camera back to the orbit). The snapshot is the SAME interpolated
      // one the mesh sync just consumed, so the camera rides the visible
      // fish without a one-frame lag.
      const fishCamDrove = this.applyFishEyeCamera(snap, c);

      // Stage 11 F11.7 — drive the water surface's uTime uniform off the
      // wall clock so the swell + ripple bands animate at their authored
      // frequencies regardless of the sim accumulator. The handle no-ops
      // after dispose so a stale tick after `dispose()` is safe.
      this.waterMesh?.updateTime(now / 1000);

      // Stage 11 F11.7 — same wall-clock tick drives every plant sway
      // material's `uTime` uniform. `updatePlantSwayTime` is a no-op when
      // the group has no sway materials attached (e.g. before the first
      // `render()` or for an empty scene), so the unconditional call is
      // safe. Flow-coupling (fidelity pass + follow-up) is baked into each
      // material's amplitude AND oscillation frequency at BUILD time from
      // `options.flowField` (see `plant-mesh.ts`), so the per-frame tick
      // only advances `uTime` — the flow factor is static per render,
      // which is correct (the field is re-baked when equipment changes,
      // which re-fires a render) and keeps the motion smooth.
      if (this.currentPlantGroup !== null) {
        updatePlantSwayTime(this.currentPlantGroup, now / 1000);
      }

      // Flicker fix — SINGLE-SOURCE the day-night lighting + caustic strength
      // here, once per frame, from the cached lookup latched by render(). This
      // is the load-bearing change: lighting is no longer re-applied per
      // event-driven render() (which interleaved with these RAF paints and let
      // the cycle + renderer defaults fight frame-to-frame). The write is
      // idempotent + allocation-free, and the caustic strength eases toward its
      // target so a directional-level change fades rather than snaps. `s` is
      // the ThreeScene (the background tint write lands on it).
      this.applyLightingFrame(s);

      // Fidelity pass (caustics) — advance the substrate + hardscape caustic
      // shader's time uniform off the same wall clock as the water + sway.
      if (this.causticMaterials.length > 0) {
        updateCausticTime(this.causticMaterials, now / 1000);
      }
      // Decor caustics — the array is LIVE (async GLB loads push patched
      // materials into it after render()), so re-reading it per tick is
      // what makes late-attached models animate without a rebuild.
      if (this.decorCausticMaterials.length > 0) {
        updateCausticTime(this.decorCausticMaterials, now / 1000);
      }

      if (!fishCamDrove) ctl?.update();
      this.paint(r, s, c);
      this.rafHandle = raf.requestAnimationFrame(tick);
    };
    this.rafHandle = raf.requestAnimationFrame(tick);
  }

  /**
   * Resolve which snapshot index the fish-eye camera should follow.
   *
   * Stage 16 F16.1 — when a game mode has marked a player entity
   * (`world.getPlayerEntity() !== NO_ENTITY_REF`), follow THAT fish by
   * finding its eid in `snap.ids`. Otherwise (and as a fallback when the
   * player isn't in the current snapshot) follow index 0 — the pre-F16.1
   * behaviour. This is the minimal retarget: the camera math below is
   * unchanged; only WHICH index it reads moves.
   */
  private fishEyeFollowIndex(snap: WorldSnapshot): number {
    const world = this.livestockWorld;
    if (world === null) return 0;
    const playerEid = world.getPlayerEntity();
    // NO_ENTITY_REF (0xffffffff) = no player marked → follow fish 0.
    if (playerEid === 0xffffffff) return 0;
    for (let i = 0; i < snap.entityCount; i++) {
      if (snap.ids[i] === playerEid) return i;
    }
    // Player marked but not in this snapshot (e.g. mid-respawn) → fish 0.
    return 0;
  }

  /**
   * Fish-eye view — park the camera at the followed fish's eye, looking
   * along the fish's heading. Follows the game player entity when one is
   * marked (Stage 16 F16.1), else fish 0. Returns `true` when the follow-cam
   * drove the camera this frame (the tick then skips `controls.update()`).
   *
   * Geometry: the snapshot's positions/orientations are in DOCUMENT
   * coordinates, but the content group is rendered through the doc→world
   * X-mirror (`applyDocToWorldMirror`). The camera lives OUTSIDE that
   * mirrored group, so the fish's doc position/heading must be mirrored
   * manually: `worldX = tank.width − docX`, and the heading's X component
   * negates. The fish's nose direction in doc space is the orientation
   * quaternion applied to `(-1, 0, 0)` — the same convention the
   * steering integrator drives (see `rotateOrientationToward` in
   * `livestock-ecs`).
   *
   * Graceful degradation: with no snapshot / no fish, the orbit camera
   * stays in charge (controls re-enabled) — fish-eye over an empty tank
   * is just plain 3D.
   */
  private applyFishEyeCamera(snap: WorldSnapshot | null, camera: PerspectiveCamera): boolean {
    const tank = this.lastRenderedTank;
    const active =
      this.cameraMode === 'fish-eye' && snap !== null && snap.entityCount > 0 && tank !== null;

    if (!active) {
      if (this.fishEyeWasActive) {
        // Exit transition — restore the editorial FOV, hand the camera
        // back to OrbitControls, and re-frame to the default 3/4 view
        // (the follow-cam left the camera inside the tank; OrbitControls'
        // spherical state must be resynced from a sane pose).
        this.fishEyeWasActive = false;
        camera.fov = FOV_DEGREES;
        camera.updateProjectionMatrix();
        if (this.controls !== null) this.controls.enabled = true;
        this.resetView();
      }
      return false;
    }

    if (!this.fishEyeWasActive) {
      // Enter transition — widen the FOV, freeze OrbitControls input.
      this.fishEyeWasActive = true;
      camera.fov = FISH_EYE_FOV_DEGREES;
      camera.updateProjectionMatrix();
      if (this.controls !== null) this.controls.enabled = false;
    }

    // Follow the game player entity when one is marked (Stage 16 F16.1),
    // else fish 0 — the snapshot's first entity. Spawn order is
    // deterministic (document order), so the followed fish is stable for a
    // given scene + player.
    const f = this.fishEyeFollowIndex(snap);
    const px = snap.position[f * 3 + 0] as number;
    const py = snap.position[f * 3 + 1] as number;
    const pz = snap.position[f * 3 + 2] as number;
    const qx = snap.orientation[f * 4 + 0] as number;
    const qy = snap.orientation[f * 4 + 1] as number;
    const qz = snap.orientation[f * 4 + 2] as number;
    const qw = snap.orientation[f * 4 + 3] as number;
    const bodyLen = (snap.scale[f] as number) || 30;

    // Doc-space nose direction = quaternion · (-1, 0, 0).
    const fx = -(1 - 2 * (qy * qy + qz * qz));
    const fy = -(2 * (qz * qw + qx * qy));
    const fz = -(2 * (qx * qz - qy * qw));

    // Doc → world mirror (X only).
    const wx = tank.width - px;
    const wfx = -fx;

    const ex = wx + wfx * bodyLen * FISH_EYE_FORWARD_FRACTION;
    const ey = py + bodyLen * FISH_EYE_UP_FRACTION + fy * bodyLen * FISH_EYE_FORWARD_FRACTION;
    const ez = pz + fz * bodyLen * FISH_EYE_FORWARD_FRACTION;
    camera.position.set(ex, ey, ez);
    camera.lookAt(ex + wfx * 100, ey + fy * 100, ez + fz * 100);
    return true;
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

    // 2x) Overhead equipment lights — rebuilt only when the tank dims or
    //     the attached-light set change; per-render the day-night level
    //     scales spot intensity + fixture glow in place (no rebuild).
    this.ensureEquipmentLights(scene, catalog, tScene);
    // Equipment-light level is driven once per frame in `applyLightingFrame`
    // (single-source the day-night-derived lighting), not here.

    // Fish-eye view — record the requested camera mode for the RAF tick.
    // The tick owns the actual camera writes (it has the interpolated
    // snapshot); render() just latches the request.
    this.cameraMode = options.cameraMode ?? 'orbit';

    // 2a) Stage 11 F11.7 Wave 3 / flicker fix — day-night cycle. render() no
    //     longer applies lighting directly; it LATCHES the lookup (defaulting
    //     to the neutral / noon lookup when the host omits it — see the field
    //     doc + `NEUTRAL_DAY_NIGHT_LOOKUP`) so the RAF tick is the single
    //     writer of ambient colour + directional intensity + background tint +
    //     caustic strength, applied once per frame. This decouples lighting
    //     from the cadence of event-driven renders and kills the orbit
    //     flicker. The synchronous paint at the end of render() still gets a
    //     correct frame because we call `applyLightingFrame` right before it.
    this.dayNightLookup = options.dayNightLookup ?? NEUTRAL_DAY_NIGHT_LOOKUP;

    // 3) Rebuild content group from scratch. Cheap (~ms) for typical
    //    scenes and keeps idempotency trivial — same input, same graph.
    if (this.currentContent !== null) {
      tScene.remove(this.currentContent);
      // Stage 11 F11.1 — the livestock bundle's Group is reused across
      // renders (its GPU resources cost too much to rebuild). Detach it
      // BEFORE `disposeNode` walks the content tree, otherwise the
      // bundle's geometries + ShaderMaterial would be disposed on every
      // re-render. The bundle's own `dispose()` runs on renderer
      // teardown via the dedicated path below.
      if (this.livestockBundle !== null) {
        this.currentContent.remove(this.livestockBundle.group);
      }
      // Stage 11 F11.7 — same detach-before-dispose dance as the livestock
      // bundle. The water mesh is cached on the renderer and re-parented
      // into the new content group below; if we let `disposeNode` walk
      // through it, the shared geometry + ShaderMaterial would be GPU-
      // disposed every render.
      if (this.waterMesh !== null) {
        this.currentContent.remove(this.waterMesh.mesh);
      }
      // Stage 15 F15.2 — same detach-before-dispose dance: the siphon tool
      // is cached + re-parented, so don't let `disposeNode` release its
      // geometry/material on a content rebuild.
      if (this.siphonTool !== null) {
        this.currentContent.remove(this.siphonTool.group);
      }
      disposeNode(this.currentContent);
      this.currentContent = null;
      // Stage 11 F11.7 — the plant group's materials were just disposed
      // by `disposeNode` above. Clear the handle so the RAF tick doesn't
      // poke `uTime` on torn-down uniforms before the new group is built
      // a few lines down. Reassigned below.
      this.currentPlantGroup = null;
      // Fidelity pass (caustics) — same reasoning: the substrate + hardscape
      // materials were just disposed; drop the non-owning view. Reassigned
      // when the new substrate + hardscape groups are built below.
      this.causticMaterials = [];
      // Decor — same: the decor group's materials were just disposed; drop
      // the live-array reference. Re-pointed at the new group's array below.
      this.decorCausticMaterials = [];
    }
    const content = new Object3D();
    content.name = 'aquascape:content';
    content.add(buildTankMesh(scene.tank));
    // Bucket 2 — when the host supplies a texture base URL, hand the
    // builders a cache-backed resolver so catalog `textures` refs become
    // live (placeholder-first) THREE.Textures. Absent ⇒ undefined ⇒ the
    // builders skip the patch and the shaders stay byte-identical to the
    // pre-Bucket-2 render (the opt-in contract on `RenderOptions`).
    const resolveTexture = this.buildTextureResolver(options.catalogTextureBaseUrl);
    const substrateGroup = buildSubstrateMeshes(scene, catalog, resolveTexture);
    const hardscapeGroup = buildHardscapeMeshes(scene, catalog, resolveTexture);
    content.add(substrateGroup);
    content.add(hardscapeGroup);
    // Fidelity pass (caustics) — collect the patched substrate + hardscape
    // materials so the RAF tick can advance their animation. Seed their
    // strength from the CURRENT smoothed factor (not the raw target) so a
    // content rebuild mid-fade doesn't pop the freshly-built materials to the
    // target value — the tick continues easing all of them in lockstep from
    // here. (Flicker fix: the tick is the single writer of caustic strength.)
    this.causticMaterials = [
      ...((substrateGroup.userData[CAUSTIC_MATERIALS_KEY] as MeshStandardMaterial[] | undefined) ??
        []),
      ...((hardscapeGroup.userData[CAUSTIC_MATERIALS_KEY] as MeshStandardMaterial[] | undefined) ??
        []),
    ];
    setCausticIntensity(this.causticMaterials, this.causticStrengthCurrent);
    // Decor — classic ornaments (treasure chest, galleon, skull…). GLB
    // models when the host supplied `catalogModelBaseUrl` (loaded through
    // the renderer-lifetime ModelCache, attach-in-place on arrival),
    // extruded-silhouette fallbacks otherwise. The group's caustic-material
    // array is held by LIVE reference so async GLB loads that resolve
    // between renders still animate (see the field doc).
    const decorGroup = buildDecorMeshes(
      scene,
      catalog,
      this.buildDecorModelOptions(options.catalogModelBaseUrl),
    );
    content.add(decorGroup);
    this.decorCausticMaterials =
      (decorGroup.userData[CAUSTIC_MATERIALS_KEY] as MeshStandardMaterial[] | undefined) ?? [];
    // Seed decor caustics from the current smoothed factor too (see above).
    setCausticIntensity(this.decorCausticMaterials, this.causticStrengthCurrent);
    // Stage 11 F11.7 — retain a handle on the plant group so the RAF tick
    // can drive its sway materials' `uTime` uniform. The group itself is
    // rebuilt + GPU-disposed every render (no caching), but we always
    // re-point this handle at the latest group so per-frame ticks land.
    const plantGroup = buildPlantMeshes(
      scene,
      catalog,
      previewAgeWeeks,
      options.flowField,
      resolveTexture,
    );
    this.currentPlantGroup = plantGroup;
    content.add(plantGroup);
    // Stage 11 F11.7 Wave 3 — write the day-night `emissiveBoost` into the
    // freshly-built plant group's sway-material uniforms. Driven off the
    // LATCHED lookup (neutral = 0 boost) so it tracks the same single source
    // as the rest of the lighting. Per-render is sufficient — the boost lerps
    // with the cycle phase, not per-frame — and keeping it here (rather than
    // every RAF tick) keeps the per-frame tick cheap; the plant group is
    // rebuilt every render anyway, so a fresh group always gets a correct
    // boost before its first paint.
    updatePlantEmissiveBoost(plantGroup, this.dayNightLookup.emissiveBoost);

    // Stage 11 F11.7 — animated water surface. Always present in 3D
    // (no opt-in flag in v1). Cached against the tank's WxHxD tag — same
    // dimensions reuse the existing handle, a tank resize disposes +
    // rebuilds. The mesh's `renderOrder = 1` keeps it in the transparent
    // pass AFTER opaque content; `depthWrite: false` means fish + plants
    // below are still visible through it.
    this.ensureWaterMeshForTank(scene);
    if (this.waterMesh !== null) {
      content.add(this.waterMesh.mesh);
      // Fidelity follow-up (water caustics) — the surface caustic shimmer
      // tracks the same smoothed day-night caustic factor as the substrate +
      // hardscape caustics. Seed from the current smoothed value here; the RAF
      // tick (`applyLightingFrame`) is the single writer that eases it toward
      // the target, so the water's bright rim shimmer fades in lockstep.
      this.waterMesh.setCausticStrength(this.causticStrengthCurrent);
    }

    // Stage 15 F15.2 — the shared siphon nozzle. Opt-in: built (once) +
    // re-parented into the content group only when the host requests it.
    // Absent/false ⇒ no nozzle (byte-identical to pre-Stage-15). The handle
    // is cached + driven in place (setSiphonPosition / setSiphonMode); it is
    // re-parented here like the water mesh, never disposed on a rebuild.
    this.ensureSiphonTool(options.siphonTool === true);
    if (this.siphonTool !== null) {
      content.add(this.siphonTool.group);
    }

    // Stage 11 F11.1 — livestock InstancedMesh bundle. The world is owned
    // by the host (apps/web's `LivestockSimulationService`); the renderer
    // just reads it each frame in the RAF loop and parents the bundle's
    // Group into the rebuilt content tree. Bundle is cached: building
    // six BufferGeometries + a ShaderMaterial is expensive, but re-
    // parenting an existing `Group` is just an `Object3D` move. The
    // X-mirror applied below mirrors the bundle along with the rest of
    // the content so fish read left/right-correct without per-instance
    // adjustment.
    this.livestockWorld = options.livestockWorld ?? null;
    if (this.livestockWorld !== null) {
      if (this.livestockBundle === null) {
        this.livestockBundle = buildLivestockMeshes({});
      }
      content.add(this.livestockBundle.group);
    }

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
    // Stage 15 — capture the water-plane height for `raycastTankPoint`'s
    // `'water'` mode (the floor plane is y = 0).
    this.lastWaterLevelMm = effectiveWaterLevelMm(scene.tank);

    // 4) Apply the latched lighting once synchronously, then paint one frame
    //    so render() has a visible effect even when no animation tick is
    //    running (Node tests, headless smoke). The RAF tick re-applies
    //    lighting every frame after this — idempotent, so the two paths agree.
    this.applyLightingFrame(tScene);
    const c = this.camera;
    if (c !== null) this.paint(r, tScene, c);
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

    // Stage 11 F11.7 Wave 3 — cache the Ambient + Directional refs so the
    // day-night cycle can mutate `color` + `intensity` in place per render
    // (no rebuild). `buildLighting` returns a Group with one of each plus
    // the directional light's `target` child; find them by `isXLight` so
    // we don't depend on child order.
    let ambient: AmbientLight | null = null;
    let directional: DirectionalLight | null = null;
    rig.traverse((node) => {
      if ((node as AmbientLight).isAmbientLight) {
        ambient = node as AmbientLight;
      } else if ((node as DirectionalLight).isDirectionalLight) {
        directional = node as DirectionalLight;
      }
    });
    this.currentAmbientLight = ambient;
    this.currentDirectionalLight = directional;
    this.baseDirectionalIntensity =
      directional !== null ? (directional as DirectionalLight).intensity : 1;
  }

  /**
   * Lazily build / rebuild the overhead equipment-lights group. Tagged by
   * tank dims + the ordered attached-light refs (`equipmentLightsTag`) —
   * same caching policy as the lighting rig. Mirrored with the content
   * (`applyDocToWorldMirror`) so the left-to-right fixture order matches
   * the equipment list's document order on screen.
   */
  private ensureEquipmentLights(
    scene: Scene,
    catalog: Catalog | undefined,
    tScene: ThreeScene,
  ): void {
    const tag = equipmentLightsTag(scene);
    if (this.equipmentLightsCacheTag === tag) return;
    if (this.equipmentLights !== null) {
      tScene.remove(this.equipmentLights.group);
      this.equipmentLights.dispose();
      this.equipmentLights = null;
    }
    const handle = buildEquipmentLights(scene, catalog);
    if (handle !== null) {
      applyDocToWorldMirror(handle.group, scene.tank.width);
      tScene.add(handle.group);
      this.equipmentLights = handle;
    }
    this.equipmentLightsCacheTag = tag;
  }

  /**
   * **Flicker fix — the single source of truth for day-night lighting.**
   * Applies the cached `this.dayNightLookup` to the cached lights + scene
   * background + every caustic-strength consumer, ONCE PER FRAME from the RAF
   * tick (and once synchronously at the end of `render()` for the no-RAF
   * path). Idempotent + allocation-free in the steady state: a Color.set +
   * an intensity float write + an in-place backdrop-tint rewrite (only when
   * the tint actually changed) + the caustic-strength ease.
   *
   * Why one writer: previously `render()` applied lighting directly, but the
   * RAF tick painted continuously in between event-driven renders. When the
   * host dropped `dayNightLookup` on some interaction frames (or a content
   * rebuild reset caustic strength), the cycle values and the renderer
   * defaults alternated frame-to-frame and the user saw a brightness flicker
   * while orbiting. Now `render()` only LATCHES the lookup; this method —
   * called every frame — is the sole writer, so the result is stable
   * regardless of how many renders fire during an interaction.
   *
   * The background is the cached gradient backdrop texture (tinted by
   * `backgroundTint`). The caustic strength EASES toward
   * `causticStrengthTarget` (the directional intensity) so a day-night scrub
   * or a content-rebuild reset fades in over a few frames rather than
   * snapping; once within `CAUSTIC_STRENGTH_EPSILON` it locks to the target
   * (no perpetual shimmer / wasted writes).
   *
   * Note on directional COLOUR: the sun is white in v1. The cycle's
   * warm/cool tint rides on the ambient channel alone (adding the sun to the
   * gradient table would double-count the temperature shift). If a future
   * cycle stage wants a coloured sun, this is the wiring spot.
   */
  private applyLightingFrame(tScene: ThreeScene): void {
    const lookup = this.dayNightLookup;
    const directional = lookup.directionalIntensity;
    // Direct (non-eased) lighting writes — ambient colour, directional key
    // intensity, background tint, and the overhead equipment-light level.
    // These are the day-night cycle's "this is the light right now" values;
    // they're written straight from the latched lookup so a scrub tracks the
    // slider exactly. The flicker came from these being applied on SOME
    // frames and reset on others, not from snapping per se — single-sourcing
    // them here (one writer, every frame) is the fix.
    if (this.currentAmbientLight !== null) {
      this.currentAmbientLight.color.set(lookup.ambientColor);
    }
    if (this.currentDirectionalLight !== null) {
      this.currentDirectionalLight.intensity = this.baseDirectionalIntensity * directional;
    }
    this.applyBackdropTint(lookup.backgroundTint, tScene);
    this.equipmentLights?.setLevel(directional);

    // Caustic strength — the ONE value that eases (the plan's step 3). It
    // tracks `directional` as its target but lerps toward it so a day-night
    // scrub (or the per-render reset when the content group is rebuilt and
    // freshly-patched materials re-seed) fades the dancing-light shimmer in
    // over a few frames instead of snapping. Once within epsilon it locks to
    // the target so there's no perpetual sub-visible churn.
    if (Math.abs(this.causticStrengthCurrent - directional) <= CAUSTIC_STRENGTH_EPSILON) {
      this.causticStrengthCurrent = directional;
    } else {
      this.causticStrengthCurrent +=
        (directional - this.causticStrengthCurrent) * CAUSTIC_STRENGTH_LERP;
    }
    const factor = this.causticStrengthCurrent;
    if (this.causticMaterials.length > 0) setCausticIntensity(this.causticMaterials, factor);
    if (this.decorCausticMaterials.length > 0)
      setCausticIntensity(this.decorCausticMaterials, factor);
    this.waterMesh?.setCausticStrength(factor);
  }

  /**
   * Fidelity follow-up (scenic backdrop) — ensure `threeScene.background`
   * is the cached gradient backdrop texture, tinted by `tint`. One texture
   * for the renderer's lifetime: the first call builds it; subsequent
   * calls with a CHANGED tint rewrite its pixel data in place (`updateBackdropTint`
   * — a few KB + `needsUpdate`). Called every frame from `applyLightingFrame`,
   * but the `backdropTint !== tint` guard means the rewrite still only fires
   * when the tint actually changes (a day-night scrub) — an unchanged tint
   * costs one string compare per frame. Pure function of the latched lookup,
   * so idempotency holds.
   *
   * Deliberately NOT behind the `instanceof WebGLRenderer` guard: a
   * `DataTexture` needs no GL context, so the headless unit-stub path gets
   * the same backdrop object the real renderer paints.
   */
  private applyBackdropTint(tint: string, tScene: ThreeScene): void {
    if (this.backdropTexture === null) {
      this.backdropTexture = buildBackdropTexture(tint);
      this.backdropTint = tint;
    } else if (this.backdropTint !== tint) {
      updateBackdropTint(this.backdropTexture, tint);
      this.backdropTint = tint;
    }
    if (tScene.background !== this.backdropTexture) {
      tScene.background = this.backdropTexture;
    }
  }

  /**
   * Bucket 2 — build the catalog-texture resolver for this render, or
   * `undefined` when the host didn't supply a base URL (the opt-in
   * contract). Lazily creates the renderer-lifetime `TextureCache` on
   * first use. The resolver is a pure function of `(baseUrl, ref, kind)`
   * over an idempotent cache, so repeated renders with the same options
   * produce identical patched-shader sources — idempotency holds; the
   * async placeholder→image upgrade is monotonic, matching how the IBL
   * environment fills in.
   */
  private buildTextureResolver(baseUrl: string | undefined): CatalogTextureResolver | undefined {
    if (baseUrl === undefined) return undefined;
    if (this.textureCache === null) {
      this.textureCache = new TextureCache();
    }
    const cache = this.textureCache;
    return (ref, kind) => cache.get(baseUrl + ref, kind);
  }

  /**
   * Decor models — build the `DecorModelOptions` for this render, or
   * `undefined` when the host didn't supply a base URL (the opt-in
   * contract: absent ⇒ extruded-silhouette fallback, no network, no
   * GLTFLoader construction — headless-test-safe). Lazily creates the
   * renderer-lifetime `ModelCache` on first use, forwarding the
   * constructor-injected loader so tests drive loads with a fake.
   */
  private buildDecorModelOptions(baseUrl: string | undefined): DecorModelOptions | undefined {
    if (baseUrl === undefined) return undefined;
    if (this.modelCache === null) {
      this.modelCache = new ModelCache(this.loadModel);
    }
    return { cache: this.modelCache, baseUrl };
  }

  /**
   * Stage 11 F11.7 — lazily build / rebuild the animated water surface.
   * Same caching policy as the lighting rig: tag the last-built tank's
   * WxHxD, reuse on match, dispose + rebuild on a tank resize. The
   * shader uniforms are otherwise stable across renders — only the RAF
   * tick's `updateTime()` writes per-frame state.
   */
  private ensureWaterMeshForTank(scene: Scene): void {
    // The tag includes the authored waterTint (baked into `uBaseColor` at
    // build time) AND the effective water level (the plane's Y) — an edit
    // to either must dispose + rebuild exactly like a tank resize.
    const tag =
      `${scene.tank.width}x${scene.tank.height}x${scene.tank.depth}` +
      `:${scene.tank.style.waterTint ?? 'default'}` +
      `:${effectiveWaterLevelMm(scene.tank)}`;
    if (this.waterMesh !== null && this.waterMeshTag === tag) return;
    if (this.waterMesh !== null) {
      this.waterMesh.dispose();
      this.waterMesh = null;
    }
    this.waterMesh = buildWaterMesh(scene);
    this.waterMeshTag = tag;
  }

  /**
   * Stage 15 F15.2 — mount / unmount the shared siphon nozzle tool based on
   * the opt-in `RenderOptions.siphonTool` flag. Mounting builds the handle
   * ONCE (cached, re-parented per render — not rebuilt). Unmounting (a render
   * without the flag) disposes the handle so the tool's geometry/material are
   * released on tool-exit, matching the "absent ⇒ byte-identical" contract.
   * The handle's `group` is re-parented into the freshly-built content group
   * by the caller after this returns.
   */
  private ensureSiphonTool(wanted: boolean): void {
    if (wanted) {
      if (this.siphonTool === null) {
        this.siphonTool = buildSiphonTool();
      }
      return;
    }
    if (this.siphonTool !== null) {
      // Detach from the (about-to-be-replaced) content group is handled by
      // the rebuild path; here we just release + drop the handle so a render
      // without the flag leaves no nozzle behind.
      if (this.currentContent !== null) this.currentContent.remove(this.siphonTool.group);
      this.siphonTool.dispose();
      this.siphonTool = null;
    }
  }

  // ─── simulation-interaction surface (Stage 15) ────────────────────────

  /**
   * Stage 15 F15.1 — canvas → tank raycast. Casts a ray from the LIVE active
   * camera (orbit or fish-eye — the renderer holds one `PerspectiveCamera`
   * either way) through the canvas pixel and returns the canonical tank
   * coordinate where it meets the floor (default) or water plane. The doc↔world
   * X-mirror is undone in `raycastTankPlane` so the result is in `.aqua` space.
   * Returns `null` when detached / un-rendered / un-sized / the ray misses.
   */
  raycastTankPoint(
    point: CanvasRaycastPoint,
    options: { plane?: RaycastTargetPlane; clamp?: boolean } = {},
  ): Vec3 | null {
    const camera = this.camera;
    const tank = this.lastRenderedTank;
    if (camera === null || tank === null) return null;
    // The camera's world matrices must be current for unprojection. The RAF
    // tick keeps them fresh, but a host call between frames (or the no-RAF
    // test path) may not have — refresh defensively (cheap, idempotent).
    camera.updateMatrixWorld();
    return raycastTankPlane(
      camera,
      point,
      {
        width: tank.width,
        depth: tank.depth,
        floorY: 0,
        waterY: this.lastWaterLevelMm,
      },
      options,
    );
  }

  /**
   * Stage 15 F15.2 — move the shared siphon nozzle to a canonical tank
   * position (mm). No-op when the tool isn't mounted (`siphonTool` flag falsy)
   * or the renderer is detached. The nozzle lives inside the mirrored content
   * group, so the doc position is set directly — the parent mirror flips X.
   */
  setSiphonPosition(pos: Vec3): void {
    this.siphonTool?.setPosition(pos);
  }

  /**
   * Stage 15 F15.2 — toggle the siphon nozzle's OUT/IN/idle visual state.
   * No-op when the tool isn't mounted or the renderer is detached.
   */
  setSiphonMode(mode: SiphonRenderMode): void {
    this.siphonTool?.setMode(mode);
  }

  /**
   * Fidelity pass — build the PMREM-filtered IBL environment and attach it
   * to the scene. No-op unless `renderer` is a real `WebGLRenderer`
   * (`PMREMGenerator` needs a GL context; the headless unit-test stub skips
   * this). Idempotent: if an environment already exists it's left in place.
   *
   * The PMREM pre-filter is deterministic given the fixed gradient source,
   * so this does NOT threaten the renderer's idempotency contract.
   */
  private setupEnvironment(renderer: RendererLike, tScene: ThreeScene): void {
    if (!(renderer instanceof WebGLRenderer)) return;
    if (this.envTexture !== null) {
      tScene.environment = this.envTexture;
      return;
    }
    const source = buildEnvEquirectTexture();
    const pmrem = new PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const target = pmrem.fromEquirectangular(source);
    pmrem.dispose();
    this.envSourceTexture = source;
    this.envTexture = target.texture;
    tScene.environment = this.envTexture;
    // Scale the IBL contribution globally so it fills shading + supplies
    // reflections without flattening the directional key's shadows.
    (tScene as ThreeScene & { environmentIntensity: number }).environmentIntensity = ENV_INTENSITY;
  }

  /**
   * Fidelity pass (bloom) — build the EffectComposer pipeline. No-op unless
   * `renderer` is a real `WebGLRenderer`. The UnrealBloomPass is tuned low
   * (high threshold, modest strength) so only genuinely bright pixels — the
   * water-surface specular, caustic filaments, bubble + day-night highlights —
   * bleed, rather than hazing the whole image. OutputPass applies the tone
   * mapping + sRGB conversion as the final step.
   */
  private setupComposer(
    renderer: RendererLike,
    tScene: ThreeScene,
    camera: PerspectiveCamera,
    surface: RenderSurface,
  ): void {
    if (!(renderer instanceof WebGLRenderer)) return;
    // Bucket-0 capability gate — probe the real GL context once per init.
    // Bloom below stays UNGATED (single-target, SwiftShader-validated);
    // this flag exists for the FUTURE render-target passes. See
    // `getRenderTargetEffectsSupported` for the contract.
    this.renderTargetEffectsSupported = detectRenderTargetEffectsSupport(
      renderer.getContext() as RenderTargetGlContextLike,
    );
    if (this.composer !== null) return;
    const w = Math.max(1, surface.width);
    const h = Math.max(1, surface.height);
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(surface.devicePixelRatio);
    composer.setSize(w, h);
    composer.addPass(new RenderPass(tScene, camera));
    // Bucket 1a (SSAO) — only on a provably hardware-accelerated context.
    // `SSAOPass` augments the RenderPass beauty (multiplies AO onto the read
    // buffer); on software WebGL its depth/normal MRT passes blank the canvas,
    // so the gate keeps it out of the SwiftShader e2e + headless paths. When
    // gated out the chain is the unchanged, SwiftShader-safe RenderPass →
    // bloom → OutputPass.
    if (this.renderTargetEffectsSupported) {
      const ssao = new SSAOPass(tScene, camera, w, h);
      // `kernelRadius` is a view-space distance (mm) — the sample point is
      // `viewPosition + sampleVector * kernelRadius`, both in mm. Set directly.
      ssao.kernelRadius = SSAO_KERNEL_RADIUS_MM;
      // `minDistance` / `maxDistance` are NORMALISED orthographic-depth deltas
      // in [0, 1] (the SSAO shader's `delta = sampleDepth − realDepth`, both
      // run through `viewZToOrthographicDepth`), NOT view-space mm — that's why
      // three's defaults are 0.005 / 0.1. Convert our mm intent to normalised
      // by dividing by the camera's near→far span (the placeholder camera's far
      // is fixed for the renderer's lifetime, so this is stable).
      const depthSpanMm = Math.max(1, camera.far - camera.near);
      ssao.minDistance = SSAO_MIN_DISTANCE_MM / depthSpanMm;
      ssao.maxDistance = SSAO_MAX_DISTANCE_MM / depthSpanMm;
      ssao.output = SSAOPass.OUTPUT.Default;
      composer.addPass(ssao);
      this.ssaoPass = ssao;
    }
    const bloom = new UnrealBloomPass(
      new Vector2(w, h),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloomPass = bloom;
  }

  /**
   * **The Bucket-0 render-target capability gate.** Returns whether
   * render-target / multi-pass post-processing effects are safe on the
   * attached GL context — i.e. the context is provably hardware-
   * accelerated (not SwiftShader / llvmpipe / softpipe) AND depth
   * textures are available. Returns `false` before `attach()`, under
   * the headless stub renderer, and after `dispose()`.
   *
   * **Contract: when SSAO / screen-space-refraction / any other
   * extra-render-target pass is added to the composer, its construction
   * MUST be conditional on this flag**, falling back to the plain
   * RenderPass → bloom → OutputPass path when it returns `false`. The
   * SSAO attempt that ignored this rendered a fully blank canvas under
   * SwiftShader (the path the e2e + headless visual loop run on) — see
   * `docs/caveats/e2e.md` and `docs/caveats/renderer-3d.md` →
   * "Render-target capability gate". Bloom stays UNGATED: it is
   * single-target and validated working under SwiftShader.
   */
  getRenderTargetEffectsSupported(): boolean {
    return this.renderTargetEffectsSupported;
  }

  /**
   * Paint one frame. Routes through the bloom composer when present, else a
   * direct `renderer.render`. Centralised so the RAF tick + the synchronous
   * paint in `render()` share one path (and the headless stub still counts a
   * `renderer.render` call for its assertions).
   */
  private paint(r: RendererLike, tScene: ThreeScene, camera: PerspectiveCamera): void {
    if (this.composer !== null) {
      this.composer.render();
    } else {
      r.render(tScene, camera);
    }
  }

  // ─── hitTest ──────────────────────────────────────────────────────────

  /**
   * Read-only contract for v1: returns `null` for every input. The 3D
   * renderer does not participate in the editor's pick/drag pipeline;
   * 3D is purely a viewer.
   */
  hitTest(
    _point: Vec2,
    _scene: Scene,
    _viewport: Viewport,
    _options?: HitTestOptions,
  ): HitResult | null {
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
      // Detach the livestock bundle BEFORE `disposeNode` walks the tree
      // so the bundle's geometries + ShaderMaterial aren't disposed
      // twice (here AND in `livestockBundle.dispose()` below). The
      // bundle's own dispose call handles its GPU resources.
      if (this.livestockBundle !== null) {
        this.currentContent.remove(this.livestockBundle.group);
      }
      // Stage 11 F11.7 — same dance for the water surface: dedicated
      // dispose path below handles its GPU resources.
      if (this.waterMesh !== null) {
        this.currentContent.remove(this.waterMesh.mesh);
      }
      // Stage 15 F15.2 — detach the siphon tool before the dispose walk; its
      // dedicated dispose below releases its GPU resources exactly once.
      if (this.siphonTool !== null) {
        this.currentContent.remove(this.siphonTool.group);
      }
      disposeNode(this.currentContent);
      this.currentContent = null;
    }
    // Stage 11 F11.7 — drop the plant-group handle so a stale tick after
    // `dispose()` doesn't reach into a torn-down content tree. The actual
    // geometries + materials were disposed by `disposeNode` above; this is
    // just our reference.
    this.currentPlantGroup = null;
    // Fidelity pass (caustics) — drop the non-owning material view (the
    // materials themselves were disposed by `disposeNode` above).
    this.causticMaterials = [];
    // Decor — drop the live caustic-array reference too.
    this.decorCausticMaterials = [];

    // Stage 11 F11.1 — release the GPU resources behind the livestock
    // bundle. The world itself is owned by the host (it survives a
    // 2D↔3D toggle); we just drop our reference here. Idempotent:
    // `bundle.dispose()` no-ops on a second call.
    if (this.livestockBundle !== null) {
      this.livestockBundle.dispose();
      this.livestockBundle = null;
    }
    this.livestockWorld = null;

    // Stage 11 F11.7 — release the water surface's geometry + ShaderMaterial.
    // Idempotent at the handle level; clearing the cache + tag here keeps
    // a subsequent `attach() + render()` rebuilding from scratch.
    if (this.waterMesh !== null) {
      this.waterMesh.dispose();
      this.waterMesh = null;
    }
    this.waterMeshTag = null;

    // Stage 15 F15.2 — release the siphon nozzle's geometry + materials.
    // Already detached from the content tree above; idempotent at the handle
    // level. Clearing it here keeps a subsequent attach() + render(siphonTool)
    // rebuilding from scratch.
    if (this.siphonTool !== null) {
      this.siphonTool.dispose();
      this.siphonTool = null;
    }
    this.lastWaterLevelMm = 0;

    if (this.lighting !== null) {
      if (this.threeScene !== null) this.threeScene.remove(this.lighting);
      disposeNode(this.lighting);
      this.lighting = null;
    }
    // Overhead equipment lights — release spots + fixture meshes, clear
    // the cache tag so a re-attach rebuilds from scratch.
    if (this.equipmentLights !== null) {
      if (this.threeScene !== null) this.threeScene.remove(this.equipmentLights.group);
      this.equipmentLights.dispose();
      this.equipmentLights = null;
    }
    this.equipmentLightsCacheTag = null;
    // Fish-eye view — reset the follow-cam latch so a re-attach starts in
    // orbit mode (the camera itself is rebuilt on attach anyway).
    this.cameraMode = 'orbit';
    this.fishEyeWasActive = false;
    // Stage 11 F11.7 Wave 3 — drop cached light refs so a stale
    // `applyLightingFrame` after dispose can't reach into disposed
    // resources. Reassigned next time `ensureLightingForTank` runs.
    this.currentAmbientLight = null;
    this.currentDirectionalLight = null;
    this.baseDirectionalIntensity = 1;
    // Flicker fix — reset the latched lookup + caustic-strength easing so a
    // fresh attach starts from neutral daylight (no carried-over tint /
    // half-faded caustics from the previous session).
    this.dayNightLookup = NEUTRAL_DAY_NIGHT_LOOKUP;
    this.causticStrengthCurrent = 1;

    // Fidelity follow-up (scenic backdrop) — release the cached backdrop
    // texture. Detach from the scene first so nothing samples a disposed
    // texture during teardown.
    if (this.threeScene !== null) this.threeScene.background = null;
    if (this.backdropTexture !== null) {
      this.backdropTexture.dispose();
      this.backdropTexture = null;
    }
    this.backdropTint = null;

    // Fidelity pass — release the IBL environment textures (PMREM product +
    // raw equirect source). Detach from the scene first so nothing samples
    // a disposed texture during teardown.
    if (this.threeScene !== null) this.threeScene.environment = null;
    if (this.envTexture !== null) {
      this.envTexture.dispose();
      this.envTexture = null;
    }
    if (this.envSourceTexture !== null) {
      this.envSourceTexture.dispose();
      this.envSourceTexture = null;
    }

    // Fidelity pass (bloom) — release the composer's render targets + passes.
    if (this.composer !== null) {
      this.composer.dispose();
      this.composer = null;
    }
    if (this.bloomPass !== null) {
      this.bloomPass.dispose();
      this.bloomPass = null;
    }
    // Bucket 1a (SSAO) — release its four render targets + four materials.
    if (this.ssaoPass !== null) {
      this.ssaoPass.dispose();
      this.ssaoPass = null;
    }
    // Bucket-0 gate — back to the pre-attach default; the next real
    // `setupComposer` run re-probes the (possibly different) context.
    this.renderTargetEffectsSupported = false;

    // Bucket 2 — release every cached catalog texture. The patched
    // materials referencing them were disposed by `disposeNode` above;
    // the textures themselves are owned HERE (uniform references are
    // invisible to the disposeNode walk by design).
    if (this.textureCache !== null) {
      this.textureCache.dispose();
      this.textureCache = null;
    }

    // Decor models — release every geometry + material the cache created
    // (loaded GLB sources + per-clone material clones). Clones living in
    // the content tree were already disposed by `disposeNode` above; the
    // cache's dispose is the backstop for the off-tree sources and any
    // late-resolved clones (double-dispose is harmless — Three.js
    // `.dispose()` is idempotent).
    if (this.modelCache !== null) {
      this.modelCache.dispose();
      this.modelCache = null;
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
