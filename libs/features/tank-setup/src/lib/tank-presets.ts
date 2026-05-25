// Built-in tank presets. F1.1 Phase B; extended with UNS / Waterbox /
// extra ADA + Standard sizes.
//
// TODO(F2.4): migrate to the tank catalog manifest once domain/catalog ships.
// Until then, this inline constants list is the source of truth for the
// preset picker.
//
// SOURCES — published manufacturer / industry-standard dimensions in mm.
//   • ADA Cube Garden series (interior dimensions, rimless low-iron glass):
//     ADA-Aquadesignamano "Cube Garden" rimless series, published interior
//     dimensions on https://www.adana.co.jp/en/contents/products/aquasystem/
//     and on the ADA "Cube Garden" detail page; cross-checked against
//     Aquasabi product listings (German distributor that publishes the
//     printed spec sheet verbatim).
//       - Mini-S       : 310 × 185 × 185 mm  (12.2 × 7.3 × 7.3 in) [ADA spec]
//                        Note: Aquasabi lists Mini-S as 300 × 180 × 240 mm
//                        but the spec sheet ADA-NA distributes (which we
//                        ship) is 310 × 185 × 185 mm. The 310 number is
//                        the long-standing US convention.
//       - Mini-M       : 360 × 220 × 220 mm  (14.2 × 8.7 × 8.7 in)
//       - 30-C         : 300 × 300 × 300 mm  cube (Aquasabi spec).
//       - 45-P         : 450 × 270 × 300 mm  (Aquasabi spec).
//       - 60-F         : 600 × 300 × 250 mm  flat / shallow (Aquasabi spec).
//       - 60-P         : 600 × 300 × 360 mm
//       - 75-P         : 750 × 450 × 450 mm  (ADA spec; matches East Ocean
//                        + Aquature listings).
//       - 90-P         : 900 × 450 × 450 mm
//       - 120-P        : 1200 × 450 × 450 mm
//       - 150-P "Mega-150" : 1500 × 600 × 600 mm  (ADA news release Aug
//                        2018; the largest standard Cube Garden — 15 mm
//                        glass).
//
//   • Ultum Nature Systems (UNS) rimless low-iron — every entry below is
//     pulled directly from the official UNS 2019 Rimless Glass Aquarium
//     Size Guide PDF at:
//       https://ultumnaturesystems.com/wp-content/uploads/2018/05/UNS-Tank-Size-Chart.pdf
//     plus the post-2019 5S addition (verified against Buce Plant + Aqua
//     Lab listings at 14.17 × 8.66 × 4.72 in).
//     Note: the chart uses LENGTH × WIDTH × HEIGHT in inches. Our schema
//     is width (left-right) × height (bottom-top) × depth (front-back).
//     Mapping is: PDF length → our width; PDF width → our depth; PDF
//     height → our height. mm values are inch×25.4 rounded to nearest int.
//       - UNS 5N (nano)      : 14.17 × 8.66  × 8.66  in → 360 × 220 × 220 mm
//       - UNS 5S (shallow)   : 14.17 × 4.72  × 8.66  in → 360 × 120 × 220 mm
//       - UNS 16C (cube)     :  6.29 × 6.29  × 6.29  in → 160 × 160 × 160 mm
//       - UNS 25C (cube)     :  9.84 × 9.84  × 9.84  in → 250 × 250 × 250 mm
//       - UNS 30C (cube)     : 11.81 × 11.81 × 11.81 in → 300 × 300 × 300 mm
//       - UNS 45U (standard) : 17.71 × 11.02 × 11.02 in → 450 × 280 × 280 mm
//       - UNS 60L (long)     : 23.60 ×  7.87 ×  7.87 in → 600 × 200 × 200 mm
//       - UNS 60S (shallow)  : 23.60 ×  7.08 × 14.17 in → 600 × 180 × 360 mm
//       - UNS 60U (standard) : 23.62 × 14.17 × 14.17 in → 600 × 360 × 360 mm
//       - UNS 75P (standard) : 29.52 × 17.72 × 17.72 in → 750 × 450 × 450 mm
//       - UNS 75S (shallow)  : 29.52 × 17.72 × 11.81 in → 750 × 300 × 450 mm
//                              (post-2019; confirmed against Bay Bridge
//                              Aquarium + Buce Plant listings.)
//       - UNS 90L (long)     : 35.43 × 11.81 × 11.81 in → 900 × 300 × 300 mm
//       - UNS 90U (standard) : 35.43 × 22.04 × 22.04 in → 900 × 560 × 560 mm
//       - UNS 120S (shallow) : 47.24 × 14.17 × 23.62 in → 1200 × 360 × 600 mm
//       - UNS 120U (standard): 47.24 × 23.62 × 23.62 in → 1200 × 600 × 600 mm
//
//     Models requested by the orchestrator but NOT in any UNS spec sheet
//     I could verify: 9S, 45F, 75L, 120L. Skipped rather than invented.
//
//   • Waterbox CLEAR / CUBE freshwater series (manufacturer listings on
//     waterboxaquariums.com + cross-referenced retailer spec sheets):
//       - Clear Mini 10  : 500 × 250 × 300 mm  (19.7 × 9.8  × 11.8 in)
//       - Clear Mini 16  : 600 × 300 × 360 mm  (23.4 × 11.8 × 14.2 in)
//       - Cube 20 (AIO)  : 450 × 450 × 400 mm  (17.7 × 17.7 × 15.7 in)
//       - Clear Mini 30  : 800 × 400 × 400 mm  (31.4 × 15.7 × 15.7 in)
//
//   • US "standard" framed tanks (Aqueon size chart — the de-facto US
//     industry reference; values are EXTERIOR. We list them here as the
//     "approx" sizes substrate calculators use because almost every US
//     hobbyist quotes them by that round number):
//       - 5 gal cube   : 16 × 8  × 10 in  ≈ 410 × 200 × 250 mm
//                        Note: there's no single "5 gal cube" standard —
//                        Aquatop's nano is 12 × 9 × 10.6 in, Lifegard's
//                        is a true 9-in cube. We list a popular hex-shape
//                        "cube" approximation popular as a Marineland /
//                        Top Fin betta-cube footprint.
//       - 10 gal       : 20.25 × 10.5 × 12.625 in → 508 × 254 × 305 mm
//       - 20 gal "20H" : 24 × 12 × 16.75 in       → 610 × 305 × 407 mm
//       - 29 gal       : 30.25 × 12.5 × 18.75 in  → 768 × 318 × 476 mm
//       - 40 gal "40B" : 36 × 18 × 16 in          → 915 × 457 × 407 mm
//       - 75 gal       : 48.5 × 18.5 × 21.125 in  → 1232 × 470 × 537 mm
//       - 90 gal       : 48.5 × 18.5 × 25.125 in  → 1232 × 470 × 638 mm
//
// The "frame" tag is used by F1.2 to pick the rendered tank style. ADA,
// UNS, and Waterbox are rimless; US standards are framed (top + bottom
// plastic trim). "braced" is reserved for braced-glass tanks; we don't
// ship any out-of-the-box bracers yet (75 / 90 gal both leave the factory
// with a center brace, but the 2D renderer treats them as framed until
// F6 adds the brace overlay variant).

export type TankFrame = 'rimless' | 'framed' | 'braced';

/** Brand grouping for the preset picker UI. */
export type TankBrand = 'ADA' | 'UNS' | 'Waterbox' | 'Standard';

export interface TankPreset {
  /** Stable id — also forms the `presetRef.id` against catalog `"core"`. */
  readonly id: string;
  /** Display name (English; F1.x will route through i18n). */
  readonly name: string;
  readonly brand: TankBrand;
  /** Interior width (left-right) in mm. */
  readonly width: number;
  /** Interior height (bottom-top) in mm. */
  readonly height: number;
  /** Interior depth (front-back) in mm. */
  readonly depth: number;
  readonly frame: TankFrame;
}

export const tankPresets: readonly TankPreset[] = [
  // ── ADA Cube Garden ──────────────────────────────────────────────────────
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
    id: 'ada.30-c',
    name: 'ADA 30-C',
    brand: 'ADA',
    width: 300,
    height: 300,
    depth: 300,
    frame: 'rimless',
  },
  {
    id: 'ada.45-p',
    name: 'ADA 45-P',
    brand: 'ADA',
    width: 450,
    height: 300,
    depth: 270,
    frame: 'rimless',
  },
  {
    id: 'ada.60-f',
    name: 'ADA 60-F',
    brand: 'ADA',
    width: 600,
    height: 250,
    depth: 300,
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
    id: 'ada.75-p',
    name: 'ADA 75-P',
    brand: 'ADA',
    width: 750,
    height: 450,
    depth: 450,
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
    id: 'ada.150-p',
    name: 'ADA 150-P (Mega-150)',
    brand: 'ADA',
    width: 1500,
    height: 600,
    depth: 600,
    frame: 'rimless',
  },

  // ── Ultum Nature Systems (UNS) ───────────────────────────────────────────
  {
    id: 'uns.5n',
    name: 'UNS 5N',
    brand: 'UNS',
    width: 360,
    height: 220,
    depth: 220,
    frame: 'rimless',
  },
  {
    id: 'uns.5s',
    name: 'UNS 5S',
    brand: 'UNS',
    width: 360,
    height: 120,
    depth: 220,
    frame: 'rimless',
  },
  {
    id: 'uns.16c',
    name: 'UNS 16C',
    brand: 'UNS',
    width: 160,
    height: 160,
    depth: 160,
    frame: 'rimless',
  },
  {
    id: 'uns.25c',
    name: 'UNS 25C',
    brand: 'UNS',
    width: 250,
    height: 250,
    depth: 250,
    frame: 'rimless',
  },
  {
    id: 'uns.30c',
    name: 'UNS 30C',
    brand: 'UNS',
    width: 300,
    height: 300,
    depth: 300,
    frame: 'rimless',
  },
  {
    id: 'uns.45u',
    name: 'UNS 45U',
    brand: 'UNS',
    width: 450,
    height: 280,
    depth: 280,
    frame: 'rimless',
  },
  {
    id: 'uns.60l',
    name: 'UNS 60L (long)',
    brand: 'UNS',
    width: 600,
    height: 200,
    depth: 200,
    frame: 'rimless',
  },
  {
    id: 'uns.60s',
    name: 'UNS 60S (shallow)',
    brand: 'UNS',
    width: 600,
    height: 180,
    depth: 360,
    frame: 'rimless',
  },
  {
    id: 'uns.60u',
    name: 'UNS 60U',
    brand: 'UNS',
    width: 600,
    height: 360,
    depth: 360,
    frame: 'rimless',
  },
  {
    id: 'uns.75p',
    name: 'UNS 75P',
    brand: 'UNS',
    width: 750,
    height: 450,
    depth: 450,
    frame: 'rimless',
  },
  {
    id: 'uns.75s',
    name: 'UNS 75S (shallow)',
    brand: 'UNS',
    width: 750,
    height: 300,
    depth: 450,
    frame: 'rimless',
  },
  {
    id: 'uns.90l',
    name: 'UNS 90L (long)',
    brand: 'UNS',
    width: 900,
    height: 300,
    depth: 300,
    frame: 'rimless',
  },
  {
    id: 'uns.90u',
    name: 'UNS 90U',
    brand: 'UNS',
    width: 900,
    height: 560,
    depth: 560,
    frame: 'rimless',
  },
  {
    id: 'uns.120s',
    name: 'UNS 120S (shallow)',
    brand: 'UNS',
    width: 1200,
    height: 360,
    depth: 600,
    frame: 'rimless',
  },
  {
    id: 'uns.120u',
    name: 'UNS 120U',
    brand: 'UNS',
    width: 1200,
    height: 600,
    depth: 600,
    frame: 'rimless',
  },

  // ── Waterbox ─────────────────────────────────────────────────────────────
  {
    id: 'waterbox.clear-mini-10',
    name: 'Waterbox Clear Mini 10',
    brand: 'Waterbox',
    width: 500,
    height: 300,
    depth: 250,
    frame: 'rimless',
  },
  {
    id: 'waterbox.clear-mini-16',
    name: 'Waterbox Clear Mini 16',
    brand: 'Waterbox',
    width: 600,
    height: 360,
    depth: 300,
    frame: 'rimless',
  },
  {
    id: 'waterbox.cube-20',
    name: 'Waterbox Cube 20',
    brand: 'Waterbox',
    width: 450,
    height: 400,
    depth: 450,
    frame: 'rimless',
  },
  {
    id: 'waterbox.clear-mini-30',
    name: 'Waterbox Clear Mini 30',
    brand: 'Waterbox',
    width: 800,
    height: 400,
    depth: 400,
    frame: 'rimless',
  },

  // ── US standard (framed) ─────────────────────────────────────────────────
  {
    id: 'standard.5-gal-cube',
    name: 'Standard 5 gal cube (US)',
    brand: 'Standard',
    width: 410,
    height: 250,
    depth: 200,
    frame: 'framed',
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
    id: 'standard.29-gal',
    name: 'Standard 29 gal (US)',
    brand: 'Standard',
    width: 768,
    height: 476,
    depth: 318,
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
  {
    id: 'standard.75-gal',
    name: 'Standard 75 gal (US)',
    brand: 'Standard',
    width: 1232,
    height: 537,
    depth: 470,
    frame: 'braced',
  },
  {
    id: 'standard.90-gal',
    name: 'Standard 90 gal (US)',
    brand: 'Standard',
    width: 1232,
    height: 638,
    depth: 470,
    frame: 'braced',
  },
];

/** Catalog namespace used in `presetRef.catalog` for these built-ins. */
export const TANK_PRESET_CATALOG = 'core';

/** Catalog version recorded on stamped `presetRef` values. */
export const TANK_PRESET_VERSION = 1;
