// Default scene factory — moved out of apps/web in F1.1 Phase B so the NgRx
// scene store owns its initial state. Re-exported from `@aquascape/state` so
// the app shell (and Stage 1+ feature code) can still read the canonical
// startup tank.
//
// Pure: no I/O, no mutation, deterministic output (seed = 0). The shape
// mirrors the eventual `.aqua` v1 document body minus the
// `format` / `schemaVersion` / `meta` envelope, which the document lib
// (F1.3) wraps/unwraps.

import type { Scene } from '@aquascape/domain/scene-model';

/** Default tank interior dimensions in mm (typical 60 cm ADA-style rimless). */
export const DEFAULT_TANK_WIDTH_MM = 600;
export const DEFAULT_TANK_HEIGHT_MM = 360;
export const DEFAULT_TANK_DEPTH_MM = 360;

/**
 * Return a fresh, empty `Scene` for first-boot. Pure function — no I/O, no
 * mutation, deterministic output.
 */
export function defaultScene(): Scene {
  return {
    tank: {
      width: DEFAULT_TANK_WIDTH_MM,
      height: DEFAULT_TANK_HEIGHT_MM,
      depth: DEFAULT_TANK_DEPTH_MM,
      style: {
        frame: 'rimless',
        background: { kind: 'none' },
      },
    },
    substrate: { regions: [] },
    layers: [],
    seed: 0,
  };
}
