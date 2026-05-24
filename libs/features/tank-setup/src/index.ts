// Public API for @aquascape/features/tank-setup. Plan Stage 1 F1.1 Phase B.

export { TankSetupComponent } from './lib/tank-setup.component';
export {
  ASPECT_MAX,
  ASPECT_MIN,
  MAX_DIM_MM,
  MIN_DIM_MM,
} from './lib/tank-setup.component';
export {
  TANK_PRESET_CATALOG,
  TANK_PRESET_VERSION,
  tankPresets,
} from './lib/tank-presets';
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
