// Stage 15 F15.1 — the feeding-tool drop resolution, extracted as a pure
// helper so the app-layer wiring (which lives inside the giant AppComponent)
// is unit-testable without standing up the whole shell.
//
// `resolveFoodDrop` is the seam between a canvas pixel + the armed food id and
// a typed-food spawn: it looks the catalog `food` row up, raycasts the pixel to
// the tank floor through the `SimulationInteractionRenderer`, and — when both
// resolve — calls `spawnFood(position, entry)`. Every failure mode (no renderer,
// no armed food, missing row, ray miss) is a no-op returning `null`. The actual
// `spawnFoodFromCatalog` call is injected so the test can assert it fires at the
// raycast point without a real ECS world.

import type { FoodEntry } from '@aquascape/domain/catalog';
import type { Vec3 } from '@aquascape/domain/geometry';
import type {
  CanvasRaycastPoint,
  SimulationInteractionRenderer,
} from '@aquascape/rendering/renderer-api';

/** The slice of `LivestockSimulationService` the drop needs (test seam). */
export interface FoodSpawner {
  spawnFoodFromCatalog(position: Vec3, entry: FoodEntry): number | null;
}

export interface FoodDropDeps {
  /** The 3D interaction renderer (or null when 3D isn't real). */
  readonly renderer: SimulationInteractionRenderer | null;
  /** The armed catalog `food` id from the action service (or null). */
  readonly foodId: string | null;
  /** All catalog `food` rows (so the helper stays catalog-source agnostic). */
  readonly foods: readonly FoodEntry[];
  /** The sim service's typed-food spawner. */
  readonly spawner: FoodSpawner;
}

/**
 * Resolve + drop the armed food at a canvas pixel. Returns the dropped tank
 * coordinate on success, or `null` when any precondition fails (so the caller
 * can decide whether to re-render). Renderer raycast happens HERE (an event-
 * handler context in the app), never in a render effect — NG0600.
 */
export function resolveFoodDrop(
  point: CanvasRaycastPoint | null,
  deps: FoodDropDeps,
): Vec3 | null {
  if (point === null) return null;
  if (deps.renderer === null) return null;
  if (deps.foodId === null) return null;
  const entry = deps.foods.find((f) => f.id === deps.foodId);
  if (entry === undefined) return null;
  const drop = deps.renderer.raycastTankPoint(point, { plane: 'floor' });
  if (drop === null) return null;
  deps.spawner.spawnFoodFromCatalog(drop, entry);
  return drop;
}
