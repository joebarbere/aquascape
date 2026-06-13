// Electron preload script — Stage 0 F0.6.
//
// Runs in a sandboxed renderer context with `contextIsolation: true`. Its
// sole job is to expose a typed bridge to the renderer via
// `contextBridge.exposeInMainWorld`. The renderer never sees `ipcRenderer`
// itself — only the narrow, typed shape defined in `../shared/ipc-contract.ts`.
//
// Constraints (plan §3, non-negotiable):
//   * No Node.js APIs may be reachable from the renderer.
//   * No raw `ipcRenderer` exposure.
//   * Only structured-cloneable data crosses `exposeInMainWorld` — Electron
//     warns / errors on non-plain values.
//
// SANDBOX CAVEAT (load-bearing): with `sandbox: true`, the preload runs in
// a restricted CommonJS environment whose `require` only resolves an
// Electron-allowlisted set of modules (`electron`, `events`, `timers`,
// `url`). It CANNOT `require` sibling files in its own output directory.
// So every IPC wrapper below is inlined directly here — moving them into
// a helper module produces a `module not found: ./helper` error at
// preload load time. The same wrapping shape lives in `./build-bridge.ts`
// for unit tests, but that file is **not loaded by Electron**; it exists
// solely so the channel mapping has a non-sandboxed home that Jest can
// exercise.

import { contextBridge, ipcRenderer } from 'electron';

import type { IpcContract } from '../shared/ipc-contract';

const ipc: IpcContract = {
  ping: (payload) => ipcRenderer.invoke('ping', payload),
  'file.open': () => ipcRenderer.invoke('file.open'),
  'file.save': (payload) => ipcRenderer.invoke('file.save', payload),
  'file.saveAs': (payload) => ipcRenderer.invoke('file.saveAs', payload),
  'dialog.confirm': (payload) => ipcRenderer.invoke('dialog.confirm', payload),
  'dialog.alert': (payload) => ipcRenderer.invoke('dialog.alert', payload),
  'storage.get': (payload) => ipcRenderer.invoke('storage.get', payload),
  'storage.set': (payload) => ipcRenderer.invoke('storage.set', payload),
  'storage.remove': (payload) => ipcRenderer.invoke('storage.remove', payload),
  'export.png': (payload) => ipcRenderer.invoke('export.png', payload),
};

// Launch mode forwarded from the main process via
// `webPreferences.additionalArguments` (see main.ts `createMainWindow`).
// The sandbox can't `require` sibling modules, so the parse is inlined here
// rather than imported from `../main/app-mode` — the canonical grammar lives
// there (`MODE_ARG_PREFIX` + `readForwardedMode`) and is unit-tested. We
// only forward the allowlisted values; anything unexpected degrades to
// 'normal' so a malformed argv can't smuggle an arbitrary string into the
// renderer's global.
const MODE_ARG_PREFIX = '--aquascape-mode=';
// Single-token modes + the `game:<submode>` colon family (ADR-0007). The
// canonical grammar lives in `../main/app-mode.ts`; this is the inlined copy
// the sandbox forces (it can't `require` siblings). Keep the two in sync.
const SINGLE_TOKEN_MODES = ['normal', 'simulation'] as const;
const GAME_MODES = ['survival', 'feeding', 'predator', 'cleaner'] as const;
const GAME_MODE_PREFIX = 'game:';
type GameMode = (typeof GAME_MODES)[number];
type AppMode = (typeof SINGLE_TOKEN_MODES)[number] | `game:${GameMode}`;
function parseModeToken(value: string): AppMode | null {
  if ((SINGLE_TOKEN_MODES as readonly string[]).includes(value)) {
    return value as AppMode;
  }
  if (value.startsWith(GAME_MODE_PREFIX)) {
    const sub = value.slice(GAME_MODE_PREFIX.length);
    if ((GAME_MODES as readonly string[]).includes(sub)) {
      return `game:${sub as GameMode}`;
    }
  }
  return null;
}
function readMode(): AppMode {
  for (const arg of process.argv) {
    if (arg.startsWith(MODE_ARG_PREFIX)) {
      const parsed = parseModeToken(arg.slice(MODE_ARG_PREFIX.length));
      if (parsed !== null) return parsed;
    }
  }
  return 'normal';
}

// Runtime mode switches pushed from the main process's "Mode" application
// menu. We expose a NARROW subscription, never raw `ipcRenderer` or the event
// object: the callback receives only the validated mode string. The returned
// thunk unsubscribes. Channel literal is duplicated from main.ts `MODE_CHANNEL`
// (the sandbox can't share a const) — keep them in sync.
const MODE_CHANNEL = 'app.mode.set';
function onSetMode(callback: (mode: AppMode) => void): () => void {
  const listener = (_event: unknown, mode: unknown): void => {
    if (typeof mode === 'string') {
      const parsed = parseModeToken(mode);
      if (parsed !== null) callback(parsed);
    }
  };
  ipcRenderer.on(MODE_CHANNEL, listener);
  return () => {
    ipcRenderer.removeListener(MODE_CHANNEL, listener);
  };
}

contextBridge.exposeInMainWorld('aquascape', { ipc, mode: readMode(), onSetMode });
