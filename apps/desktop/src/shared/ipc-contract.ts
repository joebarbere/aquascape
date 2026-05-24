// Typed IPC channel registry — Stage 0 F0.6.
//
// Shared between the main process, the preload bridge and the renderer
// (consumed via `window.aquascape.ipc`). Adding a channel here is a single
// type-checked surface — main / preload / consumer cannot drift.
//
// Stage 0 ships exactly one channel — `ping` — to prove the bridge works
// end-to-end. F1.4+ adds real file-IO / dialog / storage / export channels
// against the same registry.
//
// Conventions:
//   * Every channel name is a literal key on `IpcContract` (no string
//     namespaces — types are the namespace).
//   * Every method takes a single structured payload (or `void`) and
//     returns a `Promise` of a single structured result. This keeps
//     `ipcRenderer.invoke` / `ipcMain.handle` signatures uniform and makes
//     input validation in the main process a single chokepoint per channel.
//   * Payloads + results must be JSON-serializable. The Electron structured-
//     clone hop forbids functions, class instances, etc. — same constraint
//     as `.aqua` document payloads.

export interface PingPayload {
  /** Caller-supplied timestamp, echoed back via `receivedAt`. */
  readonly ts: number;
}

export interface PingResult {
  readonly pong: true;
  /** `Date.now()` measured inside the main process when the call arrived. */
  readonly receivedAt: number;
}

export interface IpcContract {
  ping(payload: PingPayload): Promise<PingResult>;
}

/** All known IPC channel names. Sourced from `IpcContract` so it can never drift. */
export type IpcChannel = keyof IpcContract;

/** Channel names as a runtime list — used by the main-process registrar to register every handler. */
export const IPC_CHANNELS: readonly IpcChannel[] = ['ping'] as const;
