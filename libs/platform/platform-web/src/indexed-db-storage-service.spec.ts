/**
 * @jest-environment jsdom
 */

import {
  IndexedDbStorageService,
  isIndexedDbAvailable,
} from './indexed-db-storage-service';

// ── Minimal in-memory IndexedDB shim ────────────────────────────────────────
//
// The store is shared across the test file (matching a real IDB database's
// behavior). `beforeEach` resets it so tests don't bleed.

interface ReqLike<T> {
  result: T;
  error: DOMException | null;
  onsuccess: ((this: ReqLike<T>, ev: Event) => unknown) | null;
  onerror: ((this: ReqLike<T>, ev: Event) => unknown) | null;
  onupgradeneeded?: ((this: ReqLike<T>, ev: Event) => unknown) | null;
}

let store = new Map<string, unknown>();
let openCount = 0;

beforeEach(() => {
  store = new Map();
  openCount = 0;
  (window as { indexedDB?: unknown }).indexedDB = {
    open(_name: string, _version: number) {
      openCount += 1;
      const req: ReqLike<unknown> = {
        result: {
          objectStoreNames: { contains: () => true } as DOMStringList,
          createObjectStore: () => null,
          transaction: (_storeName: string, _mode: string) => ({
            objectStore: () => ({
              get: (k: string) => {
                const r: ReqLike<unknown> = {
                  result: store.get(k),
                  error: null,
                  onsuccess: null,
                  onerror: null,
                };
                queueMicrotask(() => r.onsuccess?.call(r, new Event('s')));
                return r;
              },
              put: (v: unknown, k: string) => {
                store.set(k, v);
                const r: ReqLike<unknown> = {
                  result: undefined,
                  error: null,
                  onsuccess: null,
                  onerror: null,
                };
                queueMicrotask(() => r.onsuccess?.call(r, new Event('s')));
                return r;
              },
              delete: (k: string) => {
                store.delete(k);
                const r: ReqLike<unknown> = {
                  result: undefined,
                  error: null,
                  onsuccess: null,
                  onerror: null,
                };
                queueMicrotask(() => r.onsuccess?.call(r, new Event('s')));
                return r;
              },
            }),
            oncomplete: null,
            onerror: null,
            onabort: null,
          }),
        },
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        req.onupgradeneeded?.call(req, new Event('u'));
        req.onsuccess?.call(req, new Event('s'));
      });
      return req;
    },
  };
});

afterEach(() => {
  delete (window as { indexedDB?: unknown }).indexedDB;
});

describe('isIndexedDbAvailable', () => {
  it('returns true when indexedDB is on window', () => {
    expect(isIndexedDbAvailable()).toBe(true);
  });

  it('returns false otherwise', () => {
    delete (window as { indexedDB?: unknown }).indexedDB;
    expect(isIndexedDbAvailable()).toBe(false);
  });
});

describe('IndexedDbStorageService', () => {
  it('throws on construction when indexedDB is absent', () => {
    delete (window as { indexedDB?: unknown }).indexedDB;
    expect(() => new IndexedDbStorageService()).toThrow(/not available/);
  });

  it('round-trips a value through set + get + remove', async () => {
    const svc = new IndexedDbStorageService();
    await svc.set('k', { v: 1 });
    expect(await svc.get<{ v: number }>('k')).toEqual({ v: 1 });
    await svc.remove('k');
    expect(await svc.get<{ v: number }>('k')).toBeNull();
  });

  it('get returns null for missing keys', async () => {
    const svc = new IndexedDbStorageService();
    expect(await svc.get('missing')).toBeNull();
  });

  it('opens the database once and reuses it across operations', async () => {
    const svc = new IndexedDbStorageService();
    await svc.set('a', 1);
    await svc.set('b', 2);
    expect(openCount).toBe(1);
  });

  it('rejects when the open request fires onerror', async () => {
    (window as { indexedDB?: unknown }).indexedDB = {
      open() {
        const req: ReqLike<unknown> = {
          result: null,
          error: new DOMException('blocked'),
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => req.onerror?.call(req, new Event('e')));
        return req;
      },
    };
    const svc = new IndexedDbStorageService();
    await expect(svc.get('x')).rejects.toThrow('blocked');
  });
});
