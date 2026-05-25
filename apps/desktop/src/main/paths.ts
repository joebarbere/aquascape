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
 * Resolve the absolute path to the app icon, given the directory containing
 * the compiled `main.js` at runtime. The icons (PNG / ICO / ICNS) are
 * generated from `apps/web/src/favicon.svg` via `pnpm icons`
 * (`tools/build-icons.mjs`) and copied by the `build-main` target's
 * `assets` entry to `dist/apps/desktop/main/assets/`.
 *
 * Runtime layout: from `dist/apps/desktop/main/src/main/`, climb 2 to
 * `dist/apps/desktop/main/` and descend into `assets/icon.<ext>`.
 *
 * The optional `kind` argument selects the file format:
 *   - `'png'`  — cross-platform fallback (used by `BrowserWindow({ icon })`
 *     on Linux and as the universal fallback).
 *   - `'ico'`  — Windows multi-size icon (16, 24, 32, 48, 64, 128, 256).
 *     Used for the Windows `BrowserWindow` icon and (later) by the
 *     packager for the `.exe` resource section.
 *   - `'icns'` — macOS-native icon bundle (16…1024 incl. @2x retinas).
 *     Used by `app.dock.setIcon()` for crisp dock rendering across DPRs;
 *     consumed by the packager (Stage 8+) for the `.app` bundle's
 *     `Contents/Resources/`.
 *
 * Defaults to PNG when omitted (callers that don't care about platform
 * native formats).
 */
export type IconKind = 'png' | 'ico' | 'icns';

export function resolveIconPath(mainDir: string, kind: IconKind = 'png'): string {
  return path.join(mainDir, '..', '..', 'assets', `icon.${kind}`);
}

/**
 * Resolve the most appropriate icon path for the current platform. Used by
 * the BrowserWindow constructor and `app.dock.setIcon()` so each OS gets
 * its native-format icon at runtime.
 *
 * - Linux / unknown → PNG.
 * - Windows         → ICO.
 * - macOS           → ICNS (sharper on retina than rasterising a PNG).
 */
export function resolvePlatformIconPath(mainDir: string, platform: NodeJS.Platform): string {
  switch (platform) {
    case 'darwin':
      return resolveIconPath(mainDir, 'icns');
    case 'win32':
      return resolveIconPath(mainDir, 'ico');
    default:
      return resolveIconPath(mainDir, 'png');
  }
}
