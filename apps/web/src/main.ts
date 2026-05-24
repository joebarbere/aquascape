// Web app bootstrap — Stage 0 F0.6 + F1.1 Phase B (NgRx scene store).
//
// Composition root for `apps/web`. Wires:
//   1. Zone-based change detection with event coalescing.
//   2. Platform-api tokens (FILE/DIALOG/STORAGE/RENDER_EXPORT) bound to the
//      platform the app boots into (web vs Electron).
//   3. The NgRx store + effects runtime, plus the scene feature via
//      `provideSceneStore()`.
//   4. Store devtools in non-prod (best-effort: silent if the browser
//      extension isn't installed).

import { bootstrapApplication } from '@angular/platform-browser';
import { isDevMode, provideZoneChangeDetection } from '@angular/core';
import {
  DIALOG_SERVICE,
  FILE_SERVICE,
  RENDER_EXPORT_SERVICE,
  STORAGE_SERVICE,
} from '@aquascape/platform/platform-api/angular';
import { provideSceneStore } from '@aquascape/state';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';

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
    // NgRx runtime: store + effects, then the scene feature on top.
    provideStore(),
    provideEffects(),
    provideSceneStore(),
    provideStoreDevtools({
      maxAge: 25,
      logOnly: !isDevMode(),
      autoPause: true,
    }),
  ],
}).catch((err: unknown) => {
  // Surface bootstrap failures to the host. Using console.error here is
  // appropriate — this is the last-resort handler at the composition root,
  // not application code. Stage 1+ wires a structured error reporter.
  console.error('Aquascape bootstrap failed:', err);
});
