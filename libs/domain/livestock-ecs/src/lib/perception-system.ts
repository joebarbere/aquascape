/**
 * PerceptionSystem (Stage 11 F11.2).
 *
 * Rebuilds the world's `SpatialGrid` from scratch each tick. SchoolingSystem
 * (next in the schedule) then queries the grid for in-range neighbours; the
 * grid's broad-phase is what lets the n=200 budget stay under 4 ms.
 *
 * Cell size = `max(ZOR, ZOO, ZOA)` across every registered species. When the
 * caller re-registers a species via `world.registerSpeciesBehavior`, the
 * world swaps in a fresh `SpatialGrid` sized to the new max. We re-pick the
 * cell each tick *only* if it actually moved — re-allocating buckets on
 * every frame is wasteful, and the existing grid is cleared in place so
 * single-tick state stays cheap.
 *
 * No allocations per fish per tick: the grid pre-allocates buckets inside
 * its Map; the only object churn here is bucket array push (which the grid
 * already amortises). The per-tick clear() walks `buckets.clear()` — O(b)
 * where b is the number of buckets used last tick.
 */
import { defineQuery } from 'bitecs';
import { Position } from './components';
import { SpatialGrid } from './spatial-grid';
import type { LivestockWorld } from './world';

const positionQuery = defineQuery([Position]);

/**
 * Floor for the SpatialGrid cell size. Mirrors `world.ts#FALLBACK_GRID_CELL_MM`
 * so a grid rebuilt mid-tick (e.g. after a re-register) still chooses a
 * legal positive cell size when no species has been registered yet.
 */
const FALLBACK_GRID_CELL_MM = 50;

export function perceptionSystem(world: LivestockWorld): void {
  // Re-size the grid if the max neighbour radius moved since last tick.
  // `world.registerSpeciesBehavior` already does this synchronously when a
  // species is added, so this branch typically no-ops. The double-check
  // here protects against future systems that mutate paramStore (F11.6
  // species tuning, future hot-reload, …).
  const desiredCell = (() => {
    const max = world.paramStore.maxNeighbourRadius();
    return max > 0 ? max : FALLBACK_GRID_CELL_MM;
  })();
  const currentCell = world.spatialGrid.cellSizeMm;
  if (desiredCell !== currentCell) {
    world.spatialGrid = new SpatialGrid(desiredCell);
  } else {
    world.spatialGrid.clear();
  }

  // Insert every Position-bearing entity. Use the broad ALL_ENTITIES query
  // (Position-only) — even entities without a behaviour ref participate, so
  // they can act as obstacles for neighbours that DO have one (F11.5 will
  // sharpen this; for F11.2 it's fine to over-include).
  for (const eid of positionQuery(world.ecs)) {
    world.spatialGrid.insert(
      eid,
      Position.x[eid] as number,
      Position.y[eid] as number,
      Position.z[eid] as number,
    );
  }
}
