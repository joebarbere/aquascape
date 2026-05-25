/**
 * @jest-environment jsdom
 *
 * Capability-detection coverage for `createWebPlatform()`. The node-env spec
 * exercises the in-memory fallback path; here we drive the DOM-+-IDB and
 * FSA-enabled branches.
 */

import {
  BrowserDialogService,
  BrowserDownloadRenderExportService,
  FallbackFileService,
  FileSystemAccessFileService,
  IndexedDbStorageService,
  InMemoryFileService,
  InMemoryRenderExportService,
  InMemoryStorageService,
  StubDialogService,
  createWebPlatform,
} from './index';

function installIdb(): void {
  (window as { indexedDB?: unknown }).indexedDB = {
    open: () => {
      const req = {
        result: {
          objectStoreNames: { contains: () => true } as DOMStringList,
          createObjectStore: () => null,
          transaction: () => ({
            objectStore: () => ({
              get: () => ({ onsuccess: null, onerror: null }),
              put: () => ({ onsuccess: null, onerror: null }),
              delete: () => ({ onsuccess: null, onerror: null }),
            }),
            oncomplete: null,
            onerror: null,
            onabort: null,
          }),
        },
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      } as unknown as { onsuccess: (() => void) | null };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
}

function uninstallIdb(): void {
  delete (window as { indexedDB?: unknown }).indexedDB;
}

function installFsaPickers(): void {
  Object.assign(window, {
    showOpenFilePicker: () => Promise.resolve([]),
    showSaveFilePicker: () => Promise.resolve(null),
  });
}

function uninstallFsaPickers(): void {
  delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
}

afterEach(() => {
  uninstallIdb();
  uninstallFsaPickers();
});

describe('createWebPlatform (jsdom, capability-detected)', () => {
  it('picks Fallback + Dialog + InMemoryStorage when only DOM is available', () => {
    const platform = createWebPlatform();
    expect(platform.fileService).toBeInstanceOf(FallbackFileService);
    expect(platform.dialogService).toBeInstanceOf(BrowserDialogService);
    expect(platform.storageService).toBeInstanceOf(InMemoryStorageService);
  });

  it('picks IndexedDbStorageService when window.indexedDB is present', () => {
    installIdb();
    const platform = createWebPlatform();
    expect(platform.storageService).toBeInstanceOf(IndexedDbStorageService);
  });

  it('picks FileSystemAccessFileService when both pickers are present', () => {
    installFsaPickers();
    const platform = createWebPlatform();
    expect(platform.fileService).toBeInstanceOf(FileSystemAccessFileService);
  });

  it('forceInMemory overrides every capability detection', () => {
    installFsaPickers();
    installIdb();
    const platform = createWebPlatform({ forceInMemory: true });
    expect(platform.fileService).toBeInstanceOf(InMemoryFileService);
    expect(platform.storageService).toBeInstanceOf(InMemoryStorageService);
    expect(platform.dialogService).toBeInstanceOf(StubDialogService);
  });

  it('picks BrowserDownloadRenderExportService when document + URL.createObjectURL are both present', () => {
    // jsdom exposes `URL` as the URL parser but NOT `URL.createObjectURL`
    // (that requires real Blob streaming). Install the missing methods so
    // the factory picks the real downloader.
    const fakeGlobal = {
      document: window.document,
      URL: {
        createObjectURL: (_: Blob): string => 'blob:fake',
        revokeObjectURL: (_: string): void => undefined,
      },
    } as unknown as typeof globalThis;
    const platform = createWebPlatform({ globalRef: fakeGlobal });
    expect(platform.renderExportService).toBeInstanceOf(BrowserDownloadRenderExportService);
  });

  it('falls back to InMemoryRenderExportService when URL.createObjectURL is unavailable', () => {
    // Default jsdom: URL exists as the parser class but createObjectURL is
    // not a function — the factory's `hasUrl` check is `false` and the
    // factory hands back the in-memory stub.
    const platform = createWebPlatform();
    expect(platform.renderExportService).toBeInstanceOf(InMemoryRenderExportService);
  });
});
