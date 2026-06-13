// ViewModeService tests. Stage 10 F10.2.

import { TestBed } from '@angular/core/testing';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import { STORAGE_KEY_VIEW_MODE, ViewModeService, type ViewMode } from './view-mode.service';

function makeStorage(initial: Record<string, unknown> = {}): {
  service: StorageService;
  store: Map<string, unknown>;
  setSpy: jest.Mock;
} {
  const store = new Map<string, unknown>(Object.entries(initial));
  const setSpy = jest.fn();
  const service: StorageService = {
    get: <T>(key: string) => Promise.resolve((store.get(key) ?? null) as T | null),
    set: <T>(key: string, value: T) => {
      store.set(key, value);
      setSpy(key, value);
      return Promise.resolve();
    },
    remove: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
  return { service, store, setSpy };
}

function configure(storageInitial: Record<string, unknown> = {}): {
  service: ViewModeService;
  setSpy: jest.Mock;
} {
  const storage = makeStorage(storageInitial);
  TestBed.configureTestingModule({
    providers: [{ provide: STORAGE_SERVICE, useValue: storage.service }, ViewModeService],
  });
  const service = TestBed.inject(ViewModeService);
  return { service, setSpy: storage.setSpy };
}

/**
 * Force any registered Angular `effect()`s to run. `TestBed.flushEffects()`
 * is the Angular 18 API for this; we wrap it so a future Angular bump can
 * swap to a different mechanism in one place.
 */
function flushEffects(): void {
  TestBed.flushEffects();
}

describe('ViewModeService', () => {
  it('defaults to "2d" when storage is empty', () => {
    const { service } = configure();
    expect(service.mode()).toBe('2d');
  });

  it('hydrates "3d" from storage when persisted', async () => {
    const { service } = configure({ [STORAGE_KEY_VIEW_MODE]: '3d' as ViewMode });
    // Constructor read is async — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(service.mode()).toBe('3d');
  });

  it('ignores garbage values from storage (stays on "2d")', async () => {
    const { service } = configure({ [STORAGE_KEY_VIEW_MODE]: 'rainbow' });
    await Promise.resolve();
    await Promise.resolve();
    expect(service.mode()).toBe('2d');
  });

  it('toggle() flips 2d → 3d', () => {
    const { service } = configure();
    service.toggle();
    expect(service.mode()).toBe('3d');
  });

  it('toggle() flips 3d → 2d', async () => {
    const { service } = configure({ [STORAGE_KEY_VIEW_MODE]: '3d' as ViewMode });
    await Promise.resolve();
    await Promise.resolve();
    expect(service.mode()).toBe('3d');
    service.toggle();
    expect(service.mode()).toBe('2d');
  });

  it('setMode("3d") flips from 2d', () => {
    const { service } = configure();
    service.setMode('3d');
    expect(service.mode()).toBe('3d');
  });

  it('hydrates "fish-eye" from storage when persisted', async () => {
    const { service } = configure({ [STORAGE_KEY_VIEW_MODE]: 'fish-eye' as ViewMode });
    await Promise.resolve();
    await Promise.resolve();
    expect(service.mode()).toBe('fish-eye');
  });

  it('setMode("fish-eye") flips from 2d and persists', () => {
    const { service, setSpy } = configure();
    flushEffects();
    service.setMode('fish-eye');
    expect(service.mode()).toBe('fish-eye');
    flushEffects();
    expect(setSpy).toHaveBeenCalledWith(STORAGE_KEY_VIEW_MODE, 'fish-eye');
  });

  it('toggle() from fish-eye lands on 2d (leave the 3D family)', () => {
    const { service } = configure();
    service.setMode('fish-eye');
    service.toggle();
    expect(service.mode()).toBe('2d');
  });

  it('setMode("3d") while already in "3d" is a no-op (signal identity preserved)', async () => {
    const { service, setSpy } = configure({ [STORAGE_KEY_VIEW_MODE]: '3d' as ViewMode });
    await Promise.resolve();
    await Promise.resolve();
    expect(service.mode()).toBe('3d');
    // Flush the post-hydrate effect first so its write doesn't count
    // toward the no-op-write assertion below.
    flushEffects();
    setSpy.mockClear();
    service.setMode('3d');
    // No effect should fire because the signal value didn't change.
    flushEffects();
    expect(setSpy).not.toHaveBeenCalled();
    expect(service.mode()).toBe('3d');
  });

  it('a setMode write persists to storage', () => {
    const { service, setSpy } = configure();
    // Flush the synchronous initial dependency-registering invocation
    // FIRST (it's a no-op under the firstRun guard) so the next
    // flushEffects after `setMode` covers only the write pass.
    flushEffects();
    service.setMode('3d');
    flushEffects();
    expect(setSpy).toHaveBeenCalledWith(STORAGE_KEY_VIEW_MODE, '3d');
  });

  it('a toggle() write persists to storage', () => {
    const { service, setSpy } = configure();
    flushEffects();
    service.toggle();
    flushEffects();
    expect(setSpy).toHaveBeenCalledWith(STORAGE_KEY_VIEW_MODE, '3d');
  });

  it('the first-run guard prevents the synchronous initial write from clobbering the hydrate', () => {
    // Persist '3d'. The constructor schedules the hydrate read; the effect
    // registers its dependency synchronously. The firstRun guard MUST
    // skip the initial run, otherwise the seeded default '2d' would
    // overwrite the persisted '3d' before the hydrate resolves.
    const { setSpy } = configure({ [STORAGE_KEY_VIEW_MODE]: '3d' as ViewMode });

    // Trigger the effect's first (synchronous) dependency-registering pass
    // BEFORE the hydrate microtask resolves. The guard must suppress any
    // write at this point.
    flushEffects();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('forceMode sets the mode and pins it against a later hydrate', async () => {
    // Persisted preference is '2d'; demo mode forces '3d'. Even though the
    // async hydrate resolves AFTER the force, the lock must keep '3d'.
    const { service } = configure({ [STORAGE_KEY_VIEW_MODE]: '2d' as ViewMode });
    service.forceMode('3d');
    expect(service.mode()).toBe('3d');
    // Let the constructor's hydrate microtask resolve — must NOT clobber.
    await Promise.resolve();
    await Promise.resolve();
    expect(service.mode()).toBe('3d');
  });

  it('forceMode wins even when the hydrate would have set a different mode', async () => {
    const { service } = configure({ [STORAGE_KEY_VIEW_MODE]: 'fish-eye' as ViewMode });
    service.forceMode('3d');
    await Promise.resolve();
    await Promise.resolve();
    expect(service.mode()).toBe('3d');
  });

  it('survives a storage.get() rejection', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: STORAGE_SERVICE,
          useValue: {
            get: () => Promise.reject(new Error('boom')),
            set: () => Promise.resolve(),
            remove: () => Promise.resolve(),
          },
        },
        ViewModeService,
      ],
    });
    const service = TestBed.inject(ViewModeService);
    await Promise.resolve();
    await Promise.resolve();
    expect(service.mode()).toBe('2d');
  });
});
