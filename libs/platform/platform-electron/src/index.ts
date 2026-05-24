// Public API for @aquascape/platform/platform-electron.
//
// Stage 0 ships in-memory stubs that run entirely in the renderer process and
// satisfy the platform-api contract. Real IPC wiring lands incrementally
// starting in F0.6 (preload bridge scaffold) and F1.4+ (per-feature channels).
//
// Structure: a thin `ElectronTransport` seam encapsulates whatever is doing
// the actual work. The service classes (`ElectronFileService`, etc.) never
// change between Stage 0 and F1.4 — F1.4 swaps the transport and that's all.
//
// Only apps may import this lib (enforced via scope:platform-electron tag).

import type { Platform } from '@aquascape/platform/platform-api';

import {
  ElectronDialogService,
  ElectronFileService,
  ElectronRenderExportService,
  ElectronStorageService,
} from './services';
import { createInMemoryTransport, type ElectronTransport } from './transport';

export {
  ElectronDialogService,
  ElectronFileService,
  ElectronRenderExportService,
  ElectronStorageService,
} from './services';
export {
  createInMemoryTransport,
  type AlertRequest,
  type ConfirmRequest,
  type ElectronTransport,
  type ExportPngRequest,
  type SaveDocumentAsRequest,
  type SaveDocumentRequest,
  type StorageGetRequest,
  type StorageRemoveRequest,
  type StorageSetRequest,
} from './transport';

/**
 * Build a `Platform` bundle backed by the Stage 0 in-memory transport.
 *
 * Callers may supply a custom transport — this is the seam F1.4 will use to
 * swap in IPC-backed implementations against the typed preload bridge. The
 * default in-memory transport is fine for tests and for early feature work.
 */
export function createElectronPlatform(
  transport: ElectronTransport = createInMemoryTransport(),
): Platform {
  return {
    fileService: new ElectronFileService(transport),
    dialogService: new ElectronDialogService(transport),
    storageService: new ElectronStorageService(transport),
    renderExportService: new ElectronRenderExportService(transport),
  };
}
