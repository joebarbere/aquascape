// Stage 0 stub. In-memory key-value store. F1.5 replaces this with an
// IndexedDB-backed implementation.
//
// Values are deep-cloned on set/get via `structuredClone` (Node ≥ 17 ships it
// globally) so callers cannot retain references into the store. This mirrors
// the eventual IndexedDB behaviour, where the store always returns fresh
// objects.

import type { StorageService } from '@aquascape/platform/platform-api';

export class InMemoryStorageService implements StorageService {
  private readonly store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return structuredClone(value) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, structuredClone(value));
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}
