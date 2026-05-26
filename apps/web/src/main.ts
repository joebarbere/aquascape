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
import { provideServiceWorker } from '@angular/service-worker';
import {
  DIALOG_SERVICE,
  FILE_SERVICE,
  RENDER_EXPORT_SERVICE,
  STORAGE_SERVICE,
} from '@aquascape/platform/platform-api/angular';
import {
  DocumentEffects,
  provideDocumentStore,
  provideSceneStore,
  provideSelectionStore,
} from '@aquascape/state';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';

import { ThemeService } from '@aquascape/features/editor-shell';

import { AppComponent } from './app/app.component';
import { orbital3DControlsProvider } from './app/renderer.token';
import { selectPlatform } from './select-platform';

const platform = selectPlatform();

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    { provide: FILE_SERVICE, useValue: platform.fileService },
    { provide: DIALOG_SERVICE, useValue: platform.dialogService },
    { provide: STORAGE_SERVICE, useValue: platform.storageService },
    { provide: RENDER_EXPORT_SERVICE, useValue: platform.renderExportService },
    // Editor-shell's `Orbit3DService` (driving the zoom-control + the
    // pan/rotate pill in 3D mode) injects `ORBITAL_3D_CONTROLS`. The
    // binding lives here because it has to point at the same singleton
    // backing `SCENE_RENDERER_3D` — `Three3DRenderer` implements both
    // interfaces, so resolving the token via the existing factory is
    // exactly the renderer instance the canvas pair drives.
    orbital3DControlsProvider,
    // NgRx runtime: store + effects, then the scene + document + selection
    // features. `provideSelectionStore` is required for the F3.3 selection
    // slice the canvas + inspector + layers-panel read from; without it,
    // `selectSelectedIds` returns `undefined` and every derived selector
    // crashes with "Cannot read properties of undefined (reading 'length')".
    provideStore(),
    provideEffects(),
    provideSceneStore(),
    provideDocumentStore(),
    provideSelectionStore(),
    provideStoreDevtools({
      maxAge: 25,
      logOnly: !isDevMode(),
      autoPause: true,
    }),
    // Stage 6 F6.4 follow-up — register the @angular/service-worker SW
    // produced by the build (via `serviceWorker: ngsw-config.json` in
    // project.json). Production-only: dev disables it so the dev server
    // serves fresh bundles without cache surprises. Registration is
    // deferred ~30 s after app stable so the SW doesn't compete with
    // initial paint or first-input responsiveness.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
})
  .then((ref) => {
    // F1.5: on first paint, prime the document store from storage so the
    // recovery banner and recent-files menu reflect any persisted state. The
    // bootstrap call is async; we kick it off without blocking, because the
    // UI is fully usable in the empty/clean state until storage replies.
    const docEffects = ref.injector.get(DocumentEffects);
    void docEffects.bootstrap();

    // v1 polish: touch ThemeService at boot so its constructor primes the
    // persisted preference from storage and registers the OS-scheme media
    // query listener BEFORE the user has a chance to interact. Without this
    // the service stays uninstantiated until the toggle is opened, and the
    // page renders one frame in the default theme.
    ref.injector.get(ThemeService);
  })
  .catch((err: unknown) => {
    // Surface bootstrap failures to the host. Using console.error here is
    // appropriate — this is the last-resort handler at the composition root,
    // not application code. Stage 1+ wires a structured error reporter.
    console.error('Aquascape bootstrap failed:', err);
  });
