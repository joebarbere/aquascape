// Per-group behaviour presets for F11.2 + F11.3 + F11.4.
//
// Three named constants (no lookup table) — tree-shakable + obviously
// deterministic. F11.6 will refine the per-species presets; F11.2 just needs
// these three groups to read distinctly on screen.
//
// F11.3 added `territory`, `nipping`, `fear` to `ResolvedBehavior`. Territory
// + nipping stay null on every preset — they are species-specific, assigned
// by the heuristics in `resolve.ts`, not by depth band. Fear is required and
// varies per band: bottom dwellers are skittish (low threshold, long
// emergence delay), top dwellers are bold.
//
// F11.4 added `feeding`, `curiosity`. Both are required on every preset.
// Feeding category tracks the depth band (top → 'surface',
// mid → 'midwater', bottom → 'substrate'); the species heuristic in
// `resolve.ts` upgrades algae-grazers / plant-eaters / detritivores when an
// id or group matches. Curiosity boldness scales by band — top species are
// boldest (glass-surf often), bottom species are focused on the substrate.

import type { ResolvedBehavior } from './params';

// Couzin et al. 2002 typical blind-cone arc (~45° total behind the fish).
const BLIND_ANGLE = 0.25 * Math.PI;
// Carangiform amplitude envelope — matches the F11.1 vertex-shader default.
const ENVELOPE_EXP = 2.5;

/** Default preset for a fish that swims near the surface (hatchetfish, gourami). */
export const TOP_PRESET: ResolvedBehavior = {
  schooling: {
    ZOR: 15,
    ZOO: 40,
    ZOA: 100,
    blindAngle: BLIND_ANGLE,
    vPref: 40,
    vMax: 120,
    turnMax: 1.5,
    wSep: 2.0,
    wAli: 0.5,
    wCoh: 0.5,
    noise: 0.08,
  },
  depth: {
    preferredY: 0.92,
    bandWidth: 0.06,
    returnForce: 180,
  },
  animation: {
    tailBeatFreq: 5.0,
    ampHead: 0.015,
    ampTail: 0.10,
    envelopeExp: ENVELOPE_EXP,
  },
  territory: null,
  nipping: null,
  fear: {
    riskBaseline: 0.05,
    threshold: 0.6,
    coverPreference: 'plants',
    emergenceDelay: 5,
  },
  feeding: {
    hungerRatePerSec: 1 / 120,
    threshold: 0.7,
    category: 'surface',
  },
  curiosity: {
    boldness: 0.7,
    ratePerSec: 0.06,
    dwellSec: 4,
  },
};

/** Default preset for a mid-water schooler (tetra, rasbora, danio, barb). */
export const MID_PRESET: ResolvedBehavior = {
  schooling: {
    ZOR: 12,
    ZOO: 35,
    ZOA: 90,
    blindAngle: BLIND_ANGLE,
    vPref: 55,
    vMax: 140,
    turnMax: 2.0,
    wSep: 1.5,
    wAli: 1.5,
    wCoh: 1.0,
    noise: 0.05,
  },
  depth: {
    preferredY: 0.55,
    bandWidth: 0.25,
    returnForce: 60,
  },
  animation: {
    tailBeatFreq: 4.5,
    ampHead: 0.02,
    ampTail: 0.12,
    envelopeExp: ENVELOPE_EXP,
  },
  territory: null,
  nipping: null,
  fear: {
    riskBaseline: 0.08,
    threshold: 0.5,
    coverPreference: 'plants',
    emergenceDelay: 4,
  },
  feeding: {
    hungerRatePerSec: 1 / 120,
    threshold: 0.7,
    category: 'midwater',
  },
  curiosity: {
    boldness: 0.5,
    ratePerSec: 0.05,
    dwellSec: 3,
  },
};

/** Default preset for a substrate-hugger (cory, kuhli, pleco, oto). */
export const BOTTOM_PRESET: ResolvedBehavior = {
  schooling: {
    ZOR: 20,
    ZOO: 40,
    ZOA: 80,
    blindAngle: BLIND_ANGLE,
    vPref: 30,
    vMax: 110,
    turnMax: 1.2,
    wSep: 2.0,
    wAli: 0.3,
    wCoh: 0.7,
    noise: 0.10,
  },
  depth: {
    preferredY: 0.05,
    bandWidth: 0.04,
    returnForce: 220,
  },
  animation: {
    tailBeatFreq: 3.5,
    ampHead: 0.025,
    ampTail: 0.09,
    envelopeExp: ENVELOPE_EXP,
  },
  territory: null,
  nipping: null,
  fear: {
    riskBaseline: 0.15,
    threshold: 0.4,
    coverPreference: 'wood',
    emergenceDelay: 8,
  },
  feeding: {
    hungerRatePerSec: 1 / 180,
    threshold: 0.7,
    category: 'substrate',
  },
  curiosity: {
    boldness: 0.2,
    ratePerSec: 0.02,
    dwellSec: 2,
  },
};
