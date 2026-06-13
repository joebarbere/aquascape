// Public API for @aquascape/rendering/renderer-api.
//
// Defines the SceneRenderer interface that both renderer-2d (canvas) and
// renderer-3d (Three.js, Stage 10) implement. Plan §2.4 / Stage 0 F0.4.
//
// This lib is types-only — there is zero runtime code. The contract is
// enforced at compile time by `tsc`; the lone spec file pins the shape via
// no-op type assignments.
//
// DEPENDENCY BUDGET
// -----------------
// Imports types from `@aquascape/domain/geometry`, `@aquascape/domain/
// scene-model`, and `@aquascape/domain/catalog`. Nothing else. No Angular,
// NgRx, RxJS, Electron, platform-*. DOM types (`HTMLCanvasElement`) come
// from the workspace's `lib.dom` — acceptable here because this is the
// rendering layer's contract; the `framework:none` tag means "no Angular/
// Electron/NgRx", not "no DOM types".
//
// COORDINATE SYSTEM
// -----------------
// There is **one** coordinate space: the right-handed 3D mm space defined
// in `aqua-document.ts` (origin at the tank's front-bottom-left interior
// corner). The 2D renderer projects along −z; the 3D renderer (Stage 10)
// consumes the same numbers. Renderers never invent their own coordinate
// space and never write back to the Scene.

import type { Catalog } from '@aquascape/domain/catalog';
import type { FlowField } from '@aquascape/domain/fluid-sim';
import type { Vec2 } from '@aquascape/domain/geometry';
import type { LivestockWorld } from '@aquascape/domain/livestock-ecs';
import type { Scene, ObjectId, LayerId } from '@aquascape/domain/scene-model';

/**
 * The drawing surface a renderer paints onto. Owned by the host (web canvas,
 * Electron BrowserWindow, headless export pipeline) and passed to `attach`.
 */
export interface RenderSurface {
  /** The DOM canvas (or canvas-shaped object) the renderer will paint into. */
  canvas: HTMLCanvasElement;
  /** Hi-DPI scale factor (1, 2, 3, …). Drives the backing-store size. */
  devicePixelRatio: number;
  /** Logical width in CSS pixels. */
  width: number;
  /** Logical height in CSS pixels. */
  height: number;
}

/**
 * The world-to-pixel framing for a render. `Scene` is what's in the tank;
 * `Viewport` is how the camera looks at it.
 *
 * - `center` is in world mm (after the 2D projection drops z); it's the
 *   world point that lands at the canvas center.
 * - `zoom` is **pixels per mm** at devicePixelRatio = 1. The renderer
 *   multiplies by DPR internally when sizing the backing store.
 * - `rotation` is radians, positive counter-clockwise in world space.
 *   Stage 0 always passes 0; the field exists so the math stays correct
 *   when later stages add canvas rotation.
 */
export interface Viewport {
  center: Vec2;
  zoom: number;
  rotation: number;
}

/**
 * Result of a hit-test. `objectId` is the topmost object under the point;
 * `layerId` is the layer that contains it. `handle` is set when the hit
 * lands on a selection handle (translate body, rotate ring, scale corner).
 *
 * Stage 0 returns `null` from every `hitTest`. F3.3 lands real hit-testing
 * and selection handles.
 */
export interface HitResult {
  objectId: ObjectId;
  layerId: LayerId;
  handle?: 'rotate' | 'scaleNW' | 'scaleNE' | 'scaleSW' | 'scaleSE' | 'translate';
}

/**
 * Stage 5 F5.3 — view-only composition overlays. Three independent toggles
 * driving a renderer's "guideline" pass.
 *
 * - `goldenRatio` — paint the four φ-derived guide lines (two vertical,
 *   two horizontal) spanning the tank's front-face interior.
 * - `thirds`      — paint the four rule-of-thirds guide lines spanning the
 *   tank's front-face interior.
 * - `focalPoints` — paint the four golden-ratio intersections as small
 *   markers.
 *
 * Overlays are view-only: they are NOT serialised into `Scene` / `.aqua`,
 * they do NOT participate in `hitTest` (they're decoration, not geometry),
 * and they are positioned in the tank's front-face interior plane
 * (`(0, 0)` to `(tank.width, tank.height)` in world mm, same (x, y) plane
 * as the rendered content). When the `render` parameter is omitted, or
 * when every flag is false, the overlay pass MUST be a true no-op (no
 * canvas state change, no save/restore overhead).
 */
export interface OverlayOptions {
  goldenRatio: boolean;
  thirds: boolean;
  focalPoints: boolean;
}

/**
 * Stage 5.x — view-only "room wall" background. A filled rectangle painted
 * BEHIND the tank in world-mm coordinates, so the user can sketch a
 * background colour for the surface their tank is sitting against. The
 * rectangle is centred on the tank's geometric centre and sized
 * independently of the tank itself — `widthMm` × `heightMm` are absolute,
 * not tank-relative, because the room exists in its own space.
 *
 * v1 ships colour-only; gradient / image fills are a follow-up when the
 * "customise the entire room" scope expands. The data is NOT serialised
 * into `Scene` / `.aqua` — it's a per-user UI preference held in
 * `WallBackgroundService` (root-provided in `features/editor-shell`) and
 * persisted under `aquascape.ui.wall.*`.
 *
 * Painted between the grid pass and the tank outline so the wall sits
 * behind the tank glass and substrate, on top of any canvas-level
 * `tank.style.background` fill but below every scene object.
 *
 * No-op when omitted, when `enabled` is `false`, or when either dimension
 * is `≤ 0`.
 */
export interface WallBackground {
  enabled: boolean;
  /** Solid fill colour as a hex string (`#rrggbb` or `#rrggbbaa`). */
  color: string;
  /** Wall width in world millimetres. Centred on the tank's x centre. */
  widthMm: number;
  /** Wall height in world millimetres. Centred on the tank's y centre. */
  heightMm: number;
}

/**
 * Stage 6 F6.3 — view-only "backdrop photo" composited behind the scene.
 *
 * Painted FIRST, after the canvas clear but BEFORE the world transform
 * is applied. The renderer scales `image` to fill the entire backing
 * buffer (cover-fit) and honours `opacity` via `globalAlpha`. The
 * resulting visual reads as a static painting behind the design — the
 * user typically imports a photo of their room / tank's intended
 * placement and overlays the scene to preview composition.
 *
 * View-only for v1: not serialised into `Scene` / `.aqua`. Persistence
 * lives in `BackdropService` (editor-shell) under
 * `aquascape.ui.backdrop.*` as a data URL. Future iterations can promote
 * this to a schema-backed `scene.environment.backdrop` with proper ZIP
 * asset embedding so backdrops follow shared `.aqua` files.
 */
export interface BackdropImage {
  /** Pre-decoded image source the renderer hands to `ctx.drawImage`. */
  image: CanvasImageSource;
  /** Fill opacity in `[0, 1]`. 1 = fully opaque, 0 = invisible. */
  opacity: number;
}

/**
 * Stage 5 F5.3 + F5.4 — ephemeral alignment lines painted during a drag
 * when the dragged object's position snaps to a target (grid, golden /
 * thirds guide, or another object's centre). The renderer draws each
 * vertical line at world x = `xs[i]` spanning the tank's height, and each
 * horizontal line at world y = `ys[i]` spanning the tank's width. Lines
 * are thin, bright, and dash-free so they read as "you're locked here"
 * vs. the dashed composition overlays which read as "reference grid".
 *
 * Non-interactive (not in `hitTest`), never mutates the scene. True no-op
 * when omitted or when both arrays are empty.
 */
export interface SnapGuides {
  readonly xs: ReadonlyArray<number>;
  readonly ys: ReadonlyArray<number>;
}

/**
 * Optional inputs to `SceneRenderer.render`. Refactored from the original
 * positional-argument list (which had grown to 9 args by Stage 6) into a
 * single options bag so call sites read like
 *
 *   renderer.render(scene, viewport, { catalog, selection, overlayOptions })
 *
 * instead of a long line of `undefined, undefined, undefined, opts`.
 *
 * Every field is independently optional. Fields that the renderer treats
 * as "off / no-op when omitted" are documented per-field; combining flags
 * doesn't interact (each pass is independent).
 */
/**
 * Stage 11 F11.7 — day-night cycle lookup values consumed by the 3D
 * renderer's lighting (ambient colour + directional intensity + background
 * tint + plant emissive boost). Computed by the host's `DayNightService`;
 * the shape is declared here (not imported from the feature lib) so the
 * rendering libs stay host-free.
 */
export interface DayNightLookupValues {
  readonly ambientColor: string;
  readonly directionalIntensity: number;
  readonly backgroundTint: string;
  readonly emissiveBoost: number;
}

/**
 * The neutral (full-daylight, no tint) day-night lookup. This is what the
 * renderer applies when no cycle is active — equivalent to the editorial
 * "noon" defaults.
 *
 * **Why this is exported + load-bearing for the flicker fix:** the host
 * must NEVER omit `dayNightLookup` on a 3D render. Omitting it and applying
 * it on alternate frames is what produced the orbit brightness flicker (one
 * frame applies the cycle, the next resets to renderer defaults). The host's
 * `renderCurrent()` passes this constant instead of dropping the field when
 * its `DayNightService` value is unavailable, so every 3D render path drives
 * the *same* single lighting computation rather than flipping between
 * "apply" and "renderer default". See `docs/caveats/renderer-3d.md` →
 * "Lighting is applied once per frame from cached options".
 */
export const NEUTRAL_DAY_NIGHT_LOOKUP: DayNightLookupValues = {
  ambientColor: '#ffffff',
  directionalIntensity: 1,
  backgroundTint: '#ffffff',
  emissiveBoost: 0,
};

export interface RenderOptions {
  /**
   * Catalog the renderer consults for content lookups (substrate colours
   * Stage 2 F2.1; hardscape sprites Stage 3 F3.5; plant silhouettes
   * Stage 4 F4.5). Omit for headless smoke tests + the renderer paints
   * with implementation-defined fallback colours; the production app
   * always passes a catalog.
   */
  readonly catalog?: Catalog;
  /**
   * The currently-selected object ids. Drives the selection-handle pass
   * (corner squares + rotate dot) painted AFTER scene content. Empty /
   * omitted → handles aren't painted.
   */
  readonly selection?: ReadonlyArray<ObjectId>;
  /**
   * F4.4 — overrides every plant's stored `growth.ageWeeks` so the time
   * slider can preview a future age without mutating the document. No
   * effect on hardscape or substrate.
   */
  readonly previewAgeWeeks?: number;
  /**
   * F5.3 — three view-only composition overlay toggles (golden ratio,
   * thirds, focal points). Painted ON TOP of all scene content but
   * BENEATH selection handles. No-op when omitted or every flag false.
   */
  readonly overlayOptions?: OverlayOptions;
  /**
   * Stage 5.x — view-only "room wall" rectangle painted BEHIND the tank
   * in world-mm coords (between the grid and the tank outline). No-op
   * when omitted / disabled / zero-sized.
   */
  readonly wallBackground?: WallBackground;
  /**
   * F5.4 — ephemeral alignment lines painted during a drag when the
   * dragged position has snapped to a target. Painted ON TOP of overlays
   * but BENEATH selection handles. No-op when omitted / both arrays empty.
   */
  readonly snapGuides?: SnapGuides;
  /**
   * F6.3 — pre-decoded photo painted across the full backing buffer,
   * BEFORE the world transform is applied (so it doesn't zoom with the
   * scene). No-op when omitted / opacity ≤ 0.
   */
  readonly backdropImage?: BackdropImage;
  /**
   * Stage 11 F11.1 — bitECS world the 3D renderer steps + draws each
   * RAF tick to render animated livestock. The 2D renderer ignores
   * this field (livestock parity in 2D is deliberately out of scope —
   * 2D is the authoring surface, 3D is the simulation surface).
   *
   * When omitted (or null on the host side), the 3D renderer paints
   * the static scene exactly as Stage 10 did — no fish, no extra
   * draw calls. The renderer caches its `LivestockMeshBundle` on
   * first sight of a world and re-uses it across renders so the six
   * archetype geometries + ShaderMaterial are built once.
   */
  readonly livestockWorld?: LivestockWorld;
  /**
   * Stage 11 F11.7 — day-night cycle lookup. When present, the 3D renderer
   * keys ambient light colour, directional light intensity, scene background
   * tint, and plant emissive boost off these four values per render. The
   * 2D renderer ignores this field (day-night is a 3D-only effect in v1;
   * the 2D authoring surface always paints in flat editorial light).
   *
   * The lookup is computed by the host's `DayNightService`; the type is
   * inlined here (rather than imported from `domain/day-night-service`)
   * so the rendering libs stay free of host-app dependencies. A noon /
   * neutral default applies when omitted.
   *
   * Field semantics — all four are independent (the renderer treats each
   * as a separate write into its cached Three.js handles):
   *
   *  - `ambientColor` — hex `#RRGGBB`. Written into the cached
   *    `AmbientLight.color` every render. Warm at noon, cool at night.
   *  - `directionalIntensity` — `[0, 1]` multiplier on the cached
   *    `DirectionalLight.intensity`. 1.0 at noon, ≈ 0 at midnight.
   *  - `backgroundTint` — hex `#RRGGBB`. Written into
   *    `THREE.Scene.background` every render.
   *  - `emissiveBoost` — `[0, 0.5]`. Written into the plant material's
   *    `uPlantEmissiveBoost` uniform so dark scenes don't go featureless.
   */
  readonly dayNightLookup?: DayNightLookupValues;
  /**
   * Fidelity pass — the baked tank flow field (filter / pump current),
   * already computed by the host's `LivestockSimulationService` for the
   * livestock simulation. When present, the 3D renderer couples plant SWAY
   * to the local current: plants in a filter outflow wave harder + faster;
   * plants in a dead zone barely move. This closes the F11.7 "flow-coupled
   * sway frequency" deferral. The 2D renderer ignores it.
   *
   * The renderer samples flow magnitude at each plant's base ON THE CPU at
   * build time (via `sampleFlowField`) and bakes it into the sway shader's
   * per-instance / uniform amplitude + frequency — no 3D-texture sampler in
   * the shader. Omitted ⇒ the pre-fidelity constant-frequency sway.
   */
  readonly flowField?: FlowField;
  /**
   * Bucket 2 (3D fidelity) — base URL the 3D renderer prepends to each
   * catalog entry's `textures` refs (`CatalogTextureRefs` — optional
   * albedo / normal / roughness PNGs on substrate / hardscape / plant
   * entries) to load photorealistic texture maps. The web host serves the
   * catalog texture pack at `assets/catalog-textures/` and forwards that
   * path here on 3D renders only.
   *
   * The 2D renderer ignores this field. **Omitted ⇒ the procedural-only
   * pre-Bucket-2 render, bit-identical** — the 3D renderer builds no
   * texture resolver and leaves every material's shader source untouched.
   *
   * Texture assets are 256×256 seamlessly-tiling PNGs: albedo (sRGB,
   * moderate contrast, mean luminance ~0.5–0.6 — designed to MODULATE the
   * authored catalog colours, not replace them), normal (tangent-space,
   * linear), roughness (linear).
   */
  readonly catalogTextureBaseUrl?: string;
  /**
   * Decorations — base URL the 3D renderer prepends to each decor catalog
   * entry's `model` ref (a required glTF-binary `.glb` file name on
   * `DecorEntry`) to load the authored showcase model. The web host serves
   * the catalog model pack at `assets/catalog-models/` and forwards that
   * path here on 3D renders only.
   *
   * The 2D renderer ignores this field (decor paints as a silhouette
   * polygon in 2D, same convention as hardscape). **Omitted ⇒ the 3D
   * renderer falls back to the extruded-silhouette placeholder** for every
   * decor object — no network fetch, headless-test-safe; the same fallback
   * covers an individual model that 404s or fails to parse.
   *
   * Model assets are deterministic, procedurally-baked GLBs (geometry +
   * vertex colours + `MeshPhysicalMaterial` PBR parameters via KHR
   * extensions — clearcoat / transmission / ior / iridescence / emissive
   * strength; no embedded images), authored in millimetres, Y-up, origin
   * at bottom-centre, front facing +Z, bounding box exactly the entry's
   * `naturalSize`.
   */
  readonly catalogModelBaseUrl?: string;
  /**
   * Fish-eye view — 3D camera mode. `'orbit'` (default when omitted) is
   * the standard OrbitControls camera. `'fish-eye'` parks the camera at a
   * live fish's eye (the first entity in the livestock world's snapshot),
   * looking along the fish's heading with a wide fisheye-style FOV, and
   * disables OrbitControls while active. When the scene has no livestock
   * (or `livestockWorld` is absent) the renderer keeps the orbit camera —
   * fish-eye degrades gracefully to plain 3D.
   *
   * The 2D renderer ignores this field (there is no camera in 2D).
   */
  readonly cameraMode?: 'orbit' | 'fish-eye';
}

/**
 * Optional inputs to `SceneRenderer.hitTest`. Same refactor rationale as
 * `RenderOptions` — keep the call site readable when only some of the
 * optional inputs are relevant.
 *
 * Note: hit-test consumes a STRICT SUBSET of the render-side options.
 * Decoration-only fields (overlayOptions, wallBackground, snapGuides,
 * backdropImage) are intentionally absent because none of those layers
 * is hit-testable — clicking through an overlay should land on whatever
 * scene content is underneath.
 */
export interface HitTestOptions {
  /** Same as `RenderOptions.catalog`. Falls back to bbox hit-test when omitted. */
  readonly catalog?: Catalog;
  /**
   * Same as `RenderOptions.selection`. When provided, handle hit-test
   * runs FIRST and handle hits BEAT body hits — clicking the corner
   * scale square of a selected object returns `'scaleNE'` even when the
   * body is also under the cursor. Without `selection`, handles aren't
   * hit-tested at all.
   */
  readonly selection?: ReadonlyArray<ObjectId>;
  /**
   * Same as `RenderOptions.previewAgeWeeks`. Hit-test bbox respects the
   * preview age so clicks land where the rendered plant actually is.
   * Scatter patches always hit-test against the brush polygon (preview
   * age doesn't change the polygon footprint).
   */
  readonly previewAgeWeeks?: number;
}

/**
 * The renderer contract. Both `renderer-2d` (now) and `renderer-3d`
 * (Stage 10) implement this. Features depend on this interface, never on a
 * concrete renderer.
 *
 * INVARIANTS
 * ----------
 * - `render(scene, viewport)` is **idempotent** for a given (scene, viewport):
 *   two consecutive calls produce identical canvas state. No hidden internal
 *   state that mutates between calls; no time-based animation; no random data.
 * - `render` **does not mutate** `scene`. A deep-equal of `scene` before and
 *   after render must hold.
 * - `hitTest` is **consistent with render**: if a click at point P "hits"
 *   object X, the pixel under P was visibly part of X (or its handles).
 *   Stale render caches that disagree with `hitTest` are bugs.
 * - `dispose` releases **every** resource attached in `attach` (event
 *   listeners, GL buffers, RAF handles). Tests must verify no leak.
 */
export interface SceneRenderer {
  /**
   * Bind the renderer to a drawing surface. Sizes the canvas's backing
   * store, registers any resize / DPR listeners, and prepares whatever
   * internal state the implementation needs. Idempotent: calling `attach`
   * a second time with a different surface re-binds cleanly.
   */
  attach(surface: RenderSurface): void;

  /**
   * Paint `scene` at the given `viewport`. Must be idempotent (see
   * invariant above) and must not mutate `scene`.
   *
   * All optional inputs (catalog, selection, overlays, etc.) live on the
   * `options` bag. See `RenderOptions` for the per-field semantics +
   * no-op rules; the renderer's paint passes treat each field
   * independently so callers can mix any combination.
   *
   * Call sites should pass the options inline:
   *   renderer.render(scene, viewport, { catalog, selection, overlayOptions });
   *
   * Omitting `options` entirely is equivalent to passing `{}` — every
   * pass falls back to its no-op behaviour.
   */
  render(scene: Scene, viewport: Viewport, options?: RenderOptions): void;

  /**
   * Return the topmost object hit at `point` (canvas CSS pixels) under the
   * given `viewport`, or `null` if the point hit empty space. `viewport`
   * must match the one passed to the most recent `render` call for the
   * result to be consistent with what's on screen.
   *
   * Optional inputs (catalog, selection, previewAgeWeeks) live on the
   * `options` bag. See `HitTestOptions` for per-field semantics —
   * notably that `selection` enables handle hit-testing and that decoration
   * layers (overlays / wall / snap guides / backdrop) are deliberately
   * NOT hit-testable, so a click through them lands on whatever scene
   * content sits underneath.
   */
  hitTest(
    point: Vec2,
    scene: Scene,
    viewport: Viewport,
    options?: HitTestOptions,
  ): HitResult | null;

  /**
   * Release every resource the renderer attached. After `dispose`, the
   * renderer must be safely garbage-collectable and no listeners may
   * remain on the surface.
   */
  dispose(): void;
}
