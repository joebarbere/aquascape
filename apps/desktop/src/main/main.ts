// Electron main-process entry — Stage 0 F0.6.
//
// Boots the app, creates the secure BrowserWindow, installs the renderer
// CSP, registers the typed IPC handlers, and loads either the dev-server
// URL or the packaged web bundle.
//
// The "pure" pieces (webPreferences builder, CSP, path resolvers, IPC
// validators) live in sibling modules so they can be unit-tested without
// running Electron. This file is the wiring; it intentionally has minimal
// logic of its own.
//
// Security posture (plan §3, non-negotiable):
//   * contextIsolation, sandbox, no nodeIntegration anywhere
//   * Renderer's only path to native APIs is the typed preload bridge
//   * CSP enforced via Content-Security-Policy HTTP header
//   * Navigation + new-window guards block unexpected origins

import * as path from 'node:path';

import { app, BrowserWindow, ipcMain, nativeImage, session, shell } from 'electron';

import {
  createDialogBackend,
  createExportBackend,
  createFileBackend,
  createStorageBackend,
} from './backends';
import { cspForEnvironment } from './csp';
import { registerIpcHandlers } from './ipc-handlers';
import {
  resolveIconPath,
  resolveIndexPath,
  resolvePlatformIconPath,
  resolvePreloadPath,
} from './paths';
import { buildWebPreferences } from './web-preferences';

const DEV_SERVER_ENV = 'DEV_SERVER_URL';

/**
 * Swallow EPIPE on stdout / stderr.
 *
 * Why: Node 20 throws an uncaught exception when a write to stdout/stderr
 * fails (e.g. because the parent shell that owned the pipe has gone away —
 * the dev workflow does this any time the user kills the `nx serve desktop`
 * wrapper but leaves Electron running). Any future Node deprecation warning
 * or Electron internal `console.warn` then crashes the main process with
 * `Error: write EPIPE`. Silently dropping writes to a dead pipe is the
 * standard Electron-on-macOS workaround.
 *
 * We also install a top-level `uncaughtException` filter that ignores
 * EPIPE from console.* / process.stdout — so even if a write slips past
 * the per-stream handler (e.g. through `process.emitWarning`), the app
 * doesn't die. Every other uncaught exception is re-thrown so we don't
 * mask real bugs.
 */
function installPipeGuards(): void {
  const ignoreEpipe = (err: NodeJS.ErrnoException): void => {
    if (err && err.code === 'EPIPE') return;
    // Re-throw asynchronously so the default Node handler runs (which logs
    // + exits). We can't `throw` synchronously inside an 'error' listener.
    setImmediate(() => {
      throw err;
    });
  };
  process.stdout.on('error', ignoreEpipe);
  process.stderr.on('error', ignoreEpipe);

  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    if (err && err.code === 'EPIPE') return;
    // Preserve the original Node behaviour for everything that isn't a
    // dead-pipe write: log, exit non-zero. Done synchronously here because
    // Electron's own handler would otherwise show its native error dialog.
    console.error('Aquascape desktop uncaught exception:', err);
    app.exit(1);
  });
}

/**
 * Install the CSP via an HTTP response header. Packaged builds get the
 * strict policy; unpackaged dev builds get the `'unsafe-eval'`-relaxed
 * variant so AJV's runtime compile works. See csp.ts for the dev caveat.
 */
function installCsp(): void {
  const policy = cspForEnvironment({ isPackaged: app.isPackaged });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    headers['Content-Security-Policy'] = [policy];
    callback({ responseHeaders: headers });
  });
}

/**
 * Block navigation and window-open requests for any origin other than the
 * configured dev-server URL (in dev) or file:// (packaged). A compromised
 * renderer must not be able to navigate to attacker-controlled URLs.
 */
function lockdownNavigation(win: BrowserWindow, devServerUrl: string | undefined): void {
  win.webContents.on('will-navigate', (event, url) => {
    const allowed =
      url.startsWith('file://') || (devServerUrl !== undefined && url.startsWith(devServerUrl));
    if (!allowed) {
      event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // External http(s) links are opened in the user's default browser; nothing
    // else is allowed to open a new BrowserWindow.
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

function createMainWindow(): BrowserWindow {
  const preloadPath = resolvePreloadPath(__dirname);
  const webPreferences = buildWebPreferences(preloadPath);

  // Brand-mark icon — load the platform-native format (ICO on Windows,
  // ICNS on macOS, PNG on Linux + fallback). A read failure is non-fatal;
  // the app falls back to the default Electron diamond. The `icon`
  // property is omitted entirely when the file is missing because
  // Electron's type for it doesn't permit `undefined`. macOS ignores
  // BrowserWindow.icon for the window-title chrome (the .app bundle's
  // ICNS in Info.plist owns that), so the dock-icon path below is what
  // actually drives the visible brand at runtime there.
  const icon = nativeImage.createFromPath(resolvePlatformIconPath(__dirname, process.platform));

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    webPreferences,
    ...(icon.isEmpty() ? {} : { icon }),
  });

  const devServerUrl = process.env[DEV_SERVER_ENV];
  lockdownNavigation(win, devServerUrl);

  if (app.isPackaged) {
    void win.loadFile(resolveIndexPath(__dirname));
  } else if (devServerUrl !== undefined && devServerUrl.length > 0) {
    void win.loadURL(devServerUrl);
  } else {
    // No dev server URL provided and we're not packaged — fall back to the
    // built bundle. This is the path used by `nx build desktop && electron .`
    // smoke tests where the dev server isn't running.
    void win.loadFile(resolveIndexPath(__dirname));
  }

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}

// Lock down web security at the session level too — independent of any
// individual BrowserWindow. Belt-and-braces guard against a future
// BrowserWindow being created elsewhere without the same posture.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    // Disallow <webview> tags entirely — they create new contexts that bypass
    // our security posture.
    event.preventDefault();
  });
});

installPipeGuards();

// Stable canonical app name. Drives:
//   * macOS dock-hover tooltip (until we update it below to include the
//     version, after path resolution has run).
//   * `app.getPath('userData')` → `~/Library/Application Support/Aquascape`
//     on macOS, the equivalent on Linux / Windows. Stable across version
//     bumps so user data does NOT move when the app upgrades.
//   * Notifications "from app" label.
//
// Without this call the unpackaged dev run picks up "Electron" (the
// fallback when the walked-up package.json name is a scope like
// `@aquascape/source` that's not a valid identity name), which is what
// the user was seeing in the dock.
app.setName('Aquascape');

app
  .whenReady()
  .then(() => {
    installCsp();

    // macOS dock icon. BrowserWindow's `icon` is ignored on macOS for
    // window chrome (the OS uses the .app bundle's ICNS), but
    // `app.dock.setIcon()` surfaces the brand mark in the dock at runtime
    // — important for the dev experience (`nx serve desktop`) where
    // there's no signed bundle yet. We load the native ICNS so the dock
    // icon stays crisp across retina + DPR changes; falls back to PNG if
    // the ICNS isn't there (e.g. someone ran `pnpm icons` on Linux and
    // the macOS-only iconutil step was skipped). Production packaging
    // (Stage 8+) will embed the same ICNS in Info.plist via the packager.
    if (process.platform === 'darwin' && app.dock !== undefined) {
      let dockIcon = nativeImage.createFromPath(resolveIconPath(__dirname, 'icns'));
      if (dockIcon.isEmpty()) {
        dockIcon = nativeImage.createFromPath(resolveIconPath(__dirname, 'png'));
      }
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon);
      }
    }

    // Pre-resolve the storage path BEFORE we update `app.setName()` for
    // display (below). `app.getPath('userData')` is computed lazily from
    // the current `app.getName()`, so re-naming for the dock hover would
    // otherwise move the JSON store between writes. We freeze the path
    // here against the canonical "Aquascape" name and hand a constant
    // thunk to the backend.
    const storagePath = path.join(app.getPath('userData'), 'aquascape-storage.json');

    // F1.4: the file picker / dialogs / storage / export channels need a
    // BrowserWindow to anchor native modals to. We pass a `getWindow()`
    // accessor instead of a window directly so the backends stay valid
    // across window create / close / reopen cycles.
    let mainWindow: BrowserWindow | null = createMainWindow();
    const getWindow = (): BrowserWindow | null => mainWindow;

    registerIpcHandlers(ipcMain, {
      now: () => Date.now(),
      file: createFileBackend(getWindow),
      dialog: createDialogBackend(getWindow),
      storage: createStorageBackend(() => storagePath),
      export: createExportBackend(getWindow),
    });

    // Update the display name with a version marker so the macOS dock
    // hover (and the "About" menu's app name) tells the user which build
    // they're poking at. Dev runs (`pnpm restart:desktop`, `nx serve
    // desktop`, plain `electron`) → "(dev)". Packaged builds → the
    // version baked into the .app bundle's package.json. Done AFTER the
    // storage path resolution above so the userData directory stays
    // stable across renames + version bumps.
    const versionLabel = app.isPackaged ? app.getVersion() : '(dev)';
    app.setName(`Aquascape ${versionLabel}`);

    // macOS "About Aquascape" panel — keep the canonical name there, with
    // the resolved version. The app name shown by the dock hover (set via
    // `app.setName` above) already carries the marker, so we don't repeat
    // it here.
    if (process.platform === 'darwin' && typeof app.setAboutPanelOptions === 'function') {
      app.setAboutPanelOptions({
        applicationName: 'Aquascape',
        applicationVersion: versionLabel,
      });
    }

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        mainWindow.on('closed', () => {
          mainWindow = null;
        });
      }
    });
  })
  .catch((err: unknown) => {
    // Last-resort handler at the composition root. Stage 1+ wires a structured
    // crash reporter (opt-in, plan §3).
    console.error('Aquascape desktop main process failed to boot:', err);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Surface the path module reference so TS doesn't strip the import in a
// future refactor — `path` is also used transitively by the sibling modules
// but we want a clear top-level dependency on Node's path utilities.
void path;
