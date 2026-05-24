// Round-trip tests for the platform-web Stage 0 stubs.
//
// These verify each stub satisfies the platform-api contract well enough for
// feature libs to develop against. They are deliberately decoupled from any
// real browser API surface — those tests live in F1.4 / F1.5 once the
// File System Access and IndexedDB integrations land.

import {
  InMemoryFileService,
  InMemoryRenderExportService,
  InMemoryStorageService,
  StubDialogService,
  createWebPlatform,
} from './index';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe('InMemoryFileService', () => {
  it('returns null on open before any save', async () => {
    const fs = new InMemoryFileService();
    expect(await fs.openDocument()).toBeNull();
  });

  it('round-trips bytes and name through saveDocument + openDocument', async () => {
    const fs = new InMemoryFileService();
    const payload = bytes('hello aquascape');
    const saved = await fs.saveDocument({
      bytes: payload,
      suggestedName: 'tank.aqua',
    });
    if (saved === null) throw new Error('saveDocument returned null');
    const opened = await fs.openDocument();
    if (opened === null) throw new Error('openDocument returned null');
    expect(opened.id).toBe(saved.id);
    expect(opened.name).toBe('tank.aqua');
    expect(bytesEqual(opened.bytes, payload)).toBe(true);
  });

  it('returns a defensive copy of bytes so callers cannot mutate the store', async () => {
    const fs = new InMemoryFileService();
    const payload = bytes('aaaa');
    await fs.saveDocument({ bytes: payload, suggestedName: 'a.aqua' });
    payload[0] = 0x42; // mutate the buffer the caller still holds
    const opened = await fs.openDocument();
    if (opened === null) throw new Error('openDocument returned null');
    expect(opened.bytes[0]).toBe('a'.charCodeAt(0));
  });

  it('saveDocument reuses an existing id when supplied', async () => {
    const fs = new InMemoryFileService();
    const first = await fs.saveDocument({
      bytes: bytes('v1'),
      suggestedName: 'doc.aqua',
    });
    if (first === null) throw new Error('saveDocument returned null');
    const second = await fs.saveDocument({
      id: first.id,
      bytes: bytes('v2'),
      suggestedName: 'doc.aqua',
    });
    if (second === null) throw new Error('saveDocument returned null');
    expect(second.id).toBe(first.id);
    const opened = await fs.openDocument();
    if (opened === null) throw new Error('openDocument returned null');
    expect(bytesEqual(opened.bytes, bytes('v2'))).toBe(true);
  });

  it('saveDocument mints a fresh id when the supplied id is unknown', async () => {
    const fs = new InMemoryFileService();
    const saved = await fs.saveDocument({
      id: 'unknown-handle',
      bytes: bytes('x'),
      suggestedName: 'x.aqua',
    });
    if (saved === null) throw new Error('saveDocument returned null');
    expect(saved.id).not.toBe('unknown-handle');
  });

  it('saveDocumentAs always mints a fresh id', async () => {
    const fs = new InMemoryFileService();
    const a = await fs.saveDocumentAs({
      bytes: bytes('a'),
      suggestedName: 'a.aqua',
    });
    const b = await fs.saveDocumentAs({
      bytes: bytes('b'),
      suggestedName: 'b.aqua',
    });
    if (a === null || b === null) throw new Error('saveDocumentAs returned null');
    expect(a.id).not.toBe(b.id);
  });
});

describe('StubDialogService', () => {
  it('confirm resolves true by default', async () => {
    const dialog = new StubDialogService();
    expect(await dialog.confirm({ title: 't', message: 'm' })).toBe(true);
    expect(await dialog.confirm({ title: 't', message: 'm', danger: true })).toBe(true);
  });

  it('alert resolves without throwing', async () => {
    const dialog = new StubDialogService();
    await expect(dialog.alert({ title: 't', message: 'm' })).resolves.toBeUndefined();
  });
});

describe('InMemoryStorageService', () => {
  it('returns null for missing keys', async () => {
    const storage = new InMemoryStorageService();
    expect(await storage.get<string>('missing')).toBeNull();
  });

  it('round-trips a value through set + get', async () => {
    const storage = new InMemoryStorageService();
    await storage.set('recent', ['a.aqua', 'b.aqua']);
    expect(await storage.get<string[]>('recent')).toEqual(['a.aqua', 'b.aqua']);
  });

  it('deep-clones values so callers cannot mutate the store', async () => {
    const storage = new InMemoryStorageService();
    const original = { list: ['a'] };
    await storage.set('prefs', original);
    original.list.push('b');
    const fetched = await storage.get<{ list: string[] }>('prefs');
    expect(fetched).toEqual({ list: ['a'] });
  });

  it('remove clears the value', async () => {
    const storage = new InMemoryStorageService();
    await storage.set('k', 1);
    await storage.remove('k');
    expect(await storage.get<number>('k')).toBeNull();
  });

  it('remove is a no-op for unknown keys', async () => {
    const storage = new InMemoryStorageService();
    await expect(storage.remove('nope')).resolves.toBeUndefined();
  });
});

describe('InMemoryRenderExportService', () => {
  it('returns a memory:// path for the suggested name', async () => {
    const exports = new InMemoryRenderExportService();
    const result = await exports.exportPng({
      bytes: bytes('png'),
      suggestedName: 'render.png',
    });
    expect(result).toEqual({ path: 'memory://exports/render.png' });
  });
});

describe('createWebPlatform', () => {
  it('returns a Platform bundle with every service wired (node env → in-memory fallback)', () => {
    const platform = createWebPlatform();
    expect(platform.fileService).toBeInstanceOf(InMemoryFileService);
    expect(platform.dialogService).toBeInstanceOf(StubDialogService);
    expect(platform.storageService).toBeInstanceOf(InMemoryStorageService);
    expect(platform.renderExportService).toBeInstanceOf(InMemoryRenderExportService);
  });

  it('returns the in-memory bundle when forceInMemory is true', () => {
    const platform = createWebPlatform({ forceInMemory: true });
    expect(platform.fileService).toBeInstanceOf(InMemoryFileService);
    expect(platform.storageService).toBeInstanceOf(InMemoryStorageService);
  });
});
