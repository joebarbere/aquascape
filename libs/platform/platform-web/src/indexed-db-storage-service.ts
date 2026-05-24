// IndexedDB-backed `StorageService`. F1.4 / F1.5.
//
// Schema is one database ("aquascape"), one object store ("kv"), keyed by
// string. Values are arbitrary structured-clonable shapes (the document
// store autosave persists an AquaDocument here, so it really is "arbitrary").
//
// The wrapper is deliberately thin — there's no migration concern beyond
// "store version 1 forever", because the upgrade path for the data shape
// itself is captured by the `.aqua` schema's `Migration` chain. IndexedDB's
// own schema version is just "does the `kv` store exist?".
//
// Caveats:
//   * `structuredClone` is implicit inside IDB on both put and get; callers
//     receive fresh copies. No defensive copy here.
//   * IDB is async-only and event-based; we wrap every request in a Promise.
//   * If IDB is unavailable (private-mode Firefox, some embedded browsers),
//     construction throws — `createWebPlatform()` falls back to the in-memory
//     storage in that case.

import type { StorageService } from '@aquascape/platform/platform-api';

const DB_NAME = 'aquascape';
const STORE_NAME = 'kv';
const DB_VERSION = 1;

interface IdbFactory {
  open(name: string, version: number): IdbOpenRequest;
}

interface IdbOpenRequest {
  result: IdbDatabase;
  error: DOMException | null;
  onsuccess: ((this: IdbOpenRequest, ev: Event) => unknown) | null;
  onerror: ((this: IdbOpenRequest, ev: Event) => unknown) | null;
  onupgradeneeded: ((this: IdbOpenRequest, ev: Event) => unknown) | null;
}

interface IdbDatabase {
  objectStoreNames: DOMStringList;
  createObjectStore(name: string): unknown;
  transaction(name: string, mode: 'readonly' | 'readwrite'): IdbTransaction;
}

interface IdbTransaction {
  objectStore(name: string): IdbObjectStore;
  oncomplete: ((this: IdbTransaction, ev: Event) => unknown) | null;
  onerror: ((this: IdbTransaction, ev: Event) => unknown) | null;
  onabort: ((this: IdbTransaction, ev: Event) => unknown) | null;
}

interface IdbObjectStore {
  get(key: string): IdbRequest<unknown>;
  put(value: unknown, key: string): IdbRequest<unknown>;
  delete(key: string): IdbRequest<unknown>;
}

interface IdbRequest<T> {
  result: T;
  error: DOMException | null;
  onsuccess: ((this: IdbRequest<T>, ev: Event) => unknown) | null;
  onerror: ((this: IdbRequest<T>, ev: Event) => unknown) | null;
}

/**
 * True if the host exposes `indexedDB`. Used at platform-factory time so we
 * can fall through to the in-memory stub in restricted environments.
 */
export function isIndexedDbAvailable(globalRef: typeof globalThis = globalThis): boolean {
  const w = (globalRef as { window?: { indexedDB?: IdbFactory } }).window;
  return typeof w?.indexedDB !== 'undefined' && w.indexedDB !== null;
}

export class IndexedDbStorageService implements StorageService {
  private readonly dbPromise: Promise<IdbDatabase>;

  constructor(globalRef: typeof globalThis = globalThis) {
    const factory = (globalRef as { window?: { indexedDB?: IdbFactory } }).window?.indexedDB;
    if (factory === undefined) {
      throw new Error('IndexedDbStorageService: indexedDB is not available');
    }
    this.dbPromise = openDb(factory);
  }

  async get<T>(key: string): Promise<T | null> {
    const db = await this.dbPromise;
    const result = await runRequest<unknown>((store) => store.get(key), db, 'readonly');
    if (result === undefined || result === null) return null;
    return result as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const db = await this.dbPromise;
    await runRequest<unknown>((store) => store.put(value, key), db, 'readwrite');
  }

  async remove(key: string): Promise<void> {
    const db = await this.dbPromise;
    await runRequest<unknown>((store) => store.delete(key), db, 'readwrite');
  }
}

function openDb(factory: IdbFactory): Promise<IdbDatabase> {
  return new Promise<IdbDatabase>((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (): void => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function runRequest<T>(
  build: (store: IdbObjectStore) => IdbRequest<T>,
  db: IdbDatabase,
  mode: 'readonly' | 'readwrite',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = build(store);
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error ?? new Error('IndexedDB request failed'));
    tx.onabort = (): void => reject(new Error('IndexedDB transaction aborted'));
  });
}
