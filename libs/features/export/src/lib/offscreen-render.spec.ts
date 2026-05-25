// Offscreen-render pipeline tests. Stage 6 F6.1.
//
// We use a hand-rolled FakeCanvasForExport that records draw ops + serves
// up a synthetic Blob for `toBlob`. The real Canvas2DRenderer (which we
// import here for an end-to-end test) attaches to this fake the same way
// it does to a real `<canvas>` element.

import type { Catalog } from '@aquascape/domain/catalog';
import type { Scene } from '@aquascape/domain/scene-model';

import {
  RESOLUTION_PRESETS,
  fitViewport,
  renderSceneToImageBytes,
  type CanvasLike,
} from './offscreen-render';

// ─── Test canvas ──────────────────────────────────────────────────────────

class FakeCanvasForExport implements CanvasLike {
  width = 0;
  height = 0;
  style = { width: '', height: '' };
  // The recording context is intentionally minimal — Canvas2DRenderer
  // exercises many ops, but for THIS test we only care that it can
  // attach + render + that we capture a `toBlob` call at the end. So
  // every method is a no-op (the renderer doesn't read state back).
  private readonly ctx: Record<string, unknown> = createNoopContext();

  getContext(kind: '2d'): unknown {
    if (kind !== '2d') return null;
    return this.ctx;
  }

  toBlobCalls: Array<{ type: string | undefined; quality: number | undefined }> = [];
  toBlob(
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ): void {
    this.toBlobCalls.push({ type, quality });
    // Return a synthetic 4-byte blob; arrayBuffer() is polyfilled below.
    const blob = makeFakeBlob(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    callback(blob);
  }
}

function createNoopContext(): Record<string, unknown> {
  const noop = (): void => undefined;
  return new Proxy(
    {
      lineWidth: 1,
      strokeStyle: '#000',
      fillStyle: '#000',
      globalAlpha: 1,
    } as Record<string, unknown>,
    {
      get(target, prop) {
        if (prop in target) return Reflect.get(target, prop);
        // Every other prop access returns a no-op function (handles arc /
        // setTransform / save / restore / fillRect / strokeRect / etc.).
        return noop;
      },
      set(target, prop, value) {
        Reflect.set(target, prop, value);
        return true;
      },
    },
  );
}

function makeFakeBlob(bytes: Uint8Array): Blob {
  return {
    size: bytes.byteLength,
    type: 'image/png',
    arrayBuffer: (): Promise<ArrayBuffer> =>
      Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
    slice: () => makeFakeBlob(bytes),
    stream: (): never => {
      throw new Error('stream not implemented in fake');
    },
    text: (): Promise<string> => Promise.resolve(''),
  } as unknown as Blob;
}

// ─── Scene + catalog fixtures ─────────────────────────────────────────────

function minimalScene(): Scene {
  return {
    tank: {
      width: 360,
      height: 220,
      depth: 220,
      glassThickness: 5,
      style: { frame: 'rimless', background: { kind: 'color', color: '#0a1622' } },
    },
    substrate: { regions: [] },
    layers: [],
    seed: 1,
  } as Scene;
}

const emptyCatalog: Catalog = {
  entries: [] as never,
  get: () => null,
  byKind: () => [] as never,
} as never;

// ─── fitViewport ──────────────────────────────────────────────────────────

describe('fitViewport', () => {
  it('centres on the tank geometric centre', () => {
    const v = fitViewport({ widthCss: 800, heightCss: 600 }, minimalScene());
    expect(v.center).toEqual({ x: 180, y: 110 });
  });

  it('picks the tighter of the two axes (with 10% padding factor)', () => {
    // 800px / (360 × 1.1) = 2.02, 600px / (220 × 1.1) = 2.479. Min = 2.02.
    const v = fitViewport({ widthCss: 800, heightCss: 600 }, minimalScene());
    expect(v.zoom).toBeCloseTo(800 / (360 * 1.1), 6);
  });

  it('degenerate tank → zoom 0', () => {
    const scene = minimalScene();
    (scene.tank as { width: number }).width = 0;
    const v = fitViewport({ widthCss: 800, heightCss: 600 }, scene);
    expect(v.zoom).toBe(0);
  });

  it('rotation always 0 for exports', () => {
    const v = fitViewport({ widthCss: 800, heightCss: 600 }, minimalScene());
    expect(v.rotation).toBe(0);
  });
});

// ─── renderSceneToImageBytes ─────────────────────────────────────────────

describe('renderSceneToImageBytes', () => {
  it('returns the bytes from canvas.toBlob → arrayBuffer', async () => {
    const fake = new FakeCanvasForExport();
    const bytes = await renderSceneToImageBytes({
      scene: minimalScene(),
      catalog: emptyCatalog,
      resolution: { widthCss: 800, heightCss: 600 },
      format: 'png',
      createCanvas: () => fake,
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    // The fake blob carries the PNG magic header bytes.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('requests image/png by default + defaults quality to 0.92', async () => {
    const fake = new FakeCanvasForExport();
    await renderSceneToImageBytes({
      scene: minimalScene(),
      catalog: emptyCatalog,
      resolution: { widthCss: 800, heightCss: 600 },
      format: 'png',
      createCanvas: () => fake,
    });
    expect(fake.toBlobCalls).toHaveLength(1);
    expect(fake.toBlobCalls[0]?.type).toBe('image/png');
    expect(fake.toBlobCalls[0]?.quality).toBe(0.92);
  });

  it('requests image/jpeg + honours an explicit quality', async () => {
    const fake = new FakeCanvasForExport();
    await renderSceneToImageBytes({
      scene: minimalScene(),
      catalog: emptyCatalog,
      resolution: { widthCss: 800, heightCss: 600 },
      format: 'jpeg',
      quality: 0.5,
      createCanvas: () => fake,
    });
    expect(fake.toBlobCalls[0]?.type).toBe('image/jpeg');
    expect(fake.toBlobCalls[0]?.quality).toBe(0.5);
  });

  it('writes CSS dimensions to the canvas style', async () => {
    const fake = new FakeCanvasForExport();
    await renderSceneToImageBytes({
      scene: minimalScene(),
      catalog: emptyCatalog,
      resolution: { widthCss: 1920, heightCss: 1080 },
      format: 'png',
      createCanvas: () => fake,
    });
    expect(fake.style.width).toBe('1920px');
    expect(fake.style.height).toBe('1080px');
  });

  it('rejects when toBlob returns null', async () => {
    class NullBlobCanvas extends FakeCanvasForExport {
      override toBlob(callback: (blob: Blob | null) => void): void {
        callback(null);
      }
    }
    await expect(
      renderSceneToImageBytes({
        scene: minimalScene(),
        catalog: emptyCatalog,
        resolution: { widthCss: 800, heightCss: 600 },
        format: 'png',
        createCanvas: () => new NullBlobCanvas(),
      }),
    ).rejects.toThrow(/toBlob returned null/);
  });

  it('throws a clear error when no createCanvas is passed AND no document exists', async () => {
    // Stash + remove document to simulate a Node environment.
    const orig = (globalThis as { document?: unknown }).document;
    delete (globalThis as { document?: unknown }).document;
    try {
      await expect(
        renderSceneToImageBytes({
          scene: minimalScene(),
          catalog: emptyCatalog,
          resolution: { widthCss: 800, heightCss: 600 },
          format: 'png',
        }),
      ).rejects.toThrow(/no `document` available/);
    } finally {
      if (orig !== undefined) (globalThis as { document?: unknown }).document = orig;
    }
  });
});

describe('RESOLUTION_PRESETS', () => {
  it('exposes 1080p / 2K / 4K / thumbnail with sensible CSS sizes', () => {
    const ids = RESOLUTION_PRESETS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['1080', '2k', '4k', 'thumb']));
    for (const p of RESOLUTION_PRESETS) {
      expect(p.resolution.widthCss).toBeGreaterThan(0);
      expect(p.resolution.heightCss).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });
});
