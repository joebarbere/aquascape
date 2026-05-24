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
// Imports types from `@aquascape/domain/geometry` and
// `@aquascape/domain/scene-model`. Nothing else. No Angular, NgRx, RxJS,
// Electron, platform-*. DOM types (`HTMLCanvasElement`) come from the
// workspace's `lib.dom` — acceptable here because this is the rendering
// layer's contract; the `framework:none` tag means "no Angular/Electron/
// NgRx", not "no DOM types".
//
// COORDINATE SYSTEM
// -----------------
// There is **one** coordinate space: the right-handed 3D mm space defined
// in `aqua-document.ts` (origin at the tank's front-bottom-left interior
// corner). The 2D renderer projects along −z; the 3D renderer (Stage 10)
// consumes the same numbers. Renderers never invent their own coordinate
// space and never write back to the Scene.

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
   */
  render(scene: Scene, viewport: Viewport): void;

  /**
   * Return the topmost object hit at `point` (canvas CSS pixels) under the
   * given `viewport`, or `null` if the point hit empty space. `viewport`
   * must match the one passed to the most recent `render` call for the
   * result to be consistent with what's on screen.
   */
  hitTest(point: Vec2, scene: Scene, viewport: Viewport): HitResult | null;

  /**
   * Release every resource the renderer attached. After `dispose`, the
   * renderer must be safely garbage-collectable and no listeners may
   * remain on the surface.
   */
  dispose(): void;
}
