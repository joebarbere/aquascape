// Offscreen PNG / JPEG export. Stage 6 F6.1.
//
// Renders a `Scene` into raster bytes via the existing `Canvas2DRenderer`
// attached to a host-supplied canvas. The renderer paints under the
// usual world transform — pixels are byte-identical to what the user
// sees on screen, scaled to the requested resolution.
//
// The host (a browser or Electron renderer) provides a canvas factory
// because this lib is platform-agnostic — tests pass a fake canvas,
// production calls `document.createElement('canvas')`. The helper itself
// has no DOM imports.
//
// Resolution: the caller passes `widthCss × heightCss` (CSS pixels — the
// renderer multiplies by DPR internally if you pass one). For "fit to
// scene" we use `defaultViewport`-style math; for explicit resolutions
// the caller computes the viewport themselves.

import { Canvas2DRenderer } from '@aquascape/rendering/renderer-2d';
import type {
  RenderSurface,
  SceneRenderer,
  Viewport,
} from '@aquascape/rendering/renderer-api';
import type { Catalog } from '@aquascape/domain/catalog';
import type { Scene } from '@aquascape/domain/scene-model';

/** Pixel format the host requested. */
export type ExportImageFormat = 'png' | 'jpeg';

/** Common output resolutions exposed by the export UI. */
export interface ExportResolution {
  readonly widthCss: number;
  readonly heightCss: number;
}

export const RESOLUTION_PRESETS: ReadonlyArray<{ id: string; label: string; resolution: ExportResolution }> = [
  { id: '1080', label: 'HD 1080p (1920 × 1080)', resolution: { widthCss: 1920, heightCss: 1080 } },
  { id: '2k', label: '2K (2560 × 1440)', resolution: { widthCss: 2560, heightCss: 1440 } },
  { id: '4k', label: '4K UHD (3840 × 2160)', resolution: { widthCss: 3840, heightCss: 2160 } },
  { id: 'thumb', label: 'Thumbnail (480 × 270)', resolution: { widthCss: 480, heightCss: 270 } },
];

/**
 * Anything shaped like an `HTMLCanvasElement` that the renderer can
 * attach to and that can produce a blob. Tests pass a `FakeCanvas`;
 * production passes `document.createElement('canvas')`.
 */
export interface CanvasLike {
  width: number;
  height: number;
  style: { width: string; height: string };
  getContext(kind: '2d'): unknown;
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

/** Inputs for `renderSceneToImageBytes`. */
export interface OffscreenRenderRequest {
  readonly scene: Scene;
  readonly catalog: Catalog;
  readonly resolution: ExportResolution;
  readonly format: ExportImageFormat;
  /** JPEG quality in [0, 1]. Ignored for PNG. Default 0.92. */
  readonly quality?: number;
  /** DPR multiplier for the backing store. Default 1 (export at exact CSS size). */
  readonly devicePixelRatio?: number;
  /**
   * Optional canvas factory. Default: `document.createElement('canvas')`.
   * Tests pass a factory that returns a `FakeCanvas`.
   */
  readonly createCanvas?: () => CanvasLike;
}

/**
 * Render `scene` offscreen at the requested resolution + format and
 * return the raw image bytes ready to hand to `RenderExportService
 * .exportPng({ bytes, suggestedName })`.
 *
 * Throws if `toBlob` returns null (canvas tainted or quota exhausted)
 * — the caller maps the error into a user-visible message.
 */
export async function renderSceneToImageBytes(
  req: OffscreenRenderRequest,
): Promise<Uint8Array> {
  const factory = req.createCanvas ?? defaultCreateCanvas;
  const canvas = factory();
  // The renderer manages canvas.width / canvas.height itself via
  // syncCanvasSize; we just need to seed the CSS dims for getBoundingClientRect
  // expectations (style is unused by the renderer post the Stage 5.x fix,
  // but FakeCanvas reads it in some assertions).
  canvas.style.width = `${req.resolution.widthCss}px`;
  canvas.style.height = `${req.resolution.heightCss}px`;
  const dpr = req.devicePixelRatio ?? 1;

  const surface: RenderSurface = {
    canvas: canvas as unknown as HTMLCanvasElement,
    devicePixelRatio: dpr,
    width: req.resolution.widthCss,
    height: req.resolution.heightCss,
  };

  const renderer: SceneRenderer = new Canvas2DRenderer();
  try {
    renderer.attach(surface);
    const viewport = fitViewport(req.resolution, req.scene);
    renderer.render(req.scene, viewport, { catalog: req.catalog });
  } finally {
    // Dispose so the renderer's resize listener doesn't leak into the
    // host (production runs against `document` add a real window listener).
    renderer.dispose();
  }

  return canvasToBytes(canvas, req.format, req.quality ?? 0.92);
}

/**
 * Compute a centred fit-to-window viewport at the export resolution —
 * same shape as the editor's `defaultViewport`, but free-standing here
 * so the export pipeline doesn't pull `apps/web` into a feature lib.
 */
export function fitViewport(resolution: ExportResolution, scene: Scene): Viewport {
  const { width: tankW, height: tankH } = scene.tank;
  if (tankW <= 0 || tankH <= 0) {
    return { center: { x: 0, y: 0 }, zoom: 0, rotation: 0 };
  }
  const PAD = 1.1;
  const zoomX = resolution.widthCss / (tankW * PAD);
  const zoomY = resolution.heightCss / (tankH * PAD);
  return {
    center: { x: tankW / 2, y: tankH / 2 },
    zoom: Math.min(zoomX, zoomY),
    rotation: 0,
  };
}

function defaultCreateCanvas(): CanvasLike {
  if (typeof document === 'undefined') {
    throw new Error('renderSceneToImageBytes: no `document` available — pass a `createCanvas` factory');
  }
  return document.createElement('canvas') as unknown as CanvasLike;
}

function canvasToBytes(
  canvas: CanvasLike,
  format: ExportImageFormat,
  quality: number,
): Promise<Uint8Array> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error(`canvas.toBlob returned null for ${mime}`));
          return;
        }
        blob
          .arrayBuffer()
          .then((buf) => resolve(new Uint8Array(buf)))
          .catch((err: unknown) =>
            reject(err instanceof Error ? err : new Error(String(err))),
          );
      },
      mime,
      quality,
    );
  });
}
