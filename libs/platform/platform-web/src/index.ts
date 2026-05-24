// Public API for @aquascape/platform/platform-web.
//
// Browser implementation of platform-api. Stage 0 ships in-memory stubs that
// satisfy the interface and round-trip data so feature work can proceed
// without touching real browser IO. F1.4 swaps the bodies for File System
// Access API + IndexedDB integrations; the surface stays the same.
//
// Only apps may import this lib (enforced via scope:platform-web tag).

import type { Platform } from '@aquascape/platform/platform-api';

import { InMemoryFileService } from './in-memory-file-service';
import { InMemoryRenderExportService } from './in-memory-render-export-service';
import { InMemoryStorageService } from './in-memory-storage-service';
import { StubDialogService } from './stub-dialog-service';

export { InMemoryFileService } from './in-memory-file-service';
export { InMemoryRenderExportService } from './in-memory-render-export-service';
export { InMemoryStorageService } from './in-memory-storage-service';
export { StubDialogService } from './stub-dialog-service';

/**
 * Build a `Platform` bundle backed by the Stage 0 in-memory stubs. The web app
 * composition root calls this at boot. Once F1.4 lands, the factory will
 * return real File System Access / IndexedDB-backed services with the same
 * shape.
 */
export function createWebPlatform(): Platform {
  return {
    fileService: new InMemoryFileService(),
    dialogService: new StubDialogService(),
    storageService: new InMemoryStorageService(),
    renderExportService: new InMemoryRenderExportService(),
  };
}
