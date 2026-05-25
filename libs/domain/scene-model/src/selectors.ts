/**
 * Pure selectors over `Scene`. No mutation, no allocations beyond the
 * occasional small wrapper object for the iterator yield.
 *
 * Editor logic should reach for these directly; NgRx selectors in
 * `libs/state/` wrap them, they don't reimplement them.
 */

import type { Layer, LayerId, LivestockEntry, ObjectId, Scene, SceneObject, Uuid } from './types';

/** Find an object by id. O(layers * objects). Returns `null` if missing. */
export function getObjectById(scene: Scene, id: ObjectId): SceneObject | null {
  for (const layer of scene.layers) {
    for (const obj of layer.objects) {
      if (obj.id === id) {
        return obj;
      }
    }
  }
  return null;
}

/**
 * Find an object and the layer that owns it. Useful for commands that need
 * the layer context (e.g. to check `locked` before mutating).
 */
export function getObjectWithLayer(
  scene: Scene,
  id: ObjectId,
): { layer: Layer; object: SceneObject } | null {
  for (const layer of scene.layers) {
    for (const obj of layer.objects) {
      if (obj.id === id) {
        return { layer, object: obj };
      }
    }
  }
  return null;
}

/** Find a layer by id. Returns `null` if missing. */
export function getLayerById(scene: Scene, id: LayerId): Layer | null {
  for (const layer of scene.layers) {
    if (layer.id === id) {
      return layer;
    }
  }
  return null;
}

/**
 * Resolve the active layer from its id. Convenience over {@link getLayerById}
 * — explicit `activeLayerId === null` returns `null`, matching the editor's
 * "no active layer" state.
 */
export function getActiveLayer(scene: Scene, activeLayerId: LayerId | null): Layer | null {
  if (activeLayerId === null) {
    return null;
  }
  return getLayerById(scene, activeLayerId);
}

/**
 * Iterate every object in render order: layer index ascending, then object
 * index ascending. `layer.visible` and `layer.opacity` are NOT applied — the
 * renderer decides what to skip; this selector is for editor logic.
 */
export function* iterateObjects(
  scene: Scene,
): IterableIterator<{ layer: Layer; object: SceneObject }> {
  for (const layer of scene.layers) {
    for (const object of layer.objects) {
      yield { layer, object };
    }
  }
}

/**
 * Return the scene's livestock entries (Stage 7 F7.1). Returns an empty
 * array when `scene.livestock` is undefined so callers don't need to guard.
 * The returned array is the same reference held by the scene when present
 * — do not mutate it.
 */
export function selectLivestock(scene: Scene): LivestockEntry[] {
  return scene.livestock ?? [];
}

/** Find a livestock entry by id. O(n). Returns `null` if missing. */
export function selectLivestockById(scene: Scene, id: Uuid): LivestockEntry | null {
  const list = scene.livestock;
  if (list === undefined) return null;
  for (const entry of list) {
    if (entry.id === id) return entry;
  }
  return null;
}
