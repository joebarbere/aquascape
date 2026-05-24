// Built-in tank presets. F1.1 Phase B.
//
// TODO(F2.4): migrate to the tank catalog manifest once domain/catalog ships.
// Until then, this inline constants list is the source of truth for the
// preset picker.
//
// SOURCES — published manufacturer / industry-standard dimensions in mm.
//   • ADA Mini-S / Mini-M / 60-P / 90-P / 120-P:
//     ADA-Aquadesignamano "Cube Garden" rimless series, published interior
//     dimensions on https://www.adana.co.jp/en/contents/products/aquasystem/
//     (page captures in design notes; copy below matches the product spec
//     sheets distributed by ADG / ADA-NA).
//       - Mini-S       : 310 × 185 × 185 mm  (12.2 × 7.3 × 7.3 in)
//       - Mini-M       : 360 × 220 × 220 mm  (14.2 × 8.7 × 8.7 in)
//       - 60-P         : 600 × 300 × 360 mm  (23.6 × 11.8 × 14.2 in)
//       - 90-P         : 900 × 450 × 450 mm  (35.4 × 17.7 × 17.7 in)
//       - 120-P        : 1200 × 450 × 450 mm (47.2 × 17.7 × 17.7 in)
//   • US "standard" tanks (LFS / Aqueon / Marineland chart):
//       - 10 gal       : 20.25 × 10.5 × 12.625 in ≈ 514 × 267 × 321 mm
//                        Rounded to widely-quoted "approx" sizes used by
//                        substrate calculators: 508 × 254 × 305 mm.
//       - 20 gal "20H" : 24 × 12 × 16.75 in ≈ 610 × 305 × 425 mm
//                        Quoted as 610 × 305 × 407 mm in most aquaria
//                        guides (interior, after rim).
//       - 40 gal "40B" : 36 × 18 × 16 in    ≈ 914 × 457 × 406 mm
//                        Approximated to 915 × 457 × 407 mm.
//
// The "frame" tag is used by F1.2 to pick the rendered tank style. ADA
// products are rimless; US standards are framed (top + bottom plastic
// trim). "braced" is reserved for braced-glass tanks (often 75 gal+).

export type TankFrame = 'rimless' | 'framed' | 'braced';

export interface TankPreset {
  /** Stable id — also forms the `presetRef.id` against catalog `"core"`. */
  readonly id: string;
  /** Display name (English; F1.x will route through i18n). */
  readonly name: string;
  readonly brand: 'ADA' | 'Standard';
  /** Interior width (left-right) in mm. */
  readonly width: number;
  /** Interior height (bottom-top) in mm. */
  readonly height: number;
  /** Interior depth (front-back) in mm. */
  readonly depth: number;
  readonly frame: TankFrame;
}

export const tankPresets: readonly TankPreset[] = [
  {
    id: 'ada.mini-s',
    name: 'ADA Mini-S',
    brand: 'ADA',
    width: 310,
    height: 185,
    depth: 185,
    frame: 'rimless',
  },
  {
    id: 'ada.mini-m',
    name: 'ADA Mini-M',
    brand: 'ADA',
    width: 360,
    height: 220,
    depth: 220,
    frame: 'rimless',
  },
  {
    id: 'ada.60-p',
    name: 'ADA 60-P',
    brand: 'ADA',
    width: 600,
    height: 300,
    depth: 360,
    frame: 'rimless',
  },
  {
    id: 'ada.90-p',
    name: 'ADA 90-P',
    brand: 'ADA',
    width: 900,
    height: 450,
    depth: 450,
    frame: 'rimless',
  },
  {
    id: 'ada.120-p',
    name: 'ADA 120-P',
    brand: 'ADA',
    width: 1200,
    height: 450,
    depth: 450,
    frame: 'rimless',
  },
  {
    id: 'standard.10-gal',
    name: 'Standard 10 gal (US)',
    brand: 'Standard',
    width: 508,
    height: 254,
    depth: 305,
    frame: 'framed',
  },
  {
    id: 'standard.20-gal-h',
    name: 'Standard 20 gal "20H" (US)',
    brand: 'Standard',
    width: 610,
    height: 305,
    depth: 407,
    frame: 'framed',
  },
  {
    id: 'standard.40-gal-b',
    name: 'Standard 40 gal "40B" (US)',
    brand: 'Standard',
    width: 915,
    height: 457,
    depth: 407,
    frame: 'framed',
  },
];

/** Catalog namespace used in `presetRef.catalog` for these built-ins. */
export const TANK_PRESET_CATALOG = 'core';

/** Catalog version recorded on stamped `presetRef` values. */
export const TANK_PRESET_VERSION = 1;
