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
// Keep this file minimal — wrap, expose, done. All wrapping logic lives in
// `build-bridge.ts` so it can be unit-tested without `contextBridge`.

import { contextBridge, ipcRenderer } from 'electron';

import { buildBridge } from './build-bridge';

const ipc = buildBridge({
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
});

contextBridge.exposeInMainWorld('aquascape', { ipc });
