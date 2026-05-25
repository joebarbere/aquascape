// SnapOptionsService tests. Stage 5 F5.4.

import { TestBed } from '@angular/core/testing';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  DEFAULT_GRID_SIZE_MM,
  DEFAULT_TOLERANCE_CSS_PX,
  MAX_GRID_SIZE_MM,
  MAX_TOLERANCE_CSS_PX,
  MIN_GRID_SIZE_MM,
  MIN_TOLERANCE_CSS_PX,
} from './snap-math';
import {
  STORAGE_KEY_SNAP_ENABLED,
  STORAGE_KEY_SNAP_GRID_SIZE_MM,
  STORAGE_KEY_SNAP_TO_GRID,
  STORAGE_KEY_SNAP_TO_GUIDES,
  STORAGE_KEY_SNAP_TO_OBJECTS,
  STORAGE_KEY_SNAP_TOLERANCE_CSS_PX,
  SnapOptionsService,
} from './snap-options.service';

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
  return { service: TestBed.inject(SnapOptionsService), storage };
}

describe('SnapOptionsService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts with snap on and every kind enabled by default', () => {
    const { service } = configure();
    expect(service.enabled()).toBe(true);
    expect(service.toGrid()).toBe(true);
    expect(service.toGuides()).toBe(true);
    expect(service.toObjects()).toBe(true);
    expect(service.gridSizeMm()).toBe(DEFAULT_GRID_SIZE_MM);
    expect(service.toleranceCssPx()).toBe(DEFAULT_TOLERANCE_CSS_PX);
  });

  it('options() snapshot returns the full snap shape', () => {
    const { service } = configure();
    expect(service.options()).toEqual({
      enabled: true,
      toGrid: true,
      toGuides: true,
      toObjects: true,
      gridSizeMm: DEFAULT_GRID_SIZE_MM,
      toleranceCssPx: DEFAULT_TOLERANCE_CSS_PX,
    });
  });

  it('activeKindCount is 3 when everything is on, 0 when master is off', () => {
    const { service } = configure();
    expect(service.activeKindCount()).toBe(3);
    service.setToObjects(false);
    expect(service.activeKindCount()).toBe(2);
    service.setEnabled(false);
    expect(service.activeKindCount()).toBe(0);
  });

  it('every setter writes through to storage', async () => {
    const { service, storage } = configure();
    service.setEnabled(false);
    service.setToGrid(false);
    service.setToGuides(false);
    service.setToObjects(false);
    service.setGridSizeMm(20);
    service.setToleranceCssPx(12);
    await flushPromises();
    expect(storage.data.get(STORAGE_KEY_SNAP_ENABLED)).toBe(false);
    expect(storage.data.get(STORAGE_KEY_SNAP_TO_GRID)).toBe(false);
    expect(storage.data.get(STORAGE_KEY_SNAP_TO_GUIDES)).toBe(false);
    expect(storage.data.get(STORAGE_KEY_SNAP_TO_OBJECTS)).toBe(false);
    expect(storage.data.get(STORAGE_KEY_SNAP_GRID_SIZE_MM)).toBe(20);
    expect(storage.data.get(STORAGE_KEY_SNAP_TOLERANCE_CSS_PX)).toBe(12);
  });

  it('setGridSizeMm clamps to [MIN, MAX]', async () => {
    const { service, storage } = configure();
    service.setGridSizeMm(0);
    await flushPromises();
    expect(service.gridSizeMm()).toBe(MIN_GRID_SIZE_MM);
    expect(storage.data.get(STORAGE_KEY_SNAP_GRID_SIZE_MM)).toBe(MIN_GRID_SIZE_MM);
    service.setGridSizeMm(9999);
    await flushPromises();
    expect(service.gridSizeMm()).toBe(MAX_GRID_SIZE_MM);
  });

  it('setToleranceCssPx clamps to [MIN, MAX]', async () => {
    const { service, storage } = configure();
    service.setToleranceCssPx(0);
    await flushPromises();
    expect(service.toleranceCssPx()).toBe(MIN_TOLERANCE_CSS_PX);
    service.setToleranceCssPx(9999);
    await flushPromises();
    expect(service.toleranceCssPx()).toBe(MAX_TOLERANCE_CSS_PX);
    expect(storage.data.get(STORAGE_KEY_SNAP_TOLERANCE_CSS_PX)).toBe(MAX_TOLERANCE_CSS_PX);
  });

  it('non-finite numeric setters fall back to the defaults', () => {
    const { service } = configure();
    service.setGridSizeMm(Number.NaN);
    service.setToleranceCssPx(Number.NaN);
    expect(service.gridSizeMm()).toBe(DEFAULT_GRID_SIZE_MM);
    expect(service.toleranceCssPx()).toBe(DEFAULT_TOLERANCE_CSS_PX);
  });

  it('hydrates every field from storage on construct', async () => {
    const storage = new FakeStorageService();
    await storage.set(STORAGE_KEY_SNAP_ENABLED, false);
    await storage.set(STORAGE_KEY_SNAP_TO_GRID, false);
    await storage.set(STORAGE_KEY_SNAP_TO_GUIDES, false);
    await storage.set(STORAGE_KEY_SNAP_TO_OBJECTS, false);
    await storage.set(STORAGE_KEY_SNAP_GRID_SIZE_MM, 25);
    await storage.set(STORAGE_KEY_SNAP_TOLERANCE_CSS_PX, 16);
    const { service } = configure(storage);
    await flushPromises();
    expect(service.enabled()).toBe(false);
    expect(service.toGrid()).toBe(false);
    expect(service.toGuides()).toBe(false);
    expect(service.toObjects()).toBe(false);
    expect(service.gridSizeMm()).toBe(25);
    expect(service.toleranceCssPx()).toBe(16);
  });

  it('ignores corrupt storage values', async () => {
    const storage = new FakeStorageService();
    storage.data.set(STORAGE_KEY_SNAP_ENABLED, 'no');
    storage.data.set(STORAGE_KEY_SNAP_GRID_SIZE_MM, 'huge');
    storage.data.set(STORAGE_KEY_SNAP_TOLERANCE_CSS_PX, Number.POSITIVE_INFINITY);
    const { service } = configure(storage);
    await flushPromises();
    expect(service.enabled()).toBe(true);
    expect(service.gridSizeMm()).toBe(DEFAULT_GRID_SIZE_MM);
    expect(service.toleranceCssPx()).toBe(DEFAULT_TOLERANCE_CSS_PX);
  });

  it('clamps hydrated numbers outside the allowed ranges', async () => {
    const storage = new FakeStorageService();
    await storage.set(STORAGE_KEY_SNAP_GRID_SIZE_MM, 0);
    await storage.set(STORAGE_KEY_SNAP_TOLERANCE_CSS_PX, 9999);
    const { service } = configure(storage);
    await flushPromises();
    expect(service.gridSizeMm()).toBe(MIN_GRID_SIZE_MM);
    expect(service.toleranceCssPx()).toBe(MAX_TOLERANCE_CSS_PX);
  });

  it('survives a storage rejection (defaults stay)', async () => {
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
    const service = TestBed.inject(SnapOptionsService);
    await flushPromises();
    expect(service.enabled()).toBe(true);
    expect(service.gridSizeMm()).toBe(DEFAULT_GRID_SIZE_MM);
  });
});
