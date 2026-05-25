// BackdropService tests. Stage 6 F6.3.

import { TestBed } from '@angular/core/testing';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  BackdropService,
  DEFAULT_BACKDROP_OPACITY,
  MAX_BACKDROP_BYTES,
  STORAGE_KEY_BACKDROP_DATA_URL,
  STORAGE_KEY_BACKDROP_ENABLED,
  STORAGE_KEY_BACKDROP_OPACITY,
  decodeImageElement,
  readFileAsDataUrl,
} from './backdrop.service';

const SAMPLE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const FAKE_IMAGE = { __fake: 'image' } as unknown as CanvasImageSource;

class FakeStorageService implements StorageService {
  readonly data = new Map<string, unknown>();
  get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.data.get(key) as T | undefined) ?? null);
  }
  set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function configure(storage: FakeStorageService = new FakeStorageService()) {
  TestBed.configureTestingModule({
    providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
  });
  const service = TestBed.inject(BackdropService);
  // Inject a fake decoder so tests don't need a real Image / jsdom decode.
  service.decoder = async (_dataUrl: string): Promise<CanvasImageSource> => FAKE_IMAGE;
  return { service, storage };
}

describe('BackdropService', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('defaults', () => {
    it('starts disabled, no image, default opacity', () => {
      const { service } = configure();
      expect(service.enabled()).toBe(false);
      expect(service.image()).toBeNull();
      expect(service.dataUrl()).toBeNull();
      expect(service.opacity()).toBe(DEFAULT_BACKDROP_OPACITY);
      expect(service.isLive()).toBe(false);
      expect(service.backdrop()).toBeNull();
    });
  });

  describe('setEnabled / setOpacity', () => {
    it('setEnabled persists + updates signal', async () => {
      const { service, storage } = configure();
      service.setEnabled(true);
      await flushPromises();
      expect(service.enabled()).toBe(true);
      expect(storage.data.get(STORAGE_KEY_BACKDROP_ENABLED)).toBe(true);
    });

    it('setOpacity clamps to [0, 1] + persists', async () => {
      const { service, storage } = configure();
      service.setOpacity(0.42);
      await flushPromises();
      expect(service.opacity()).toBe(0.42);
      expect(storage.data.get(STORAGE_KEY_BACKDROP_OPACITY)).toBe(0.42);
      service.setOpacity(2);
      expect(service.opacity()).toBe(1);
      service.setOpacity(-0.5);
      expect(service.opacity()).toBe(0);
    });

    it('setOpacity ignores non-finite inputs', () => {
      const { service } = configure();
      const before = service.opacity();
      service.setOpacity(Number.NaN);
      expect(service.opacity()).toBe(before);
    });

    it('setEnabled + setOpacity survive a storage.set rejection', async () => {
      const failing: StorageService = {
        get: () => Promise.resolve(null),
        set: () => Promise.reject(new Error('set boom')),
        remove: () => Promise.resolve(),
      };
      TestBed.configureTestingModule({
        providers: [{ provide: STORAGE_SERVICE, useValue: failing }],
      });
      const service = TestBed.inject(BackdropService);
      service.decoder = async (): Promise<CanvasImageSource> => FAKE_IMAGE;
      service.setEnabled(true);
      service.setOpacity(0.25);
      await service.setImageFromDataUrl(SAMPLE_DATA_URL);
      await flushPromises();
      // In-memory state still set despite every storage.set rejecting.
      expect(service.enabled()).toBe(true);
      expect(service.opacity()).toBe(0.25);
      expect(service.image()).toBe(FAKE_IMAGE);
    });
  });

  describe('setImageFromDataUrl', () => {
    it('decodes + commits image + dataUrl + persists', async () => {
      const { service, storage } = configure();
      await service.setImageFromDataUrl(SAMPLE_DATA_URL);
      expect(service.dataUrl()).toBe(SAMPLE_DATA_URL);
      expect(service.image()).toBe(FAKE_IMAGE);
      expect(service.lastError()).toBeNull();
      expect(storage.data.get(STORAGE_KEY_BACKDROP_DATA_URL)).toBe(SAMPLE_DATA_URL);
    });

    it('rejects + sets lastError when the data URL exceeds MAX_BACKDROP_BYTES', async () => {
      const { service, storage } = configure();
      const tooBig = 'x'.repeat(MAX_BACKDROP_BYTES + 1);
      await expect(service.setImageFromDataUrl(tooBig)).rejects.toThrow(/too large/i);
      expect(service.lastError()).toMatch(/too large/i);
      // Storage NOT touched — no half-written state.
      expect(storage.data.has(STORAGE_KEY_BACKDROP_DATA_URL)).toBe(false);
    });

    it('rejects + sets lastError when the decoder throws', async () => {
      const { service } = configure();
      service.decoder = async (): Promise<CanvasImageSource> => {
        throw new Error('decode boom');
      };
      await expect(service.setImageFromDataUrl(SAMPLE_DATA_URL)).rejects.toThrow('decode boom');
      expect(service.lastError()).toBe('decode boom');
      // No image committed.
      expect(service.image()).toBeNull();
    });
  });

  describe('backdrop / isLive computed', () => {
    it('isLive is true only when enabled + image set + opacity > 0', async () => {
      const { service } = configure();
      expect(service.isLive()).toBe(false);

      service.setEnabled(true);
      expect(service.isLive()).toBe(false); // no image yet

      await service.setImageFromDataUrl(SAMPLE_DATA_URL);
      expect(service.isLive()).toBe(true);

      service.setOpacity(0);
      expect(service.isLive()).toBe(false); // opacity 0 kills it
    });

    it('backdrop snapshot includes image + opacity when live', async () => {
      const { service } = configure();
      service.setEnabled(true);
      await service.setImageFromDataUrl(SAMPLE_DATA_URL);
      service.setOpacity(0.75);
      const snap = service.backdrop();
      expect(snap).toEqual({ image: FAKE_IMAGE, opacity: 0.75 });
    });

    it('backdrop returns null when disabled, even if image is loaded', async () => {
      const { service } = configure();
      await service.setImageFromDataUrl(SAMPLE_DATA_URL);
      expect(service.backdrop()).toBeNull();
    });
  });

  describe('clear', () => {
    it('drops the image + data URL + storage entry', async () => {
      const { service, storage } = configure();
      await service.setImageFromDataUrl(SAMPLE_DATA_URL);
      expect(storage.data.has(STORAGE_KEY_BACKDROP_DATA_URL)).toBe(true);
      await service.clear();
      expect(service.image()).toBeNull();
      expect(service.dataUrl()).toBeNull();
      expect(storage.data.has(STORAGE_KEY_BACKDROP_DATA_URL)).toBe(false);
    });

    it('preserves the enabled flag (user toggle, not asset state)', async () => {
      const { service } = configure();
      service.setEnabled(true);
      await service.setImageFromDataUrl(SAMPLE_DATA_URL);
      await service.clear();
      expect(service.enabled()).toBe(true);
    });
  });

  describe('hydrate on construct', () => {
    it('restores enabled + opacity + dataUrl + decodes image', async () => {
      const storage = new FakeStorageService();
      await storage.set(STORAGE_KEY_BACKDROP_ENABLED, true);
      await storage.set(STORAGE_KEY_BACKDROP_OPACITY, 0.3);
      await storage.set(STORAGE_KEY_BACKDROP_DATA_URL, SAMPLE_DATA_URL);
      const { service } = configure(storage);
      await flushPromises();
      expect(service.enabled()).toBe(true);
      expect(service.opacity()).toBe(0.3);
      expect(service.dataUrl()).toBe(SAMPLE_DATA_URL);
      expect(service.image()).toBe(FAKE_IMAGE);
    });

    it('surfaces a decode failure via lastError but keeps the data URL', async () => {
      const storage = new FakeStorageService();
      await storage.set(STORAGE_KEY_BACKDROP_DATA_URL, SAMPLE_DATA_URL);
      TestBed.configureTestingModule({
        providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
      });
      const service = TestBed.inject(BackdropService);
      service.decoder = async (): Promise<CanvasImageSource> => {
        throw new Error('bad image');
      };
      // Hydrate already kicked off in the constructor (before we swapped
      // the decoder). Re-prime by calling setImageFromDataUrl to exercise
      // the swap'd decoder path AND assert lastError populates.
      await expect(service.setImageFromDataUrl(SAMPLE_DATA_URL)).rejects.toThrow('bad image');
      expect(service.lastError()).toBe('bad image');
      expect(service.dataUrl()).toBe(SAMPLE_DATA_URL);
    });

    it('ignores corrupt storage values', async () => {
      const storage = new FakeStorageService();
      storage.data.set(STORAGE_KEY_BACKDROP_ENABLED, 'yes');
      storage.data.set(STORAGE_KEY_BACKDROP_OPACITY, 'half');
      storage.data.set(STORAGE_KEY_BACKDROP_DATA_URL, 'not-a-data-url');
      const { service } = configure(storage);
      await flushPromises();
      expect(service.enabled()).toBe(false);
      expect(service.opacity()).toBe(DEFAULT_BACKDROP_OPACITY);
      expect(service.dataUrl()).toBeNull();
    });
  });

  describe('setImageFromFile', () => {
    it('reads the File as a data URL then commits via the decoder', async () => {
      const { service } = configure();
      const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
      // Stub global FileReader so the deterministic data URL flows through.
      const originalReader = globalThis.FileReader;
      class FakeFileReader {
        result: string | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(_: File): void {
          this.result = SAMPLE_DATA_URL;
          if (this.onload !== null) this.onload();
        }
      }
      (globalThis as { FileReader: typeof FileReader }).FileReader =
        FakeFileReader as unknown as typeof FileReader;
      try {
        await service.setImageFromFile(file);
        expect(service.dataUrl()).toBe(SAMPLE_DATA_URL);
        expect(service.image()).toBe(FAKE_IMAGE);
      } finally {
        globalThis.FileReader = originalReader;
      }
    });

    it('propagates a FileReader error', async () => {
      const { service } = configure();
      const originalReader = globalThis.FileReader;
      class FailingReader {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(_: File): void {
          if (this.onerror !== null) this.onerror();
        }
      }
      (globalThis as { FileReader: typeof FileReader }).FileReader =
        FailingReader as unknown as typeof FileReader;
      try {
        await expect(
          service.setImageFromFile(new File([], 'x.png', { type: 'image/png' })),
        ).rejects.toThrow(/Failed to read file/);
      } finally {
        globalThis.FileReader = originalReader;
      }
    });

    it('propagates a non-string FileReader result', async () => {
      const { service } = configure();
      const originalReader = globalThis.FileReader;
      class WeirdReader {
        result: ArrayBuffer | null = new ArrayBuffer(8);
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(_: File): void {
          if (this.onload !== null) this.onload();
        }
      }
      (globalThis as { FileReader: typeof FileReader }).FileReader =
        WeirdReader as unknown as typeof FileReader;
      try {
        await expect(
          service.setImageFromFile(new File([], 'x.png', { type: 'image/png' })),
        ).rejects.toThrow(/non-string result/);
      } finally {
        globalThis.FileReader = originalReader;
      }
    });
  });

  describe('clear — storage rejection', () => {
    it('still clears the in-memory state when storage.remove rejects', async () => {
      const failing: StorageService = {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        remove: () => Promise.reject(new Error('remove boom')),
      };
      TestBed.configureTestingModule({
        providers: [{ provide: STORAGE_SERVICE, useValue: failing }],
      });
      const service = TestBed.inject(BackdropService);
      service.decoder = async (): Promise<CanvasImageSource> => FAKE_IMAGE;
      await service.setImageFromDataUrl(SAMPLE_DATA_URL);
      await service.clear();
      expect(service.image()).toBeNull();
      expect(service.dataUrl()).toBeNull();
    });
  });

  describe('default helpers', () => {
    describe('decodeImageElement', () => {
      it('throws when no Image constructor is available', async () => {
        const origImage = (globalThis as { Image?: unknown }).Image;
        delete (globalThis as { Image?: unknown }).Image;
        try {
          await expect(decodeImageElement(SAMPLE_DATA_URL)).rejects.toThrow(/No `Image` constructor/);
        } finally {
          if (origImage !== undefined) (globalThis as { Image: unknown }).Image = origImage;
        }
      });

      it('falls back to onload when Image.decode is unavailable', async () => {
        // Stub Image with no `.decode` so the onload/onerror fallback path is
        // exercised. Each `new Image()` returns an object that fires onload
        // synchronously when src is assigned.
        const origImage = (globalThis as { Image?: unknown }).Image;
        class NoDecodeImage {
          private _src = '';
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          set src(value: string) {
            this._src = value;
            queueMicrotask(() => this.onload?.());
          }
          get src(): string {
            return this._src;
          }
        }
        (globalThis as { Image: unknown }).Image = NoDecodeImage as unknown as typeof Image;
        try {
          const img = await decodeImageElement(SAMPLE_DATA_URL);
          expect(img).toBeInstanceOf(NoDecodeImage);
        } finally {
          if (origImage !== undefined) (globalThis as { Image: unknown }).Image = origImage;
          else delete (globalThis as { Image?: unknown }).Image;
        }
      });

      it('rejects when the fallback onerror fires', async () => {
        const origImage = (globalThis as { Image?: unknown }).Image;
        class FailingImage {
          private _src = '';
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          set src(value: string) {
            this._src = value;
            queueMicrotask(() => this.onerror?.());
          }
          get src(): string {
            return this._src;
          }
        }
        (globalThis as { Image: unknown }).Image = FailingImage as unknown as typeof Image;
        try {
          await expect(decodeImageElement(SAMPLE_DATA_URL)).rejects.toThrow(/Image failed to load/);
        } finally {
          if (origImage !== undefined) (globalThis as { Image: unknown }).Image = origImage;
          else delete (globalThis as { Image?: unknown }).Image;
        }
      });
    });

    describe('readFileAsDataUrl', () => {
      it('returns the FileReader.result string', async () => {
        const originalReader = globalThis.FileReader;
        class OK {
          result: string | null = SAMPLE_DATA_URL;
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          readAsDataURL(_: File): void {
            if (this.onload !== null) this.onload();
          }
        }
        (globalThis as { FileReader: typeof FileReader }).FileReader =
          OK as unknown as typeof FileReader;
        try {
          const out = await readFileAsDataUrl(new File([], 'x.png', { type: 'image/png' }));
          expect(out).toBe(SAMPLE_DATA_URL);
        } finally {
          globalThis.FileReader = originalReader;
        }
      });
    });
  });
});
