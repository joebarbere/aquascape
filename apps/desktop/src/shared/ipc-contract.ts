// Typed IPC channel registry. F0.6 (initial) + F1.4 (file/dialog/storage/export).
//
// Shared between the main process, the preload bridge and the renderer
// (consumed via `window.aquascape.ipc`). Adding a channel here is a single
// type-checked surface — main / preload / consumer cannot drift.
//
// Conventions:
//   * Every channel name is a literal key on `IpcContract` (no string
//     namespaces — types are the namespace).
//   * Every method takes a single structured payload (or `void`) and returns
//     a `Promise` of a single structured result. This keeps
//     `ipcRenderer.invoke` / `ipcMain.handle` signatures uniform and makes
//     input validation in the main process a single chokepoint per channel.
//   * Payloads + results must be JSON-serializable. The Electron structured-
//     clone hop forbids functions, class instances, etc. — same constraint
//     as `.aqua` document payloads.
//   * Channel names are dot-separated (`file.open`, not `file:open`) so they
//     map cleanly to TS property access on the bridge object.
//   * Bytes cross the IPC boundary as `Uint8Array`. Electron's structured-
//     clone preserves the typed array; we never base64-encode.

// ─── Ping (F0.6 handshake) ───────────────────────────────────────────────

export interface PingPayload {
  /** Caller-supplied timestamp, echoed back via `receivedAt`. */
  readonly ts: number;
}

export interface PingResult {
  readonly pong: true;
  /** `Date.now()` measured inside the main process when the call arrived. */
  readonly receivedAt: number;
}

// ─── File IO (F1.4) ──────────────────────────────────────────────────────

export interface FileOpenResult {
  /** Absolute path; serves as the `OpenDocumentResult.id` on the renderer. */
  readonly id: string;
  readonly bytes: Uint8Array;
  /** Basename without directory components. */
  readonly name: string;
}

export interface FileSavePayload {
  /** Absolute path to save to. Omit to prompt for one (Save As semantics). */
  readonly id?: string;
  readonly bytes: Uint8Array;
  /** Default filename suggested in the save dialog when no `id` is supplied. */
  readonly suggestedName: string;
}

export interface FileSaveAsPayload {
  readonly bytes: Uint8Array;
  readonly suggestedName: string;
}

export interface FileSaveResult {
  readonly id: string;
}

// ─── Dialogs (F1.4) ──────────────────────────────────────────────────────

export interface DialogConfirmPayload {
  readonly title: string;
  readonly message: string;
  readonly danger?: boolean;
}

export interface DialogAlertPayload {
  readonly title: string;
  readonly message: string;
}

// ─── Storage (F1.4 / F1.5) ───────────────────────────────────────────────

export interface StorageGetPayload {
  readonly key: string;
}

export interface StorageSetPayload {
  readonly key: string;
  /** Arbitrary structured-clonable shape; main process re-validates as JSON. */
  readonly value: unknown;
}

export interface StorageRemovePayload {
  readonly key: string;
}

// ─── PNG export (F6.1 placeholder; stubbed here so the wiring is in place) ──

export interface ExportPngPayload {
  readonly bytes: Uint8Array;
  readonly suggestedName: string;
}

export interface ExportPngResult {
  readonly path: string;
}

// ─── Contract ────────────────────────────────────────────────────────────

export interface IpcContract {
  ping(payload: PingPayload): Promise<PingResult>;

  // File IO — `null` = user cancelled the picker.
  ['file.open'](): Promise<FileOpenResult | null>;
  ['file.save'](payload: FileSavePayload): Promise<FileSaveResult | null>;
  ['file.saveAs'](payload: FileSaveAsPayload): Promise<FileSaveResult | null>;

  // Dialogs.
  ['dialog.confirm'](payload: DialogConfirmPayload): Promise<boolean>;
  ['dialog.alert'](payload: DialogAlertPayload): Promise<void>;

  // Storage (userData-rooted JSON file).
  ['storage.get'](payload: StorageGetPayload): Promise<unknown>;
  ['storage.set'](payload: StorageSetPayload): Promise<void>;
  ['storage.remove'](payload: StorageRemovePayload): Promise<void>;

  // PNG export — `null` = user cancelled.
  ['export.png'](payload: ExportPngPayload): Promise<ExportPngResult | null>;
}

/** All known IPC channel names. Sourced from `IpcContract` so it can never drift. */
export type IpcChannel = keyof IpcContract;

/** Channel names as a runtime list — used by the registrar to wire every handler. */
export const IPC_CHANNELS: readonly IpcChannel[] = [
  'ping',
  'file.open',
  'file.save',
  'file.saveAs',
  'dialog.confirm',
  'dialog.alert',
  'storage.get',
  'storage.set',
  'storage.remove',
  'export.png',
] as const;
