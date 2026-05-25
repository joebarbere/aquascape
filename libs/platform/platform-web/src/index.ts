// Public API for @aquascape/platform/platform-web.
//
// Browser implementation of platform-api. Each service capability-detects at
// `createWebPlatform()` time and picks the best available backend:
//
//   * FileService — File System Access (Chromium) → fallback (Safari/Firefox).
//     The fallback collapses Save into Save As (no silent overwrite) because
//     the legacy `<input type=file>` + download flow has no concept of a
//     stable user-chosen file handle.
//   * StorageService — IndexedDB → in-memory (private-mode Firefox etc.).
//   * DialogService  — `<dialog>` (every modern browser) → in-memory stub
//     (non-DOM environments / tests).
//   * RenderExportService — in-memory only for now; F6.1 wires real export.
//
// Stage 0 in-memory stubs are still exported so tests + SSR can opt in
// explicitly without a window/document.
//
// Only apps may import this lib (enforced via scope:platform-web tag).

import type { Platform } from '@aquascape/platform/platform-api';

import { BrowserDialogService } from './browser-dialog-service';
import { FallbackFileService } from './fallback-file-service';
import {
  FileSystemAccessFileService,
  isFileSystemAccessAvailable,
} from './file-system-access-file-service';
import { InMemoryFileService } from './in-memory-file-service';
import { BrowserDownloadRenderExportService } from './browser-download-render-export-service';
import { InMemoryRenderExportService } from './in-memory-render-export-service';
import { InMemoryStorageService } from './in-memory-storage-service';
import {
  IndexedDbStorageService,
  isIndexedDbAvailable,
} from './indexed-db-storage-service';
import { StubDialogService } from './stub-dialog-service';

export { BrowserDialogService } from './browser-dialog-service';
export { FallbackFileService } from './fallback-file-service';
export {
  FileSystemAccessFileService,
  isFileSystemAccessAvailable,
} from './file-system-access-file-service';
export { InMemoryFileService } from './in-memory-file-service';
export { InMemoryRenderExportService } from './in-memory-render-export-service';
export { BrowserDownloadRenderExportService } from './browser-download-render-export-service';
export { InMemoryStorageService } from './in-memory-storage-service';
export {
  IndexedDbStorageService,
  isIndexedDbAvailable,
} from './indexed-db-storage-service';
export { StubDialogService } from './stub-dialog-service';

/**
 * Build a `Platform` bundle for the browser. Each capability is detected
 * independently: a Firefox tab gets the fallback FileService + IndexedDB
 * storage + real Dialog; a private-mode Chrome tab gets FSA + in-memory
 * storage + real Dialog.
 *
 * Tests can short-circuit detection by passing `{ forceInMemory: true }`,
 * which yields the original Stage-0 in-memory bundle.
 */
export function createWebPlatform(
  options: { forceInMemory?: boolean; globalRef?: typeof globalThis } = {},
): Platform {
  const globalRef = options.globalRef ?? globalThis;
  if (options.forceInMemory === true) {
    return inMemoryPlatform();
  }

  const hasDoc = typeof (globalRef as { document?: Document }).document !== 'undefined';

  const fileService = isFileSystemAccessAvailable(globalRef)
    ? new FileSystemAccessFileService(globalRef)
    : hasDoc
      ? new FallbackFileService((globalRef as { document: Document }).document)
      : new InMemoryFileService();

  const storageService = isIndexedDbAvailable(globalRef)
    ? new IndexedDbStorageService(globalRef)
    : new InMemoryStorageService();

  const dialogService = hasDoc
    ? new BrowserDialogService((globalRef as { document: Document }).document)
    : new StubDialogService();

  // Stage 6 F6.1 — real browser download via <a download> + Blob URL.
  // Falls back to the in-memory stub when no `document` / `URL` is
  // available (Node + jsdom-without-URL setups).
  const win = globalRef as unknown as {
    URL?: { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
  };
  const hasUrl =
    win.URL !== undefined &&
    typeof win.URL.createObjectURL === 'function' &&
    typeof win.URL.revokeObjectURL === 'function';
  const renderExportService =
    hasDoc && hasUrl
      ? new BrowserDownloadRenderExportService(
          (globalRef as { document: Document }).document,
          (globalRef as unknown as { URL: { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void } }).URL,
        )
      : new InMemoryRenderExportService();

  return {
    fileService,
    dialogService,
    storageService,
    renderExportService,
  };
}

function inMemoryPlatform(): Platform {
  return {
    fileService: new InMemoryFileService(),
    dialogService: new StubDialogService(),
    storageService: new InMemoryStorageService(),
    renderExportService: new InMemoryRenderExportService(),
  };
}
