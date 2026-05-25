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
import type { Vec2 } from '@aquascape/domain/geometry';
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
   * The optional `catalog` parameter is consulted for content lookups
   * (substrate colors as of Stage 2 F2.1; later: hardscape sprites, plant
   * meshes, etc.). When omitted, the renderer paints with implementation-
   * defined fallback colors so tests + headless smoke runs stay simple —
   * the production app always passes a catalog.
   *
   * The optional `previewAgeWeeks` parameter (F4.4) overrides every plant's
   * stored `growth.ageWeeks` so the time slider can preview a future age
   * without mutating the document. Has no effect on hardscape or substrate.
   *
   * The optional `overlayOptions` parameter (F5.3) toggles three view-only
   * composition overlays painted ON TOP of all scene content but BENEATH
   * any selection handles, so selection markers stay readable. Overlays
   * are decoration — they don't appear in `hitTest`, never mutate the
   * scene, and add no canvas work when the parameter is omitted or every
   * flag is false.
   *
   * The optional `wallBackground` parameter (Stage 5.x) paints a filled
   * "room wall" rectangle BEHIND the tank in world-mm coordinates (between
   * the grid and the tank outline). Centred on the tank's geometric
   * centre; `widthMm × heightMm` are absolute. Decoration only — not in
   * `hitTest`, never mutates the scene, true no-op when omitted /
   * disabled / zero-sized.
   *
   * The optional `snapGuides` parameter (Stage 5 F5.4) paints ephemeral
   * alignment lines for the snap targets that are currently engaged. The
   * host updates this every pointermove during a drag; on pointerup or
   * cancel it clears the field and the lines disappear. Painted ON TOP
   * of every scene object but BENEATH selection handles so the user
   * can read both the guide AND the handle. No-op when omitted / empty.
   *
   * NOTE: the positional argument list is at its sensible limit. Any
   * further additions should refactor `render(...)` to an options object.
   */
  render(
    scene: Scene,
    viewport: Viewport,
    catalog?: Catalog,
    selection?: ReadonlyArray<ObjectId>,
    previewAgeWeeks?: number,
    overlayOptions?: OverlayOptions,
    wallBackground?: WallBackground,
    snapGuides?: SnapGuides,
  ): void;

  /**
   * Return the topmost object hit at `point` (canvas CSS pixels) under the
   * given `viewport`, or `null` if the point hit empty space. `viewport`
   * must match the one passed to the most recent `render` call for the
   * result to be consistent with what's on screen.
   *
   * The optional `catalog` parameter is consulted for object silhouettes
   * (hardscape entries carry a per-entry polygon in normalized space). When
   * omitted, the renderer falls back to an axis-aligned-bounding-box test
   * derived from `transform.scale × naturalSize`-defaults — adequate for
   * headless smoke tests but visibly looser than the rendered shape.
   *
   * The optional `selection` parameter enables **handle hit-testing**: when
   * the point lands on a painted selection handle of a currently-selected
   * object, the result's `handle` field is populated (`'translate'`,
   * `'rotate'`, `'scaleNW'`, etc.). Handle hits BEAT body hits — clicking
   * the top-right scale square returns `'scaleNE'` even when the body is
   * under the cursor. Without `selection`, handles aren't hit-tested at all
   * (handles only paint for selected objects, and the renderer doesn't
   * track selection between `render` calls).
   *
   * The optional `previewAgeWeeks` parameter (F4.4) overrides every plant's
   * stored `growth.ageWeeks` for hit-test purposes — so when the time slider
   * is at week 12, clicks land on plants at their week-12 size, matching
   * what's painted. Single-specimen plants only; scatter patches always
   * hit-test against the brush polygon.
   */
  hitTest(
    point: Vec2,
    scene: Scene,
    viewport: Viewport,
    catalog?: Catalog,
    selection?: ReadonlyArray<ObjectId>,
    previewAgeWeeks?: number,
  ): HitResult | null;

  /**
   * Release every resource the renderer attached. After `dispose`, the
   * renderer must be safely garbage-collectable and no listeners may
   * remain on the surface.
   */
  dispose(): void;
}
