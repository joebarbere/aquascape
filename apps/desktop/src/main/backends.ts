// Production backends for the F1.4 IPC handlers. Kept in a sibling module
// so `main.ts` stays a small composition root and so the (heavy) deps on
// `electron`, `node:fs`, and `node:path` live behind a single import.
//
// All file IO is async; all dialogs go through Electron's native modules so
// the user sees system-styled prompts. The storage backend is a tiny JSON
// file in `app.getPath('userData')` — sufficient for F1.5 recent-files +
// autosave-draft persistence. A future stage can swap it for a real
// lightweight KV store (sqlite, leveldown) without changing the contract.

import { dialog, app } from 'electron';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';

import type { BrowserWindow } from 'electron';

import type {
  DialogBackend,
  ExportBackend,
  FileBackend,
  StorageBackend,
} from './ipc-handlers';

const AQUA_FILE_FILTERS = [
  { name: 'Aquascape Document', extensions: ['aqua'] },
  { name: 'All Files', extensions: ['*'] },
];

const PNG_FILE_FILTERS = [
  { name: 'PNG Image', extensions: ['png'] },
  { name: 'All Files', extensions: ['*'] },
];

/**
 * Wire the FileBackend over Electron's native dialogs + `fs.promises`. The
 * `getWindow()` indirection lets `main.ts` build the backend before the
 * BrowserWindow exists — pickers are anchored to the active window so they
 * present as sheets on macOS.
 */
export function createFileBackend(getWindow: () => BrowserWindow | null): FileBackend {
  return {
    async showOpenPicker() {
      const result = await dialog.showOpenDialog(getWindowOrThrow(getWindow), {
        title: 'Open Aquascape document',
        filters: AQUA_FILE_FILTERS,
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const id = result.filePaths[0]!;
      return { id, name: path.basename(id) };
    },

    async showSavePicker({ suggestedName }) {
      const result = await dialog.showSaveDialog(getWindowOrThrow(getWindow), {
        title: 'Save Aquascape document',
        defaultPath: suggestedName,
        filters: AQUA_FILE_FILTERS,
      });
      if (result.canceled || result.filePath === undefined || result.filePath.length === 0) {
        return null;
      }
      return { id: result.filePath, name: path.basename(result.filePath) };
    },

    async readFile(id) {
      const buf = await fs.readFile(id);
      // Slice into a fresh Uint8Array so the structured-clone hop is purely
      // typed-array bytes (no Node Buffer subclass leakage into the renderer).
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },

    async writeFile(id, bytes) {
      await fs.writeFile(id, bytes);
    },

    basename(id) {
      return path.basename(id);
    },
  };
}

export function createDialogBackend(getWindow: () => BrowserWindow | null): DialogBackend {
  return {
    async confirm({ title, message, danger }) {
      const result = await dialog.showMessageBox(getWindowOrThrow(getWindow), {
        type: danger ? 'warning' : 'question',
        buttons: ['OK', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title,
        message,
        noLink: true,
      });
      return result.response === 0;
    },
    async alert({ title, message }) {
      await dialog.showMessageBox(getWindowOrThrow(getWindow), {
        type: 'info',
        buttons: ['OK'],
        defaultId: 0,
        title,
        message,
        noLink: true,
      });
    },
  };
}

/**
 * JSON-file KV storage in `app.getPath('userData')`. The whole map is read on
 * every `get` and written on every `set`/`remove` — fine at autosave scale
 * (the file is small) and trivially crash-safe by virtue of being all-or-
 * nothing. F1.5's debounce keeps write frequency manageable.
 *
 * The file is created lazily on the first write; reads against a missing
 * file return `null`, which matches the `StorageService` contract.
 */
export function createStorageBackend(
  getStoragePath: () => string = () => path.join(app.getPath('userData'), 'aquascape-storage.json'),
): StorageBackend {
  async function readAll(): Promise<Record<string, unknown>> {
    try {
      const buf = await fs.readFile(getStoragePath(), 'utf8');
      const parsed = JSON.parse(buf) as unknown;
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch (err) {
      if (isEnoent(err)) return {};
      throw err;
    }
  }

  async function writeAll(map: Record<string, unknown>): Promise<void> {
    const file = getStoragePath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(map), 'utf8');
  }

  return {
    async get(key: string) {
      const map = await readAll();
      return key in map ? map[key] : null;
    },
    async set(key: string, value: unknown) {
      const map = await readAll();
      map[key] = value;
      await writeAll(map);
    },
    async remove(key: string) {
      const map = await readAll();
      if (key in map) {
        delete map[key];
        await writeAll(map);
      }
    },
  };
}

/**
 * Stage 0 placeholder PNG exporter — writes the supplied bytes to a file the
 * user picks. F6.1 will rewire this once the renderer can produce real PNG
 * bytes; the contract stays the same.
 */
export function createExportBackend(
  getWindow: () => BrowserWindow | null,
): ExportBackend {
  return {
    async exportPng({ bytes, suggestedName }) {
      const result = await dialog.showSaveDialog(getWindowOrThrow(getWindow), {
        title: 'Export PNG',
        defaultPath: suggestedName,
        filters: PNG_FILE_FILTERS,
      });
      if (result.canceled || result.filePath === undefined || result.filePath.length === 0) {
        return null;
      }
      await fs.writeFile(result.filePath, bytes);
      return { path: result.filePath };
    },
  };
}

function getWindowOrThrow(getWindow: () => BrowserWindow | null): BrowserWindow {
  const w = getWindow();
  if (w === null) {
    throw new Error('No active BrowserWindow — cannot show native dialog');
  }
  return w;
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'ENOENT'
  );
}
