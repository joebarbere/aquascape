// Round-trip tests for the platform-electron Stage 0 stubs.
//
// Two responsibilities:
//   1. Verify that the default in-memory transport satisfies the platform-api
//      contract end-to-end (save → open, set → get → remove, etc.).
//   2. Verify the transport seam: a hand-built fake transport must reach every
//      service method exactly the way an IPC-backed transport would in F1.4.

import {
  ElectronDialogService,
  ElectronFileService,
  ElectronRenderExportService,
  ElectronStorageService,
  createElectronPlatform,
  createInMemoryTransport,
  type ElectronTransport,
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

describe('createElectronPlatform (default in-memory transport)', () => {
  it('wires every service', () => {
    const platform = createElectronPlatform();
    expect(platform.fileService).toBeInstanceOf(ElectronFileService);
    expect(platform.dialogService).toBeInstanceOf(ElectronDialogService);
    expect(platform.storageService).toBeInstanceOf(ElectronStorageService);
    expect(platform.renderExportService).toBeInstanceOf(ElectronRenderExportService);
  });

  it('FileService round-trips bytes and name', async () => {
    const { fileService } = createElectronPlatform();
    expect(await fileService.openDocument()).toBeNull();
    const payload = bytes('aqua bytes');
    const saved = await fileService.saveDocument({
      bytes: payload,
      suggestedName: 'doc.aqua',
    });
    if (saved === null) throw new Error('saveDocument returned null');
    const opened = await fileService.openDocument();
    if (opened === null) throw new Error('openDocument returned null');
    expect(opened.id).toBe(saved.id);
    expect(opened.name).toBe('doc.aqua');
    expect(bytesEqual(opened.bytes, payload)).toBe(true);
  });

  it('FileService.saveDocument reuses a known id and mints when unknown', async () => {
    const { fileService } = createElectronPlatform();
    const first = await fileService.saveDocument({
      bytes: bytes('v1'),
      suggestedName: 'd.aqua',
    });
    if (first === null) throw new Error('saveDocument returned null');
    const reused = await fileService.saveDocument({
      id: first.id,
      bytes: bytes('v2'),
      suggestedName: 'd.aqua',
    });
    if (reused === null) throw new Error('saveDocument returned null');
    expect(reused.id).toBe(first.id);
    const minted = await fileService.saveDocument({
      id: 'never-saved',
      bytes: bytes('v3'),
      suggestedName: 'd.aqua',
    });
    if (minted === null) throw new Error('saveDocument returned null');
    expect(minted.id).not.toBe('never-saved');
  });

  it('FileService.saveDocumentAs always mints a fresh id', async () => {
    const { fileService } = createElectronPlatform();
    const a = await fileService.saveDocumentAs({
      bytes: bytes('a'),
      suggestedName: 'a.aqua',
    });
    const b = await fileService.saveDocumentAs({
      bytes: bytes('b'),
      suggestedName: 'b.aqua',
    });
    if (a === null || b === null) throw new Error('saveDocumentAs returned null');
    expect(a.id).not.toBe(b.id);
  });

  it('DialogService returns true / void by default', async () => {
    const { dialogService } = createElectronPlatform();
    expect(await dialogService.confirm({ title: 't', message: 'm' })).toBe(true);
    expect(
      await dialogService.confirm({
        title: 't',
        message: 'm',
        danger: true,
      }),
    ).toBe(true);
    await expect(dialogService.alert({ title: 't', message: 'm' })).resolves.toBeUndefined();
  });

  it('StorageService round-trips and removes', async () => {
    const { storageService } = createElectronPlatform();
    expect(await storageService.get<string>('missing')).toBeNull();
    await storageService.set('k', { ok: true });
    expect(await storageService.get<{ ok: boolean }>('k')).toEqual({
      ok: true,
    });
    await storageService.remove('k');
    expect(await storageService.get<{ ok: boolean }>('k')).toBeNull();
  });

  it('StorageService deep-clones values', async () => {
    const { storageService } = createElectronPlatform();
    const v = { list: ['a'] };
    await storageService.set('prefs', v);
    v.list.push('b');
    expect(await storageService.get<{ list: string[] }>('prefs')).toEqual({
      list: ['a'],
    });
  });

  it('RenderExportService returns a memory:// path', async () => {
    const { renderExportService } = createElectronPlatform();
    const result = await renderExportService.exportPng({
      bytes: bytes('png'),
      suggestedName: 'render.png',
    });
    expect(result).toEqual({ path: 'memory://exports/render.png' });
  });
});

describe('ElectronTransport seam', () => {
  it('routes every service call through the supplied transport', async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const fake: ElectronTransport = {
      async openDocument() {
        calls.push({ method: 'openDocument', payload: undefined });
        return { id: 'fake-id', bytes: bytes('hi'), name: 'fake.aqua' };
      },
      async saveDocument(req) {
        calls.push({ method: 'saveDocument', payload: req });
        return { id: 'saved-id' };
      },
      async saveDocumentAs(req) {
        calls.push({ method: 'saveDocumentAs', payload: req });
        return { id: 'saved-as-id' };
      },
      async confirm(req) {
        calls.push({ method: 'confirm', payload: req });
        return false;
      },
      async alert(req) {
        calls.push({ method: 'alert', payload: req });
      },
      async storageGet(req) {
        calls.push({ method: 'storageGet', payload: req });
        return 'stored-value';
      },
      async storageSet(req) {
        calls.push({ method: 'storageSet', payload: req });
      },
      async storageRemove(req) {
        calls.push({ method: 'storageRemove', payload: req });
      },
      async exportPng(req) {
        calls.push({ method: 'exportPng', payload: req });
        return { path: '/fake/render.png' };
      },
    };

    const platform = createElectronPlatform(fake);

    expect(await platform.fileService.openDocument()).toEqual({
      id: 'fake-id',
      bytes: bytes('hi'),
      name: 'fake.aqua',
    });
    await platform.fileService.saveDocument({
      bytes: bytes('a'),
      suggestedName: 'a.aqua',
    });
    await platform.fileService.saveDocumentAs({
      bytes: bytes('b'),
      suggestedName: 'b.aqua',
    });
    expect(await platform.dialogService.confirm({ title: 't', message: 'm' })).toBe(false);
    await platform.dialogService.alert({ title: 't', message: 'm' });
    expect(await platform.storageService.get<string>('k')).toBe('stored-value');
    await platform.storageService.set('k', 1);
    await platform.storageService.remove('k');
    expect(
      await platform.renderExportService.exportPng({
        bytes: bytes('x'),
        suggestedName: 'r.png',
      }),
    ).toEqual({ path: '/fake/render.png' });

    expect(calls.map((c) => c.method)).toEqual([
      'openDocument',
      'saveDocument',
      'saveDocumentAs',
      'confirm',
      'alert',
      'storageGet',
      'storageSet',
      'storageRemove',
      'exportPng',
    ]);
  });

  it('StorageService.get coerces undefined transport results to null', async () => {
    const fake: ElectronTransport = {
      ...createInMemoryTransport(),
      async storageGet() {
        return undefined;
      },
    };
    const platform = createElectronPlatform(fake);
    expect(await platform.storageService.get<string>('any')).toBeNull();
  });

  it('factory builds isolated in-memory transports per call', async () => {
    const a = createElectronPlatform();
    const b = createElectronPlatform();
    await a.fileService.saveDocument({
      bytes: bytes('a'),
      suggestedName: 'a.aqua',
    });
    expect(await b.fileService.openDocument()).toBeNull();
  });
});
