// TemplatesService tests. Stage 5 F5.1 + F5.2.

import { TestBed } from '@angular/core/testing';

import { documentToScene } from '@aquascape/domain/document';
import { BUILTIN_TEMPLATES } from '@aquascape/features/templates';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  MAX_PERSONAL_TEMPLATES,
  STORAGE_KEY_PERSONAL_TEMPLATES,
  TemplatesService,
} from './templates.service';

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
  const service = TestBed.inject(TemplatesService);
  return { service, storage };
}

describe('TemplatesService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('built-ins', () => {
    it('exposes every BUILTIN_TEMPLATES entry', () => {
      const { service } = configure();
      expect(service.builtins).toEqual(BUILTIN_TEMPLATES);
    });

    it('starts with no personal templates', () => {
      const { service } = configure();
      expect(service.personal()).toEqual([]);
      expect(service.personalCount()).toBe(0);
    });

    it('all() concatenates builtins first then personals', () => {
      const { service } = configure();
      expect(service.all()).toEqual(service.builtins);
    });
  });

  describe('instantiateTemplate', () => {
    it('produces a scene the editor can use', () => {
      const { service } = configure();
      const scene = service.instantiateTemplate(BUILTIN_TEMPLATES[0]!.document);
      expect(scene.tank.width).toBeGreaterThan(0);
      expect(scene.layers.length).toBeGreaterThan(0);
    });

    it('does NOT mutate the source template document', () => {
      const { service } = configure();
      const before = JSON.stringify(BUILTIN_TEMPLATES[0]!.document);
      service.instantiateTemplate(BUILTIN_TEMPLATES[0]!.document);
      const after = JSON.stringify(BUILTIN_TEMPLATES[0]!.document);
      expect(after).toBe(before);
    });
  });

  describe('saveAsTemplate', () => {
    const sourceDoc = BUILTIN_TEMPLATES[0]!.document;
    const { scene: sourceScene, envelope: sourceEnvelope } = documentToScene(sourceDoc);

    it('appends a listing + persists with isTemplate=true + fresh id', async () => {
      const { service, storage } = configure();
      const listing = await service.saveAsTemplate(sourceScene, sourceEnvelope, 'My Saved');
      expect(service.personal()).toHaveLength(1);
      expect(service.personal()[0]).toEqual(listing);
      expect(listing.name).toBe('My Saved');
      expect(listing.document.meta.isTemplate).toBe(true);
      // Fresh id minted — NOT the source doc's id.
      expect(listing.document.meta.id).not.toBe(sourceDoc.meta.id);
      const blob = storage.data.get(STORAGE_KEY_PERSONAL_TEMPLATES);
      expect(Array.isArray(blob)).toBe(true);
      expect(blob).toHaveLength(1);
    });

    it('falls back to "Untitled template" when name is blank/whitespace', async () => {
      const { service } = configure();
      const listing = await service.saveAsTemplate(sourceScene, sourceEnvelope, '   ');
      expect(listing.name).toBe('Untitled template');
    });

    it('puts the newest entry first', async () => {
      const { service } = configure();
      await service.saveAsTemplate(sourceScene, sourceEnvelope, 'Old');
      const newer = await service.saveAsTemplate(sourceScene, sourceEnvelope, 'New');
      expect(service.personal()[0]).toEqual(newer);
      expect(service.personal()[1]?.name).toBe('Old');
    });

    it('caps at MAX_PERSONAL_TEMPLATES (oldest evicted)', async () => {
      const { service } = configure();
      for (let i = 0; i < MAX_PERSONAL_TEMPLATES + 2; i++) {
        await service.saveAsTemplate(sourceScene, sourceEnvelope, `T${i}`);
      }
      expect(service.personal()).toHaveLength(MAX_PERSONAL_TEMPLATES);
      expect(service.personal()[0]?.name).toBe(`T${MAX_PERSONAL_TEMPLATES + 1}`);
    });

    it('synthesises a minimal envelope when envelope is null', async () => {
      const { service } = configure();
      const listing = await service.saveAsTemplate(sourceScene, null, 'From scratch');
      expect(listing.document.meta.isTemplate).toBe(true);
      expect(listing.document.meta.title).toBe('From scratch');
      expect(listing.document.meta.seed).toBe(sourceScene.seed);
    });

    it('honours an explicit description', async () => {
      const { service } = configure();
      const listing = await service.saveAsTemplate(
        sourceScene,
        sourceEnvelope,
        'X',
        'My fancy layout',
      );
      expect(listing.description).toBe('My fancy layout');
    });
  });

  describe('deletePersonalTemplate', () => {
    const { scene, envelope } = documentToScene(BUILTIN_TEMPLATES[0]!.document);

    it('removes the listing + persists', async () => {
      const { service, storage } = configure();
      const a = await service.saveAsTemplate(scene, envelope, 'A');
      await service.saveAsTemplate(scene, envelope, 'B');
      await service.deletePersonalTemplate(a.id);
      expect(service.personal()).toHaveLength(1);
      expect(service.personal()[0]?.name).toBe('B');
      const blob = storage.data.get(STORAGE_KEY_PERSONAL_TEMPLATES);
      expect(blob).toHaveLength(1);
    });

    it('is a no-op on unknown ids', async () => {
      const { service } = configure();
      await service.saveAsTemplate(scene, envelope, 'A');
      await service.deletePersonalTemplate('unknown-id');
      expect(service.personal()).toHaveLength(1);
    });
  });

  describe('hydrate', () => {
    it('restores personal templates from storage', async () => {
      const storage = new FakeStorageService();
      const seed = [
        {
          id: 'one',
          name: 'One',
          description: '',
          document: BUILTIN_TEMPLATES[0]!.document,
        },
        {
          id: 'two',
          name: 'Two',
          description: 'desc',
          document: BUILTIN_TEMPLATES[1]!.document,
        },
      ];
      await storage.set(STORAGE_KEY_PERSONAL_TEMPLATES, seed);
      const { service } = configure(storage);
      await flushPromises();
      expect(service.personal()).toHaveLength(2);
      expect(service.personal()[0]?.name).toBe('One');
    });

    it('skips corrupt entries during hydrate', async () => {
      const storage = new FakeStorageService();
      await storage.set(STORAGE_KEY_PERSONAL_TEMPLATES, [
        { id: 'ok', name: 'OK', description: '', document: BUILTIN_TEMPLATES[0]!.document },
        { id: 123, name: 'bad id', description: '', document: {} },
        null,
        'not-an-object',
        { id: 'still-ok', name: 'Still OK', description: '', document: BUILTIN_TEMPLATES[1]!.document },
      ]);
      const { service } = configure(storage);
      await flushPromises();
      expect(service.personal()).toHaveLength(2);
      expect(service.personal().map((t) => t.name)).toEqual(['OK', 'Still OK']);
    });

    it('caps a too-large hydrated list', async () => {
      const storage = new FakeStorageService();
      const big = Array.from({ length: MAX_PERSONAL_TEMPLATES + 5 }).map((_, i) => ({
        id: `id-${i}`,
        name: `n-${i}`,
        description: '',
        document: BUILTIN_TEMPLATES[0]!.document,
      }));
      await storage.set(STORAGE_KEY_PERSONAL_TEMPLATES, big);
      const { service } = configure(storage);
      await flushPromises();
      expect(service.personal()).toHaveLength(MAX_PERSONAL_TEMPLATES);
    });

    it('ignores non-array storage values', async () => {
      const storage = new FakeStorageService();
      await storage.set(STORAGE_KEY_PERSONAL_TEMPLATES, 'not-an-array');
      const { service } = configure(storage);
      await flushPromises();
      expect(service.personal()).toEqual([]);
    });

    it('survives a storage rejection', async () => {
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
      const service = TestBed.inject(TemplatesService);
      await flushPromises();
      expect(service.personal()).toEqual([]);
    });
  });

  describe('clearPersonalTemplates', () => {
    const { scene, envelope } = documentToScene(BUILTIN_TEMPLATES[0]!.document);

    it('empties the list + persists', async () => {
      const { service, storage } = configure();
      await service.saveAsTemplate(scene, envelope, 'X');
      await service.clearPersonalTemplates();
      expect(service.personal()).toEqual([]);
      expect(storage.data.get(STORAGE_KEY_PERSONAL_TEMPLATES)).toEqual([]);
    });
  });
});
