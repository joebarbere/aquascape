/**
 * Preview-time + tank-param adapters for the F13.3 driver paths.
 *
 * These pure helpers bridge a `Scene` to the framework-free chemistry model so
 * BOTH the editor preview-time path and the live `WaterChemistryService` derive
 * their `WaterChemistryParams` and their starting `WaterState` the same way —
 * agreement by shared construction, like `bioloadSourceN`.
 *
 * Pure + deterministic + framework-free: no Angular/DOM, no clock, no random.
 */

import type { Scene, Tank, WaterChemistry } from '@aquascape/domain/scene-model';
import { effectiveWaterLevelMm } from '@aquascape/domain/scene-model';

import {
  ENGINE_VERSION,
  freshWaterState,
  simulateChemistry,
  type WaterChemistryParams,
  type WaterState,
} from './chemistry';

/**
 * Default carbonate hardness (dKH) when the tank doesn't record one. A moderate
 * buffer — enough that nitrification acid drift is gentle. The scene model
 * doesn't carry a per-tank KH today; this is the labelled default the model
 * uses for both driver paths.
 */
export const DEFAULT_KH_DKH = 4;

/**
 * Default water temperature (°C) when the tank doesn't record one. A typical
 * tropical community-tank setpoint. The scene model doesn't carry a per-tank
 * temperature today; labelled default for both driver paths.
 */
export const DEFAULT_TEMPERATURE_C = 25;

/**
 * Derive the `WaterChemistryParams` (volume / KH / temperature) for a tank.
 *
 * Volume is the WATER volume at the effective fill line (`width × depth ×
 * effectiveWaterLevelMm`), not the gross interior — the source term is diluted
 * into the actual water, so the waterline matters. KH + temperature fall back
 * to the labelled defaults above (the scene model doesn't persist them yet).
 */
export function waterParamsFromTank(tank: Tank): WaterChemistryParams {
  const levelMm = effectiveWaterLevelMm(tank);
  // mm³ → litres (1 L = 1_000_000 mm³). Floored to 1 L so a degenerate tank
  // can't divide-by-near-zero the source-term concentration.
  const volumeLitres = Math.max(1, (tank.width * tank.depth * levelMm) / 1_000_000);
  return {
    volumeLitres,
    kh: DEFAULT_KH_DKH,
    temperatureC: DEFAULT_TEMPERATURE_C,
  };
}

/**
 * Lift a persisted `Tank.waterChemistry` snapshot back into a live `WaterState`,
 * or return a fresh uncycled state when absent. The snapshot's `chemistry` block
 * is a field-for-field mirror of `WaterState`, so this is a structural copy.
 *
 * When the persisted snapshot was produced under a DIFFERENT engine version, we
 * still resume from it (no silent migration); the caller owns any explicit
 * migration. The returned state carries the snapshot's own `engineVersion` so
 * provenance is preserved until the next `simulateChemistry` call re-stamps it.
 */
export function initialWaterState(persisted: WaterChemistry | undefined): WaterState {
  if (persisted === undefined) return freshWaterState();
  const c = persisted.chemistry;
  return {
    ammonia: c.ammonia,
    nitrite: c.nitrite,
    nitrate: c.nitrate,
    ph: c.ph,
    aobColony: c.aobColony,
    nobColony: c.nobColony,
    ageWeeks: c.ageWeeks,
    engineVersion: c.engineVersion ?? ENGINE_VERSION,
  };
}

/**
 * EDITOR preview-time evaluation. Compute the chemistry state a scene's tank
 * reaches after `targetWeek` weeks of cycling, deterministically from the
 * document seed + the scene's stocking-derived source term.
 *
 * - Initial state = the persisted snapshot (`Tank.waterChemistry`) lifted via
 *   `initialWaterState`, else a fresh uncycled tank.
 * - Source term = `sourceN` (caller passes `bioloadSourceN(scene, catalog)`),
 *   held CONSTANT across the span (the editor models a fixed stocking — it
 *   doesn't replay feeding events).
 * - Elapsed = `targetWeek − initial.ageWeeks`, clamped to ≥ 0. Scrubbing the
 *   slider BACKWARDS below the persisted age returns the initial state
 *   unchanged (the model is monotonic-forward; you can't un-cycle by scrubbing).
 *
 * Pure: same `(scene seed, params, initial, targetWeek, sourceN)` ⇒ identical
 * `WaterState`. This is the deterministic-from-seed contract growth-sim has.
 */
export function evaluateChemistryAtWeek(
  params: WaterChemistryParams,
  initial: WaterState,
  targetWeek: number,
  sourceN: number,
  seed: number,
): WaterState {
  const target = Number.isFinite(targetWeek) ? Math.max(0, targetWeek) : 0;
  const elapsed = target - (Number.isFinite(initial.ageWeeks) ? initial.ageWeeks : 0);
  if (elapsed <= 0) {
    // Scrubbed to/under the persisted age — nothing to advance. Stamp the
    // current engine version for provenance (mirrors simulateChemistry's
    // zero-elapsed identity path).
    return { ...initial, engineVersion: ENGINE_VERSION };
  }
  return simulateChemistry(params, initial, elapsed, sourceN, seed);
}

/**
 * Convenience wrapper that derives params + initial state + source from the
 * scene directly. The editor service uses this; tests can call the lower-level
 * `evaluateChemistryAtWeek` to pin params explicitly.
 */
export function evaluateSceneChemistryAtWeek(
  scene: Scene,
  targetWeek: number,
  sourceN: number,
): WaterState {
  const params = waterParamsFromTank(scene.tank);
  const initial = initialWaterState(scene.tank.waterChemistry);
  return evaluateChemistryAtWeek(params, initial, targetWeek, sourceN, scene.seed);
}
