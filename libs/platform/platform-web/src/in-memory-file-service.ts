// Stage 0 stub. In-memory FileService used by the web app until the File
// System Access API integration lands in F1.4 / F1.5.
//
// Behaviour:
//   * `saveDocument` and `saveDocumentAs` store bytes in an internal Map keyed
//     by an id. `saveDocument` reuses the supplied id (if known) or mints a
//     fresh one; `saveDocumentAs` always mints a fresh id.
//   * `openDocument` returns the most recently saved document. This is a
//     deliberate refinement over "always null" so features can drive a
//     round-trip end-to-end without a real file picker. Real implementations
//     will prompt the user and may resolve to `null` on cancel.
//   * Bytes are defensively copied on the way in and on the way out so callers
//     can't mutate stored state and stored state can't bleed back into them.

import type {
  FileService,
  OpenDocumentResult,
  SaveDocumentResult,
} from '@aquascape/platform/platform-api';

interface StoredDocument {
  readonly bytes: Uint8Array;
  readonly name: string;
}

let nextId = 0;
function mintId(): string {
  // Sequential ids keep tests deterministic. Real implementations should use
  // a stronger identifier (UUID, opaque platform handle).
  nextId += 1;
  return `mem-doc-${nextId}`;
}

function copyBytes(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.byteLength);
  out.set(input);
  return out;
}

export class InMemoryFileService implements FileService {
  private readonly store = new Map<string, StoredDocument>();
  private lastSavedId: string | null = null;

  async openDocument(): Promise<OpenDocumentResult | null> {
    if (this.lastSavedId === null) return null;
    // Class invariant: `lastSavedId` is only ever assigned alongside a
    // `store.set(id, ...)`, and nothing else removes from the store. The
    // `Map.get` therefore cannot return `undefined` here.
    const entry = this.store.get(this.lastSavedId) as {
      bytes: Uint8Array;
      name: string;
    };
    return {
      id: this.lastSavedId,
      bytes: copyBytes(entry.bytes),
      name: entry.name,
    };
  }

  async saveDocument(args: {
    id?: string;
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<SaveDocumentResult | null> {
    const id = args.id !== undefined && this.store.has(args.id) ? args.id : mintId();
    this.store.set(id, {
      bytes: copyBytes(args.bytes),
      name: args.suggestedName,
    });
    this.lastSavedId = id;
    return { id };
  }

  async saveDocumentAs(args: {
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<SaveDocumentResult | null> {
    const id = mintId();
    this.store.set(id, {
      bytes: copyBytes(args.bytes),
      name: args.suggestedName,
    });
    this.lastSavedId = id;
    return { id };
  }
}
