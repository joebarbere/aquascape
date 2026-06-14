// Stage 15 F15.2 — the pure OUT/IN volume → chemistry/level mapping for the
// water-change tool, extracted so the app-layer wiring (inside the giant
// AppComponent) is unit-testable without standing up the shell.
//
// The siphon-tool flow drains a slice of the water column (OUT) then refills it
// (IN). Both steps are expressed as a fraction of the *current water volume*
// removed/added; that fraction is exactly the `applyWaterChange` dilution
// fraction (the single source of dilution truth in `domain/scene-model`). The
// only extra math here is the water-LEVEL bookkeeping — turning the configured
// OUT fraction into the new `SetWaterLevel` mm, and the IN step back up.
//
// We DO NOT re-implement any dilution math: `outFraction()` / `inFraction()`
// return the fraction the caller hands straight to `applyWaterChange` (the
// Command and the live `WaterChemistryService`). This module only owns the
// level <-> fraction conversion + the replacement-param defaults.

import type { ReplacementWater } from '@aquascape/domain/scene-model';

/**
 * The default proportion of the water column a single siphon OUT removes — a
 * realistic partial water change (~30 %). The IN step restores the same volume.
 * Held here (not the component) so the mapping helper + its test pin it.
 */
export const DEFAULT_WATER_CHANGE_FRACTION = 0.3;

/** The replacement-water params the form collects (new water going IN). */
export interface ReplacementParams {
  /** Replacement temperature, °C (display/record only — chemistry helper ignores). */
  readonly temperatureC: number;
  /** Replacement pH — lerps the tank toward it on IN. */
  readonly ph: number;
  /** Replacement general hardness (dGH) — record only (WaterState has no gh). */
  readonly hardnessDgh: number;
}

/**
 * Sensible replacement-water defaults (room-temp, neutral, soft–medium tap).
 * The form seeds from this; the IN step blends the tank toward `ph`.
 */
export const DEFAULT_REPLACEMENT: ReplacementParams = {
  temperatureC: 24,
  ph: 7.0,
  hardnessDgh: 6,
};

/** Clamp a fraction into the `applyWaterChange`-valid open-top range (0, 1]. */
function clampFraction(f: number): number {
  if (!Number.isFinite(f) || f <= 0) return 0;
  return Math.min(1, f);
}

/**
 * The OUT dilution fraction — the proportion of the water column removed. Passed
 * verbatim to `applyWaterChange` (clean source water) so nitrate/ammonia/nitrite
 * dilute. Clamped to (0, 1].
 */
export function outFraction(fraction = DEFAULT_WATER_CHANGE_FRACTION): number {
  return clampFraction(fraction);
}

/**
 * The IN dilution fraction — refilling the drained slice with replacement water.
 * Modelled as adding `fraction` of fresh water back: the post-OUT column is
 * `(1 - f)` of full, and adding `f` back makes the new water `f / 1` of the
 * full column, so the chemistry blends toward the replacement by exactly `f`.
 * Passed to `applyWaterChange` with the replacement params. Clamped to (0, 1].
 */
export function inFraction(fraction = DEFAULT_WATER_CHANGE_FRACTION): number {
  return clampFraction(fraction);
}

/**
 * Convert the replacement-param form values into the `ReplacementWater` the
 * dilution helper consumes. Clean source water (0 ammonia/nitrite/nitrate);
 * `ph` lerps the tank toward the chosen value; `gh` carried for richer live
 * callers (the persisted `WaterState` has no gh axis, so the helper ignores it).
 */
export function toReplacementWater(params: ReplacementParams): ReplacementWater {
  return {
    ammonia: 0,
    nitrite: 0,
    nitrate: 0,
    ph: params.ph,
    gh: params.hardnessDgh,
  };
}

/**
 * The new water level (mm) after a siphon OUT removes `fraction` of the column.
 * `currentLevelMm` is the effective level before the drain. Floors at 1 mm
 * (the `SetWaterLevel` command's minimum) so a 100 % drain still leaves a valid
 * command. Returns an integer (canonical mm).
 */
export function levelAfterOut(currentLevelMm: number, fraction = DEFAULT_WATER_CHANGE_FRACTION): number {
  const f = clampFraction(fraction);
  const next = Math.round(currentLevelMm * (1 - f));
  return Math.max(1, next);
}

/**
 * The water level (mm) after a siphon IN refills the drained slice — restores
 * the pre-drain level, clamped to the tank height. `preDrainLevelMm` is the
 * level captured before OUT; `tankHeightMm` is the ceiling. Returns an integer.
 */
export function levelAfterIn(preDrainLevelMm: number, tankHeightMm: number): number {
  return Math.max(1, Math.min(Math.round(tankHeightMm), Math.round(preDrainLevelMm)));
}
