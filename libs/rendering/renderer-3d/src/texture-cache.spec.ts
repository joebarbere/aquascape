import { NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';

import { TextureCache, type ImageLoadFn } from './texture-cache';

describe('TextureCache (Bucket 2)', () => {
  it('returns a placeholder-backed texture synchronously', () => {
    const cache = new TextureCache(() => undefined);
    const tex = cache.get('a.albedo.png', 'albedo');
    const image = tex.image as { width: number; height: number };
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    cache.dispose();
  });

  it('sets colorSpace per map kind (albedo sRGB; normal/roughness linear)', () => {
    const cache = new TextureCache(() => undefined);
    expect(cache.get('a.albedo.png', 'albedo').colorSpace).toBe(SRGBColorSpace);
    expect(cache.get('a.normal.png', 'normal').colorSpace).toBe(NoColorSpace);
    expect(cache.get('a.roughness.png', 'roughness').colorSpace).toBe(NoColorSpace);
    cache.dispose();
  });

  it('sets repeat wrapping on both axes (the maps tile in world space)', () => {
    const cache = new TextureCache(() => undefined);
    const tex = cache.get('a.albedo.png', 'albedo');
    expect(tex.wrapS).toBe(RepeatWrapping);
    expect(tex.wrapT).toBe(RepeatWrapping);
    cache.dispose();
  });

  it('dedupes by full URL — same URL returns the same Texture object', () => {
    const loads: string[] = [];
    const loader: ImageLoadFn = (url) => {
      loads.push(url);
    };
    const cache = new TextureCache(loader);
    const first = cache.get('stone.albedo.png', 'albedo');
    const second = cache.get('stone.albedo.png', 'albedo');
    expect(second).toBe(first);
    expect(cache.size()).toBe(1);
    expect(loads).toEqual(['stone.albedo.png']);
    cache.dispose();
  });

  it('upgrades the texture image IN PLACE when the load completes', () => {
    let resolveLoad: ((image: unknown) => void) | null = null;
    const loader: ImageLoadFn = (_url, onLoad) => {
      resolveLoad = onLoad;
    };
    const cache = new TextureCache(loader);
    const tex = cache.get('x.albedo.png', 'albedo');
    const placeholder = tex.image;
    const versionBefore = tex.version;

    const fakeImage = { width: 256, height: 256 };
    resolveLoad!(fakeImage);

    expect(tex.image).toBe(fakeImage);
    expect(tex.image).not.toBe(placeholder);
    // `needsUpdate = true` bumps `version` (the setter is write-only).
    expect(tex.version).toBeGreaterThan(versionBefore);
    cache.dispose();
  });

  it('keeps the neutral placeholder on load error (degrades to the procedural look)', () => {
    const loader: ImageLoadFn = (_url, _onLoad, onError) => {
      onError();
    };
    const cache = new TextureCache(loader);
    const tex = cache.get('missing.albedo.png', 'albedo');
    const image = tex.image as { width: number };
    expect(image.width).toBe(2);
    cache.dispose();
  });

  it('dispose() disposes every texture and clears the map', () => {
    const cache = new TextureCache(() => undefined);
    const a = cache.get('a.png', 'albedo');
    const b = cache.get('b.png', 'normal');
    const disposed: string[] = [];
    a.addEventListener('dispose', () => disposed.push('a'));
    b.addEventListener('dispose', () => disposed.push('b'));
    cache.dispose();
    expect(disposed.sort()).toEqual(['a', 'b']);
    expect(cache.size()).toBe(0);
  });
});
