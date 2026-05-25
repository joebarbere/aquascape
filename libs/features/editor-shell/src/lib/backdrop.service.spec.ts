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
});
