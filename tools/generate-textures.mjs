#!/usr/bin/env node
/**
 * generate-textures.mjs — deterministic procedural PBR texture baker.
 *
 * Bakes 9 texture families x 3 maps (albedo / normal / roughness) = 27 PNGs
 * into libs/domain/catalog/assets/textures/. Pure math -> PNG via sharp;
 * no network, no licensed assets, no Math.random(), no Date.
 *
 *   node tools/generate-textures.mjs            # bake + verify + write
 *   node tools/generate-textures.mjs --sheet    # also write a 3x3 albedo
 *                                               # contact sheet to
 *                                               # /tmp/texture-sheet.png
 *
 * Pipeline per family (all noise is PERIODIC so every map tiles seamlessly):
 *   1. height field: multi-octave fBm of seeded value noise on a lattice with
 *      modular wrap (+ family-specific structure: strata bands, Worley cells,
 *      anisotropic grain, vein ridges).
 *   2. albedo  = colour ramp over height + low-frequency tint octave.
 *      Moderate contrast: the renderer MULTIPLIES these over authored catalog
 *      colours, so they modulate rather than fight.
 *   3. normal  = central differences of the height field (wrapped), encoded
 *      as RGB tangent-space (neutral = 128,128,255).
 *   4. roughness = per-family base level + inverted height detail. Written as
 *      a SINGLE-CHANNEL grayscale PNG (three.js reads the green channel of a
 *      roughnessMap; grayscale decodes to R=G=B, and 1 channel is smaller).
 *
 * Determinism: splitmix32 PRNG (Steele et al. SplitMix adapted to 32-bit;
 * the well-known JS variant), one fixed seed per family. The script bakes
 * every raw pixel buffer TWICE from scratch and asserts byte-identity, and
 * encodes each PNG twice and asserts byte-identity, before writing anything.
 * Cross-platform PNG byte-identity additionally depends on the sharp/libvips
 * version — the committed files are the source of truth; this script is the
 * regeneration path.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'libs', 'domain', 'catalog', 'assets', 'textures');
const SHEET_PATH = '/tmp/texture-sheet.png';

/** Texture edge size in pixels. All lattice frequencies are integers, so the
 *  noise is periodic with period SIZE in both axes => seamless tiling. */
const SIZE = 256;

// ---------------------------------------------------------------------------
// PRNG — splitmix32. Cited variant: 32-bit SplitMix (Steele/Lea/Flood
// "Fast splittable pseudorandom number generators", adapted for JS by
// bryc/code — https://github.com/bryc/code/blob/master/jshash/PRNGs.md).
// ---------------------------------------------------------------------------
function splitmix32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/** Stable integer hash -> [0,1) for per-cell variation (no PRNG state). */
function hash01(n) {
  let t = (n + 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
  t = (t ^ (t >>> 15)) >>> 0;
  t = Math.imul(t ^ (t >>> 7), 0x735a2d97);
  return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Periodic noise primitives
// ---------------------------------------------------------------------------
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10); // quintic
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Value noise on a px-by-py lattice with modular wrap. Sample coords are in
 *  LATTICE units; u=px maps exactly onto u=0, so it tiles by construction. */
function makeValueNoise(rng, px, py) {
  const grid = new Float64Array(px * py);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  return (u, v) => {
    let iu = Math.floor(u);
    let iv = Math.floor(v);
    const fu = fade(u - iu);
    const fv = fade(v - iv);
    iu = ((iu % px) + px) % px;
    iv = ((iv % py) + py) % py;
    const iu1 = (iu + 1) % px;
    const iv1 = (iv + 1) % py;
    const r0 = lerp(grid[iv * px + iu], grid[iv * px + iu1], fu);
    const r1 = lerp(grid[iv1 * px + iu], grid[iv1 * px + iu1], fu);
    return lerp(r0, r1, fv);
  };
}

/**
 * Periodic fBm. fx/fy are integer base frequencies (lattice cells per tile);
 * lacunarity 2 keeps every octave's frequency an integer => seamless.
 * Returns a sampler over PIXEL coords (0..SIZE), output roughly [0,1].
 */
function makeFbm(rng, { fx, fy, octaves, persistence = 0.5 }) {
  const layers = [];
  let ax = fx;
  let ay = fy;
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push({ noise: makeValueNoise(rng, ax, ay), fx: ax, fy: ay, amp });
    total += amp;
    amp *= persistence;
    ax *= 2;
    ay *= 2;
  }
  return (x, y) => {
    let s = 0;
    for (const L of layers) s += L.amp * L.noise((x / SIZE) * L.fx, (y / SIZE) * L.fy);
    return s / total;
  };
}

/**
 * Periodic Worley/cellular noise: one jittered feature point per cell on a
 * c-by-c grid, torus distance metric. Returns { f1, id } where f1 is the
 * distance to the nearest feature point in CELL units and id identifies the
 * (wrapped) owning cell — used for per-pebble / per-granule albedo variation.
 */
function makeWorley(rng, c) {
  const pts = new Float64Array(c * c * 2);
  for (let j = 0; j < c; j++) {
    for (let i = 0; i < c; i++) {
      pts[2 * (j * c + i)] = rng();
      pts[2 * (j * c + i) + 1] = rng();
    }
  }
  return (x, y) => {
    const u = (x / SIZE) * c;
    const v = (y / SIZE) * c;
    const ci = Math.floor(u);
    const cj = Math.floor(v);
    let f1 = Infinity;
    let id = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const wi = (((ci + di) % c) + c) % c;
        const wj = (((cj + dj) % c) + c) % c;
        const px = ci + di + pts[2 * (wj * c + wi)];
        const py = cj + dj + pts[2 * (wj * c + wi) + 1];
        const d = Math.hypot(u - px, v - py);
        if (d < f1) {
          f1 = d;
          id = wj * c + wi;
        }
      }
    }
    return { f1, id };
  };
}

const ridge = (n) => 1 - Math.abs(2 * n - 1); // sharp crease at n=0.5

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** Piecewise-linear colour ramp over h in [0,1]. stops: [[pos, '#rrggbb'], …] */
function makeRamp(stops) {
  const parsed = stops.map(([p, c]) => [p, hex(c)]);
  return (h) => {
    if (h <= parsed[0][0]) return parsed[0][1];
    for (let i = 1; i < parsed.length; i++) {
      if (h <= parsed[i][0]) {
        const t = (h - parsed[i - 1][0]) / (parsed[i][0] - parsed[i - 1][0]);
        const a = parsed[i - 1][1];
        const b = parsed[i][1];
        return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
      }
    }
    return parsed[parsed.length - 1][1];
  };
}

const luminance01 = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// ---------------------------------------------------------------------------
// Family definitions — every tunable is a named constant in the spec object.
//
//   seed            fixed PRNG seed (never change once textures ship)
//   make(rng)       returns { heightAt(x,y) -> [0,1],
//                             albedoAt?(x,y,h) -> [r,g,b]  (full override),
//                             tintAt?(x,y) -> scalar [-1,1] luminance drift }
//   ramp            albedo colour ramp over height (when no albedoAt)
//   tintAmount      strength of the low-frequency tint octave
//   normalStrength  slope multiplier for the normal map
//   roughBase/Amp   roughness = clamp01(roughBase + roughAmp * (0.5 - h))
//   meanLum         [lo, hi] sanity window for mean albedo luminance
// ---------------------------------------------------------------------------
const FAMILIES = {
  // Cool gray seiryu-like stone with darker diagonal strata.
  'stone-gray': {
    seed: 0x5347a001,
    ramp: makeRamp([
      [0.0, '#4e545c'],
      [0.45, '#7a8088'],
      [0.78, '#959ba3'],
      [1.0, '#aab0b8'],
    ]),
    tintAmount: 0.06,
    normalStrength: 34,
    roughBase: 0.74,
    roughAmp: 0.28,
    meanLum: [0.42, 0.56],
    make(rng) {
      const fbm = makeFbm(rng, { fx: 5, fy: 5, octaves: 6, persistence: 0.62 });
      const warp = makeFbm(rng, { fx: 2, fy: 2, octaves: 3, persistence: 0.5 });
      const tint = makeFbm(rng, { fx: 2, fy: 2, octaves: 2 });
      const BAND_X = 1; // integer strata cycles per tile (tiles seamlessly)
      const BAND_Y = 4; // mostly-horizontal diagonal layering
      const BAND_WARP = 0.7;
      const STRATA_SHARP = 5; // pow() exponent: narrows bands into strata lines
      const STRATA_DEPTH = 0.3;
      return {
        heightAt(x, y) {
          // Diagonal layering: integer cycle counts on both axes keep it periodic.
          const phase = (BAND_X * x + BAND_Y * y) / SIZE + BAND_WARP * warp(x, y);
          const band = 0.5 + 0.5 * Math.sin(2 * Math.PI * phase);
          const strata = Math.pow(band, STRATA_SHARP); // narrow recessed seams
          return clamp01(0.16 + 0.78 * fbm(x, y) - STRATA_DEPTH * strata);
        },
        tintAt: (x, y) => 2 * tint(x, y) - 1,
      };
    },
  },

  // Tan/brown stone with cellular pitting (pores recessed + darkened).
  'stone-warm': {
    seed: 0x5347a002,
    ramp: makeRamp([
      [0.0, '#5e4a36'],
      [0.4, '#8a7052'],
      [0.75, '#ab8e6c'],
      [1.0, '#c4a98a'],
    ]),
    tintAmount: 0.08,
    normalStrength: 34,
    roughBase: 0.72,
    roughAmp: 0.3,
    meanLum: [0.42, 0.58],
    make(rng) {
      const fbm = makeFbm(rng, { fx: 5, fy: 5, octaves: 5, persistence: 0.55 });
      const pores = makeWorley(rng, 26);
      const tint = makeFbm(rng, { fx: 2, fy: 2, octaves: 2 });
      const PORE_R_MIN = 0.1; // per-cell radius range, in cell units
      const PORE_R_MAX = 0.42;
      const PORE_SKIP = 0.3; // fraction of cells with no pore (density variation)
      const PORE_DEPTH = 0.36;
      return {
        heightAt(x, y) {
          const { f1, id } = pores(x, y);
          const hasPore = hash01(id ^ 0x9e37) > PORE_SKIP;
          const radius = PORE_R_MIN + (PORE_R_MAX - PORE_R_MIN) * hash01(id);
          const pit = hasPore ? smoothstep(radius, 0, f1) : 0;
          return clamp01(0.22 + 0.78 * fbm(x, y) - PORE_DEPTH * pit);
        },
        tintAt: (x, y) => 2 * tint(x, y) - 1,
      };
    },
  },

  // Very dark basalt; fine vesicular speckle, LOW albedo variance (no sparkle).
  'stone-dark': {
    seed: 0x5347a003,
    ramp: makeRamp([
      [0.0, '#303234'],
      [0.5, '#46494c'],
      [1.0, '#595d61'],
    ]),
    tintAmount: 0.04,
    normalStrength: 26,
    roughBase: 0.86,
    roughAmp: 0.14,
    meanLum: [0.22, 0.36],
    make(rng) {
      const fbm = makeFbm(rng, { fx: 8, fy: 8, octaves: 5, persistence: 0.5 });
      const vesicles = makeWorley(rng, 46);
      const tint = makeFbm(rng, { fx: 2, fy: 2, octaves: 2 });
      const VESICLE_RADIUS = 0.22;
      const VESICLE_DEPTH = 0.3;
      return {
        heightAt(x, y) {
          const pit = smoothstep(VESICLE_RADIUS, 0, vesicles(x, y).f1);
          return clamp01(0.2 + 0.8 * fbm(x, y) - VESICLE_DEPTH * pit);
        },
        tintAt: (x, y) => 2 * tint(x, y) - 1,
      };
    },
  },

  // Brown bark with strong anisotropic grain (domain stretched ~5x along x).
  'wood-bark': {
    seed: 0x5347a004,
    ramp: makeRamp([
      [0.0, '#3e2c1e'],
      [0.4, '#5e452f'],
      [0.75, '#7c5e42'],
      [1.0, '#967454'],
    ]),
    tintAmount: 0.09,
    normalStrength: 40,
    roughBase: 0.78,
    roughAmp: 0.22,
    meanLum: [0.3, 0.44],
    make(rng) {
      // Grain runs along x: low frequency along x, high across (y) => 5–6x stretch.
      const grain = makeFbm(rng, { fx: 3, fy: 18, octaves: 4, persistence: 0.55 });
      const ridges = makeFbm(rng, { fx: 2, fy: 12, octaves: 3, persistence: 0.6 });
      const fine = makeFbm(rng, { fx: 10, fy: 48, octaves: 2, persistence: 0.5 });
      const tint = makeFbm(rng, { fx: 2, fy: 2, octaves: 2 });
      const FISSURE_SHARP = 3; // pow() exponent: narrows creases into fissures
      const FISSURE_DEPTH = 0.5;
      return {
        heightAt(x, y) {
          // Narrow dark fissures along the (x-elongated) contour lines of the
          // ridge noise; plateaus between them carry the grain detail.
          const fissure = Math.pow(ridge(ridges(x, y)), FISSURE_SHARP);
          return clamp01(
            0.44 + 0.42 * grain(x, y) + 0.18 * fine(x, y) - FISSURE_DEPTH * fissure,
          );
        },
        tintAt: (x, y) => 2 * tint(x, y) - 1,
      };
    },
  },

  // Dark brown packed-soil-granule look (aquasoil balls).
  'soil-dark': {
    seed: 0x5347a005,
    tintAmount: 0,
    normalStrength: 6,
    roughBase: 0.84,
    roughAmp: 0.16,
    meanLum: [0.16, 0.3],
    make(rng) {
      const granules = makeWorley(rng, 38);
      const fbm = makeFbm(rng, { fx: 16, fy: 16, octaves: 3, persistence: 0.5 });
      const tint = makeFbm(rng, { fx: 2, fy: 2, octaves: 2 });
      const ramp = makeRamp([
        [0.0, '#1d150e'],
        [0.45, '#3a2c1d'],
        [0.8, '#4e3c28'],
        [1.0, '#5a4630'],
      ]);
      const DOME_EDGE = 0.78; // granule radius in cell units
      const GRANULE_TINT = 0.16; // per-granule luminance variation
      return {
        heightAt(x, y) {
          const { f1 } = granules(x, y);
          const dome = smoothstep(DOME_EDGE, 0.08, f1); // rounded ball per cell
          return clamp01(0.7 * dome + 0.3 * fbm(x, y));
        },
        albedoAt(x, y, h) {
          const { id } = granules(x, y);
          const per = 1 + GRANULE_TINT * (2 * hash01(id) - 1);
          const t = 1 + 0.1 * (2 * tint(x, y) - 1);
          const [r, g, b] = ramp(h);
          return [r * per * t, g * per * t, b * per * t];
        },
      };
    },
  },

  // Pale beige sand: very fine high-frequency speckle, LOW contrast.
  'sand-fine': {
    seed: 0x5347a006,
    ramp: makeRamp([
      [0.0, '#9c8c6a'],
      [0.5, '#b8a787'],
      [1.0, '#d0c2a3'],
    ]),
    tintAmount: 0.05,
    normalStrength: 14,
    roughBase: 0.94,
    roughAmp: 0.08,
    meanLum: [0.56, 0.7],
    make(rng) {
      const speckle = makeFbm(rng, { fx: 64, fy: 64, octaves: 2, persistence: 0.5 });
      const drift = makeFbm(rng, { fx: 4, fy: 4, octaves: 2 });
      const tint = makeFbm(rng, { fx: 2, fy: 2, octaves: 2 });
      const CONTRAST = 0.55; // compress around mid: low-contrast field
      return {
        heightAt(x, y) {
          const h = 0.75 * speckle(x, y) + 0.25 * drift(x, y);
          return clamp01(0.5 + CONTRAST * (h - 0.5));
        },
        tintAt: (x, y) => 2 * tint(x, y) - 1,
      };
    },
  },

  // Medium-scale rounded pebbles, per-pebble gray/tan/brown albedo mix.
  'gravel-mixed': {
    seed: 0x5347a007,
    tintAmount: 0,
    normalStrength: 18,
    roughBase: 0.7,
    roughAmp: 0.3,
    meanLum: [0.36, 0.52],
    make(rng) {
      const pebbles = makeWorley(rng, 12);
      const fbm = makeFbm(rng, { fx: 24, fy: 24, octaves: 3, persistence: 0.5 });
      const PEBBLE_EDGE = 0.92;
      const PALETTE = ['#8a8a86', '#a4937a', '#79634f', '#9c9c98', '#6e665c', '#b0a48c'].map(hex);
      const CREVICE_DARKEN = 0.55; // albedo *= lerp(CREVICE_DARKEN, 1, dome)
      return {
        heightAt(x, y) {
          const { f1 } = pebbles(x, y);
          const dome = smoothstep(PEBBLE_EDGE, 0.1, f1);
          return clamp01(0.78 * dome + 0.22 * fbm(x, y));
        },
        albedoAt(x, y) {
          const { f1, id } = pebbles(x, y);
          const dome = smoothstep(PEBBLE_EDGE, 0.1, f1);
          const base = PALETTE[Math.floor(hash01(id) * PALETTE.length) % PALETTE.length];
          const per = 1 + 0.12 * (2 * hash01(id ^ 0x5bd1) - 1);
          const shade = lerp(CREVICE_DARKEN, 1, dome) * (0.92 + 0.16 * fbm(x, y));
          return [base[0] * per * shade, base[1] * per * shade, base[2] * per * shade];
        },
      };
    },
  },

  // Mid-green fine parallel blade striations (anisotropic, tighter than bark).
  'leaf-fine': {
    seed: 0x5347a008,
    ramp: makeRamp([
      [0.0, '#33572b'],
      [0.45, '#4c7a3a'],
      [0.8, '#639349'],
      [1.0, '#74a458'],
    ]),
    tintAmount: 0.08,
    normalStrength: 12,
    roughBase: 0.55,
    roughAmp: 0.25,
    meanLum: [0.32, 0.48],
    make(rng) {
      // Blades run along y: low freq along y, high across x.
      const blades = makeFbm(rng, { fx: 28, fy: 3, octaves: 3, persistence: 0.55 });
      const warp = makeFbm(rng, { fx: 3, fy: 3, octaves: 2 });
      const tint = makeFbm(rng, { fx: 2, fy: 2, octaves: 2 });
      const STRIA_FREQ = 36; // integer stripe cycles across the tile
      const STRIA_WARP = 0.5;
      return {
        heightAt(x, y) {
          const phase = (STRIA_FREQ * x) / SIZE + STRIA_WARP * warp(x, y);
          const stripe = 0.5 + 0.5 * Math.sin(2 * Math.PI * phase);
          return clamp01(0.5 * blades(x, y) + 0.35 * stripe + 0.15 * warp(x, y));
        },
        tintAt: (x, y) => 2 * tint(x, y) - 1,
      };
    },
  },

  // Deeper green broad leaf: midrib + a few branching vein ridges + broad
  // luminance variation.
  'leaf-broad': {
    seed: 0x5347a009,
    ramp: makeRamp([
      [0.0, '#24461f'],
      [0.45, '#35602c'],
      [0.8, '#477a39'],
      [1.0, '#558a45'],
    ]),
    tintAmount: 0.14,
    normalStrength: 22,
    roughBase: 0.5,
    roughAmp: 0.25,
    meanLum: [0.26, 0.42],
    make(rng) {
      const fbm = makeFbm(rng, { fx: 5, fy: 5, octaves: 4, persistence: 0.5 });
      const warp = makeFbm(rng, { fx: 2, fy: 2, octaves: 2 });
      const tint = makeFbm(rng, { fx: 2, fy: 2, octaves: 3, persistence: 0.65 });
      const MIDRIB_WIDTH = 9; // gaussian sigma in pixels
      const MIDRIB_HEIGHT = 0.5;
      // Side veins: smooth ridges along integer (a·x + b·y) directions — the
      // integer coefficients keep them periodic over the tile.
      const VEINS = [
        { a: 1, b: 3, phase: 0.13, sharp: 14, amp: 0.16 },
        { a: 1, b: -3, phase: 0.57, sharp: 14, amp: 0.16 },
        { a: 2, b: 5, phase: 0.31, sharp: 18, amp: 0.1 },
      ];
      return {
        heightAt(x, y) {
          // Midrib runs along y at x = SIZE/2 (symmetric => continuous at wrap).
          const dx = x - SIZE / 2;
          const rib = MIDRIB_HEIGHT * Math.exp(-(dx * dx) / (2 * MIDRIB_WIDTH * MIDRIB_WIDTH));
          let veins = 0;
          for (const v of VEINS) {
            const c = Math.cos(2 * Math.PI * ((v.a * x + v.b * y) / SIZE + v.phase + 0.3 * warp(x, y)));
            veins += v.amp * Math.pow(Math.max(0, c), v.sharp);
          }
          return clamp01(0.34 + 0.42 * fbm(x, y) + rib + veins);
        },
        tintAt: (x, y) => 2 * tint(x, y) - 1,
      };
    },
  },
};

const FAMILY_ORDER = [
  'stone-gray',
  'stone-warm',
  'stone-dark',
  'wood-bark',
  'soil-dark',
  'sand-fine',
  'gravel-mixed',
  'leaf-fine',
  'leaf-broad',
];

// ---------------------------------------------------------------------------
// Baking
// ---------------------------------------------------------------------------
const idx = (x, y) => y * SIZE + x;

function bakeFamily(name) {
  const spec = FAMILIES[name];
  const rng = splitmix32(spec.seed);
  const { heightAt, albedoAt, tintAt } = spec.make(rng);

  // --- seamless-tiling assertion: the height function evaluated one full
  // period away must reproduce the opposite edge exactly.
  for (let i = 0; i < SIZE; i += 1) {
    const dRow = Math.abs(heightAt(i, SIZE) - heightAt(i, 0));
    const dCol = Math.abs(heightAt(SIZE, i) - heightAt(0, i));
    if (dRow > 1e-9 || dCol > 1e-9) {
      throw new Error(`${name}: height field does not tile (i=${i}, dRow=${dRow}, dCol=${dCol})`);
    }
  }

  // --- height field
  const H = new Float64Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) H[idx(x, y)] = heightAt(x, y);

  // --- albedo (RGB)
  const albedo = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const h = H[idx(x, y)];
      let rgb;
      if (albedoAt) {
        rgb = albedoAt(x, y, h);
      } else {
        rgb = spec.ramp(h);
        if (tintAt && spec.tintAmount) {
          const t = 1 + spec.tintAmount * tintAt(x, y);
          rgb = [rgb[0] * t, rgb[1] * t, rgb[2] * t];
        }
      }
      const o = idx(x, y) * 3;
      albedo[o] = Math.round(clamp01(rgb[0] / 255) * 255);
      albedo[o + 1] = Math.round(clamp01(rgb[1] / 255) * 255);
      albedo[o + 2] = Math.round(clamp01(rgb[2] / 255) * 255);
    }
  }

  // --- normal (RGB tangent space; +y of the texture = -dh/dy convention)
  const normal = Buffer.alloc(SIZE * SIZE * 3);
  const s = spec.normalStrength;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dhdx = (H[idx((x + 1) % SIZE, y)] - H[idx((x + SIZE - 1) % SIZE, y)]) * 0.5;
      const dhdy = (H[idx(x, (y + 1) % SIZE)] - H[idx(x, (y + SIZE - 1) % SIZE)]) * 0.5;
      const nx = -dhdx * s;
      const ny = dhdy * s; // +Y up in tangent space (OpenGL convention)
      const inv = 1 / Math.hypot(nx, ny, 1);
      const o = idx(x, y) * 3;
      normal[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
    }
  }

  // --- roughness (single channel)
  const rough = Buffer.alloc(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    rough[i] = Math.round(clamp01(spec.roughBase + spec.roughAmp * (0.5 - H[i])) * 255);
  }

  return { albedo, normal, rough };
}

// ---------------------------------------------------------------------------
// Sanity checks
// ---------------------------------------------------------------------------
function meanChannels(buf, channels) {
  const sums = new Float64Array(channels);
  for (let i = 0; i < buf.length; i += channels) for (let c = 0; c < channels; c++) sums[c] += buf[i + c];
  const n = buf.length / channels;
  return Array.from(sums, (v) => v / n);
}

function sanityCheck(name, maps) {
  const spec = FAMILIES[name];
  const report = {};

  const [ar, ag, ab] = meanChannels(maps.albedo, 3);
  const lum = luminance01(ar, ag, ab);
  report.albedoMean = [ar, ag, ab].map((v) => Math.round(v));
  report.meanLum = +lum.toFixed(3);
  if (lum < spec.meanLum[0] || lum > spec.meanLum[1]) {
    throw new Error(
      `${name}: mean albedo luminance ${lum.toFixed(3)} outside window [${spec.meanLum.join(', ')}]`,
    );
  }

  const [nr, ng, nb] = meanChannels(maps.normal, 3);
  report.normalMean = [nr, ng, nb].map((v) => Math.round(v));
  if (Math.abs(nr - 128) > 10 || Math.abs(ng - 128) > 10 || nb < 212 || nb > 252) {
    throw new Error(`${name}: normal mean (${nr.toFixed(1)}, ${ng.toFixed(1)}, ${nb.toFixed(1)}) outside (128±10, 128±10, 212–252)`);
  }

  const [rm] = meanChannels(maps.rough, 1);
  report.roughMean = +(rm / 255).toFixed(3);

  return report;
}

// ---------------------------------------------------------------------------
// Encoding + main
// ---------------------------------------------------------------------------
const PNG_OPTS = { compressionLevel: 9, adaptiveFiltering: true };

async function encodePng(raw, channels) {
  return sharp(raw, { raw: { width: SIZE, height: SIZE, channels } })
    .png(PNG_OPTS)
    .toBuffer();
}

async function main() {
  const wantSheet = process.argv.includes('--sheet');
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Baking ${FAMILY_ORDER.length} families × 3 maps at ${SIZE}×${SIZE} → ${OUT_DIR}`);

  const baked = new Map();
  let totalBytes = 0;

  for (const name of FAMILY_ORDER) {
    // Determinism: bake twice from scratch, raw buffers must be identical.
    const a = bakeFamily(name);
    const b = bakeFamily(name);
    for (const map of ['albedo', 'normal', 'rough']) {
      if (!a[map].equals(b[map])) throw new Error(`${name}: ${map} raw bake is non-deterministic`);
    }

    const report = sanityCheck(name, a);

    const files = [
      [`${name}.albedo.png`, a.albedo, 3],
      [`${name}.normal.png`, a.normal, 3],
      [`${name}.roughness.png`, a.rough, 1],
    ];
    const sizes = [];
    for (const [file, raw, channels] of files) {
      // Determinism: PNG encode twice, bytes must be identical.
      const png1 = await encodePng(raw, channels);
      const png2 = await encodePng(raw, channels);
      if (!png1.equals(png2)) throw new Error(`${name}: PNG encode of ${file} is non-deterministic`);
      await writeFile(join(OUT_DIR, file), png1);
      totalBytes += png1.length;
      sizes.push(`${file} ${(png1.length / 1024).toFixed(1)} KB`);
    }
    baked.set(name, a);

    console.log(
      `  ${name.padEnd(13)} lum=${report.meanLum} albedo=(${report.albedoMean.join(',')}) ` +
        `normal=(${report.normalMean.join(',')}) rough=${report.roughMean}\n` +
        `                ${sizes.join('  ')}`,
    );
  }

  console.log(`Total: ${FAMILY_ORDER.length * 3} PNGs, ${(totalBytes / 1024).toFixed(0)} KB`);

  if (wantSheet) {
    // 3×3 contact sheet of the albedo maps (row-major in FAMILY_ORDER).
    const composites = await Promise.all(
      FAMILY_ORDER.map(async (name, i) => ({
        input: await encodePng(baked.get(name).albedo, 3),
        left: (i % 3) * SIZE,
        top: Math.floor(i / 3) * SIZE,
      })),
    );
    await sharp({
      create: { width: SIZE * 3, height: SIZE * 3, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite(composites)
      .png()
      .toFile(SHEET_PATH);
    console.log(`Contact sheet (albedo, row-major: ${FAMILY_ORDER.join(', ')}) → ${SHEET_PATH}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
