// Pure factory for the typed preload bridge — extracted so the wrapping
// logic can be unit-tested without `contextBridge` / a renderer context.
//
// The bridge wraps `ipcRenderer.invoke` per-channel. We deliberately do NOT
// expose `ipcRenderer` itself: each channel becomes a typed function so the
// renderer can never invoke an unregistered channel, and a future audit of
// what the renderer can do is just `git grep` against this file.

import type { IpcContract, PingPayload, PingResult } from '../shared/ipc-contract';

/**
 * Minimal subset of `Electron.IpcRenderer` we depend on. Stage 0 only uses
 * `invoke`; F1.4+ will add `on` for push notifications when needed.
 */
export interface BridgeInvoker {
  invoke(channel: string, payload: unknown): Promise<unknown>;
}

/**
 * Build the IPC bridge object. The renderer sees this through
 * `window.aquascape.ipc` (see `preload.ts`).
 */
export function buildBridge(invoker: BridgeInvoker): IpcContract {
  return {
    ping: (payload: PingPayload): Promise<PingResult> =>
      invoker.invoke('ping', payload) as Promise<PingResult>,
  };
}
