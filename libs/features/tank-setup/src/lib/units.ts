// Unit conversion helpers. F1.1 Phase B.
//
// The document stores millimetres (integers preferred). The UI offers cm /
// in / mm display only. Conversions back to mm round-to-integer so the
// authoritative storage stays clean. Sub-mm precision IS intentionally lost
// because integer mm IS the canonical representation.
//
// Round-trip guarantee (property-tested in units.spec.ts):
//   • For mm ∈ [100, 10_000], cmToMm(mmToCm(mm)) === mm.
//   • For mm ∈ [100, 10_000], inchesToMm(mmToInches(mm)) === mm — note
//     that this round-trip relies on Math.round absorbing the
//     mm ↔ in floating-point error. The test verifies that ±0 rounding
//     across the supported range round-trips losslessly.

/** Convert millimetres to centimetres. Lossy: returns a real number. */
export function mmToCm(mm: number): number {
  return mm / 10;
}

/**
 * Convert centimetres to integer millimetres. Rounds half-to-even via
 * `Math.round`. The form's value stays in mm; this function is the only
 * place a user-typed cm value crosses back into the canonical unit.
 */
export function cmToMm(cm: number): number {
  return Math.round(cm * 10);
}

/** Millimetres → inches. Lossy: returns a real number. */
export function mmToInches(mm: number): number {
  return mm / 25.4;
}

/**
 * Inches → integer millimetres. Same rounding contract as
 * {@link cmToMm}. 1 in = 25.4 mm exactly.
 */
export function inchesToMm(inches: number): number {
  return Math.round(inches * 25.4);
}

/** The unit the picker is currently displaying. */
export type DisplayUnit = 'cm' | 'in' | 'mm';

/** Storage key for the user's chosen display unit (StorageService). */
export const DISPLAY_UNIT_STORAGE_KEY = 'tank-setup.units';

/**
 * Format an integer millimetre value for display in the given unit. Returns
 * a string with no trailing zeros beyond the units we want to expose
 * (cm: 1 decimal, in: 2 decimals, mm: 0 decimals).
 */
export function formatForDisplay(mm: number, unit: DisplayUnit): string {
  switch (unit) {
    case 'mm':
      return `${Math.round(mm)}`;
    case 'cm':
      return mmToCm(mm).toFixed(1);
    case 'in':
      return mmToInches(mm).toFixed(2);
  }
}

// ── Water-fill conversions (mm ↔ US gallons) ───────────────────────────
//
// The water-fill control displays the fill LEVEL either as a height (mm)
// or as the contained VOLUME in US gallons. Gallons are display-only —
// canonical storage is always integer mm of water-surface height. The
// conversion depends on the tank footprint:
//
//   litres  = width(mm) × depth(mm) × level(mm) / 1e6
//   gallons = litres / 3.78541
//
// e.g. a 600 × 300 mm footprint holds 0.18 L per mm of depth.

/** Litres per US gallon (exact definition: 3.785411784, truncated per spec). */
export const LITRES_PER_US_GALLON = 3.78541;

/** The unit the water-fill control is currently displaying. */
export type WaterFillUnit = 'mm' | 'gal';

/** Storage key for the user's chosen water-fill display unit. */
export const WATER_FILL_UNIT_STORAGE_KEY = 'tank-setup.water-fill-unit';

/**
 * Water level (mm above the interior floor) → contained volume in US
 * gallons for a tank with the given interior footprint. Lossy: returns a
 * real number (display rounds to 1 decimal).
 */
export function mmLevelToGallons(levelMm: number, widthMm: number, depthMm: number): number {
  return (widthMm * depthMm * levelMm) / 1e6 / LITRES_PER_US_GALLON;
}

/**
 * US gallons → integer water level in mm for a tank with the given interior
 * footprint. Same integer-rounding contract as {@link cmToMm}. Returns
 * `null` for a non-finite gallon value or a degenerate (≤ 0) footprint.
 */
export function gallonsToMmLevel(gallons: number, widthMm: number, depthMm: number): number | null {
  const footprint = widthMm * depthMm;
  if (!Number.isFinite(gallons) || !Number.isFinite(footprint) || footprint <= 0) return null;
  return Math.round((gallons * LITRES_PER_US_GALLON * 1e6) / footprint);
}

/**
 * Format an integer-mm water level for display in the given water-fill
 * unit (mm: integer string, gal: 1 decimal).
 */
export function formatWaterFill(
  levelMm: number,
  unit: WaterFillUnit,
  widthMm: number,
  depthMm: number,
): string {
  return unit === 'mm'
    ? `${Math.round(levelMm)}`
    : mmLevelToGallons(levelMm, widthMm, depthMm).toFixed(1);
}

/**
 * Parse a user-entered water-fill string in the given unit back into
 * integer millimetres of level. Returns `null` when the input is not a
 * finite number (or, for gallons, when the footprint is degenerate).
 */
export function parseWaterFillToMm(
  value: string,
  unit: WaterFillUnit,
  widthMm: number,
  depthMm: number,
): number | null {
  if (value.trim().length === 0) return null;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  return unit === 'mm' ? Math.round(raw) : gallonsToMmLevel(raw, widthMm, depthMm);
}

/**
 * Parse a user-entered numeric string in the given display unit back into
 * integer millimetres. Returns `null` if the input is not a finite number.
 */
export function parseToMm(value: string, unit: DisplayUnit): number | null {
  // Treat empty / whitespace as "no value" — `Number('')` is 0, which would
  // silently coerce a blank input to 0 mm and then trip the min validator.
  // Better to return null and let the form's Validators.required fire.
  if (value.trim().length === 0) return null;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  switch (unit) {
    case 'mm':
      return Math.round(raw);
    case 'cm':
      return cmToMm(raw);
    case 'in':
      return inchesToMm(raw);
  }
}
