// Angular DI bindings for @aquascape/platform/platform-api.
//
// Separate sub-entry so the framework-free interface file (../index.ts) never
// pulls in `@angular/core`. Imported as `@aquascape/platform/platform-api/angular`
// by Angular feature libs and the app composition roots.
//
// Implementation is intentionally plain TypeScript — `InjectionToken` compiles
// without Angular AOT. Don't add Angular build infrastructure here.

import { InjectionToken } from '@angular/core';
import type { DialogService, FileService, RenderExportService, StorageService } from '../index';

export const FILE_SERVICE = new InjectionToken<FileService>('FileService');
export const DIALOG_SERVICE = new InjectionToken<DialogService>('DialogService');
export const STORAGE_SERVICE = new InjectionToken<StorageService>('StorageService');
export const RENDER_EXPORT_SERVICE = new InjectionToken<RenderExportService>('RenderExportService');
