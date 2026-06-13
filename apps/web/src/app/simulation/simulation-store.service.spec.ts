import { TestBed } from '@angular/core/testing';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import { SIMULATION_STORE_KEY, SimulationStoreService } from './simulation-store.service';
import { createShowcaseScene } from './showcase-scene';

function memStorage(): { service: StorageService; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const service: StorageService = {
    get: <T>(key: string) => Promise.resolve((store.get(key) ?? null) as T | null),
    set: <T>(key: string, value: T) => {
      store.set(key, value);
      return Promise.resolve();
    },
    remove: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
  return { service, store };
}

function makeService() {
  const mem = memStorage();
  TestBed.configureTestingModule({
    providers: [{ provide: STORAGE_SERVICE, useValue: mem.service }, SimulationStoreService],
  });
  return { svc: TestBed.inject(SimulationStoreService), mem };
}

describe('SimulationStoreService', () => {
  it('starts empty', async () => {
    const { svc } = makeService();
    expect(await svc.list()).toEqual([]);
    expect(await svc.load('nope')).toBeNull();
  });

  it('saves + loads a demo by name', async () => {
    const { svc, mem } = makeService();
    const scene = createShowcaseScene();
    await svc.save('reef', scene, 1000);
    expect(await svc.load('reef')).toEqual(scene);
    // Persisted under the single library key.
    expect(mem.store.has(SIMULATION_STORE_KEY)).toBe(true);
  });

  it('lists saved demos sorted by name', async () => {
    const { svc } = makeService();
    await svc.save('zebra', createShowcaseScene(), 2);
    await svc.save('alpha', createShowcaseScene(), 1);
    expect((await svc.list()).map((d) => d.name)).toEqual(['alpha', 'zebra']);
  });

  it('overwrites on re-save (update)', async () => {
    const { svc } = makeService();
    await svc.save('x', createShowcaseScene(), 1);
    const edited = { ...createShowcaseScene(), seed: 999 };
    await svc.save('x', edited, 2);
    expect((await svc.load('x'))?.seed).toBe(999);
    expect(await svc.list()).toHaveLength(1);
  });

  it('removes a demo, reporting whether it existed', async () => {
    const { svc } = makeService();
    await svc.save('gone', createShowcaseScene(), 1);
    expect(await svc.remove('gone')).toBe(true);
    expect(await svc.remove('gone')).toBe(false);
    expect(await svc.load('gone')).toBeNull();
  });
});
