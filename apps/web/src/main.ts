// Web app bootstrap — Stage 0 F0.6.
//
// Composition root for `apps/web`. Wires:
//   1. Zone-based change detection with event coalescing (Angular 18 default
//      idiom; `provideExperimentalZonelessChangeDetection` remains
//      experimental in 18 and would change the rendering loop semantics).
//   2. Platform-api tokens → either platform-web OR platform-electron,
//      chosen at runtime by detecting the typed preload bridge
//      (`window.aquascape`) injected by the Electron shell. The same web
//      bundle runs in both a normal browser and inside Electron — when
//      Electron-only features land that need a different bootstrap, we'll
//      ship a separate renderer entry under `apps/desktop/src/renderer/`.
//
// The runtime check is intentionally tiny and one-shot — it does NOT change
// the rest of the application's behaviour, only the platform binding.

import { bootstrapApplication } from '@angular/platform-browser';
import { provideZoneChangeDetection } from '@angular/core';
import {
  DIALOG_SERVICE,
  FILE_SERVICE,
  RENDER_EXPORT_SERVICE,
  STORAGE_SERVICE,
} from '@aquascape/platform/platform-api/angular';

import { AppComponent } from './app/app.component';
import { selectPlatform } from './select-platform';

const platform = selectPlatform();

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    { provide: FILE_SERVICE, useValue: platform.fileService },
    { provide: DIALOG_SERVICE, useValue: platform.dialogService },
    { provide: STORAGE_SERVICE, useValue: platform.storageService },
    { provide: RENDER_EXPORT_SERVICE, useValue: platform.renderExportService },
  ],
}).catch((err: unknown) => {
  // Surface bootstrap failures to the host. Using console.error here is
  // appropriate — this is the last-resort handler at the composition root,
  // not application code. Stage 1+ wires a structured error reporter.
  console.error('Aquascape bootstrap failed:', err);
});
