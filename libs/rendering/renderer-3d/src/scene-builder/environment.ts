/**
 * Procedural image-based-lighting (IBL) environment — Stage 11 fidelity pass.
 *
 * The renderer sets `scene.environment` to a pre-filtered (PMREM) version of
 * this texture so every `MeshStandardMaterial` / `MeshPhysicalMaterial` has
 * something to reflect: the glass picks up a Fresnel sheen, wet substrate +
 * hardscape read with believable roughness, and fish bodies catch a soft
 * highlight instead of looking like flat-shaded clay.
 *
 * We deliberately DON'T pull in the `three/examples/jsm/environments/
 * RoomEnvironment` addon — it would mean wiring another ESM-addon import
 * through tsconfig path maps + jest stubs (the OrbitControls dance). A
 * hand-built equirectangular gradient is cheaper, deterministic (no GL, no
 * RNG — important for the renderer's idempotency contract), and reads as a
 * neutral "soft room above, darker floor below" studio light that doesn't
 * tint the scene.
 *
 * The gradient is a vertical (elevation) ramp: cool-bright sky at the top
 * pole, a slightly warm horizon band in the middle, and a dim floor at the
 * bottom pole. Azimuth is constant (one column replicated across the width),
 * which is all a soft studio environment needs.
 *
 * Pure + framework-light: constructs a `DataTexture` only — no renderer, no
 * WebGL context — so it's unit-testable in the node jest env. The PMREM
 * pre-filter (which DOES need a GL context) happens renderer-side, guarded
 * behind a real-`WebGLRenderer` check.
 */

import {
  DataTexture,
  EquirectangularReflectionMapping,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';

/** Equirect texture width — azimuth is constant, so a thin strip suffices. */
const ENV_WIDTH = 8;
/** Equirect texture height — the elevation ramp resolution. */
const ENV_HEIGHT = 64;

/** sRGB colour stops for the vertical gradient (top pole → bottom pole). */
const SKY_TOP: [number, number, number] = [150, 178, 205]; // cool soft sky
const HORIZON: [number, number, number] = [200, 198, 188]; // warm-neutral horizon
const FLOOR_BOTTOM: [number, number, number] = [40, 42, 46]; // dim cool floor

/**
 * Default global strength the renderer applies via `scene.environmentIntensity`.
 * Kept modest so the IBL fills shading + supplies reflections without washing
 * out the directional key light's shadows. Exported so the renderer + tests
 * share one constant.
 */
export const ENV_INTENSITY = 0.35;

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
 * Build the equirectangular gradient as a `DataTexture`. Row 0 is the
 * bottom of the texture (floor) and the last row is the top (sky) — matching
 * `DataTexture`'s bottom-up row order so the bright end maps to the upper
 * hemisphere once mapped equirectangularly.
 *
 * The caller owns disposal (`texture.dispose()`); the renderer disposes both
 * this source texture and its PMREM-filtered product on teardown.
 */
export function buildEnvEquirectTexture(): DataTexture {
  const data = new Uint8Array(ENV_WIDTH * ENV_HEIGHT * 4);
  for (let y = 0; y < ENV_HEIGHT; y++) {
    // v in [0,1] from bottom (floor) to top (sky). ENV_HEIGHT is a fixed
    // constant > 1, so the denominator is always positive.
    const v = y / (ENV_HEIGHT - 1);
    // Two-segment ramp: floor → horizon over the lower half, horizon → sky
    // over the upper half. Gives a defined horizon band rather than a flat
    // top-to-bottom fade.
    const color =
      v < 0.5
        ? lerp3(FLOOR_BOTTOM, HORIZON, v / 0.5)
        : lerp3(HORIZON, SKY_TOP, (v - 0.5) / 0.5);
    for (let x = 0; x < ENV_WIDTH; x++) {
      const i = (y * ENV_WIDTH + x) * 4;
      data[i] = Math.round(color[0]);
      data[i + 1] = Math.round(color[1]);
      data[i + 2] = Math.round(color[2]);
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, ENV_WIDTH, ENV_HEIGHT, RGBAFormat, UnsignedByteType);
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
