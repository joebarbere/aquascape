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

import { app, BrowserWindow, ipcMain, session, shell } from 'electron';

import { ELECTRON_CSP } from './csp';
import { registerIpcHandlers } from './ipc-handlers';
import { resolveIndexPath, resolvePreloadPath } from './paths';
import { buildWebPreferences } from './web-preferences';

const DEV_SERVER_ENV = 'DEV_SERVER_URL';

/**
 * Install the CSP via an HTTP response header. We compose with (rather than
 * replace) the meta-tag CSP shipped in `apps/web/src/index.html` — the
 * stricter of the two wins.
 */
function installCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    headers['Content-Security-Policy'] = [ELECTRON_CSP];
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

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    webPreferences,
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

app
  .whenReady()
  .then(() => {
    installCsp();
    registerIpcHandlers(ipcMain);

    let mainWindow: BrowserWindow | null = createMainWindow();
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
