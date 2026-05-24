// Public API for @aquascape/features/tank-setup. Plan Stage 1 F1.1 Phase B,
// extended for F1.2 Phase D (tank-styling subpanel).

export { TankSetupComponent } from './lib/tank-setup.component';
export { ASPECT_MAX, ASPECT_MIN, MAX_DIM_MM, MIN_DIM_MM } from './lib/tank-setup.component';
export { TANK_PRESET_CATALOG, TANK_PRESET_VERSION, tankPresets } from './lib/tank-presets';
export type { TankFrame, TankPreset } from './lib/tank-presets';
export {
  DISPLAY_UNIT_STORAGE_KEY,
  cmToMm,
  formatForDisplay,
  inchesToMm,
  mmToCm,
  mmToInches,
  parseToMm,
} from './lib/units';
export type { DisplayUnit } from './lib/units';
export {
  TankStylingComponent,
  FRAME_OPTIONS,
  UI_HEX_RE,
  normaliseHex,
  isDomainHex,
  hexWithoutAlpha,
  degToRad,
  radToDeg,
} from './lib/tank-styling.component';
export type { BackgroundTab, FrameOption } from './lib/tank-styling.component';
export {
  BACKGROUND_COLOR_PRESETS,
  DEFAULT_FRAME_COLOR,
  DEFAULT_GRADIENT,
  GRADIENT_ANGLE_PRESETS_DEG,
  MAX_GRADIENT_STOPS,
  MIN_GRADIENT_STOPS,
  WATER_TINT_PRESETS,
} from './lib/tank-style-defaults';
