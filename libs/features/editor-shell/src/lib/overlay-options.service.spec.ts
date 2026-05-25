// OverlayOptionsService tests. Stage 5 F5.3.

import { TestBed } from '@angular/core/testing';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  OverlayOptionsService,
  STORAGE_KEY_OVERLAY_FOCAL,
  STORAGE_KEY_OVERLAY_GOLDEN,
  STORAGE_KEY_OVERLAY_THIRDS,
} from './overlay-options.service';

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
  // Two ticks: one for the storage promise to resolve, one for the
  // signal-set inside the .then() to flush through change detection.
  await Promise.resolve();
  await Promise.resolve();
}

function configure(storage: FakeStorageService = new FakeStorageService()): {
  service: OverlayOptionsService;
  storage: FakeStorageService;
} {
  TestBed.configureTestingModule({
    providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
  });
  const service = TestBed.inject(OverlayOptionsService);
  return { service, storage };
}

describe('OverlayOptionsService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('all three flags default to false (clean canvas on first run)', () => {
    const { service } = configure();
    expect(service.goldenRatio()).toBe(false);
    expect(service.thirds()).toBe(false);
    expect(service.focalPoints()).toBe(false);
    expect(service.anyEnabled()).toBe(false);
  });

  it('overlays() returns the OverlayOptions shape the renderer consumes', () => {
    const { service } = configure();
    expect(service.overlays()).toEqual({
      goldenRatio: false,
      thirds: false,
      focalPoints: false,
    });
    service.setGoldenRatio(true);
    service.setFocalPoints(true);
    expect(service.overlays()).toEqual({
      goldenRatio: true,
      thirds: false,
      focalPoints: true,
    });
  });

  it('anyEnabled() is true iff at least one flag is on', () => {
    const { service } = configure();
    expect(service.anyEnabled()).toBe(false);
    service.setThirds(true);
    expect(service.anyEnabled()).toBe(true);
    service.setThirds(false);
    expect(service.anyEnabled()).toBe(false);
  });

  it('setGoldenRatio persists through StorageService', async () => {
    const { service, storage } = configure();
    service.setGoldenRatio(true);
    await flushPromises();
    expect(storage.data.get(STORAGE_KEY_OVERLAY_GOLDEN)).toBe(true);
    service.setGoldenRatio(false);
    await flushPromises();
    expect(storage.data.get(STORAGE_KEY_OVERLAY_GOLDEN)).toBe(false);
  });

  it('setThirds persists through StorageService', async () => {
    const { service, storage } = configure();
    service.setThirds(true);
    await flushPromises();
    expect(storage.data.get(STORAGE_KEY_OVERLAY_THIRDS)).toBe(true);
  });

  it('setFocalPoints persists through StorageService', async () => {
    const { service, storage } = configure();
    service.setFocalPoints(true);
    await flushPromises();
    expect(storage.data.get(STORAGE_KEY_OVERLAY_FOCAL)).toBe(true);
  });

  it('hydrates every flag from StorageService on construct', async () => {
    const storage = new FakeStorageService();
    await storage.set(STORAGE_KEY_OVERLAY_GOLDEN, true);
    await storage.set(STORAGE_KEY_OVERLAY_THIRDS, true);
    await storage.set(STORAGE_KEY_OVERLAY_FOCAL, true);
    const { service } = configure(storage);
    await flushPromises();
    expect(service.goldenRatio()).toBe(true);
    expect(service.thirds()).toBe(true);
    expect(service.focalPoints()).toBe(true);
  });

  it('ignores non-boolean storage values (defensive)', async () => {
    const storage = new FakeStorageService();
    // Simulate a corrupt entry — e.g. a string the user pasted into devtools.
    storage.data.set(STORAGE_KEY_OVERLAY_GOLDEN, 'true');
    storage.data.set(STORAGE_KEY_OVERLAY_THIRDS, 1);
    storage.data.set(STORAGE_KEY_OVERLAY_FOCAL, null);
    const { service } = configure(storage);
    await flushPromises();
    expect(service.goldenRatio()).toBe(false);
    expect(service.thirds()).toBe(false);
    expect(service.focalPoints()).toBe(false);
  });

  it('survives a storage read rejection (defaults stay false)', async () => {
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
    const service = TestBed.inject(OverlayOptionsService);
    await flushPromises();
    expect(service.goldenRatio()).toBe(false);
    expect(service.thirds()).toBe(false);
    expect(service.focalPoints()).toBe(false);
  });

  it('survives a storage write rejection (in-memory value still updates)', async () => {
    const failing: StorageService = {
      get(): Promise<null> {
        return Promise.resolve(null);
      },
      set(): Promise<void> {
        return Promise.reject(new Error('boom'));
      },
      remove(): Promise<void> {
        return Promise.resolve();
      },
    };
    TestBed.configureTestingModule({
      providers: [{ provide: STORAGE_SERVICE, useValue: failing }],
    });
    const service = TestBed.inject(OverlayOptionsService);
    service.setGoldenRatio(true);
    service.setThirds(true);
    service.setFocalPoints(true);
    await flushPromises();
    expect(service.goldenRatio()).toBe(true);
    expect(service.thirds()).toBe(true);
    expect(service.focalPoints()).toBe(true);
  });
});
