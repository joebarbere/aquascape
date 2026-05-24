// Transport seam for the Electron platform lib.
//
// In Stage 0 every method is serviced by in-memory fakes that run entirely in
// the renderer process. F1.4 replaces `inMemoryTransport` with one whose
// methods forward to `window.aquascape.ipc.*` channels exposed by the typed
// preload bridge (scaffolded in F0.6, real channels added per feature).
//
// Keeping the transport behind an interface means the service classes above
// (`ElectronFileService`, etc.) don't change between Stage 0 and F1.4 — only
// the wiring at `createElectronPlatform()` does.

import type {
  ExportPngResult,
  OpenDocumentResult,
  SaveDocumentResult,
} from '@aquascape/platform/platform-api';

export interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly danger?: boolean;
}

export interface AlertRequest {
  readonly title: string;
  readonly message: string;
}

export interface SaveDocumentRequest {
  readonly id?: string;
  readonly bytes: Uint8Array;
  readonly suggestedName: string;
}

export interface SaveDocumentAsRequest {
  readonly bytes: Uint8Array;
  readonly suggestedName: string;
}

export interface ExportPngRequest {
  readonly bytes: Uint8Array;
  readonly suggestedName: string;
}

export interface StorageGetRequest {
  readonly key: string;
}

export interface StorageSetRequest {
  readonly key: string;
  readonly value: unknown;
}

export interface StorageRemoveRequest {
  readonly key: string;
}

/**
 * The IPC-replaceable surface. Implementations must not throw for "absent
 * capability" or "user cancelled" — they return `null` for the void cases.
 */
export interface ElectronTransport {
  openDocument(): Promise<OpenDocumentResult | null>;
  saveDocument(req: SaveDocumentRequest): Promise<SaveDocumentResult | null>;
  saveDocumentAs(req: SaveDocumentAsRequest): Promise<SaveDocumentResult | null>;

  confirm(req: ConfirmRequest): Promise<boolean>;
  alert(req: AlertRequest): Promise<void>;

  storageGet(req: StorageGetRequest): Promise<unknown>;
  storageSet(req: StorageSetRequest): Promise<void>;
  storageRemove(req: StorageRemoveRequest): Promise<void>;

  exportPng(req: ExportPngRequest): Promise<ExportPngResult | null>;
}

// ─── In-memory transport (Stage 0) ──────────────────────────────────────────

interface StoredDocument {
  readonly bytes: Uint8Array;
  readonly name: string;
}

function copyBytes(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.byteLength);
  out.set(input);
  return out;
}

/**
 * Build a fresh in-memory transport. Each call returns an isolated set of
 * stores so tests cannot leak state into one another.
 */
export function createInMemoryTransport(): ElectronTransport {
  const docs = new Map<string, StoredDocument>();
  const kv = new Map<string, unknown>();
  const exportSink = new Map<string, StoredDocument>();
  let lastSavedId: string | null = null;
  let nextId = 0;

  function mintId(): string {
    nextId += 1;
    return `mem-elec-doc-${nextId}`;
  }

  return {
    async openDocument() {
      if (lastSavedId === null) return null;
      // Closure invariant: `lastSavedId` is only ever assigned alongside a
      // `docs.set(id, ...)`, and nothing else removes from `docs`. The
      // `Map.get` therefore cannot return `undefined` here.
      const entry = docs.get(lastSavedId) as StoredDocument;
      return {
        id: lastSavedId,
        bytes: copyBytes(entry.bytes),
        name: entry.name,
      };
    },
    async saveDocument(req) {
      const id = req.id !== undefined && docs.has(req.id) ? req.id : mintId();
      docs.set(id, {
        bytes: copyBytes(req.bytes),
        name: req.suggestedName,
      });
      lastSavedId = id;
      return { id };
    },
    async saveDocumentAs(req) {
      const id = mintId();
      docs.set(id, {
        bytes: copyBytes(req.bytes),
        name: req.suggestedName,
      });
      lastSavedId = id;
      return { id };
    },
    async confirm() {
      return true;
    },
    async alert() {
      return;
    },
    async storageGet(req) {
      if (!kv.has(req.key)) return null;
      return structuredClone(kv.get(req.key));
    },
    async storageSet(req) {
      kv.set(req.key, structuredClone(req.value));
    },
    async storageRemove(req) {
      kv.delete(req.key);
    },
    async exportPng(req) {
      exportSink.set(req.suggestedName, {
        bytes: copyBytes(req.bytes),
        name: req.suggestedName,
      });
      return { path: `memory://exports/${req.suggestedName}` };
    },
  };
}
