// Default scene used by the web shell on boot. Stage 0 / F0.6.
//
// An empty tank with the typical ADA-style 60 cm dimensions. The renderer
// paints the tank outline + mm grid; substrate / layers / objects are all
// added by feature work in Stage 1+. The scene is **immutable** — the shell
// holds the reference produced here and never mutates it; subsequent renders
// (resize, future state changes) hand the same or a new `Scene` to the
// renderer.

import type { Scene } from '@aquascape/domain/scene-model';

/** Default tank interior dimensions in mm (typical 60 cm ADA-style rimless). */
export const DEFAULT_TANK_WIDTH_MM = 600;
export const DEFAULT_TANK_HEIGHT_MM = 360;
export const DEFAULT_TANK_DEPTH_MM = 360;

/**
 * Return a fresh, empty `Scene` for first-boot. Pure function — no I/O, no
 * mutation, deterministic output (seed = 0).
 *
 * The shape mirrors the eventual `.aqua` v1 document body (without the
 * `format` / `schemaVersion` / `meta` envelope, which is the document lib's
 * job in F1.3).
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
