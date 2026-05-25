// Backdrop-photo service. Stage 6 F6.3.
//
// View-only "import a photo as a backdrop layer" — the renderer paints
// the loaded image across the full backing buffer before any scene
// content, so the user can compose plants + hardscape ON TOP of a
// real-room reference photo. Per-user, persisted via `StorageService`
// under `aquascape.ui.backdrop.*` as a data URL (the image bytes
// inlined into the JSON blob — no separate asset store yet).
//
// Why data URL: keeps the service self-contained without threading the
// .aqua ZIP container's asset map through the document store. Trade-off:
// no sharing across devices (the backdrop doesn't follow the saved
// document). A future iteration can promote this into a schema-backed
// `scene.environment.backdrop` with proper ZIP asset embedding so
// backdrops follow shared `.aqua` files — for v1 the per-install
// persistence covers the dev workflow.
//
// Image-loading flow:
//   1. User picks a file → FileReader → data URL.
//   2. data URL → `new Image()` → `.decode()` (or await `onload`).
//   3. Persist data URL + commit decoded image to the `image` signal.
//   4. Renderer reads `backdrop()` and paints with the live image.
//
// On reload, the constructor hydrates the data URL from storage and
// kicks off the same decode flow.

import { Injectable, computed, inject, signal } from '@angular/core';

import type { BackdropImage } from '@aquascape/rendering/renderer-api';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

export const STORAGE_KEY_BACKDROP_ENABLED = 'aquascape.ui.backdrop.enabled';
export const STORAGE_KEY_BACKDROP_DATA_URL = 'aquascape.ui.backdrop.dataUrl';
export const STORAGE_KEY_BACKDROP_OPACITY = 'aquascape.ui.backdrop.opacity';

/** Default opacity when the user enables a backdrop for the first time. */
export const DEFAULT_BACKDROP_OPACITY = 0.6;
/** Hard cap on persisted data URL size (≈ 8 MB raw before base64 inflation).
 *  Keeps the storage blob bounded — bigger images hit the user with a
 *  visible error rather than silently bloating localStorage. */
export const MAX_BACKDROP_BYTES = 8 * 1024 * 1024;

/**
 * Test-friendly seam for loading an image from a data URL into something
 * the renderer can pass to `ctx.drawImage`. Production uses
 * `decodeImageElement` (below); tests inject a no-op that returns a
 * synthetic `CanvasImageSource`.
 */
export type ImageDecoder = (dataUrl: string) => Promise<CanvasImageSource>;

@Injectable({ providedIn: 'root' })
export class BackdropService {
  private readonly storage: StorageService = inject(STORAGE_SERVICE);

  private readonly enabledSignal = signal<boolean>(false);
  private readonly dataUrlSignal = signal<string | null>(null);
  private readonly opacitySignal = signal<number>(DEFAULT_BACKDROP_OPACITY);
  private readonly imageSignal = signal<CanvasImageSource | null>(null);
  private readonly lastErrorSignal = signal<string | null>(null);

  readonly enabled = this.enabledSignal.asReadonly();
  readonly dataUrl = this.dataUrlSignal.asReadonly();
  readonly opacity = this.opacitySignal.asReadonly();
  readonly image = this.imageSignal.asReadonly();
  readonly lastError = this.lastErrorSignal.asReadonly();

  /** True iff there's a loaded image to paint AND the user has enabled it. */
  readonly isLive = computed<boolean>(
    () => this.enabledSignal() && this.imageSignal() !== null && this.opacitySignal() > 0,
  );

  /**
   * `BackdropImage` snapshot the renderer consumes. `null` when there
   * is nothing live — the host passes `undefined` to `render()` in that
   * case so the paint method is a true no-op.
   */
  readonly backdrop = computed<BackdropImage | null>(() => {
    if (!this.enabledSignal()) return null;
    const image = this.imageSignal();
    if (image === null) return null;
    return { image, opacity: this.opacitySignal() };
  });

  /** Override for tests + the future Electron path that uses a different
   *  decode (e.g. `OffscreenCanvas.transferFromImageBitmap`). */
  decoder: ImageDecoder = decodeImageElement;

  constructor() {
    void this.hydrate();
  }

  setEnabled(next: boolean): void {
    this.enabledSignal.set(next);
    void this.storage.set(STORAGE_KEY_BACKDROP_ENABLED, next).catch(() => {
      // Non-fatal.
    });
  }

  setOpacity(next: number): void {
    if (!Number.isFinite(next)) return;
    const clamped = Math.max(0, Math.min(1, next));
    this.opacitySignal.set(clamped);
    void this.storage.set(STORAGE_KEY_BACKDROP_OPACITY, clamped).catch(() => {
      // Non-fatal.
    });
  }

  /**
   * Replace the backdrop image. `dataUrl` should be a fully-formed
   * `data:image/...;base64,...` string. The decoder converts it to a
   * `CanvasImageSource` the renderer can paint; on success both the
   * data URL and the decoded image are committed atomically (so a
   * mid-decode crash doesn't strand the storage blob without an image).
   *
   * Rejects with a string error message stored on `lastError` when the
   * decode fails or the data URL exceeds `MAX_BACKDROP_BYTES`.
   */
  async setImageFromDataUrl(dataUrl: string): Promise<void> {
    if (dataUrl.length > MAX_BACKDROP_BYTES) {
      const message = `Backdrop image too large (${formatBytes(dataUrl.length)} > ${formatBytes(MAX_BACKDROP_BYTES)}). Please pick a smaller photo.`;
      this.lastErrorSignal.set(message);
      throw new Error(message);
    }
    let decoded: CanvasImageSource;
    try {
      decoded = await this.decoder(dataUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image decode failed';
      this.lastErrorSignal.set(message);
      throw err instanceof Error ? err : new Error(message);
    }
    this.dataUrlSignal.set(dataUrl);
    this.imageSignal.set(decoded);
    this.lastErrorSignal.set(null);
    void this.storage.set(STORAGE_KEY_BACKDROP_DATA_URL, dataUrl).catch(() => {
      // Non-fatal — in-memory backdrop still works.
    });
  }

  /** Read a `File` (drag-drop or `<input type=file>`) as a data URL,
   *  then delegate to `setImageFromDataUrl`. */
  async setImageFromFile(file: File): Promise<void> {
    const dataUrl = await readFileAsDataUrl(file);
    await this.setImageFromDataUrl(dataUrl);
  }

  /** Drop the current image + clear storage. Enabled flag stays as-is. */
  async clear(): Promise<void> {
    this.dataUrlSignal.set(null);
    this.imageSignal.set(null);
    this.lastErrorSignal.set(null);
    await this.storage.remove(STORAGE_KEY_BACKDROP_DATA_URL).catch(() => {
      // Non-fatal.
    });
  }

  private async hydrate(): Promise<void> {
    try {
      const [enabled, opacity, dataUrl] = await Promise.all([
        this.storage.get<unknown>(STORAGE_KEY_BACKDROP_ENABLED),
        this.storage.get<unknown>(STORAGE_KEY_BACKDROP_OPACITY),
        this.storage.get<unknown>(STORAGE_KEY_BACKDROP_DATA_URL),
      ]);
      if (typeof enabled === 'boolean') this.enabledSignal.set(enabled);
      if (typeof opacity === 'number' && Number.isFinite(opacity)) {
        this.opacitySignal.set(Math.max(0, Math.min(1, opacity)));
      }
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
        this.dataUrlSignal.set(dataUrl);
        // Decode in the background. On failure we surface via lastError
        // but keep the data URL so a manual retry works.
        try {
          const decoded = await this.decoder(dataUrl);
          this.imageSignal.set(decoded);
        } catch (err) {
          this.lastErrorSignal.set(
            err instanceof Error ? err.message : 'Backdrop image failed to decode',
          );
        }
      }
    } catch {
      // Storage failure non-fatal.
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Default decoder — uses `new Image()` + the modern `.decode()` API
 * (Chromium / Firefox / Safari all support it). The decoded
 * `HTMLImageElement` is a valid `CanvasImageSource`.
 *
 * Exported for direct test coverage (the service swaps in a fake decoder
 * for most tests; this is the production path).
 */
export async function decodeImageElement(dataUrl: string): Promise<CanvasImageSource> {
  if (typeof Image === 'undefined') {
    throw new Error('No `Image` constructor available — cannot decode backdrop');
  }
  const img = new Image();
  img.src = dataUrl;
  if (typeof img.decode === 'function') {
    await img.decode();
  } else {
    await new Promise<void>((resolve, reject) => {
      img.onload = (): void => resolve();
      img.onerror = (): void => reject(new Error('Image failed to load'));
    });
  }
  return img;
}

/** Exported for direct test coverage of the FileReader path. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = (): void => reject(new Error('Failed to read file'));
    reader.onload = (): void => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader returned non-string result'));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
