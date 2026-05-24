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

contextBridge.exposeInMainWorld('aquascape', { ipc });
