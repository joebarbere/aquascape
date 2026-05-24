// Type-surface smoke test for @aquascape/platform/platform-api.
//
// The library is interface-only; there's no behaviour to exercise. These tests
// pin the public type surface so accidental removals of a named export are
// caught at PR time alongside the lint and build gates.

import type {
  DialogService,
  ExportPngResult,
  FileService,
  OpenDocumentResult,
  Platform,
  RenderExportService,
  SaveDocumentResult,
  StorageService,
} from './index';

describe('@aquascape/platform/platform-api', () => {
  it('exposes the documented interface surface', () => {
    // Synthesize a minimal Platform implementation purely to satisfy each
    // interface contract at the type level. The values are never invoked.
    const platform: Platform = {
      fileService: {
        async openDocument(): Promise<OpenDocumentResult | null> {
          return null;
        },
        async saveDocument(): Promise<SaveDocumentResult | null> {
          return null;
        },
        async saveDocumentAs(): Promise<SaveDocumentResult | null> {
          return null;
        },
      } satisfies FileService,
      dialogService: {
        async confirm(): Promise<boolean> {
          return false;
        },
        async alert(): Promise<void> {
          return;
        },
      } satisfies DialogService,
      storageService: {
        async get<T>(): Promise<T | null> {
          return null;
        },
        async set<T>(_key: string, _value: T): Promise<void> {
          return;
        },
        async remove(): Promise<void> {
          return;
        },
      } satisfies StorageService,
      renderExportService: {
        async exportPng(): Promise<ExportPngResult | null> {
          return null;
        },
      } satisfies RenderExportService,
    };

    expect(typeof platform.fileService.openDocument).toBe('function');
    expect(typeof platform.dialogService.confirm).toBe('function');
    expect(typeof platform.storageService.get).toBe('function');
    expect(typeof platform.renderExportService.exportPng).toBe('function');
  });
});
