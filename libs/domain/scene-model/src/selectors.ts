/**
 * Pure selectors over `Scene`. No mutation, no allocations beyond the
 * occasional small wrapper object for the iterator yield.
 *
 * Editor logic should reach for these directly; NgRx selectors in
 * `libs/state/` wrap them, they don't reimplement them.
 */

import type {
  DoseEvent,
  EquipmentEntry,
  Layer,
  LayerId,
  LivestockEntry,
  ObjectId,
  Scene,
  SceneObject,
  Tank,
  Uuid,
} from './types';

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

/**
 * Return the scene's equipment entries (Stage 7 F7.3). Returns an empty
 * array when `scene.equipment` is undefined so callers don't need to guard.
 * The returned array is the same reference held by the scene when present
 * — do not mutate it.
 */
export function selectEquipment(scene: Scene): EquipmentEntry[] {
  return scene.equipment ?? [];
}

/** Find an equipment entry by id. O(n). Returns `null` if missing. */
export function selectEquipmentById(scene: Scene, id: Uuid): EquipmentEntry | null {
  const list = scene.equipment;
  if (list === undefined) return null;
  for (const entry of list) {
    if (entry.id === id) return entry;
  }
  return null;
}

// ─── Dosing (Nutrients & additives + dosing, F-B) ─────────────────────────

/**
 * Return the scene's dose-event log (runtime-only; chemistry deferred to
 * Stage 13). Returns an empty array when `scene.doseLog` is undefined so
 * callers don't need to guard. The returned array is the same reference held
 * by the scene when present — do not mutate it.
 */
export function selectDoseLog(scene: Scene): readonly DoseEvent[] {
  return scene.doseLog ?? [];
}

/** Find a dose event by id. O(n). Returns `null` if missing. */
export function selectDoseEventById(scene: Scene, id: Uuid): DoseEvent | null {
  const list = scene.doseLog;
  if (list === undefined) return null;
  for (const event of list) {
    if (event.id === id) return event;
  }
  return null;
}

/**
 * The next monotonic dose sequence number for the scene: `1 + max(seq)` over
 * the existing log, or `0` for an empty / absent log. The `doseNutrient`
 * factory caller passes this as the event `seq` so the log stays in a stable
 * total order independent of array index.
 */
export function nextDoseSeq(scene: Scene): number {
  const list = scene.doseLog;
  if (list === undefined || list.length === 0) return 0;
  let max = -1;
  for (const event of list) {
    if (event.seq > max) max = event.seq;
  }
  return max + 1;
}

// ─── Water level ──────────────────────────────────────────────────────────

/**
 * Default air gap between the interior rim and the water surface when the
 * document doesn't author `tank.waterLevelMm`. 25 mm reads as a realistic
 * fill (a 5 mm gap read as "filled to the brim"); the 3D renderer and the
 * livestock simulation both consume the EFFECTIVE level via
 * `effectiveWaterLevelMm`, never this constant directly.
 */
export const DEFAULT_WATER_GAP_BELOW_RIM_MM = 25;

/**
 * The tank's effective water-surface height above the interior floor (mm).
 * Single source of truth for "where is the waterline":
 *
 *  - authored `tank.waterLevelMm` when present (clamped into
 *    `[1, tank.height]` so a stale value can't float above the rim after
 *    a tank shrink — `SetTankDimensions` doesn't rewrite it);
 *  - else the default fill `tank.height − DEFAULT_WATER_GAP_BELOW_RIM_MM`
 *    (floored at 1 for degenerate tiny tanks).
 *
 * Consumers: the 3D renderer's water plane, the livestock sim's
 * `tankAabb.maxY` (depth bands / kinematic clamp / bubble despawn / food
 * floats), and the tank-setup UI's display default.
 */
export function effectiveWaterLevelMm(tank: Tank): number {
  const fallback = Math.max(1, tank.height - DEFAULT_WATER_GAP_BELOW_RIM_MM);
  if (tank.waterLevelMm === undefined) return fallback;
  return Math.min(tank.height, Math.max(1, tank.waterLevelMm));
}
