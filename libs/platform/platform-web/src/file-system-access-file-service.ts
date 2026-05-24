// File System Access API binding for `FileService`. F1.4.
//
// Browser support today (May 2026): Chromium-based browsers ship the full
// surface; Safari + Firefox do not. Capability detection happens at
// `createWebPlatform()` time — see `index.ts`, which falls back to the
// `<input type=file>` + download-link implementation when these APIs are
// absent. This class assumes the APIs are present.
//
// FileSystemFileHandles are kept in an in-memory map keyed by a synthetic id
// so the `FileService` contract (open returns an id; save can be re-targeted
// at that id) survives the fact that handles are not directly serializable.
//
// Bytes returned to callers are defensively copied — even though FSA reads
// give us a fresh ArrayBuffer per call, the contract requires immutability.

import type {
  FileService,
  OpenDocumentResult,
  SaveDocumentResult,
} from '@aquascape/platform/platform-api';

/**
 * Minimal subset of the File System Access API we actually use. Declared
 * locally so the lib doesn't need `lib.dom.fileSystemAccess.d.ts` (which
 * ships under a non-default `lib` key in some TS configurations).
 */
interface FsFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritable>;
  readonly name: string;
}

interface FsWritable {
  write(data: BufferSource): Promise<void>;
  close(): Promise<void>;
}

interface FsPicker {
  showOpenFilePicker?: (options?: {
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
    multiple?: boolean;
  }) => Promise<FsFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FsFileHandle>;
}

/** Standard `.aqua` accept filter for both pickers. */
const AQUA_TYPES = [
  { description: 'Aquascape Document', accept: { 'application/aqua': ['.aqua'] } },
];

/**
 * True if the host browser exposes the File System Access pickers we need.
 * Exported so the platform factory can capability-detect at boot.
 */
export function isFileSystemAccessAvailable(globalRef: typeof globalThis = globalThis): boolean {
  const w = (globalRef as { window?: FsPicker }).window;
  return (
    typeof w !== 'undefined' &&
    typeof w.showOpenFilePicker === 'function' &&
    typeof w.showSaveFilePicker === 'function'
  );
}

let nextHandleId = 0;
function mintHandleId(): string {
  nextHandleId += 1;
  return `fsa-${nextHandleId}`;
}

/**
 * FSA-backed FileService. Holds picker results in an internal map so that a
 * subsequent `saveDocument({ id })` can re-target the original handle
 * without re-prompting (the FSA "save to known handle" affordance).
 *
 * The picker call is `await`ed inline — `showOpenFilePicker` rejects with
 * `AbortError` when the user cancels, which the contract translates to `null`.
 */
export class FileSystemAccessFileService implements FileService {
  private readonly handles = new Map<string, FsFileHandle>();
  private readonly globalRef: typeof globalThis;

  constructor(globalRef: typeof globalThis = globalThis) {
    this.globalRef = globalRef;
  }

  async openDocument(): Promise<OpenDocumentResult | null> {
    const picker = this.picker();
    let handles: FsFileHandle[];
    try {
      handles = await picker.showOpenFilePicker!({ types: AQUA_TYPES, multiple: false });
    } catch (err) {
      if (isAbortError(err)) return null;
      throw err;
    }
    const handle = handles[0];
    if (handle === undefined) return null;

    const file = await handle.getFile();
    const buf = await file.arrayBuffer();
    const id = mintHandleId();
    this.handles.set(id, handle);
    return { id, bytes: new Uint8Array(buf), name: handle.name };
  }

  async saveDocument(args: {
    id?: string;
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<SaveDocumentResult | null> {
    // If we still have the handle the user originally opened, write to it
    // without prompting — that's the killer feature of FSA over plain
    // <input type=file>: silent overwrite of a user-chosen path.
    if (args.id !== undefined) {
      const known = this.handles.get(args.id);
      if (known !== undefined) {
        await writeAll(known, args.bytes);
        return { id: args.id };
      }
    }
    return this.saveDocumentAs(args);
  }

  async saveDocumentAs(args: {
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<SaveDocumentResult | null> {
    const picker = this.picker();
    let handle: FsFileHandle;
    try {
      handle = await picker.showSaveFilePicker!({
        suggestedName: args.suggestedName,
        types: AQUA_TYPES,
      });
    } catch (err) {
      if (isAbortError(err)) return null;
      throw err;
    }
    await writeAll(handle, args.bytes);
    const id = mintHandleId();
    this.handles.set(id, handle);
    return { id };
  }

  private picker(): FsPicker {
    const w = (this.globalRef as { window?: FsPicker }).window;
    if (w === undefined) {
      throw new Error('FileSystemAccessFileService used in a non-window environment');
    }
    return w;
  }
}

async function writeAll(handle: FsFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes);
  } finally {
    await writable.close();
  }
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}
