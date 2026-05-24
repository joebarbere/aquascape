// Service classes that wrap an `ElectronTransport`. The transport seam means
// Stage 0 in-memory bodies and F1.4 IPC-backed bodies share these wrappers —
// only the transport changes.

import type {
  DialogService,
  FileService,
  OpenDocumentResult,
  RenderExportService,
  SaveDocumentResult,
  StorageService,
  ExportPngResult,
} from '@aquascape/platform/platform-api';

import type { ElectronTransport } from './transport';

export class ElectronFileService implements FileService {
  constructor(private readonly transport: ElectronTransport) {}

  openDocument(): Promise<OpenDocumentResult | null> {
    return this.transport.openDocument();
  }

  saveDocument(args: {
    id?: string;
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<SaveDocumentResult | null> {
    return this.transport.saveDocument(args);
  }

  saveDocumentAs(args: {
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<SaveDocumentResult | null> {
    return this.transport.saveDocumentAs(args);
  }
}

export class ElectronDialogService implements DialogService {
  constructor(private readonly transport: ElectronTransport) {}

  confirm(args: { title: string; message: string; danger?: boolean }): Promise<boolean> {
    return this.transport.confirm(args);
  }

  alert(args: { title: string; message: string }): Promise<void> {
    return this.transport.alert(args);
  }
}

export class ElectronStorageService implements StorageService {
  constructor(private readonly transport: ElectronTransport) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.transport.storageGet({ key });
    if (raw === null || raw === undefined) return null;
    return raw as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.transport.storageSet({ key, value });
  }

  async remove(key: string): Promise<void> {
    await this.transport.storageRemove({ key });
  }
}

export class ElectronRenderExportService implements RenderExportService {
  constructor(private readonly transport: ElectronTransport) {}

  exportPng(args: { bytes: Uint8Array; suggestedName: string }): Promise<ExportPngResult | null> {
    return this.transport.exportPng(args);
  }
}
