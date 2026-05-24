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
