// Tank-styling defaults & UI constants. F1.2 Phase D.
//
// Exported so tests can pin the values and the component template can pull
// them without literals scattered across the codebase. No business logic
// here — just data. Strict TS with `exactOptionalPropertyTypes: true` so
// every field is explicit.

import type { HexColor } from '@aquascape/domain/scene-model';

/**
 * Default frame color shown the first time the user picks a non-rimless
 * frame style. A neutral dark grey reads as a generic black-plastic rim
 * without committing the renderer to a specific shade.
 */
export const DEFAULT_FRAME_COLOR: HexColor = '#222222';

/**
 * Water-tint presets shown as chips next to the hex input.
 *
 * `hex === null` is the explicit "clear" preset; selecting it clears
 * `style.waterTint` (drops the field on dispatch) so the renderer treats
 * the water as fully transparent. The amber/green/blue presets all carry
 * an 0x80 alpha (≈ 50 %) so they read as a tint, not a flood-fill.
 */
export const WATER_TINT_PRESETS: ReadonlyArray<{
  readonly label: string;
  readonly hex: HexColor | null;
}> = [
  { label: 'Clear', hex: null },
  { label: 'Slight green', hex: '#a8d8a880' },
  { label: 'Tannin amber', hex: '#c08e4a80' },
  { label: 'Cool blue', hex: '#7fb3d580' },
];

/**
 * Background solid-color presets. No alpha — backgrounds are opaque.
 */
export const BACKGROUND_COLOR_PRESETS: ReadonlyArray<{
  readonly label: string;
  readonly hex: HexColor;
}> = [
  { label: 'Neutral dark', hex: '#1f2933' },
  { label: 'Slate', hex: '#3a4a5a' },
  { label: 'Black', hex: '#000000' },
  { label: 'Warm grey', hex: '#4a4238' },
  { label: 'Off-white', hex: '#f0ece4' },
];

/**
 * Default angle preset buttons (degrees, UI-side). Conversion to radians
 * for the document happens at dispatch.
 */
export const GRADIENT_ANGLE_PRESETS_DEG: readonly number[] = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * Sensible "deep-water" two-stop gradient used as the first-time UX when
 * the user toggles into the Gradient tab. Angle is stored in **radians**
 * in the document, but this constant exposes it pre-converted (π/2 ≈
 * 1.5707963267948966 = bottom→top), since `TankStyle.background.gradient`
 * is the persisted shape. The UI shows it as 90 degrees.
 */
export const DEFAULT_GRADIENT: {
  readonly angle: number;
  readonly stops: ReadonlyArray<{ readonly at: number; readonly color: HexColor }>;
} = {
  angle: Math.PI / 2,
  stops: [
    { at: 0, color: '#0b2540' },
    { at: 1, color: '#1f6f8b' },
  ],
};

/** Minimum number of gradient stops the UI will allow before disabling Remove. */
export const MIN_GRADIENT_STOPS = 2;

/** Maximum number of gradient stops the UI will allow before disabling Add. */
export const MAX_GRADIENT_STOPS = 6;
