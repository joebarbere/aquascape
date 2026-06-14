// Pure value → test-kit-band/colour mapping. Plan Stage 13 F13.5 (F13.5b).
//
// The framework-free heart of the water-testing UI: given the live chemistry
// (ammonia / nitrite / nitrate / pH) and a selected `water-test-kit` catalog
// entry's `reads[]` ranges, classify each parameter into the classic
// colour-chart band (a normalised position on the kit's swatch scale, a
// rendered swatch colour, and a safe / caution / danger health verdict).
//
// Shared by the editor readout panel (`TestKitReadoutComponent`) AND the
// simulation HUD (apps/web), so it lives here as a pure helper with no Angular
// / DOM deps — unit-tested in isolation. Both surfaces read the SAME chemistry
// source (PreviewChemistryService in the editor, WaterChemistryService live in
// sim) and feed it through this one mapping.
//
// ─── Two independent classifications ────────────────────────────────────────
// The kit's `reads[]` `min`/`max` drive the SWATCH position + colour (where on
// the kit's printed colour card a reading falls — clamped to the top swatch,
// the classic API behaviour). The safe/caution/danger VERDICT is a separate
// hobby-husbandry judgement (e.g. ANY detectable ammonia is dangerous,
// regardless of where it sits on an 8 ppm card), keyed off honest hobby
// thresholds — NOT the kit's chart range. A kit only changes the swatch scale;
// it never changes what's safe for fish.

import type { WaterParameter, WaterTestReading } from '@aquascape/domain/catalog';

/** The four parameters the classic hobby panel surfaces, in display order. */
export const PANEL_PARAMETERS = ['ammonia', 'nitrite', 'nitrate', 'ph'] as const;

/** Union of just the four panel parameters (narrower than `WaterParameter`). */
export type PanelParameter = (typeof PANEL_PARAMETERS)[number];

/** Health verdict for a parameter reading. */
export type WaterBand = 'safe' | 'caution' | 'danger';

/** A single parameter's mapped readout row. */
export interface TestKitBand {
  /** Which parameter this row reads. */
  readonly parameter: WaterParameter;
  /** Raw value (mg/L for the nitrogen trio; pH units for pH). */
  readonly value: number;
  /** Reporting unit from the kit's reading (`'ppm'` / `'pH'` / …). */
  readonly unit: WaterTestReading['unit'];
  /** Chart range used for the swatch position. */
  readonly min: number;
  readonly max: number;
  /** Value's normalised position on the swatch scale, clamped to `[0, 1]`. */
  readonly fraction: number;
  /** Rendered swatch colour (sRGB hex) for the value's chart position. */
  readonly swatch: string;
  /** Health verdict — safe / caution / danger (hobby thresholds, not the chart). */
  readonly band: WaterBand;
}

// ─── Per-parameter colour ramps (the printed colour-card swatches) ───────────
//
// A small hand-picked ramp per parameter, evoking the API-master-kit cards:
// ammonia/nitrite go yellow → green → blue → purple as they climb; nitrate
// goes yellow → orange → red; pH runs the bromothymol/phenol-red wash. The
// helper samples the ramp at the value's normalised chart position. These are
// presentation swatches, not measured colours.
const COLOUR_RAMPS: Record<WaterParameter, readonly string[]> = {
  ammonia: ['#f4e04d', '#a7d24b', '#4caf50', '#2f8f6b', '#3f6fae', '#5e4b9e'],
  nitrite: ['#7fd6e8', '#5fb6d6', '#8e6fc0', '#b14fa8', '#c73f7f', '#d12f5f'],
  nitrate: ['#f4e04d', '#f4b73d', '#ef8a3d', '#e0552f', '#c33', '#a01f2f'],
  ph: ['#f2c84b', '#c8d84b', '#7fc24b', '#4caf50', '#3f8fae', '#3f5fae'],
  // The remaining parameters are not in the F13.5b panel but kept for
  // completeness so a kit covering them never crashes the mapper.
  kh: ['#f4e04d', '#a7d24b', '#4caf50', '#3f8fae', '#3f5fae'],
  gh: ['#f4e04d', '#a7d24b', '#4caf50', '#3f8fae', '#3f5fae'],
  phosphate: ['#f4e04d', '#a7d24b', '#4caf50', '#ef8a3d', '#c33'],
  co2: ['#3f5fae', '#4caf50', '#f4e04d'],
};

// ─── Health thresholds (hobby husbandry, NOT the kit chart) ──────────────────
//
// Honest hobby consensus: ammonia + nitrite are toxic at any detectable level
// (danger past a trace, caution at a whiff); nitrate is a slow stressor that
// drives water-change cadence; pH is judged by distance from a neutral band.
const SAFE_TRACE_MG_L = 0.25; // below this reads "processed / safe"
const CAUTION_TRACE_MG_L = 0.5; // ammonia/nitrite: above safe but not yet acute
const NITRATE_SAFE_MG_L = 20; // typical "do a water change soon" floor
const NITRATE_CAUTION_MG_L = 40; // elevated; past here is the danger band
const PH_SAFE_LO = 6.4;
const PH_SAFE_HI = 7.8;
const PH_CAUTION_LO = 6.0;
const PH_CAUTION_HI = 8.4;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Sample a colour ramp at `t ∈ [0, 1]` (nearest swatch — chart swatches are discrete). */
function sampleRamp(ramp: readonly string[], t: number): string {
  if (ramp.length === 0) return '#888888';
  const idx = Math.round(clamp01(t) * (ramp.length - 1));
  return ramp[idx] ?? ramp[ramp.length - 1] ?? '#888888';
}

/** Classify a single parameter's value into a safe/caution/danger verdict. */
export function classifyBand(parameter: WaterParameter, value: number): WaterBand {
  const v = Number.isFinite(value) ? value : 0;
  switch (parameter) {
    case 'ammonia':
    case 'nitrite':
      if (v <= SAFE_TRACE_MG_L) return 'safe';
      if (v <= CAUTION_TRACE_MG_L) return 'caution';
      return 'danger';
    case 'nitrate':
      if (v <= NITRATE_SAFE_MG_L) return 'safe';
      if (v <= NITRATE_CAUTION_MG_L) return 'caution';
      return 'danger';
    case 'ph':
      if (v >= PH_SAFE_LO && v <= PH_SAFE_HI) return 'safe';
      if (v >= PH_CAUTION_LO && v <= PH_CAUTION_HI) return 'caution';
      return 'danger';
    default:
      // Parameters outside the panel: no honest universal threshold — neutral.
      return 'safe';
  }
}

/**
 * Map one parameter value against a kit reading into a full {@link TestKitBand}.
 * `reading` supplies the chart `min`/`max`/`unit` (the swatch scale); the
 * verdict comes from {@link classifyBand} (hobby thresholds).
 */
export function mapReading(reading: WaterTestReading, value: number): TestKitBand {
  const v = Number.isFinite(value) ? value : 0;
  const span = reading.max - reading.min;
  const fraction = span > 0 ? clamp01((v - reading.min) / span) : 0;
  return {
    parameter: reading.parameter,
    value: v,
    unit: reading.unit,
    min: reading.min,
    max: reading.max,
    fraction,
    swatch: sampleRamp(COLOUR_RAMPS[reading.parameter], fraction),
    band: classifyBand(reading.parameter, v),
  };
}

/** The chemistry values the panel reads (a minimal slice of `WaterState`). */
export interface PanelChemistry {
  readonly ammonia: number;
  readonly nitrite: number;
  readonly nitrate: number;
  readonly ph: number;
}

/**
 * Build the four-row panel readout for the standard hobby panel
 * (ammonia / nitrite / nitrate / pH) from a chemistry slice + a kit's reading
 * list. For each panel parameter, the FIRST matching reading in `reads`
 * supplies the chart scale (a master kit may list two pH ranges — we take the
 * first/normal-range one); a parameter the kit doesn't cover falls back to a
 * sensible default range so the panel always shows all four rows.
 */
export function buildPanelReadout(
  chemistry: PanelChemistry,
  reads: readonly WaterTestReading[],
): TestKitBand[] {
  const valueOf: Record<PanelParameter, number> = {
    ammonia: chemistry.ammonia,
    nitrite: chemistry.nitrite,
    nitrate: chemistry.nitrate,
    ph: chemistry.ph,
  };
  return PANEL_PARAMETERS.map((parameter) => {
    const reading =
      reads.find((r) => r.parameter === parameter) ?? DEFAULT_PANEL_READINGS[parameter];
    return mapReading(reading, valueOf[parameter]);
  });
}

/**
 * Fallback chart ranges for the four panel parameters — used when the selected
 * kit doesn't cover a parameter (or when no kit is selected and the default
 * master kit somehow lacks one). Mirrors the API-master-kit swatch ranges.
 */
export const DEFAULT_PANEL_READINGS: Record<PanelParameter, WaterTestReading> = {
  ammonia: { parameter: 'ammonia', min: 0, max: 8, unit: 'ppm' },
  nitrite: { parameter: 'nitrite', min: 0, max: 5, unit: 'ppm' },
  nitrate: { parameter: 'nitrate', min: 0, max: 160, unit: 'ppm' },
  ph: { parameter: 'ph', min: 6.0, max: 7.6, unit: 'pH' },
};

/** Human label for a parameter (used by both the editor + sim readouts). */
export function parameterLabel(parameter: WaterParameter): string {
  switch (parameter) {
    case 'ammonia':
      return 'Ammonia';
    case 'nitrite':
      return 'Nitrite';
    case 'nitrate':
      return 'Nitrate';
    case 'ph':
      return 'pH';
    case 'kh':
      return 'KH';
    case 'gh':
      return 'GH';
    case 'phosphate':
      return 'Phosphate';
    case 'co2':
      return 'CO₂';
  }
}
