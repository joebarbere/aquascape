/**
 * Scenic gradient backdrop — 3D-fidelity follow-ups, Bucket 3.
 *
 * The old flat background `Color` (0x1a2030) read as a void behind the tank.
 * This builder replaces it with a small equirectangular `DataTexture`
 * vertical gradient styled like a softly lit room behind the tank: a darker
 * floor band at the bottom, the familiar `0x1a2030`-family tone through the
 * mid band, and a lighter upper band. With `EquirectangularReflectionMapping`
 * the texture reads as a gradient sky-sphere when assigned to
 * `Scene.background`, so orbiting the camera shows a subtle vertical ramp
 * instead of one unmoving flat colour.
 *
 * DAY-NIGHT TINTING
 * -----------------
 * `fillBackdropData` multiplies every gradient stop by a tint (the day-night
 * `backgroundTint`, hex `#RRGGBB`), so noon (near-white tint) and midnight
 * (near-black tint) backdrops differ strongly — the e2e day-night scrub test
 * asserts > 5000 px difference between the two, and the backdrop is most of
 * the visible background. The renderer keeps ONE cached texture and rewrites
 * its pixel data in place (`updateBackdropTint`) when the effective tint
 * changes — per render, never per frame; the texture is a few KB.
 *
 * Pure + GL-free: `DataTexture` construction needs no WebGL context, so the
 * backdrop works under the headless unit-test stub renderer too (it is
 * deliberately NOT hidden behind the `instanceof WebGLRenderer` guard the
 * PMREM environment needs). Deterministic — same tint, same bytes; no RNG.
 */

import {
  DataTexture,
  EquirectangularReflectionMapping,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';

/** Equirect width — azimuth is constant, so a thin strip suffices. */
const BACKDROP_WIDTH = 8;
/** Equirect height — the vertical-ramp resolution. */
const BACKDROP_HEIGHT = 64;

/**
 * sRGB gradient stops (bottom pole → top pole), chosen to harmonise with the
 * old `0x1a2030` flat background so the default (white-tint) look stays in
 * the same dark blue-grey family:
 *  - floor: darker than the old flat colour (the room's floor in shadow),
 *  - mid:   the `0x1a2030` tone itself (r 26, g 32, b 48),
 *  - upper: a lighter blue-grey band (soft room light above the tank).
 */
const FLOOR_BOTTOM: [number, number, number] = [12, 15, 22];
const MID_BAND: [number, number, number] = [26, 32, 48];
const UPPER_BAND: [number, number, number] = [64, 78, 108];

/**
 * Where the floor→mid segment hands over to the mid→upper segment, as a
 * fraction of texture height from the bottom. Below the horizon the ramp is
 * compressed (floor reads as a band, not half the sphere).
 */
const HORIZON_V = 0.4;

/**
 * Parse a `#RRGGBB` hex tint into `[r, g, b]` in `[0, 1]`. Defensive:
 * malformed input falls back to white (no-op tint) rather than throwing —
 * the backdrop must never take the render loop down over a bad lookup row.
 */
function parseTint(tintHex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(tintHex.trim());
  if (match === null) return [1, 1, 1];
  const v = parseInt(match[1]!, 16);
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * Fill `data` (RGBA, `BACKDROP_WIDTH × BACKDROP_HEIGHT`) with the gradient
 * multiplied per-channel by `tintHex`. Row 0 is the bottom of the texture
 * (floor) and the last row the top (upper band) — matching `DataTexture`'s
 * bottom-up row order so the bright band maps to the upper hemisphere.
 * Pure: same tint → same bytes.
 */
function fillBackdropData(data: Uint8Array, tintHex: string): void {
  const [tr, tg, tb] = parseTint(tintHex);
  for (let y = 0; y < BACKDROP_HEIGHT; y++) {
    const v = y / (BACKDROP_HEIGHT - 1);
    const stop =
      v < HORIZON_V
        ? lerp3(FLOOR_BOTTOM, MID_BAND, v / HORIZON_V)
        : lerp3(MID_BAND, UPPER_BAND, (v - HORIZON_V) / (1 - HORIZON_V));
    const r = Math.round(stop[0] * tr);
    const g = Math.round(stop[1] * tg);
    const b = Math.round(stop[2] * tb);
    for (let x = 0; x < BACKDROP_WIDTH; x++) {
      const i = (y * BACKDROP_WIDTH + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
}

/**
 * Build the backdrop `DataTexture` for the given tint (day-night
 * `backgroundTint` hex; pass `'#ffffff'` for the untinted default look).
 * The caller owns disposal — the renderer caches ONE of these and disposes
 * it in `dispose()` alongside the IBL env textures.
 */
export function buildBackdropTexture(tintHex: string): DataTexture {
  const data = new Uint8Array(BACKDROP_WIDTH * BACKDROP_HEIGHT * 4);
  fillBackdropData(data, tintHex);
  const tex = new DataTexture(
    data,
    BACKDROP_WIDTH,
    BACKDROP_HEIGHT,
    RGBAFormat,
    UnsignedByteType,
  );
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Rewrite an existing backdrop texture's pixel data in place for a new tint
 * and flag it for re-upload (`needsUpdate = true`). This is the steady-state
 * day-night path: one cached texture, a few-KB CPU rewrite when the tint
 * changes — per render, never per frame, and no texture re-allocation.
 */
export function updateBackdropTint(tex: DataTexture, tintHex: string): void {
  fillBackdropData(tex.image.data as Uint8Array, tintHex);
  tex.needsUpdate = true;
}
