// Pure factory for the typed preload bridge — extracted so the wrapping
// logic can be unit-tested without `contextBridge` / a renderer context.
//
// The bridge wraps `ipcRenderer.invoke` per-channel. We deliberately do NOT
// expose `ipcRenderer` itself: each channel becomes a typed function so the
// renderer can never invoke an unregistered channel, and a future audit of
// what the renderer can do is just `git grep` against this file.

import type {
  DialogAlertPayload,
  DialogConfirmPayload,
  ExportPngPayload,
  ExportPngResult,
  FileOpenResult,
  FileSaveAsPayload,
  FileSavePayload,
  FileSaveResult,
  IpcContract,
  PingPayload,
  PingResult,
  StorageGetPayload,
  StorageRemovePayload,
  StorageSetPayload,
} from '../shared/ipc-contract';

/**
 * Minimal subset of `Electron.IpcRenderer` we depend on. F1.4+ may add `on`
 * for push notifications (e.g. autosave hint from main); for now `invoke` is
 * sufficient because every channel is a request/response.
 */
export interface BridgeInvoker {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

/**
 * Build the IPC bridge object. The renderer sees this through
 * `window.aquascape.ipc` (see `preload.ts`).
 */
export function buildBridge(invoker: BridgeInvoker): IpcContract {
  return {
    ping: (payload: PingPayload): Promise<PingResult> =>
      invoker.invoke('ping', payload) as Promise<PingResult>,
    'file.open': (): Promise<FileOpenResult | null> =>
      invoker.invoke('file.open') as Promise<FileOpenResult | null>,
    'file.save': (payload: FileSavePayload): Promise<FileSaveResult | null> =>
      invoker.invoke('file.save', payload) as Promise<FileSaveResult | null>,
    'file.saveAs': (payload: FileSaveAsPayload): Promise<FileSaveResult | null> =>
      invoker.invoke('file.saveAs', payload) as Promise<FileSaveResult | null>,
    'dialog.confirm': (payload: DialogConfirmPayload): Promise<boolean> =>
      invoker.invoke('dialog.confirm', payload) as Promise<boolean>,
    'dialog.alert': (payload: DialogAlertPayload): Promise<void> =>
      invoker.invoke('dialog.alert', payload) as Promise<void>,
    'storage.get': (payload: StorageGetPayload): Promise<unknown> =>
      invoker.invoke('storage.get', payload),
    'storage.set': (payload: StorageSetPayload): Promise<void> =>
      invoker.invoke('storage.set', payload) as Promise<void>,
    'storage.remove': (payload: StorageRemovePayload): Promise<void> =>
      invoker.invoke('storage.remove', payload) as Promise<void>,
    'export.png': (payload: ExportPngPayload): Promise<ExportPngResult | null> =>
      invoker.invoke('export.png', payload) as Promise<ExportPngResult | null>,
  };
}
