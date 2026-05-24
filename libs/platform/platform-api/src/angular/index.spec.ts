// Smoke test for the Angular DI sub-entry.
//
// Validates that the InjectionTokens are constructed and carry the documented
// debug names. The runtime expectation is intentionally tiny — we don't depend
// on Angular's DI runtime here, only on the standalone `InjectionToken`
// constructor that ships in `@angular/core`.

import { DIALOG_SERVICE, FILE_SERVICE, RENDER_EXPORT_SERVICE, STORAGE_SERVICE } from './index';

describe('@aquascape/platform/platform-api/angular', () => {
  it('exports a FILE_SERVICE InjectionToken', () => {
    expect(FILE_SERVICE.toString()).toContain('FileService');
  });

  it('exports a DIALOG_SERVICE InjectionToken', () => {
    expect(DIALOG_SERVICE.toString()).toContain('DialogService');
  });

  it('exports a STORAGE_SERVICE InjectionToken', () => {
    expect(STORAGE_SERVICE.toString()).toContain('StorageService');
  });

  it('exports a RENDER_EXPORT_SERVICE InjectionToken', () => {
    expect(RENDER_EXPORT_SERVICE.toString()).toContain('RenderExportService');
  });
});
