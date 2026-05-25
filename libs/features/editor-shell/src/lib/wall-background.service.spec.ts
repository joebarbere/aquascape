// WallBackgroundService tests. Stage 5.x.

import { TestBed } from '@angular/core/testing';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  DEFAULT_WALL_COLOR,
  DEFAULT_WALL_HEIGHT_MM,
  DEFAULT_WALL_WIDTH_MM,
  MAX_WALL_DIM_MM,
  MIN_WALL_DIM_MM,
  STORAGE_KEY_WALL_COLOR,
  STORAGE_KEY_WALL_ENABLED,
  STORAGE_KEY_WALL_HEIGHT_MM,
  STORAGE_KEY_WALL_WIDTH_MM,
  WallBackgroundService,
} from './wall-background.service';

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
  // Three ticks: hydrate awaits four sequential storage reads, then sets
  // the signals. Two ticks usually suffice; three is the safe ceiling.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function configure(storage: FakeStorageService = new FakeStorageService()): {
  service: WallBackgroundService;
  storage: FakeStorageService;
} {
  TestBed.configureTestingModule({
    providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
  });
  const service = TestBed.inject(WallBackgroundService);
  return { service, storage };
}

describe('WallBackgroundService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('defaults', () => {
    it('starts disabled with the shipped defaults', () => {
      const { service } = configure();
      expect(service.enabled()).toBe(false);
      expect(service.color()).toBe(DEFAULT_WALL_COLOR);
      expect(service.widthMm()).toBe(DEFAULT_WALL_WIDTH_MM);
      expect(service.heightMm()).toBe(DEFAULT_WALL_HEIGHT_MM);
    });

    it('wall() snapshot matches the renderer-api shape', () => {
      const { service } = configure();
      expect(service.wall()).toEqual({
        enabled: false,
        color: DEFAULT_WALL_COLOR,
        widthMm: DEFAULT_WALL_WIDTH_MM,
        heightMm: DEFAULT_WALL_HEIGHT_MM,
      });
    });
  });

  describe('setters + persistence', () => {
    it('setEnabled writes through to storage', async () => {
      const { service, storage } = configure();
      service.setEnabled(true);
      await flushPromises();
      expect(service.enabled()).toBe(true);
      expect(storage.data.get(STORAGE_KEY_WALL_ENABLED)).toBe(true);
    });

    it('setColor accepts valid hex and persists', async () => {
      const { service, storage } = configure();
      service.setColor('#abcdef');
      await flushPromises();
      expect(service.color()).toBe('#abcdef');
      expect(storage.data.get(STORAGE_KEY_WALL_COLOR)).toBe('#abcdef');
    });

    it('setColor accepts 8-digit hex (alpha)', () => {
      const { service } = configure();
      service.setColor('#aabbccdd');
      expect(service.color()).toBe('#aabbccdd');
    });

    it('setColor rejects malformed input — keeps prior value', async () => {
      const { service, storage } = configure();
      service.setColor('not-a-color');
      service.setColor('#abc');
      service.setColor('rgb(1,2,3)');
      await flushPromises();
      expect(service.color()).toBe(DEFAULT_WALL_COLOR);
      expect(storage.data.has(STORAGE_KEY_WALL_COLOR)).toBe(false);
    });

    it('setWidthMm clamps below MIN_WALL_DIM_MM', async () => {
      const { service, storage } = configure();
      service.setWidthMm(10);
      await flushPromises();
      expect(service.widthMm()).toBe(MIN_WALL_DIM_MM);
      expect(storage.data.get(STORAGE_KEY_WALL_WIDTH_MM)).toBe(MIN_WALL_DIM_MM);
    });

    it('setWidthMm clamps above MAX_WALL_DIM_MM', async () => {
      const { service, storage } = configure();
      service.setWidthMm(50_000);
      await flushPromises();
      expect(service.widthMm()).toBe(MAX_WALL_DIM_MM);
      expect(storage.data.get(STORAGE_KEY_WALL_WIDTH_MM)).toBe(MAX_WALL_DIM_MM);
    });

    it('setWidthMm collapses NaN to the default width', () => {
      const { service } = configure();
      service.setWidthMm(Number.NaN);
      expect(service.widthMm()).toBe(DEFAULT_WALL_WIDTH_MM);
    });

    it('setHeightMm clamps + persists symmetrically to width', async () => {
      const { service, storage } = configure();
      service.setHeightMm(50_000);
      await flushPromises();
      expect(service.heightMm()).toBe(MAX_WALL_DIM_MM);
      expect(storage.data.get(STORAGE_KEY_WALL_HEIGHT_MM)).toBe(MAX_WALL_DIM_MM);
    });
  });

  describe('hydration', () => {
    it('restores every field from storage on construct', async () => {
      const storage = new FakeStorageService();
      await storage.set(STORAGE_KEY_WALL_ENABLED, true);
      await storage.set(STORAGE_KEY_WALL_COLOR, '#112233');
      await storage.set(STORAGE_KEY_WALL_WIDTH_MM, 800);
      await storage.set(STORAGE_KEY_WALL_HEIGHT_MM, 400);
      const { service } = configure(storage);
      await flushPromises();
      expect(service.enabled()).toBe(true);
      expect(service.color()).toBe('#112233');
      expect(service.widthMm()).toBe(800);
      expect(service.heightMm()).toBe(400);
    });

    it('ignores corrupt storage values (defaults stay)', async () => {
      const storage = new FakeStorageService();
      storage.data.set(STORAGE_KEY_WALL_ENABLED, 'yes'); // not a boolean
      storage.data.set(STORAGE_KEY_WALL_COLOR, 'turquoise'); // not hex
      storage.data.set(STORAGE_KEY_WALL_WIDTH_MM, 'wide'); // not a number
      storage.data.set(STORAGE_KEY_WALL_HEIGHT_MM, Number.POSITIVE_INFINITY);
      const { service } = configure(storage);
      await flushPromises();
      expect(service.enabled()).toBe(false);
      expect(service.color()).toBe(DEFAULT_WALL_COLOR);
      expect(service.widthMm()).toBe(DEFAULT_WALL_WIDTH_MM);
      expect(service.heightMm()).toBe(DEFAULT_WALL_HEIGHT_MM);
    });

    it('clamps hydrated dimensions outside the allowed range', async () => {
      const storage = new FakeStorageService();
      await storage.set(STORAGE_KEY_WALL_WIDTH_MM, 99); // below MIN
      await storage.set(STORAGE_KEY_WALL_HEIGHT_MM, 99_999); // above MAX
      const { service } = configure(storage);
      await flushPromises();
      expect(service.widthMm()).toBe(MIN_WALL_DIM_MM);
      expect(service.heightMm()).toBe(MAX_WALL_DIM_MM);
    });

    it('survives a storage read rejection (defaults stay)', async () => {
      const failing: StorageService = {
        get(): Promise<never> {
          return Promise.reject(new Error('boom'));
        },
        set(): Promise<void> {
          return Promise.resolve();
        },
        remove(): Promise<void> {
          return Promise.resolve();
        },
      };
      TestBed.configureTestingModule({
        providers: [{ provide: STORAGE_SERVICE, useValue: failing }],
      });
      const service = TestBed.inject(WallBackgroundService);
      await flushPromises();
      expect(service.enabled()).toBe(false);
      expect(service.color()).toBe(DEFAULT_WALL_COLOR);
      expect(service.widthMm()).toBe(DEFAULT_WALL_WIDTH_MM);
      expect(service.heightMm()).toBe(DEFAULT_WALL_HEIGHT_MM);
    });
  });

  describe('reset', () => {
    it('clears every field back to the defaults', async () => {
      const { service, storage } = configure();
      service.setEnabled(true);
      service.setColor('#aabbcc');
      service.setWidthMm(800);
      service.setHeightMm(400);
      service.reset();
      await flushPromises();
      expect(service.enabled()).toBe(false);
      expect(service.color()).toBe(DEFAULT_WALL_COLOR);
      expect(service.widthMm()).toBe(DEFAULT_WALL_WIDTH_MM);
      expect(service.heightMm()).toBe(DEFAULT_WALL_HEIGHT_MM);
      expect(storage.data.get(STORAGE_KEY_WALL_ENABLED)).toBe(false);
      expect(storage.data.get(STORAGE_KEY_WALL_COLOR)).toBe(DEFAULT_WALL_COLOR);
    });
  });

  describe('storage.set rejection', () => {
    it('every setter still updates the in-memory value when storage.set rejects', async () => {
      const failing: StorageService = {
        get<T>(): Promise<T | null> {
          return Promise.resolve(null);
        },
        set<T>(): Promise<void> {
          return Promise.reject(new Error('set boom'));
        },
        remove(): Promise<void> {
          return Promise.resolve();
        },
      };
      TestBed.configureTestingModule({
        providers: [{ provide: STORAGE_SERVICE, useValue: failing }],
      });
      const service = TestBed.inject(WallBackgroundService);
      service.setEnabled(true);
      service.setColor('#112233');
      service.setWidthMm(800);
      service.setHeightMm(400);
      await flushPromises();
      expect(service.enabled()).toBe(true);
      expect(service.color()).toBe('#112233');
      expect(service.widthMm()).toBe(800);
      expect(service.heightMm()).toBe(400);
    });
  });
});
