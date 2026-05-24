// Main-process IPC handlers — the trusted side of the typed bridge.
//
// Every handler validates its input (the renderer is untrusted code per
// plan §3 / §5). Validation lives next to the handler so it can never be
// skipped by accident; the registrar in `registerIpcHandlers()` wires each
// entry into `ipcMain.handle`.
//
// Pure factory shape: the registrar takes a `HandlerHost` (the subset of
// `ipcMain` we use) and a `HandlerDeps` (file IO + dialogs + storage) so a
// unit test can drive every handler without booting Electron.
//
// Error-surface rule (plan §3, non-negotiable): we deliberately do NOT echo
// raw user payloads back to the renderer in error messages. Bad shapes get a
// generic `TypeError` describing the channel + the offending field name —
// never the value.

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

// ── HandlerHost ─────────────────────────────────────────────────────────────

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

// ── HandlerDeps ─────────────────────────────────────────────────────────────

/**
 * Provider hooks injected into the handlers — exposed so tests can stub them
 * without bringing in `electron`/`fs`.
 *
 * Splitting deps along feature lines (file/dialog/storage/export) keeps the
 * test surface small per handler while still letting the registrar wire
 * everything from a single object.
 */
export interface HandlerDeps {
  readonly now: () => number;
  readonly file: FileBackend;
  readonly dialog: DialogBackend;
  readonly storage: StorageBackend;
  readonly export: ExportBackend;
}

/**
 * File-IO backend. The real implementation in `main.ts` wires this to
 * Electron's `dialog.showOpenDialog` + `dialog.showSaveDialog` and Node's
 * `fs.promises.{readFile,writeFile}`. The seam exists so the unit test can
 * drive every branch without touching the disk.
 */
export interface FileBackend {
  /** Show a single-file open picker. `null` if the user cancelled. */
  showOpenPicker(): Promise<{ id: string; name: string } | null>;
  /** Show a save picker, defaulting `suggestedName`. `null` if cancelled. */
  showSavePicker(args: { suggestedName: string }): Promise<{ id: string; name: string } | null>;
  /** Read raw bytes from disk. Throws if the file can't be read. */
  readFile(id: string): Promise<Uint8Array>;
  /** Write raw bytes to disk. Throws if the write fails. */
  writeFile(id: string, bytes: Uint8Array): Promise<void>;
  /** Extract the basename portion (no directory) of an id/path. */
  basename(id: string): string;
}

export interface DialogBackend {
  confirm(args: { title: string; message: string; danger: boolean }): Promise<boolean>;
  alert(args: { title: string; message: string }): Promise<void>;
}

/**
 * Tiny key-value store backed by a JSON file in Electron `userData` in
 * production; replaced by an in-memory map in tests. The contract is
 * intentionally narrower than the renderer's `StorageService` (which adds
 * type parameters); JSON in, JSON out, no schema knowledge here.
 */
export interface StorageBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ExportBackend {
  exportPng(args: { bytes: Uint8Array; suggestedName: string }): Promise<ExportPngResult | null>;
}

// ── Validators ──────────────────────────────────────────────────────────────

const generic = (channel: string, field: string): TypeError =>
  new TypeError(`${channel}: payload.${field} is missing or has the wrong type`);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

export function validatePingPayload(value: unknown): PingPayload {
  if (!isObject(value)) throw generic('ping', '<payload>');
  const ts = value.ts;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) throw generic('ping', 'ts');
  return { ts };
}

export function validateFileSavePayload(value: unknown): FileSavePayload {
  if (!isObject(value)) throw generic('file.save', '<payload>');
  if (!isUint8Array(value.bytes)) throw generic('file.save', 'bytes');
  if (typeof value.suggestedName !== 'string') throw generic('file.save', 'suggestedName');
  if (value.id !== undefined && typeof value.id !== 'string') throw generic('file.save', 'id');
  return {
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    bytes: value.bytes,
    suggestedName: value.suggestedName,
  };
}

export function validateFileSaveAsPayload(value: unknown): FileSaveAsPayload {
  if (!isObject(value)) throw generic('file.saveAs', '<payload>');
  if (!isUint8Array(value.bytes)) throw generic('file.saveAs', 'bytes');
  if (typeof value.suggestedName !== 'string') throw generic('file.saveAs', 'suggestedName');
  return { bytes: value.bytes, suggestedName: value.suggestedName };
}

export function validateDialogConfirmPayload(value: unknown): DialogConfirmPayload {
  if (!isObject(value)) throw generic('dialog.confirm', '<payload>');
  if (typeof value.title !== 'string') throw generic('dialog.confirm', 'title');
  if (typeof value.message !== 'string') throw generic('dialog.confirm', 'message');
  if (value.danger !== undefined && typeof value.danger !== 'boolean')
    throw generic('dialog.confirm', 'danger');
  return {
    title: value.title,
    message: value.message,
    ...(typeof value.danger === 'boolean' ? { danger: value.danger } : {}),
  };
}

export function validateDialogAlertPayload(value: unknown): DialogAlertPayload {
  if (!isObject(value)) throw generic('dialog.alert', '<payload>');
  if (typeof value.title !== 'string') throw generic('dialog.alert', 'title');
  if (typeof value.message !== 'string') throw generic('dialog.alert', 'message');
  return { title: value.title, message: value.message };
}

export function validateStorageGetPayload(value: unknown): StorageGetPayload {
  if (!isObject(value)) throw generic('storage.get', '<payload>');
  if (typeof value.key !== 'string') throw generic('storage.get', 'key');
  return { key: value.key };
}

export function validateStorageSetPayload(value: unknown): StorageSetPayload {
  if (!isObject(value)) throw generic('storage.set', '<payload>');
  if (typeof value.key !== 'string') throw generic('storage.set', 'key');
  // `value.value` may be any structured-clonable shape including `null`.
  return { key: value.key, value: value.value };
}

export function validateStorageRemovePayload(value: unknown): StorageRemovePayload {
  if (!isObject(value)) throw generic('storage.remove', '<payload>');
  if (typeof value.key !== 'string') throw generic('storage.remove', 'key');
  return { key: value.key };
}

export function validateExportPngPayload(value: unknown): ExportPngPayload {
  if (!isObject(value)) throw generic('export.png', '<payload>');
  if (!isUint8Array(value.bytes)) throw generic('export.png', 'bytes');
  if (typeof value.suggestedName !== 'string') throw generic('export.png', 'suggestedName');
  return { bytes: value.bytes, suggestedName: value.suggestedName };
}

// ── Handlers ────────────────────────────────────────────────────────────────

/** Pure body of the `ping` handler — testable in isolation. */
export function handlePing(payload: unknown, deps: Pick<HandlerDeps, 'now'>): PingResult {
  validatePingPayload(payload);
  return { pong: true, receivedAt: deps.now() };
}

export async function handleFileOpen(deps: Pick<HandlerDeps, 'file'>): Promise<FileOpenResult | null> {
  const picked = await deps.file.showOpenPicker();
  if (picked === null) return null;
  const bytes = await deps.file.readFile(picked.id);
  return { id: picked.id, name: picked.name, bytes };
}

export async function handleFileSave(
  payload: unknown,
  deps: Pick<HandlerDeps, 'file'>,
): Promise<FileSaveResult | null> {
  const validated = validateFileSavePayload(payload);
  let id = validated.id;
  let name: string;
  if (id === undefined) {
    const picked = await deps.file.showSavePicker({ suggestedName: validated.suggestedName });
    if (picked === null) return null;
    id = picked.id;
    name = picked.name;
  } else {
    name = deps.file.basename(id);
  }
  await deps.file.writeFile(id, validated.bytes);
  void name;
  return { id };
}

export async function handleFileSaveAs(
  payload: unknown,
  deps: Pick<HandlerDeps, 'file'>,
): Promise<FileSaveResult | null> {
  const validated = validateFileSaveAsPayload(payload);
  const picked = await deps.file.showSavePicker({ suggestedName: validated.suggestedName });
  if (picked === null) return null;
  await deps.file.writeFile(picked.id, validated.bytes);
  return { id: picked.id };
}

export async function handleDialogConfirm(
  payload: unknown,
  deps: Pick<HandlerDeps, 'dialog'>,
): Promise<boolean> {
  const validated = validateDialogConfirmPayload(payload);
  return deps.dialog.confirm({
    title: validated.title,
    message: validated.message,
    danger: validated.danger === true,
  });
}

export async function handleDialogAlert(
  payload: unknown,
  deps: Pick<HandlerDeps, 'dialog'>,
): Promise<void> {
  const validated = validateDialogAlertPayload(payload);
  await deps.dialog.alert(validated);
}

export async function handleStorageGet(
  payload: unknown,
  deps: Pick<HandlerDeps, 'storage'>,
): Promise<unknown> {
  const validated = validateStorageGetPayload(payload);
  return deps.storage.get(validated.key);
}

export async function handleStorageSet(
  payload: unknown,
  deps: Pick<HandlerDeps, 'storage'>,
): Promise<void> {
  const validated = validateStorageSetPayload(payload);
  await deps.storage.set(validated.key, validated.value);
}

export async function handleStorageRemove(
  payload: unknown,
  deps: Pick<HandlerDeps, 'storage'>,
): Promise<void> {
  const validated = validateStorageRemovePayload(payload);
  await deps.storage.remove(validated.key);
}

export async function handleExportPng(
  payload: unknown,
  deps: Pick<HandlerDeps, 'export'>,
): Promise<ExportPngResult | null> {
  const validated = validateExportPngPayload(payload);
  return deps.export.exportPng(validated);
}

// ── Default deps ────────────────────────────────────────────────────────────

/**
 * Fallback deps used by tests that don't care about a specific backend. Each
 * method throws a recognizable error so a misconfigured test fails loudly.
 */
const notWired = (label: string): never => {
  throw new Error(`HandlerDeps.${label} not wired in this test`);
};

const defaultDeps: HandlerDeps = {
  now: () => Date.now(),
  file: {
    showOpenPicker: () => Promise.resolve(notWired('file.showOpenPicker') as never),
    showSavePicker: () => Promise.resolve(notWired('file.showSavePicker') as never),
    readFile: () => Promise.resolve(notWired('file.readFile') as never),
    writeFile: () => Promise.resolve(notWired('file.writeFile') as never),
    basename: () => notWired('file.basename') as never,
  },
  dialog: {
    confirm: () => Promise.resolve(notWired('dialog.confirm') as never),
    alert: () => Promise.resolve(notWired('dialog.alert') as never),
  },
  storage: {
    get: () => Promise.resolve(notWired('storage.get') as never),
    set: () => Promise.resolve(notWired('storage.set') as never),
    remove: () => Promise.resolve(notWired('storage.remove') as never),
  },
  export: {
    exportPng: () => Promise.resolve(notWired('export.exportPng') as never),
  },
};

// ── Registrar ───────────────────────────────────────────────────────────────

/**
 * Wire every channel in `IpcContract` to `ipcMain.handle`. Returns a record
 * of the bound handlers so a test can call them without an actual `ipcMain`.
 *
 * Each registration:
 *   1. Validates the inbound payload via the helpers above.
 *   2. Returns the structured-clonable result.
 *   3. Lets a thrown error propagate — `ipcRenderer.invoke` will reject the
 *      renderer-side promise. Errors must NOT include sensitive payload values.
 */
export function registerIpcHandlers(
  host: HandlerHost,
  deps: HandlerDeps = defaultDeps,
): { [K in keyof IpcContract]: (payload: unknown) => ReturnType<IpcContract[K]> } {
  const handlers = {
    ping: (payload: unknown) => Promise.resolve(handlePing(payload, deps)),
    'file.open': () => handleFileOpen(deps),
    'file.save': (payload: unknown) => handleFileSave(payload, deps),
    'file.saveAs': (payload: unknown) => handleFileSaveAs(payload, deps),
    'dialog.confirm': (payload: unknown) => handleDialogConfirm(payload, deps),
    'dialog.alert': (payload: unknown) => handleDialogAlert(payload, deps),
    'storage.get': (payload: unknown) => handleStorageGet(payload, deps),
    'storage.set': (payload: unknown) => handleStorageSet(payload, deps),
    'storage.remove': (payload: unknown) => handleStorageRemove(payload, deps),
    'export.png': (payload: unknown) => handleExportPng(payload, deps),
  } as const;

  host.handle('ping', (_event, payload) => handlers.ping(payload));
  host.handle('file.open', () => handlers['file.open']());
  host.handle('file.save', (_event, payload) => handlers['file.save'](payload));
  host.handle('file.saveAs', (_event, payload) => handlers['file.saveAs'](payload));
  host.handle('dialog.confirm', (_event, payload) => handlers['dialog.confirm'](payload));
  host.handle('dialog.alert', (_event, payload) => handlers['dialog.alert'](payload));
  host.handle('storage.get', (_event, payload) => handlers['storage.get'](payload));
  host.handle('storage.set', (_event, payload) => handlers['storage.set'](payload));
  host.handle('storage.remove', (_event, payload) => handlers['storage.remove'](payload));
  host.handle('export.png', (_event, payload) => handlers['export.png'](payload));

  // The exported handlers map is typed against `IpcContract`'s return types;
  // the implementation above conforms by construction.
  return handlers as unknown as {
    [K in keyof IpcContract]: (payload: unknown) => ReturnType<IpcContract[K]>;
  };
}
