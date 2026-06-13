// Saved-demo persistence.
//
// Lets the demo console snapshot the current scene under a name, list/load/
// delete those snapshots, and have them survive restarts. Backed by the
// platform `StorageService` (IndexedDB on web, on-disk JSON via IPC on
// Electron), so saved demos are usable across launches + platforms.
//
// All demos live under a single key as a `Record<name, SavedSimulation>` — one read
// gives the whole library (cheap to list), one write commits a change.

import { Injectable, inject } from '@angular/core';

import type { Scene } from '@aquascape/domain/scene-model';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

export interface SavedSimulation {
  readonly name: string;
  /** The full scene snapshot (plain serializable data). */
  readonly scene: Scene;
  /** Epoch millis the snapshot was saved (display metadata only). */
  readonly savedAt: number;
}

/** StorageService key holding the whole saved-demo library. */
export const SIMULATION_STORE_KEY = 'aquascape.simulations';

@Injectable({ providedIn: 'root' })
export class SimulationStoreService {
  private readonly storage: StorageService = inject(STORAGE_SERVICE);

  /** All saved demos, sorted by name. */
  async list(): Promise<SavedSimulation[]> {
    const map = await this.readMap();
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Save (or overwrite) a demo under `name`. */
  async save(name: string, scene: Scene, savedAt: number): Promise<void> {
    const map = await this.readMap();
    map[name] = { name, scene, savedAt };
    await this.storage.set(SIMULATION_STORE_KEY, map);
  }

  /** Load a saved scene by name, or null if there's none. */
  async load(name: string): Promise<Scene | null> {
    const map = await this.readMap();
    return map[name]?.scene ?? null;
  }

  /** Delete a saved demo. Returns whether one existed. */
  async remove(name: string): Promise<boolean> {
    const map = await this.readMap();
    if (!(name in map)) return false;
    delete map[name];
    await this.storage.set(SIMULATION_STORE_KEY, map);
    return true;
  }

  private async readMap(): Promise<Record<string, SavedSimulation>> {
    try {
      const map = await this.storage.get<Record<string, SavedSimulation>>(SIMULATION_STORE_KEY);
      return map ?? {};
    } catch {
      return {};
    }
  }
}
