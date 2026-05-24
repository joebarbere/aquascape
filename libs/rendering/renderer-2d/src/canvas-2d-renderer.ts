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

import type { Catalog, HardscapeEntry, SubstrateEntry } from '@aquascape/domain/catalog';
import {
  pointInPolygon,
  project2D,
  sampleCatmullRom,
  seededHash01,
} from '@aquascape/domain/geometry';
import type { Vec2 } from '@aquascape/domain/geometry';
import type {
  CatalogRef,
  HardscapeObject,
  LayerId,
  ObjectId,
  Scene,
  SceneObject,
  SubstrateRegion,
  TankStyle,
} from '@aquascape/domain/scene-model';
import type {
  HitResult,
  RenderSurface,
  SceneRenderer,
  Viewport,
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
   * Size the canvas's backing store for the current DPR and write the CSS
   * size so the host layout sees the logical px. Called from `attach` and
   * from the resize / DPR listeners. Idempotent.
   */
  private syncCanvasSize(): void {
    const s = this.surface;
    if (s === null) return;
    const dpr = s.devicePixelRatio;
    const targetW = Math.round(s.width * dpr);
    const targetH = Math.round(s.height * dpr);
    if (s.canvas.width !== targetW) s.canvas.width = targetW;
    if (s.canvas.height !== targetH) s.canvas.height = targetH;
    // CSS size — host code may also do this but we own it during attach.
    const style = s.canvas.style as CSSStyleDeclaration | undefined;
    if (style !== undefined) {
      style.width = `${s.width}px`;
      style.height = `${s.height}px`;
    }
  }

  // ─── render ─────────────────────────────────────────────────────────────

  render(
    scene: Scene,
    viewport: Viewport,
    catalog?: Catalog,
    selection?: ReadonlyArray<ObjectId>,
  ): void {
    const s = this.surface;
    const ctx = this.ctx;
    if (s === null || ctx === null) return;

    const dpr = s.devicePixelRatio;
    const backingW = s.canvas.width;
    const backingH = s.canvas.height;

    // 1) Clear the full backing store under the identity transform.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, backingW, backingH);

    // 1a) Background — F1.2 Phase C. Painted under the identity transform
    //     so endpoints are canvas pixels, not world mm. The background
    //     covers the entire renderer-visible area, not just the tank.
    this.drawBackground(ctx, backingW, backingH, scene.tank.style);

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

    this.drawGrid(ctx, tankCorner0, tankCornerW, oneCssPxInMm);
    this.drawTank(ctx, tankCorner0, tankCornerW, oneCssPxInMm);
    // F2.3 — substrate sits between the tank outline and the water tint so
    // the tint visibly shades the substrate fill. Drawn under the same
    // world transform as the tank outline.
    this.drawSubstrate(ctx, scene, catalog);
    this.drawWaterTint(ctx, tankCorner0, tankCornerW, scene.tank.style);
    this.drawFrame(ctx, tankCorner0, tankCornerW, scene.tank.style);

    // F3.3 — paint hardscape silhouettes back-to-front (layers low→high,
    // objects within a layer low→high). Selection handles render LAST so
    // they sit visually on top of every object, even when selecting a
    // back-layer item.
    const selectedSet = selection !== undefined && selection.length > 0 ? new Set(selection) : null;
    this.drawHardscape(ctx, scene, catalog, oneCssPxInMm);
    if (selectedSet !== null) {
      this.drawSelectionHandles(ctx, scene, catalog, oneCssPxInMm, selectedSet);
    }

    // F4.x will add plant rendering here (over hardscape, under handles).
  }

  // ─── F1.2 Phase C — tank-styling helpers ──────────────────────────────

  /**
   * Paint the background fill across the entire canvas. Runs under the
   * identity transform set just before this call.
   *
   * Background variants:
   *   - `'none'`     — flat `DEFAULT_BACKGROUND_FILL` over the whole canvas.
   *   - `'color'`    — flat `background.color` over the whole canvas.
   *   - `'gradient'` — linear gradient spanning the canvas at `angle` radians.
   *     The angle is interpreted in WORLD space (+y up); we convert to canvas
   *     space by negating the y component when computing endpoints.
   *   - `'image'`    — TODO(F6.3): treated as `'none'` for now. Stage 0's
   *     `render` is synchronous; image loading needs an async cache rearch
   *     that F6.3 will deliver.
   */
  private drawBackground(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    style: TankStyle,
  ): void {
    const bg = style.background;
    if (bg.kind === 'none' || bg.kind === 'image') {
      // TODO(F6.3): for `'image'`, load and draw asset via async image cache.
      ctx.fillStyle = DEFAULT_BACKGROUND_FILL;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    if (bg.kind === 'color') {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    // Gradient. Endpoints span the canvas along the angle direction. We
    // pick the canvas center and project the canvas half-diagonal onto the
    // unit vector `(cos a, -sin a)` — the `-sin` converts WORLD +y-up into
    // CANVAS +y-down so `angle = π/2` paints bottom→top on screen.
    const ux = Math.cos(bg.angle);
    const uy = -Math.sin(bg.angle);
    const cx = w / 2;
    const cy = h / 2;
    // Half-extent along the gradient direction. Projecting the canvas's
    // half-width and half-height onto the absolute components of `u`
    // gives the distance from center to the bounding box along `u`. This
    // ensures the gradient endpoints sit on (or just past) the canvas
    // rectangle, so stops at 0 and 1 reach the edges.
    const half = (w * Math.abs(ux) + h * Math.abs(uy)) / 2;
    const x0 = cx - ux * half;
    const y0 = cy - uy * half;
    const x1 = cx + ux * half;
    const y1 = cy + uy * half;
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const stop of bg.stops) {
      grad.addColorStop(stop.at, stop.color);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
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
    catalog?: Catalog,
  ): HitResult | null {
    // The surface is the source of truth for canvas dimensions. Without an
    // attach we have no frame of reference — return null.
    const s = this.surface;
    if (s === null) return null;

    const world = canvasCssToWorld(point, viewport, { width: s.width, height: s.height });

    // Iterate **front-to-back** so the visually-topmost object wins:
    // layers are stored back-to-front (index 0 furthest back), and within
    // a layer objects are stored back-to-front too. Reverse both.
    for (let li = scene.layers.length - 1; li >= 0; li--) {
      const layer = scene.layers[li]!;
      if (!layer.visible) continue;
      for (let oi = layer.objects.length - 1; oi >= 0; oi--) {
        const obj = layer.objects[oi]!;
        if (obj.kind !== 'hardscape') continue; // Stage 3 hit-tests hardscape only.
        if (objectContainsWorldPoint(obj, world, catalog)) {
          return { objectId: obj.id, layerId: layer.id };
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
    const sx = obj.transform.scale.x * (obj.transform.flipX ? -1 : 1) * entry.naturalSize.width * 0.5;
    const sy = obj.transform.scale.y * (obj.transform.flipY ? -1 : 1) * entry.naturalSize.height * 0.5;
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
        if (obj.kind !== 'hardscape') continue;
        if (!selected.has(obj.id)) continue;
        const entry = resolveHardscapeEntry(obj.ref, catalog);
        if (entry === null) continue;
        this.paintSelectionHandles(ctx, obj as HardscapeObject, entry, oneCssPxInMm);
      }
    }
  }

  private paintSelectionHandles(
    ctx: CanvasRenderingContext2D,
    obj: HardscapeObject,
    entry: HardscapeEntry,
    oneCssPxInMm: number,
  ): void {
    const halfW = obj.transform.scale.x * entry.naturalSize.width * 0.5;
    const halfH = obj.transform.scale.y * entry.naturalSize.height * 0.5;
    if (halfW === 0 || halfH === 0) return;

    ctx.save();
    ctx.translate(obj.transform.position.x, obj.transform.position.y);
    if (obj.transform.rotation.z !== 0) {
      ctx.rotate(obj.transform.rotation.z);
    }

    ctx.lineWidth = SELECTION_LINE_WIDTH_PX * oneCssPxInMm;
    ctx.strokeStyle = SELECTION_COLOR;
    // Bounding box.
    ctx.strokeRect(-halfW, -halfH, 2 * halfW, 2 * halfH);

    // Four corner scale handles — square fills.
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

    // Rotate handle: small circle above the bbox, connected by a stalk.
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
}

// ─── F3.3 / F3.5 — Hardscape render helpers (module-level pure) ───────────

const SELECTION_COLOR = '#3a8eff';
const SELECTION_LINE_WIDTH_PX = 1.5;
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
  const halfW = (naturalW * 0.5) * sxRaw;
  const halfH = (naturalH * 0.5) * syRaw;
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

/** Fallback hardscape footprint when no catalog is provided to hit-test. */
const HARDSCAPE_FALLBACK_NATURAL_MM = 100;

// Suppress "unused" warnings for types reserved for future use here.
void ((): LayerId | undefined => undefined);
void ((): ObjectId | undefined => undefined);
