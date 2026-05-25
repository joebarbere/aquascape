// Pure path-resolution helpers for the main process. Extracted so they're
// unit-testable without booting Electron.
//
// Build layout (per F0.6 + apps/desktop/project.json):
//
//   dist/apps/desktop/main/src/main/main.js        ← __dirname for the entry
//   dist/apps/desktop/preload/src/preload/preload.js
//   dist/apps/web/browser/index.html               ← Angular 18 `application` builder
//
// The `src/` nesting under each output directory is a `@nx/js:tsc` artefact:
// when the TS project's `include` spans multiple sub-trees (here `src/main`
// + `src/shared`), the compiler computes a `rootDir` of `src/` and mirrors
// that under the output path. Rather than fight the executor (which would
// require splitting the shared types into their own buildable lib for one
// file), we encode the actual runtime layout here. The companion spec pins
// every relative climb so future contributors get an obvious failure if the
// layout ever changes.
//
// From `dist/apps/desktop/main/src/main/`:
//   * index.html  → climb four levels (`main`, `src`, `main`, `desktop`) and
//     descend into `web/browser/index.html`.
//   * preload.js  → climb three levels (`main`, `src`, `main`) and descend
//     into `preload/src/preload/preload.js`.

import * as path from 'node:path';

/**
 * Resolve the absolute path to the web bundle's `index.html`, given the
 * directory containing the compiled `main.js` at runtime.
 *
 * Runtime layout: `dist/apps/desktop/main/src/main/main.js`. Web bundle:
 * `dist/apps/web/browser/index.html`.
 */
export function resolveIndexPath(mainDir: string): string {
  return path.join(mainDir, '..', '..', '..', '..', 'web', 'browser', 'index.html');
}

/**
 * Resolve the absolute path to the compiled preload script, given the
 * directory containing the compiled `main.js` at runtime.
 *
 * Runtime layout: `dist/apps/desktop/preload/src/preload/preload.js`.
 */
export function resolvePreloadPath(mainDir: string): string {
  return path.join(mainDir, '..', '..', '..', 'preload', 'src', 'preload', 'preload.js');
}

/**
 * Resolve the absolute path to the app icon PNG, given the directory
 * containing the compiled `main.js` at runtime. The icon is copied by the
 * `build-main` target's `assets` entry to `dist/apps/desktop/main/assets/`.
 *
 * Runtime layout: from `dist/apps/desktop/main/src/main/`, climb 2 to
 * `dist/apps/desktop/main/` and descend into `assets/icon.png`.
 *
 * Used for:
 *   - `BrowserWindow({ icon })` on Windows / Linux (macOS ignores it for
 *     window chrome but the app.dock.setIcon() call uses the same file).
 *   - `app.dock.setIcon()` on macOS to surface the brand mark in the dock
 *     during `nx serve desktop` (production packaging needs a proper ICNS
 *     in the app bundle's Info.plist — separate follow-up).
 */
export function resolveIconPath(mainDir: string): string {
  return path.join(mainDir, '..', '..', 'assets', 'icon.png');
}
