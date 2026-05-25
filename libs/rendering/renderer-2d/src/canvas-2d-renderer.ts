// Canvas 2D implementation of `SceneRenderer`. Plan §2.4 / Stage 0 F0.4.
//
// SCOPE — STAGE 0 + F1.2 PHASE C
// ------------------------------
// Paints tank styling + outline + millimetre grid. F1.2 Phase C added
// `Tank.style` rendering: background (color / gradient / none / image-as-
// none-stub), water tint overlay, and frame overlays (rimless / framed /
// braced). Object rendering (substrate fills, hardscape sprites, plant
// clusters) is deferred to later stages:
//   - F2.x will add substrate region rendering here.
//   - F3.x will add hardscape rendering + selection handles here.
//   - F4.x will add plant rendering (grown according to growth-sim).
// `hitTest` is a permanent `null` for now; F3.3 lands real hit-testing.
//
// IDEMPOTENCY
// -----------
// `render(scene, viewport)` is byte-identical across consecutive calls with
// the same arguments. There is no time-based animation, no random data, no
// hidden internal state that mutates between calls.
//
// IMMUTABILITY
// ------------
// `render` does not mutate `scene`. The renderer takes a read-only view.
//
// COORDINATE SYSTEM
// -----------------
// World mm, origin at the tank front-bottom-left interior corner. World +y
// is UP. Canvas pixel +y is DOWN. The y-flip happens **once** in the
// world-to-pixel transform — the renderer never mutates the world data to
// "convert" it into canvas space. There is one coordinate space; the 3D
// renderer (Stage 10) consumes the same numbers.

import type {
  Catalog,
  HardscapeEntry,
  PlantEntry,
  SubstrateEntry,
} from '@aquascape/domain/catalog';
import {
  focalPoints,
  goldenRatioLines,
  pointInPolygon,
  project2D,
  sampleCatmullRom,
  seededHash01,
  thirdsLines,
} from '@aquascape/domain/geometry';
import type { Transform, Vec2 } from '@aquascape/domain/geometry';
import { plantScale, scatterInPolygon } from '@aquascape/domain/growth-sim';
import type {
  CatalogRef,
  HardscapeObject,
  LayerId,
  ObjectId,
  PlantObject,
  Scene,
  SceneObject,
  SubstrateRegion,
  TankStyle,
} from '@aquascape/domain/scene-model';
import type {
  BackdropImage,
  HitResult,
  HitTestOptions,
  OverlayOptions,
  RenderOptions,
  RenderSurface,
  SceneRenderer,
  SnapGuides,
  Viewport,
  WallBackground,
} from '@aquascape/rendering/renderer-api';

// ─── Tuning constants ─────────────────────────────────────────────────────

/** Grid pitch in mm for the faint minor lines. */
const GRID_MINOR_MM = 10;
/** Grid pitch in mm for the stronger major lines. */
const GRID_MAJOR_MM = 50;
/** Tank outline stroke color. */
const TANK_STROKE = '#222';
/** Grid minor line color (rgba with low alpha). */
const GRID_MINOR_STROKE = 'rgba(0, 0, 0, 0.06)';
/** Grid major line color (rgba with slightly higher alpha). */
const GRID_MAJOR_STROKE = 'rgba(0, 0, 0, 0.12)';

// ─── F1.2 Phase C — tank-styling tuning constants ────────────────────────

/**
 * Canvas fill used when `style.background.kind === 'none'` (and currently
 * for `'image'`, which is a TODO until F6.3). A neutral near-white so the
 * tank outline + grid are legible without committing to a brand color.
 */
const DEFAULT_BACKGROUND_FILL = '#fafafa';

/**
 * Water tint is rendered as a flat fill across the tank interior with this
 * global alpha. We deliberately ignore any alpha channel already in the hex
 * — the tint should look sensible regardless of whether the user picked
 * `#88ccff` or `#88ccff40`. `save` / `restore` around the assignment.
 */
const WATER_TINT_ALPHA = 0.25;

/** World-mm thickness of the top/bottom rim band on framed & braced tanks. */
const FRAME_RIM_MM = 8;
/** World-mm width of the centre brace bar on braced tanks. */
const FRAME_BRACE_WIDTH_MM = 10;
/** Frame fill color when `style.frameColor` is undefined. */
const DEFAULT_FRAME_COLOR = '#222';

// ─── F5.3 — composition overlay tuning constants ──────────────────────────

/** Stroke color for golden-ratio guide lines (soft gold, low alpha). */
const OVERLAY_GOLDEN_STROKE = 'rgba(255, 215, 0, 0.45)';
/** Stroke color for rule-of-thirds guide lines (white, low alpha). */
const OVERLAY_THIRDS_STROKE = 'rgba(255, 255, 255, 0.45)';
/** Fill color for golden-ratio focal-point markers (gold, mostly opaque). */
const OVERLAY_FOCAL_FILL = 'rgba(255, 215, 0, 0.85)';
/** Guide-line dash pattern in CSS px — short on, short off. */
const OVERLAY_DASH_CSS_PX = 4;
/** Guide-line stroke width in CSS px. */
const OVERLAY_LINE_WIDTH_CSS_PX = 1;
/** Focal-point marker radius in CSS px. */
const OVERLAY_FOCAL_RADIUS_CSS_PX = 4;

// ─── F5.4 — snap-guide tuning constants ──────────────────────────────────

/** Stroke color for engaged snap alignment lines (vivid magenta, bright). */
const SNAP_GUIDE_STROKE = 'rgba(255, 64, 192, 0.95)';
/** Snap-guide stroke width in CSS px — slightly heavier than overlay lines. */
const SNAP_GUIDE_LINE_WIDTH_CSS_PX = 1.5;

// ─── Internal types ───────────────────────────────────────────────────────

/**
 * Minimal `window`-shape we use, declared narrowly so we never touch
 * `window` directly and can run in Node-without-DOM environments.
 */
interface WindowLike {
  addEventListener(type: 'resize', listener: () => void, options?: { passive?: boolean }): void;
  removeEventListener(type: 'resize', listener: () => void): void;
  matchMedia?: (q: string) => MediaQueryList | null;
}

/**
 * Find a window-like object without crashing under SSR / Node tests. We
 * deliberately avoid `globalThis.window` typing collisions by declaring
 * exactly the surface we touch.
 */
function getWindowLike(): WindowLike | null {
  const g = globalThis as unknown as { window?: WindowLike };
  return g.window ?? null;
}

// ─── Canvas2DRenderer ─────────────────────────────────────────────────────

export class Canvas2DRenderer implements SceneRenderer {
  /** The surface bound by `attach`, or null when detached / disposed. */
  private surface: RenderSurface | null = null;

  /** The 2D drawing context for `surface.canvas`, cached on attach. */
  private ctx: CanvasRenderingContext2D | null = null;

  /** Listeners we registered on `window`, kept for `dispose`. */
  private resizeListener: (() => void) | null = null;
  private dprMql: MediaQueryList | null = null;
  private dprListener: (() => void) | null = null;

  // ─── attach ─────────────────────────────────────────────────────────────

  attach(surface: RenderSurface): void {
    // If we were already attached, clean up first so attach is idempotent.
    if (this.surface !== null) {
      this.dispose();
    }

    this.surface = surface;
    const ctx = surface.canvas.getContext('2d');
    if (ctx === null) {
      // Can't recover. Leave the renderer in a detached state and surface
      // the failure to the caller; this lets tests and host code react.
      this.surface = null;
      throw new Error('Canvas2DRenderer.attach: getContext("2d") returned null');
    }
    this.ctx = ctx;

    this.syncCanvasSize();

    // Register listeners through whatever `window`-like global is
    // available. Under Node-only test envs there is no window, and we
    // silently skip — host apps that care about resize/DPR responses must
    // be running in a DOM context anyway.
    const w = getWindowLike();
    if (w !== null) {
      const resizeListener = (): void => {
        this.syncCanvasSize();
      };
      w.addEventListener('resize', resizeListener, { passive: true });
      this.resizeListener = resizeListener;

      // DPR change listener — fires when the user drags the window from a
      // Retina display to a non-Retina one, or vice versa. Modern Electron
      // and all evergreen browsers support `addEventListener` on
      // MediaQueryList; we don't carry an old-Safari `addListener` fallback.
      if (typeof w.matchMedia === 'function') {
        const mql = w.matchMedia(`(resolution: ${surface.devicePixelRatio}dppx)`);
        if (mql !== null) {
          const dprListener = (): void => {
            this.syncCanvasSize();
          };
          mql.addEventListener('change', dprListener);
          this.dprMql = mql;
          this.dprListener = dprListener;
        }
      }
    }
  }

  /**
   * Size the canvas's backing store for the current DPR. Called from
   * `attach` and from the resize / DPR listeners. Idempotent.
   *
   * Stage 5.x: we deliberately do NOT write `canvas.style.width/height`
   * here. The host's stylesheet (`apps/web/src/app/app.component.ts`'s
   * `.scene-canvas { width: 100%; height: 100%; }`) drives the CSS box
   * size from the layout. If we wrote inline pixel sizes we'd freeze the
   * canvas at whatever interim dimensions it had on the first `attach`
   * call — before async-hydrated sidebar/rail widths and recovery-banner
   * layout settled — and the ResizeObserver would then read back our own
   * frozen value forever, leaving a tall canvas-host with a short canvas
   * painted only across its top. The renderer's job is the backing
   * buffer; the layout's job is the box.
   */
  private syncCanvasSize(): void {
    const s = this.surface;
    if (s === null) return;
    const dpr = s.devicePixelRatio;
    const targetW = Math.round(s.width * dpr);
    const targetH = Math.round(s.height * dpr);
    if (s.canvas.width !== targetW) s.canvas.width = targetW;
    if (s.canvas.height !== targetH) s.canvas.height = targetH;
  }

  // ─── render ─────────────────────────────────────────────────────────────

  render(scene: Scene, viewport: Viewport, options: RenderOptions = {}): void {
    const {
      catalog,
      selection,
      previewAgeWeeks,
      overlayOptions,
      wallBackground,
      snapGuides,
      backdropImage,
    } = options;
    const s = this.surface;
    const ctx = this.ctx;
    if (s === null || ctx === null) return;

    const dpr = s.devicePixelRatio;
    const backingW = s.canvas.width;
    const backingH = s.canvas.height;

    // 1) Clear the full backing store under the identity transform. The
    //    area outside the tank rect stays transparent so the page (host
    //    element) background — which follows the theme — shows through.
    //    The tank's `style.background` is painted INSIDE the tank under
    //    the world transform a few lines below.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, backingW, backingH);

    // 1.5) Backdrop image (F6.3). Painted in CSS-pixel space (NO world
    //      transform applied) so it stretches to fill the full backing
    //      buffer regardless of zoom / pan. Every world-space layer
    //      below paints on top of it. No-op when omitted or opacity 0.
    this.drawBackdrop(ctx, backingW, backingH, backdropImage);

    // 2) Build the world-to-pixel transform.
    //
    //   p_px = T(cx,cy) · R(-θ) · S(zoom·dpr, -(zoom·dpr)) · T(-center) · p_world
    //
    // The negative y-scale flips world +y up into canvas +y down. The `-θ`
    // makes positive viewport.rotation a CCW rotation in WORLD space
    // (because the y-flip would otherwise reverse the visual rotation).
    // For Stage 0, viewport.rotation = 0 and the rotation term vanishes.
    const scaleWorldToPx = viewport.zoom * dpr;
    const cxPx = backingW / 2;
    const cyPx = backingH / 2;

    ctx.setTransform(1, 0, 0, 1, cxPx, cyPx);
    if (viewport.rotation !== 0) {
      ctx.rotate(-viewport.rotation);
    }
    ctx.scale(scaleWorldToPx, -scaleWorldToPx);
    ctx.translate(-viewport.center.x, -viewport.center.y);

    // 3) Now we draw in world-mm. A 1-CSS-pixel stroke is 1/zoom mm wide
    //    in world units. We pick line widths in that frame so strokes are
    //    consistent across DPR and zoom.
    const oneCssPxInMm = 1 / viewport.zoom;

    // Tank dimensions, projected via the canonical projection. project2D
    // drops z; the 2D outline IS the front face of the tank — exactly
    // what the renderer needs to paint. We pass the tank's two extreme
    // corners through project2D so a future projection change is picked
    // up here without code edits.
    const tankCorner0 = project2D({ x: 0, y: 0, z: 0 });
    const tankCornerW = project2D({
      x: scene.tank.width,
      y: scene.tank.height,
      z: 0,
    });

    // Stage 5.x — view-only "room wall" background. Painted FIRST in world
    // space (right after the clear) so the tank's own style.background fill
    // and the tank outline cover the wall where the tank sits, and the wall
    // is visible only in the area outside the tank's silhouette — i.e.
    // exactly how a real wall reads through the front-view projection.
    // No-op when omitted / disabled / zero-sized.
    this.drawWallBackground(ctx, scene, wallBackground);

    // Tank-style background: painted INSIDE the tank rect (clipped to the
    // tank outline) so the tank reads as a centered card on the host page
    // background, rather than the background absorbing the whole canvas.
    // Runs before the grid so grid lines paint on top.
    this.drawBackground(ctx, tankCorner0, tankCornerW, scene.tank.style);
    this.drawGrid(ctx, tankCorner0, tankCornerW, oneCssPxInMm);
    this.drawTank(ctx, tankCorner0, tankCornerW, oneCssPxInMm);
    // F2.3 — substrate sits between the tank outline and the water tint so
    // the tint visibly shades the substrate fill. Drawn under the same
    // world transform as the tank outline.
    this.drawSubstrate(ctx, scene, catalog);
    this.drawWaterTint(ctx, tankCorner0, tankCornerW, scene.tank.style);
    this.drawFrame(ctx, tankCorner0, tankCornerW, scene.tank.style);

    // F3.3 — paint hardscape silhouettes back-to-front (layers low→high,
    // objects within a layer low→high). F4.4 — plants over hardscape.
    // Selection handles render LAST so they sit visually on top of every
    // object, even when selecting a back-layer item.
    const selectedSet = selection !== undefined && selection.length > 0 ? new Set(selection) : null;
    this.drawHardscape(ctx, scene, catalog, oneCssPxInMm);
    this.drawPlants(ctx, scene, catalog, oneCssPxInMm, previewAgeWeeks, scene.seed);
    // F5.3 — composition overlays paint AFTER plants but BEFORE selection
    // handles, so handles always sit on top and stay readable when the user
    // turns guides on.
    this.drawCompositionOverlays(ctx, scene, oneCssPxInMm, overlayOptions);
    // F5.4 — ephemeral snap-alignment guides paint AFTER the overlays but
    // BEFORE selection handles so the user can read both the "you're
    // locked here" line and the corner handles at the same time.
    this.drawSnapGuides(ctx, scene, oneCssPxInMm, snapGuides);
    if (selectedSet !== null) {
      this.drawSelectionHandles(ctx, scene, catalog, oneCssPxInMm, selectedSet);
    }
  }

  // ─── F1.2 Phase C — tank-styling helpers ──────────────────────────────

  /**
   * Paint the tank's `style.background` INSIDE the tank rect. Runs under
   * the world transform (world-mm coords).
   *
   * Background variants:
   *   - `'none'`     — flat `DEFAULT_BACKGROUND_FILL` inside the tank.
   *   - `'color'`    — flat `background.color` inside the tank.
   *   - `'gradient'` — linear gradient spanning the TANK rect at `angle`
   *     radians. The angle is interpreted in WORLD space (+y up). World
   *     space is already +y up under the current ctx transform (the world
   *     transform has a negative y-scale), so we use +cos / +sin without
   *     the canvas-frame y-flip the previous canvas-wide variant needed.
   *   - `'image'`    — TODO(F6.3): treated as `'none'` for now. The async
   *     image-cache rearch that F6.3 will deliver lives here.
   *
   * The area OUTSIDE the tank rect stays transparent so the host's page
   * background (theme-driven) shows through — the tank reads as a centered
   * "card" rather than absorbing the whole canvas.
   */
  private drawBackground(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, style: TankStyle): void {
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const w = x1 - x0;
    const h = y1 - y0;
    const bg = style.background;
    if (bg.kind === 'none' || bg.kind === 'image') {
      // TODO(F6.3): for `'image'`, load and draw asset via async image cache.
      ctx.fillStyle = DEFAULT_BACKGROUND_FILL;
      ctx.fillRect(x0, y0, w, h);
      return;
    }
    if (bg.kind === 'color') {
      ctx.fillStyle = bg.color;
      ctx.fillRect(x0, y0, w, h);
      return;
    }
    // Gradient. Endpoints span the TANK along the angle direction. Pick
    // the tank centre and project the tank's half-diagonal onto the unit
    // vector `(cos a, sin a)` (world +y up). Half-extent = sum of the
    // axis half-extents projected onto the angle, so the endpoints sit on
    // (or just past) the tank rectangle and stops at 0 / 1 reach the
    // glass edges.
    const ux = Math.cos(bg.angle);
    const uy = Math.sin(bg.angle);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const half = (w * Math.abs(ux) + h * Math.abs(uy)) / 2;
    const gx0 = cx - ux * half;
    const gy0 = cy - uy * half;
    const gx1 = cx + ux * half;
    const gy1 = cy + uy * half;
    const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    for (const stop of bg.stops) {
      grad.addColorStop(stop.at, stop.color);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, w, h);
  }

  /**
   * Paint the water tint as a semi-transparent fill inside the projected
   * tank rectangle. Runs in world-mm (the world transform is already set).
   * Uses `globalAlpha = WATER_TINT_ALPHA` regardless of any alpha in the
   * user-supplied hex so the tint stays visually sensible.
   */
  private drawWaterTint(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, style: TankStyle): void {
    if (style.waterTint === undefined) return;
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.save();
    ctx.globalAlpha = WATER_TINT_ALPHA;
    ctx.fillStyle = style.waterTint;
    ctx.fillRect(x0, y0, w, h);
    ctx.restore();
  }

  /**
   * Paint the frame overlay (rims / brace) ON TOP of the water tint and
   * tank outline. World-mm space, so all dimensions are in mm.
   *
   * Frame variants:
   *   - `'rimless'` — no overlay; the thin tank outline IS the look.
   *   - `'framed'`  — top & bottom rim bands of `FRAME_RIM_MM` mm thickness.
   *   - `'braced'`  — `'framed'` PLUS a vertical center brace of
   *     `FRAME_BRACE_WIDTH_MM` mm width running between the rims.
   */
  private drawFrame(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, style: TankStyle): void {
    if (style.frame === 'rimless') return;
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const w = x1 - x0;
    const color = style.frameColor ?? DEFAULT_FRAME_COLOR;

    ctx.fillStyle = color;
    // Bottom rim — y0 is the floor in world-mm coords.
    ctx.fillRect(x0, y0, w, FRAME_RIM_MM);
    // Top rim — sits BELOW y1 by FRAME_RIM_MM so it stays inside the tank.
    ctx.fillRect(x0, y1 - FRAME_RIM_MM, w, FRAME_RIM_MM);

    if (style.frame === 'braced') {
      const cx = (x0 + x1) / 2;
      const bx = cx - FRAME_BRACE_WIDTH_MM / 2;
      // Brace spans from inner edge of bottom rim to inner edge of top rim.
      const by = y0 + FRAME_RIM_MM;
      const bh = y1 - y0 - 2 * FRAME_RIM_MM;
      ctx.fillRect(bx, by, FRAME_BRACE_WIDTH_MM, bh);
    }
  }

  /**
   * Draw the mm grid clipped to the tank interior. Minor lines every
   * GRID_MINOR_MM mm; major lines every GRID_MAJOR_MM mm (drawn on a
   * separate pass with a slightly darker color so they're distinguishable
   * without overlapping a minor line).
   *
   * We use one path per pass for performance and so the stroke count
   * stays a function of the line count (one stroke per axis per pass).
   */
  private drawGrid(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, oneCssPxInMm: number): void {
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);

    // Clip to tank interior so the grid never paints outside the outline.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();

    // Minor pass — every GRID_MINOR_MM, but skip multiples of GRID_MAJOR_MM
    // so major lines don't have a minor line painted on top.
    ctx.lineWidth = oneCssPxInMm;
    ctx.strokeStyle = GRID_MINOR_STROKE;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / GRID_MINOR_MM) * GRID_MINOR_MM; x <= x1; x += GRID_MINOR_MM) {
      if (x % GRID_MAJOR_MM === 0) continue;
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = Math.ceil(y0 / GRID_MINOR_MM) * GRID_MINOR_MM; y <= y1; y += GRID_MINOR_MM) {
      if (y % GRID_MAJOR_MM === 0) continue;
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();

    // Major pass — every GRID_MAJOR_MM.
    ctx.strokeStyle = GRID_MAJOR_STROKE;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / GRID_MAJOR_MM) * GRID_MAJOR_MM; x <= x1; x += GRID_MAJOR_MM) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = Math.ceil(y0 / GRID_MAJOR_MM) * GRID_MAJOR_MM; y <= y1; y += GRID_MAJOR_MM) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Draw the tank outline as a rectangle in world-mm space.
   *
   * We use `strokeRect` (a single call) rather than a beginPath/rect/stroke
   * sequence so the tank-outline pass shows up as exactly one operation in
   * the stroke counters our tests rely on.
   */
  private drawTank(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, oneCssPxInMm: number): void {
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.lineWidth = oneCssPxInMm;
    ctx.strokeStyle = TANK_STROKE;
    ctx.strokeRect(x0, y0, w, h);
  }

  // ─── hitTest ────────────────────────────────────────────────────────────

  hitTest(
    point: Vec2,
    scene: Scene,
    viewport: Viewport,
    options: HitTestOptions = {},
  ): HitResult | null {
    const { catalog, selection, previewAgeWeeks } = options;
    // The surface is the source of truth for canvas dimensions. Without an
    // attach we have no frame of reference — return null.
    const s = this.surface;
    if (s === null) return null;

    const world = canvasCssToWorld(point, viewport, { width: s.width, height: s.height });
    // Pixel-equivalent slack in world mm so the user doesn't have to land
    // on the exact handle pixel — same `oneCssPxInMm` the renderer uses.
    const oneCssPxInMm = 1 / viewport.zoom;

    // 1) Handle hit-test FIRST — handles only paint for selected objects,
    //    and a click that lands on a handle should win over the body
    //    underneath (otherwise the user could never grab a handle that
    //    sits inside the object's bounds, which all of them do).
    if (selection !== undefined && selection.length > 0) {
      const selectedSet = new Set<ObjectId>(selection);
      // Iterate selection in the same front-to-back order as bodies — the
      // visually-topmost selected object's handles win if multiple overlap.
      for (let li = scene.layers.length - 1; li >= 0; li--) {
        const layer = scene.layers[li]!;
        if (!layer.visible) continue;
        for (let oi = layer.objects.length - 1; oi >= 0; oi--) {
          const obj = layer.objects[oi]!;
          if (!selectedSet.has(obj.id)) continue;
          const extents = resolveSelectableExtents(obj, catalog, previewAgeWeeks);
          if (extents === null) continue;
          const handle = handleAtPointGeneric(obj.transform, extents, world, oneCssPxInMm);
          if (handle !== null) {
            return { objectId: obj.id, layerId: layer.id, handle };
          }
        }
      }
    }

    // 2) Body hit-test — same front-to-back walk as before. Plants beat
    //    hardscape within a layer when their (front-to-back) index is higher.
    for (let li = scene.layers.length - 1; li >= 0; li--) {
      const layer = scene.layers[li]!;
      if (!layer.visible) continue;
      for (let oi = layer.objects.length - 1; oi >= 0; oi--) {
        const obj = layer.objects[oi]!;
        if (obj.kind === 'hardscape') {
          if (objectContainsWorldPoint(obj, world, catalog)) {
            return { objectId: obj.id, layerId: layer.id };
          }
        } else if (obj.kind === 'plant') {
          if (plantContainsWorldPoint(obj, world, catalog, previewAgeWeeks)) {
            return { objectId: obj.id, layerId: layer.id };
          }
        }
      }
    }
    return null;
  }

  // ─── dispose ────────────────────────────────────────────────────────────

  dispose(): void {
    const w = getWindowLike();
    if (this.resizeListener !== null && w !== null) {
      w.removeEventListener('resize', this.resizeListener);
    }
    this.resizeListener = null;

    if (this.dprMql !== null && this.dprListener !== null) {
      this.dprMql.removeEventListener('change', this.dprListener);
    }
    this.dprMql = null;
    this.dprListener = null;

    // Clear the canvas under identity so the surface is left in a clean
    // state for the next renderer or host code.
    if (this.ctx !== null && this.surface !== null) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.surface.canvas.width, this.surface.canvas.height);
    }

    this.ctx = null;
    this.surface = null;
  }

  // ─── F2.3 — Substrate rendering ───────────────────────────────────────
  //
  // Paint each region's filled profile silhouette in world-mm. Color comes
  // from the catalog entry referenced by the region's `material`; missing
  // entries fall back to `SUBSTRATE_FALLBACK_FILL` so a doc opened without
  // its catalog still renders something visible.
  //
  // Blend zones: where two regions' `[fromX, toX]` ranges overlap, the
  // overlap is drawn for BOTH regions. Painters' order (input order) means
  // the later region's color sits on top; if both want to contribute we
  // could alpha-blend, but for v1 the simpler "later wins" is enough and
  // matches the schema's "blend is a render hint, not an authoritative
  // mix" stance. The `blend` field is honoured by softening each region's
  // edges with a linear alpha fall-off `blend` mm wide.
  //
  // Grain noise: deterministic, hashed by `scene.seed`. Skipped at very
  // small viewport zooms (zoom < 0.5 px/mm) where each grain is sub-pixel
  // — would just produce flicker on resize.

  private drawSubstrate(
    ctx: CanvasRenderingContext2D,
    scene: Scene,
    catalog: Catalog | undefined,
  ): void {
    if (scene.substrate.regions.length === 0) return;
    const tankW = scene.tank.width;
    if (tankW <= 0) return;

    for (const region of scene.substrate.regions) {
      const fill = resolveSubstrateColor(region.material, catalog);
      this.paintSubstrateRegion(ctx, region, tankW, fill, scene.seed);
    }
  }

  private paintSubstrateRegion(
    ctx: CanvasRenderingContext2D,
    region: SubstrateRegion,
    tankWidthMm: number,
    fill: string,
    seed: number,
  ): void {
    const x0 = region.fromX * tankWidthMm;
    const x1 = region.toX * tankWidthMm;
    if (x1 - x0 <= 0) return;

    // Sample the Catmull-Rom profile in region-local coords ([0,1] x [0, mm]),
    // then map to world coords inside [x0, x1]. We oversample (≈ one sample
    // per mm of region width, capped) so the visible silhouette is smooth at
    // most editor zooms without exploding sample count on a 2 m tank.
    const widthMm = x1 - x0;
    const samples = Math.min(400, Math.max(8, Math.round(widthMm)));
    const profileSamples = sampleCatmullRom(region.profile, samples);

    ctx.save();
    ctx.beginPath();
    // Start at the bottom-left of the region.
    ctx.moveTo(x0, 0);
    for (let i = 0; i < profileSamples.length; i++) {
      const p = profileSamples[i]!;
      const x = x0 + p.x * widthMm;
      // Profile y is height above tank floor in mm; clamp negative samples
      // just in case the spline overshoots below 0.
      const y = Math.max(0, p.y);
      ctx.lineTo(x, y);
    }
    // Close back along the floor.
    ctx.lineTo(x1, 0);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // F2.3 — grain noise overlay. Single-pass scatter of darker / lighter
    // dots inside the silhouette. Deterministic per (seed, region.id).
    // Skip entirely when the silhouette is too thin to read individual
    // grains.
    if (widthMm >= 20) {
      this.paintSubstrateGrain(ctx, region, x0, x1, profileSamples, seed);
    }

    ctx.restore();
  }

  private paintSubstrateGrain(
    ctx: CanvasRenderingContext2D,
    region: SubstrateRegion,
    x0: number,
    x1: number,
    profileSamples: readonly Vec2[],
    seed: number,
  ): void {
    // Stable hash of the region id → an integer seed so two regions don't
    // share the same noise pattern.
    const regionSeed = stringSeed(region.id);
    // Density: 1 grain per ~150 mm² of region area. Keep total bounded.
    const widthMm = x1 - x0;
    const maxHeight = profileSamples.reduce((m, p) => Math.max(m, p.y), 0);
    if (maxHeight <= 0) return;
    const areaMm2 = widthMm * maxHeight;
    const grainCount = Math.min(800, Math.floor(areaMm2 / 150));
    if (grainCount === 0) return;

    ctx.save();
    ctx.globalAlpha = 0.18;
    // Save the silhouette as a clip so grains never spill outside.
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    for (let i = 0; i < profileSamples.length; i++) {
      const p = profileSamples[i]!;
      ctx.lineTo(x0 + p.x * widthMm, Math.max(0, p.y));
    }
    ctx.lineTo(x1, 0);
    ctx.closePath();
    ctx.clip();

    // Two passes so we get a light + dark fleck without two clip setups.
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? '#000' : '#fff';
      for (let i = 0; i < grainCount; i++) {
        const rx = seededHash01(seed ^ regionSeed, i, pass, 1);
        const ry = seededHash01(seed ^ regionSeed, i, pass, 2);
        const px = x0 + rx * widthMm;
        const py = ry * maxHeight;
        // Grain "size" in world mm — at 1 px/mm zoom these are tiny;
        // at editor zooms they read as fine speckle.
        ctx.fillRect(px, py, 1, 1);
      }
    }

    ctx.restore();
  }

  // ─── F3.3 / F3.5 — Hardscape rendering ────────────────────────────────
  //
  // Iterate scene.layers (back-to-front) and within each layer iterate
  // objects (back-to-front). Per HardscapeObject: resolve the catalog
  // entry, apply the world transform, then path the silhouette polygon
  // and fill with the catalog material color. Wood gets a darker outline
  // stroke; rock gets a subtle highlight band hint. No catalog → skip
  // (the hit-test fallback is for testing, but visual rendering needs
  // the silhouette).

  private drawHardscape(
    ctx: CanvasRenderingContext2D,
    scene: Scene,
    catalog: Catalog | undefined,
    oneCssPxInMm: number,
  ): void {
    for (const layer of scene.layers) {
      if (!layer.visible) continue;
      const layerAlpha = clampOpacity(layer.opacity);
      for (const obj of layer.objects) {
        if (obj.kind !== 'hardscape') continue;
        const entry = resolveHardscapeEntry(obj.ref, catalog);
        if (entry === null) continue; // No silhouette to draw — silently skip.
        this.paintHardscape(ctx, obj as HardscapeObject, entry, oneCssPxInMm, layerAlpha);
      }
    }
  }

  private paintHardscape(
    ctx: CanvasRenderingContext2D,
    obj: HardscapeObject,
    entry: HardscapeEntry,
    oneCssPxInMm: number,
    layerAlpha: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = layerAlpha;
    // Apply the object transform: translate, rotate, scale.
    ctx.translate(obj.transform.position.x, obj.transform.position.y);
    if (obj.transform.rotation.z !== 0) {
      ctx.rotate(obj.transform.rotation.z);
    }
    const sx =
      obj.transform.scale.x * (obj.transform.flipX ? -1 : 1) * entry.naturalSize.width * 0.5;
    const sy =
      obj.transform.scale.y * (obj.transform.flipY ? -1 : 1) * entry.naturalSize.height * 0.5;
    if (sx === 0 || sy === 0) {
      ctx.restore();
      return;
    }
    ctx.scale(sx, sy);
    // Silhouette is in normalized [-1, 1]; after the scale above, lives
    // at the object's natural footprint.
    pathPolygon(ctx, entry.silhouette);
    ctx.fillStyle = entry.color;
    ctx.fill();

    // Outline at 1 CSS px equivalent — needs to invert the per-axis scale
    // so the line width stays 1 px regardless of object size. Use the
    // mean of |sx|, |sy| as a single-line-width proxy; non-uniform scale
    // produces slightly anisotropic strokes, which is acceptable.
    const meanScale = (Math.abs(sx) + Math.abs(sy)) * 0.5;
    if (meanScale > 0) {
      ctx.lineWidth = oneCssPxInMm / meanScale;
      ctx.strokeStyle = entry.category === 'wood' ? '#2a1a0e' : '#222';
      ctx.stroke();
    }
    ctx.restore();
  }

  // ─── F3.3 — Selection handles ─────────────────────────────────────────
  //
  // Per selected object: draw an axis-aligned bounding box in screen-px
  // line width + four corner scale handles + one rotate handle above. The
  // handles are drawn AFTER all hardscape so they always sit on top.

  private drawSelectionHandles(
    ctx: CanvasRenderingContext2D,
    scene: Scene,
    catalog: Catalog | undefined,
    oneCssPxInMm: number,
    selected: Set<ObjectId>,
  ): void {
    for (const layer of scene.layers) {
      if (!layer.visible) continue;
      for (const obj of layer.objects) {
        if (!selected.has(obj.id)) continue;
        // Scatter-patch plants don't get interactive handles — reshaping
        // a brush polygon is a different gesture than scaling/rotating a
        // sprite — but they DO get a non-interactive dashed bbox around
        // the polygon AABB so the user gets visual feedback that the
        // patch is selected.
        if (obj.kind === 'plant' && obj.scatter !== undefined) {
          this.paintScatterSelectionBox(ctx, obj.scatter.polygon, oneCssPxInMm);
          continue;
        }
        const extents = resolveSelectableExtents(obj, catalog, undefined);
        if (extents === null) continue;
        this.paintSelectionHandlesGeneric(ctx, obj.transform, extents, oneCssPxInMm);
      }
    }
  }

  /**
   * Paint a dashed bbox around a scatter patch's polygon AABB. Renders in
   * scene-mm space (no transform), with screen-px line width and dash
   * pattern so it stays visually consistent at any zoom. No corner / rotate
   * handles — scatter brushes don't have a useful "scale" or "rotate"
   * affordance through corner drags.
   */
  private paintScatterSelectionBox(
    ctx: CanvasRenderingContext2D,
    polygon: ReadonlyArray<{ x: number; y: number }>,
    oneCssPxInMm: number,
  ): void {
    if (polygon.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of polygon) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (w <= 0 || h <= 0) return;
    ctx.save();
    ctx.lineWidth = SELECTION_LINE_WIDTH_PX * oneCssPxInMm;
    ctx.strokeStyle = SELECTION_COLOR;
    const dash = 6 * oneCssPxInMm;
    ctx.setLineDash([dash, dash]);
    ctx.strokeRect(minX, minY, w, h);
    ctx.restore();
  }

  private paintSelectionHandlesGeneric(
    ctx: CanvasRenderingContext2D,
    transform: Transform,
    extents: { halfW: number; halfH: number },
    oneCssPxInMm: number,
  ): void {
    const { halfW, halfH } = extents;
    if (halfW === 0 || halfH === 0) return;

    ctx.save();
    ctx.translate(transform.position.x, transform.position.y);
    if (transform.rotation.z !== 0) {
      ctx.rotate(transform.rotation.z);
    }

    ctx.lineWidth = SELECTION_LINE_WIDTH_PX * oneCssPxInMm;
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.strokeRect(-halfW, -halfH, 2 * halfW, 2 * halfH);

    const handleSizeMm = SELECTION_HANDLE_PX * oneCssPxInMm;
    ctx.fillStyle = '#fff';
    for (const [hx, hy] of [
      [-halfW, -halfH],
      [halfW, -halfH],
      [halfW, halfH],
      [-halfW, halfH],
    ] as const) {
      ctx.fillRect(hx - handleSizeMm / 2, hy - handleSizeMm / 2, handleSizeMm, handleSizeMm);
      ctx.strokeRect(hx - handleSizeMm / 2, hy - handleSizeMm / 2, handleSizeMm, handleSizeMm);
    }

    const stalkLengthMm = SELECTION_ROTATE_STALK_PX * oneCssPxInMm;
    ctx.beginPath();
    ctx.moveTo(0, halfH);
    ctx.lineTo(0, halfH + stalkLengthMm);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, halfH + stalkLengthMm, handleSizeMm / 2, 0, Math.PI * 2);
    ctx.fillStyle = SELECTION_COLOR;
    ctx.fill();
    ctx.restore();
  }

  // ─── Stage 6 F6.3 — Backdrop image ───────────────────────────────────
  //
  // View-only photo composited behind everything else. Painted under the
  // identity transform (in CSS-px space) so it covers the full backing
  // buffer regardless of zoom / pan — the user typically wants their
  // photo to behave like a static painting behind the design.
  //
  // True no-op when the parameter is omitted, when `opacity <= 0`, or
  // when the image isn't ready (e.g. dimensions still 0 because the
  // host hasn't decoded it). Wrapped in save / restore so globalAlpha
  // doesn't leak into the world-transform paint that follows.

  private drawBackdrop(
    ctx: CanvasRenderingContext2D,
    backingW: number,
    backingH: number,
    backdrop: BackdropImage | undefined,
  ): void {
    if (backdrop === undefined) return;
    if (!Number.isFinite(backdrop.opacity) || backdrop.opacity <= 0) return;
    if (backingW <= 0 || backingH <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, backdrop.opacity);
    // drawImage(source, dx, dy, dw, dh) — cover-fit the entire backing.
    ctx.drawImage(backdrop.image, 0, 0, backingW, backingH);
    ctx.restore();
  }

  // ─── Stage 5.x — Wall background ─────────────────────────────────────
  //
  // View-only "room wall" rectangle painted in world-mm coordinates,
  // centred on the tank's geometric centre, sized independently of the
  // tank (configurable in mm via the editor-shell `WallBackgroundService`).
  // Called BEFORE every other paint pass so the tank's `style.background`
  // covers the wall inside the tank rect — the wall is therefore visible
  // only in the area outside the tank's silhouette.
  //
  // True no-op when the argument is omitted, when `enabled` is false, or
  // when either dimension is non-positive. Wrapped in save / restore so
  // the fillStyle assignment doesn't leak into the next paint.

  private drawWallBackground(
    ctx: CanvasRenderingContext2D,
    scene: Scene,
    wall: WallBackground | undefined,
  ): void {
    if (wall === undefined || !wall.enabled) return;
    if (wall.widthMm <= 0 || wall.heightMm <= 0) return;
    const tankW = scene.tank.width;
    const tankH = scene.tank.height;
    if (tankW <= 0 || tankH <= 0) return;

    const cx = tankW / 2;
    const cy = tankH / 2;
    const x = cx - wall.widthMm / 2;
    const y = cy - wall.heightMm / 2;

    ctx.save();
    ctx.fillStyle = wall.color;
    ctx.fillRect(x, y, wall.widthMm, wall.heightMm);
    ctx.restore();
  }

  // ─── F5.4 — Snap alignment guides ─────────────────────────────────────
  //
  // Ephemeral lines painted during a drag when the dragged object's
  // position has snapped to a target (grid / golden / thirds / focal /
  // another object's centre). Each `xs[i]` becomes a vertical line at
  // world x = xs[i] spanning the tank's height; each `ys[i]` becomes a
  // horizontal line. The host clears the param on pointerup so the lines
  // disappear cleanly.
  //
  // True no-op when the argument is omitted OR both arrays are empty.
  // Wrapped in save / restore so style state doesn't leak into the
  // selection-handle paint that follows.

  private drawSnapGuides(
    ctx: CanvasRenderingContext2D,
    scene: Scene,
    oneCssPxInMm: number,
    guides: SnapGuides | undefined,
  ): void {
    if (guides === undefined) return;
    if (guides.xs.length === 0 && guides.ys.length === 0) return;
    const tankW = scene.tank.width;
    const tankH = scene.tank.height;
    if (tankW <= 0 || tankH <= 0) return;

    ctx.save();
    ctx.lineWidth = SNAP_GUIDE_LINE_WIDTH_CSS_PX * oneCssPxInMm;
    ctx.strokeStyle = SNAP_GUIDE_STROKE;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const x of guides.xs) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, tankH);
    }
    for (const y of guides.ys) {
      ctx.moveTo(0, y);
      ctx.lineTo(tankW, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ─── F5.3 — Composition overlays ──────────────────────────────────────
  //
  // Three view-only guides: golden-ratio lines, rule-of-thirds lines, and
  // golden-ratio focal-point markers. They paint in the tank's front-face
  // interior plane (`(0, 0)` to `(tank.width, tank.height)` in world mm),
  // so the world transform already in place from `render()` projects them
  // exactly the same way as scene content.
  //
  // When `overlayOptions` is omitted or all three flags are false, this is
  // a true no-op — no save/restore overhead, no canvas state change. The
  // single early return below guarantees that.
  //
  // Each enabled pass is wrapped in its own `save` / `restore` pair so
  // style state (lineWidth, strokeStyle, lineDash, fillStyle) never leaks
  // into the selection-handle paint that follows.

  private drawCompositionOverlays(
    ctx: CanvasRenderingContext2D,
    scene: Scene,
    oneCssPxInMm: number,
    overlayOptions: OverlayOptions | undefined,
  ): void {
    if (overlayOptions === undefined) return;
    if (!overlayOptions.goldenRatio && !overlayOptions.thirds && !overlayOptions.focalPoints) {
      return;
    }
    const tankW = scene.tank.width;
    const tankH = scene.tank.height;
    if (tankW <= 0 || tankH <= 0) return;

    if (overlayOptions.goldenRatio) {
      const { vertical, horizontal } = goldenRatioLines(tankW, tankH);
      this.paintOverlayGuideLines(
        ctx,
        vertical,
        horizontal,
        tankW,
        tankH,
        OVERLAY_GOLDEN_STROKE,
        oneCssPxInMm,
      );
    }
    if (overlayOptions.thirds) {
      const { vertical, horizontal } = thirdsLines(tankW, tankH);
      this.paintOverlayGuideLines(
        ctx,
        vertical,
        horizontal,
        tankW,
        tankH,
        OVERLAY_THIRDS_STROKE,
        oneCssPxInMm,
      );
    }
    if (overlayOptions.focalPoints) {
      const points = focalPoints(tankW, tankH);
      this.paintOverlayFocalPoints(ctx, points, oneCssPxInMm);
    }
  }

  /**
   * Paint a set of vertical + horizontal guide lines across the tank's
   * front-face interior rect. Verticals span 0 → tankH, horizontals span
   * 0 → tankW. World transform is already in place, so we draw in mm.
   * `lineWidth` and `setLineDash` are scaled by `oneCssPxInMm` so they
   * look identical at every zoom.
   */
  private paintOverlayGuideLines(
    ctx: CanvasRenderingContext2D,
    verticals: readonly number[],
    horizontals: readonly number[],
    tankW: number,
    tankH: number,
    strokeStyle: string,
    oneCssPxInMm: number,
  ): void {
    ctx.save();
    ctx.lineWidth = OVERLAY_LINE_WIDTH_CSS_PX * oneCssPxInMm;
    ctx.strokeStyle = strokeStyle;
    const dashMm = OVERLAY_DASH_CSS_PX * oneCssPxInMm;
    ctx.setLineDash([dashMm, dashMm]);
    ctx.beginPath();
    for (const x of verticals) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, tankH);
    }
    for (const y of horizontals) {
      ctx.moveTo(0, y);
      ctx.lineTo(tankW, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Paint the four golden-ratio focal-point markers as small filled circles
   * (no stroke). `radius` is scaled by `oneCssPxInMm` so the dots stay the
   * same visual size at every zoom.
   */
  private paintOverlayFocalPoints(
    ctx: CanvasRenderingContext2D,
    points: ReadonlyArray<Vec2>,
    oneCssPxInMm: number,
  ): void {
    ctx.save();
    ctx.fillStyle = OVERLAY_FOCAL_FILL;
    const radiusMm = OVERLAY_FOCAL_RADIUS_CSS_PX * oneCssPxInMm;
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radiusMm, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ─── F4.4 — Plant rendering ───────────────────────────────────────────
  //
  // Two plant render paths:
  //   - Single-specimen (no `scatter` field): one silhouette painted at the
  //     plant's transform.position, scaled by transform × naturalSize ×
  //     growthScale.
  //   - Scatter patch: `scatterInPolygon(scatter.polygon, scatter.density,
  //     scatter.seed ?? scene.seed)` produces a deterministic point list.
  //     Each instance is one silhouette at world position, scaled by
  //     naturalSize × growthScale × per-instance jitter, rotated by the
  //     per-instance rotation. The brush polygon itself is NOT outlined
  //     (that would draw a visible patch boundary that the user can't see
  //     in the real planted carpet).
  //
  // Both branches use `plantScale(entry.growth, plant.growth, previewAgeWeeks)`
  // — the time slider's preview age is honoured without mutating the doc.

  private drawPlants(
    ctx: CanvasRenderingContext2D,
    scene: Scene,
    catalog: Catalog | undefined,
    oneCssPxInMm: number,
    previewAgeWeeks: number | undefined,
    sceneSeed: number,
  ): void {
    for (const layer of scene.layers) {
      if (!layer.visible) continue;
      const layerAlpha = clampOpacity(layer.opacity);
      for (const obj of layer.objects) {
        if (obj.kind !== 'plant') continue;
        const entry = resolvePlantEntry(obj.ref, catalog);
        if (entry === null) continue;
        const scale = plantScale(entry.growth, obj.growth, previewAgeWeeks);
        if (obj.scatter !== undefined) {
          this.paintScatterPlant(ctx, obj, entry, scale, layerAlpha, sceneSeed, oneCssPxInMm);
        } else {
          this.paintSinglePlant(ctx, obj, entry, scale, layerAlpha, oneCssPxInMm);
        }
      }
    }
  }

  private paintSinglePlant(
    ctx: CanvasRenderingContext2D,
    obj: PlantObject,
    entry: PlantEntry,
    growthScale: number,
    layerAlpha: number,
    oneCssPxInMm: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = layerAlpha;
    ctx.translate(obj.transform.position.x, obj.transform.position.y);
    if (obj.transform.rotation.z !== 0) {
      ctx.rotate(obj.transform.rotation.z);
    }
    const sx =
      obj.transform.scale.x *
      (obj.transform.flipX ? -1 : 1) *
      entry.naturalSize.width *
      0.5 *
      growthScale;
    const sy =
      obj.transform.scale.y *
      (obj.transform.flipY ? -1 : 1) *
      entry.naturalSize.height *
      0.5 *
      growthScale;
    if (sx === 0 || sy === 0) {
      ctx.restore();
      return;
    }
    ctx.scale(sx, sy);
    pathPolygon(ctx, entry.silhouette);
    ctx.fillStyle = entry.color;
    ctx.fill();
    // Thin outline at one CSS px, scaled into world-mm. Same stroke-scaling
    // logic as hardscape so plants read cleanly at any zoom.
    const meanScale = (Math.abs(sx) + Math.abs(sy)) * 0.5;
    if (meanScale > 0) {
      ctx.lineWidth = oneCssPxInMm / meanScale;
      ctx.strokeStyle = darken(entry.color, 0.25);
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintScatterPlant(
    ctx: CanvasRenderingContext2D,
    obj: PlantObject,
    entry: PlantEntry,
    growthScale: number,
    layerAlpha: number,
    sceneSeed: number,
    oneCssPxInMm: number,
  ): void {
    const scatter = obj.scatter;
    if (scatter === undefined) return;
    // Effective seed XORs in a flipX/flipY signature so Mirror produces a
    // visibly different scatter arrangement even on symmetric brushes
    // (the default auto-created 16-sided regular circle is symmetric, so
    // polygon mirror alone is a no-op — without this XOR, clicking Mirror
    // on a carpet drop looks like nothing happened). XOR is self-inverse,
    // so Mirror twice on the same axis restores the original arrangement.
    const baseSeed = scatter.seed ?? sceneSeed;
    const seed =
      ((baseSeed ^ (obj.transform.flipX ? SCATTER_FLIP_X_SEED_MIX : 0)) ^
        (obj.transform.flipY ? SCATTER_FLIP_Y_SEED_MIX : 0)) >>>
      0;
    // Honor `transform.flipX/flipY` on the brush polygon BEFORE scattering.
    // The user expects Mirror H/V on a carpet patch to flip the patch
    // footprint — for asymmetric polygons this re-arranges which cells
    // contain instances. Symmetric polygons (e.g. the auto-created
    // 16-sided regular circle) are invariant under this flip; the seed
    // XOR above is what makes the visible re-scatter happen there.
    const polygon = mirrorPolygon(
      scatter.polygon,
      obj.transform.flipX,
      obj.transform.flipY,
    );
    const points = scatterInPolygon(polygon, scatter.density, seed);
    if (points.length === 0) return;

    // Per-instance silhouette flip mirrors EACH plant glyph too, so an
    // asymmetric silhouette (e.g. Bucephalandra) visibly flips along with
    // the patch. Symmetric silhouettes (Hairgrass, Vallisneria) stay
    // invariant. `instanceSx` / `instanceSy` carry the sign.
    const flipSx = obj.transform.flipX ? -1 : 1;
    const flipSy = obj.transform.flipY ? -1 : 1;

    ctx.save();
    ctx.globalAlpha = layerAlpha;
    ctx.fillStyle = entry.color;
    const strokeColor = darken(entry.color, 0.25);
    for (const p of points) {
      ctx.save();
      ctx.translate(p.position.x, p.position.y);
      if (p.rotation !== 0) ctx.rotate(p.rotation);
      const instanceSx = entry.naturalSize.width * 0.5 * growthScale * p.jitter * flipSx;
      const instanceSy = entry.naturalSize.height * 0.5 * growthScale * p.jitter * flipSy;
      if (instanceSx === 0 || instanceSy === 0) {
        ctx.restore();
        continue;
      }
      ctx.scale(instanceSx, instanceSy);
      pathPolygon(ctx, entry.silhouette);
      ctx.fill();
      const meanScale = (Math.abs(instanceSx) + Math.abs(instanceSy)) * 0.5;
      if (meanScale > 0) {
        ctx.lineWidth = oneCssPxInMm / meanScale;
        ctx.strokeStyle = strokeColor;
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }
}

// ─── F3.3 / F3.5 — Hardscape render helpers (module-level pure) ───────────

const SELECTION_COLOR = '#3a8eff';
const SELECTION_LINE_WIDTH_PX = 1.5;
/**
 * Magic 32-bit constants XOR'd into the scatter seed when the plant's
 * `transform.flipX/Y` is true. XOR is self-inverse so toggling a flip
 * twice restores the original arrangement. Numbers are arbitrary mixing
 * primes (the same value used in the carpet-clone reseed elsewhere) — any
 * pair of non-zero distinct constants would do; what matters is that
 * each axis produces a clearly different arrangement.
 */
const SCATTER_FLIP_X_SEED_MIX = 0x9e3779b1;
const SCATTER_FLIP_Y_SEED_MIX = 0x85ebca77;
const SELECTION_HANDLE_PX = 8;
const SELECTION_ROTATE_STALK_PX = 18;

function pathPolygon(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<{ x: number; y: number }>,
): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i]!.x, points[i]!.y);
  }
  ctx.closePath();
}

/**
 * Mirror a polygon about its bounding-box centroid on either axis. Used by
 * the scatter-plant renderer to make `transform.flipX/Y` produce a visible
 * change when the user clicks Mirror H/V on a carpet patch: the polygon
 * footprint flips, so for asymmetric brushes the scattered instances end
 * up in mirrored positions. Symmetric polygons (the auto-created 16-sided
 * regular circle) are invariant — Mirror is mathematically a no-op on
 * them, which is the right answer.
 */
function mirrorPolygon(
  polygon: ReadonlyArray<{ x: number; y: number }>,
  flipX: boolean,
  flipY: boolean,
): ReadonlyArray<{ x: number; y: number }> {
  if (!flipX && !flipY) return polygon;
  if (polygon.length === 0) return polygon;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return polygon.map((p) => ({
    x: flipX ? cx - (p.x - cx) : p.x,
    y: flipY ? cy - (p.y - cy) : p.y,
  }));
}

function clampOpacity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ─── Substrate render helpers (module-level pure) ─────────────────────────

/** Fallback fill color when no catalog is provided or the lookup misses. */
const SUBSTRATE_FALLBACK_FILL = '#6b5a45';

function resolveSubstrateColor(ref: CatalogRef, catalog: Catalog | undefined): string {
  if (catalog === undefined) return SUBSTRATE_FALLBACK_FILL;
  const entry = catalog.get({ catalog: ref.catalog, id: ref.id });
  if (entry === null || entry.kind !== 'substrate') return SUBSTRATE_FALLBACK_FILL;
  return (entry as SubstrateEntry).color;
}

/**
 * Cheap 32-bit hash of a string, used to derive a deterministic per-region
 * noise seed from the region's UUID. NOT cryptographic.
 */
function stringSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

// ─── F3.3 — hit-test helpers (pure, no DOM access) ────────────────────────

/**
 * Invert the viewport's world-to-canvas transform applied in `render`.
 * Returns world mm coords. Mirrors the forward transform in `render` step-
 * by-step: subtract canvas-center, scale by 1/zoom with the canvas y-flip,
 * rotate by +viewport.rotation, add viewport.center.
 */
function canvasCssToWorld(
  pointCss: Vec2,
  viewport: Viewport,
  canvas: { width: number; height: number },
): Vec2 {
  // 1) Relative to canvas centre.
  const dxPx = pointCss.x - canvas.width / 2;
  const dyPx = pointCss.y - canvas.height / 2;
  // 2) Pixels → world mm, including the canvas-y-flip.
  const dxMm = dxPx / viewport.zoom;
  const dyMm = -dyPx / viewport.zoom;
  // 3) Inverse of the world-space `rotate(-viewport.rotation)`: rotate by
  //    +viewport.rotation.
  const cos = Math.cos(viewport.rotation);
  const sin = Math.sin(viewport.rotation);
  const rxMm = dxMm * cos - dyMm * sin;
  const ryMm = dxMm * sin + dyMm * cos;
  // 4) Offset by the centre to land in world coords.
  return { x: viewport.center.x + rxMm, y: viewport.center.y + ryMm };
}

/**
 * True if `worldPoint` falls inside the object's silhouette (catalog-aware)
 * or its naturalSize-scaled axis-aligned bbox (catalog-omitted fallback).
 *
 * The object's transform is inverted: translate by -position, rotate by
 * -rotation.z, then divide by `(scale.x × naturalSize.width × 0.5)` and
 * `(scale.y × naturalSize.height × 0.5)` so the point lands in the
 * silhouette's normalized [-1, 1] space. flipX / flipY are absorbed by
 * flipping the sign of the scale divisor.
 */
function objectContainsWorldPoint(
  obj: SceneObject,
  worldPoint: Vec2,
  catalog: Catalog | undefined,
): boolean {
  if (obj.kind !== 'hardscape') return false;
  const hardscape = obj as HardscapeObject;
  const entry = resolveHardscapeEntry(hardscape.ref, catalog);

  // Translate to object-relative.
  const dx = worldPoint.x - hardscape.transform.position.x;
  const dy = worldPoint.y - hardscape.transform.position.y;
  // Inverse-rotate by transform.rotation.z (rotate by -theta).
  const theta = hardscape.transform.rotation.z;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rx = dx * cos + dy * sin;
  const ry = -dx * sin + dy * cos;

  // Compute half-extents in world mm, signed by flip.
  const naturalW = entry?.naturalSize.width ?? HARDSCAPE_FALLBACK_NATURAL_MM;
  const naturalH = entry?.naturalSize.height ?? HARDSCAPE_FALLBACK_NATURAL_MM;
  const sxRaw = hardscape.transform.scale.x * (hardscape.transform.flipX ? -1 : 1);
  const syRaw = hardscape.transform.scale.y * (hardscape.transform.flipY ? -1 : 1);
  const halfW = naturalW * 0.5 * sxRaw;
  const halfH = naturalH * 0.5 * syRaw;
  if (halfW === 0 || halfH === 0) return false;

  const lx = rx / halfW;
  const ly = ry / halfH;

  // Fallback: AABB in normalized space when no catalog silhouette is available.
  if (entry === null) {
    return lx >= -1 && lx <= 1 && ly >= -1 && ly <= 1;
  }
  return pointInPolygon({ x: lx, y: ly }, entry.silhouette);
}

function resolveHardscapeEntry(
  ref: CatalogRef,
  catalog: Catalog | undefined,
): HardscapeEntry | null {
  if (catalog === undefined) return null;
  const entry = catalog.get({ catalog: ref.catalog, id: ref.id });
  if (entry === null || entry.kind !== 'hardscape') return null;
  return entry;
}

function resolvePlantEntry(ref: CatalogRef, catalog: Catalog | undefined): PlantEntry | null {
  if (catalog === undefined) return null;
  const entry = catalog.get({ catalog: ref.catalog, id: ref.id });
  if (entry === null || entry.kind !== 'plant') return null;
  return entry;
}

/** Fallback hardscape footprint when no catalog is provided to hit-test. */
const HARDSCAPE_FALLBACK_NATURAL_MM = 100;

/**
 * Hit-test a plant. Single-specimen: same silhouette test as hardscape,
 * but with the catalog silhouette scaled by the plant's growth scale at the
 * given previewAgeWeeks (so click targets match what's painted). Scatter:
 * point-in-polygon against the brush polygon — the patch IS the selection
 * surface; individual instances aren't independently selectable.
 */
function plantContainsWorldPoint(
  obj: PlantObject,
  worldPoint: Vec2,
  catalog: Catalog | undefined,
  previewAgeWeeks: number | undefined,
): boolean {
  if (obj.scatter !== undefined) {
    return pointInPolygon(worldPoint, obj.scatter.polygon);
  }
  const entry = resolvePlantEntry(obj.ref, catalog);
  if (entry === null) return false;
  const growth = plantScale(entry.growth, obj.growth, previewAgeWeeks);
  // Inverse transform into the object's local frame, accounting for growth.
  const dx = worldPoint.x - obj.transform.position.x;
  const dy = worldPoint.y - obj.transform.position.y;
  const theta = obj.transform.rotation.z;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rx = dx * cos + dy * sin;
  const ry = -dx * sin + dy * cos;
  const sxRaw = obj.transform.scale.x * (obj.transform.flipX ? -1 : 1);
  const syRaw = obj.transform.scale.y * (obj.transform.flipY ? -1 : 1);
  const halfW = entry.naturalSize.width * 0.5 * sxRaw * growth;
  const halfH = entry.naturalSize.height * 0.5 * syRaw * growth;
  if (halfW === 0 || halfH === 0) return false;
  const lx = rx / halfW;
  const ly = ry / halfH;
  return pointInPolygon({ x: lx, y: ly }, entry.silhouette);
}

/**
 * Resolve the local-frame half-extents (in world mm) for the selection-handle
 * geometry of an object. Returns `null` when the object can't show handles —
 * either because we can't resolve its catalog entry, or because it's a kind
 * that doesn't use bbox handles (scatter plants, decor sprites, etc.).
 *
 * Plants honour `previewAgeWeeks` so the bbox follows the painted growth
 * state; hardscape is unaffected.
 */
function resolveSelectableExtents(
  obj: SceneObject,
  catalog: Catalog | undefined,
  previewAgeWeeks: number | undefined,
): { halfW: number; halfH: number } | null {
  if (obj.kind === 'hardscape') {
    const entry = resolveHardscapeEntry(obj.ref, catalog);
    const naturalW = entry?.naturalSize.width ?? HARDSCAPE_FALLBACK_NATURAL_MM;
    const naturalH = entry?.naturalSize.height ?? HARDSCAPE_FALLBACK_NATURAL_MM;
    const halfW = obj.transform.scale.x * naturalW * 0.5;
    const halfH = obj.transform.scale.y * naturalH * 0.5;
    if (halfW <= 0 || halfH <= 0) return null;
    return { halfW, halfH };
  }
  if (obj.kind === 'plant') {
    if (obj.scatter !== undefined) return null;
    const entry = resolvePlantEntry(obj.ref, catalog);
    if (entry === null) return null;
    const growth = plantScale(entry.growth, obj.growth, previewAgeWeeks);
    const halfW = obj.transform.scale.x * entry.naturalSize.width * 0.5 * growth;
    const halfH = obj.transform.scale.y * entry.naturalSize.height * 0.5 * growth;
    if (halfW <= 0 || halfH <= 0) return null;
    return { halfW, halfH };
  }
  return null;
}

/**
 * Test `worldPoint` against the painted selection handles of a hardscape
 * object. Returns the handle name (matches `HitResult.handle`) or `null`.
 * Mirrors the geometry the renderer uses in `paintSelectionHandles`:
 *   - 4 corner scale handles at `(±halfW, ±halfH)` in the object's local frame,
 *     each a `SELECTION_HANDLE_PX × SELECTION_HANDLE_PX` square (world-mm
 *     sized so the visual hit slop matches what the user sees).
 *   - 1 rotate handle at `(0, halfH + SELECTION_ROTATE_STALK_PX * 1mm)`,
 *     a circle of radius `SELECTION_HANDLE_PX / 2` world-mm.
 *
 * The renderer doesn't paint a 'translate' handle as a discrete dot — the
 * whole object body acts as the translate handle. This helper deliberately
 * skips 'translate'; the caller falls through to body hit-test for that.
 */
/**
 * Generic handle hit-test against a `(transform, extents)` pair. Used for
 * hardscape AND single-specimen plants — both place handles at the corners
 * and a rotate stalk above the local-frame bbox `(±halfW, ±halfH)`.
 */
function handleAtPointGeneric(
  transform: Transform,
  extents: { halfW: number; halfH: number },
  worldPoint: Vec2,
  oneCssPxInMm: number,
): NonNullable<HitResult['handle']> | null {
  const { halfW, halfH } = extents;
  if (halfW <= 0 || halfH <= 0) return null;

  // Transform the world point into the object's local frame (translate
  // by -position, rotate by -theta).
  const dx = worldPoint.x - transform.position.x;
  const dy = worldPoint.y - transform.position.y;
  const theta = transform.rotation.z;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;

  const handleHalfMm = SELECTION_HANDLE_PX * 0.5 * oneCssPxInMm;
  const rotateRadiusMm = SELECTION_HANDLE_PX * 0.5 * oneCssPxInMm;
  const stalkLengthMm = SELECTION_ROTATE_STALK_PX * oneCssPxInMm;

  const corners: Array<[number, number, NonNullable<HitResult['handle']>]> = [
    [-halfW, -halfH, 'scaleSW'],
    [halfW, -halfH, 'scaleSE'],
    [halfW, halfH, 'scaleNE'],
    [-halfW, halfH, 'scaleNW'],
  ];
  for (const [cx, cy, name] of corners) {
    if (
      lx >= cx - handleHalfMm &&
      lx <= cx + handleHalfMm &&
      ly >= cy - handleHalfMm &&
      ly <= cy + handleHalfMm
    ) {
      return name;
    }
  }

  const rcx = 0;
  const rcy = halfH + stalkLengthMm;
  const rdx = lx - rcx;
  const rdy = ly - rcy;
  if (rdx * rdx + rdy * rdy <= rotateRadiusMm * rotateRadiusMm) {
    return 'rotate';
  }

  return null;
}

/**
 * Darken a `#rrggbb` (or `#rrggbbaa`) hex by `amount` ∈ [0, 1]. amount = 0.25
 * means each channel is scaled to 75% of its value. Used for plant outline
 * strokes that need to read against the fill at any zoom. If the input isn't
 * a recognized hex, returns the input unchanged — the renderer just uses the
 * fill color for the stroke and the plant becomes a flat shape (fine fallback).
 */
function darken(hex: string, amount: number): string {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex);
  if (m === null) return hex;
  const rgb = m[1]!;
  const alpha = m[2] ?? '';
  const factor = Math.max(0, 1 - amount);
  const r = Math.round(parseInt(rgb.slice(0, 2), 16) * factor);
  const g = Math.round(parseInt(rgb.slice(2, 4), 16) * factor);
  const b = Math.round(parseInt(rgb.slice(4, 6), 16) * factor);
  const hex2 = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${alpha}`;
}

// Suppress "unused" warnings for types reserved for future use here.
void ((): LayerId | undefined => undefined);
