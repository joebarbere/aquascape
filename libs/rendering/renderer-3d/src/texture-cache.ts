/**
 * Catalog texture cache — Bucket 2 of the 3D fidelity plan.
 *
 * One cache per `Three3DRenderer` LIFETIME (not per content rebuild): the
 * renderer rebuilds its content group on every `render()` call, but the
 * texture pixels are immutable assets — re-fetching / re-uploading them per
 * rebuild would thrash the GPU. `disposeNode`'s rebuild walk never touches
 * these textures because the patched materials hold them via
 * `onBeforeCompile` uniforms, not `material.map` (and `Material.dispose()`
 * never disposes textures anyway). The renderer disposes the cache exactly
 * once, in `dispose()`.
 *
 * THE PLACEHOLDER → IMAGE UPGRADE TRICK
 * -------------------------------------
 * `get(url, kind)` returns a `THREE.Texture` SYNCHRONOUSLY whose `.image`
 * starts as a tiny 2×2 NEUTRAL placeholder, then loads the real image via
 * `THREE.ImageLoader` (NOT `TextureLoader` — TextureLoader would hand back a
 * *new* Texture, but we must keep the ONE Texture object alive so the
 * already-patched materials pick the pixels up the moment they arrive:
 * `texture.image = img; texture.needsUpdate = true` re-uploads in place, no
 * material recompile, no uniform rewire). "Neutral" means the triplanar
 * patch's modulation evaluates to ≈ 1.0 (identity) while the placeholder is
 * showing, so a still-loading (or 404'd, or unit-test) texture leaves the
 * render looking like the pre-Bucket-2 procedural baseline:
 *
 *  - albedo:    sRGB-encoded LINEAR mid-gray (byte 188 ≈ linear 0.5 after
 *               the sampler's sRGB decode) — `2.0 × 0.5 = 1.0` under the
 *               patch's recentring multiply. A literal byte-128 mid-gray
 *               would decode to linear ≈ 0.214 and darken everything ~2×.
 *  - normal:    (128, 128, 255) — the flat tangent-space normal; zero
 *               perturbation.
 *  - roughness: byte 128 (the map is linear, no decode) — `2.0 × 0.5 = 1.0`
 *               under the same recentring.
 *
 * Image loading is guarded behind `typeof document !== 'undefined'`
 * (`ImageLoader` creates an `<img>` element): jsdom-less unit envs still get
 * placeholder textures from `get`, they just never upgrade.
 */

import {
  ImageLoader,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three';

/** Which map a texture ref denotes. Drives placeholder pixels + colorSpace. */
export type CatalogTextureKind = 'albedo' | 'normal' | 'roughness';

/**
 * Injectable image-load function. The default (browser) implementation wraps
 * `THREE.ImageLoader`; tests inject a synchronous fake to exercise the
 * placeholder → image upgrade without a DOM.
 */
export type ImageLoadFn = (
  url: string,
  onLoad: (image: unknown) => void,
  onError: () => void,
) => void;

/**
 * sRGB-encoded linear mid-gray for the albedo placeholder. See the header —
 * byte 188 decodes to linear ≈ 0.502, which the patch's `2.0 ×` recentring
 * maps to ≈ 1.0 (identity modulation).
 */
const ALBEDO_PLACEHOLDER_BYTE = 188;
/** Linear mid-gray for the roughness placeholder (no sRGB decode). */
const ROUGHNESS_PLACEHOLDER_BYTE = 128;

/** RGBA bytes for one placeholder texel of the given kind. */
function placeholderTexel(kind: CatalogTextureKind): [number, number, number, number] {
  switch (kind) {
    case 'albedo':
      return [ALBEDO_PLACEHOLDER_BYTE, ALBEDO_PLACEHOLDER_BYTE, ALBEDO_PLACEHOLDER_BYTE, 255];
    case 'normal':
      return [128, 128, 255, 255];
    case 'roughness':
      return [ROUGHNESS_PLACEHOLDER_BYTE, ROUGHNESS_PLACEHOLDER_BYTE, ROUGHNESS_PLACEHOLDER_BYTE, 255];
  }
}

/**
 * Build the 2×2 placeholder image. In a browser this is a tiny canvas (a
 * valid `TexImageSource` Three.js can upload); in a jsdom-less unit env it's
 * a plain `{ width, height, data }` object — never uploaded (nothing paints
 * in that env), but inspectable by tests.
 */
function buildPlaceholderImage(kind: CatalogTextureKind): unknown {
  const [r, g, b, a] = placeholderTexel(kind);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
      ctx.fillRect(0, 0, 2, 2);
    }
    return canvas;
  }
  const data = new Uint8Array(2 * 2 * 4);
  for (let i = 0; i < 4; i++) {
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width: 2, height: 2, data };
}

/** Default loader: `THREE.ImageLoader` when a DOM exists, else null. */
function defaultImageLoader(): ImageLoadFn | null {
  if (typeof document === 'undefined') return null;
  const loader = new ImageLoader();
  return (url, onLoad, onError) => {
    loader.load(url, onLoad, undefined, onError);
  };
}

/**
 * URL-keyed cache of catalog textures. Keyed by FULL URL (base + ref); if
 * the same URL is ever requested under two different kinds, the first
 * request's kind wins (the manifest naming convention
 * `<family>.<kind>.png` makes that collision structurally impossible for
 * well-formed packs).
 */
export class TextureCache {
  private readonly textures = new Map<string, Texture>();
  private readonly loadImage: ImageLoadFn | null;

  /**
   * @param loadImage injectable image loader — tests pass a fake; production
   * omits it and gets the `ImageLoader`-backed default (null in jsdom-less
   * envs, where placeholders simply never upgrade).
   */
  constructor(loadImage?: ImageLoadFn) {
    this.loadImage = loadImage ?? defaultImageLoader();
  }

  /**
   * Return the texture for `url`, creating (and starting the async image
   * load for) it on first sight. Synchronous: the returned texture is
   * immediately usable as a shader uniform value — its placeholder image
   * keeps the patch neutral until the real pixels arrive.
   */
  get(url: string, kind: CatalogTextureKind): Texture {
    const cached = this.textures.get(url);
    if (cached !== undefined) return cached;

    const texture = new Texture();
    texture.image = buildPlaceholderImage(kind);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    // Albedo is authored in sRGB (the sampler decodes to linear); normal +
    // roughness carry non-colour data and must NOT be decoded.
    texture.colorSpace = kind === 'albedo' ? SRGBColorSpace : NoColorSpace;
    texture.needsUpdate = true;
    this.textures.set(url, texture);

    if (this.loadImage !== null) {
      this.loadImage(
        url,
        (image) => {
          // Upgrade IN PLACE — same Texture object, so every material whose
          // uniforms already reference it picks the pixels up on the next
          // frame without a recompile.
          texture.image = image as typeof texture.image;
          texture.needsUpdate = true;
        },
        () => {
          // Missing / broken asset: keep the neutral placeholder. The render
          // stays at the procedural baseline rather than going black.
        },
      );
    }
    return texture;
  }

  /** Number of distinct URLs currently cached. Exposed for tests. */
  size(): number {
    return this.textures.size;
  }

  /** Dispose every cached texture and clear the map. */
  dispose(): void {
    for (const texture of this.textures.values()) {
      texture.dispose();
    }
    this.textures.clear();
  }
}
