// Main-process IPC handlers — the trusted side of the typed bridge.
//
// Every handler validates its input (the renderer is untrusted code per
// plan §3 / §5). Validation lives next to the handler so it can never be
// skipped by accident; the registrar in `registerIpcHandlers()` wires each
// entry into `ipcMain.handle`.
//
// Pure factory shape: the registrar takes a `HandlerHost` (the subset of
// `ipcMain` we use) so a unit test can drive every handler without booting
// Electron.

import type { IpcContract, PingPayload, PingResult } from '../shared/ipc-contract';

/**
 * Subset of `Electron.IpcMain` that we actually use. Keeping this minimal
 * lets the test drive it with a hand-rolled fake.
 */
export interface HandlerHost {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>,
  ): void;
}

/** Provider hooks injected into the handlers — exposed so tests can stub them. */
export interface HandlerDeps {
  /** Current time in ms since the epoch. Defaults to `Date.now`. */
  readonly now: () => number;
}

const defaultDeps: HandlerDeps = { now: () => Date.now() };

// ── Validators ──────────────────────────────────────────────────────────────

/**
 * Validate a `ping` payload. Throws a `TypeError` with a generic message on
 * failure — we deliberately do NOT echo the offending value back to the
 * renderer in error messages (plan §3: keep error surfaces narrow).
 */
export function validatePingPayload(value: unknown): PingPayload {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('ping: payload must be an object');
  }
  const ts = (value as { ts?: unknown }).ts;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) {
    throw new TypeError('ping: payload.ts must be a finite number');
  }
  return { ts };
}

// ── Handlers ────────────────────────────────────────────────────────────────

/** Pure body of the `ping` handler — testable in isolation. */
export function handlePing(payload: unknown, deps: HandlerDeps = defaultDeps): PingResult {
  // Validate even though TypeScript types the input — the renderer is
  // untrusted and `payload` arrives as `unknown` over the wire.
  validatePingPayload(payload);
  return { pong: true, receivedAt: deps.now() };
}

// ── Registrar ───────────────────────────────────────────────────────────────

/**
 * Wire every channel in `IpcContract` to `ipcMain.handle`. Returns a record
 * of the bound handlers so a test can call them without an actual `ipcMain`.
 *
 * Each registration:
 *   1. Validates the inbound payload.
 *   2. Returns the structured-clonable result.
 *   3. Lets a thrown error propagate — `ipcRenderer.invoke` will reject the
 *      renderer-side promise. Errors must NOT include sensitive values.
 */
export function registerIpcHandlers(
  host: HandlerHost,
  deps: HandlerDeps = defaultDeps,
): { [K in keyof IpcContract]: (payload: unknown) => ReturnType<IpcContract[K]> } {
  const handlers = {
    ping: (payload: unknown): Promise<PingResult> => Promise.resolve(handlePing(payload, deps)),
  };

  host.handle('ping', (_event, payload) => handlers.ping(payload));

  return handlers;
}
