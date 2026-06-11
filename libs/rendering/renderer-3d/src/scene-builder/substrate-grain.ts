/**
 * Substrate grain (fidelity pass — enhancement A1).
 *
 * Dark aquasoil (`#2a2520`-ish) under tank light crushes to a flat BLACK void
 * — the single most damaging read in the 3D scene (the floor looks missing).
 * This patches the substrate `MeshStandardMaterial` (via `onBeforeCompile`,
 * chaining any prior patch like caustics) to add:
 *
 *   - a deterministic per-fragment VALUE-NOISE grain in world space, at two
 *     scales, so the soil reads as thousands of tiny granules catching light
 *     rather than a uniform black slab; and
 *   - a small UP-FACING tonal lift (`max(worldNormal.y, 0)`) so the visible
 *     top surface of the bed sits a touch above pure black.
 *
 * Both are additive on the final fragment colour (after the standard pipeline,
 * like the plant emissive boost + caustics), so the authored catalog colour is
 * preserved — we only stop it crushing to a featureless void. Pure +
 * deterministic (no texture, no RNG): the only inputs are world position +
 * normal, so the renderer's idempotency holds.
 */

import type {
  MeshStandardMaterial,
  WebGLProgramParametersWithUniforms,
} from 'three';

/** Grain amplitude (added to the [0,1] fragment colour). Subtle — soil, not snow. */
const GRAIN_AMP = 0.05;
/** Up-facing tonal lift so the bed's top surface clears pure black. */
const UP_LIFT = 0.07;
/** Coarse grain wavelength (world mm⁻¹). */
const GRAIN_FREQ = 0.25;

/**
 * Patch a substrate material to add the grain + up-lift. Mutates + returns the
 * same material. Chains any existing `onBeforeCompile` (call order:
 * substrate-mesh applies caustics first, then this — so the caustic patch runs
 * and THEN the grain is added on top).
 */
export function applySubstrateGrain(material: MeshStandardMaterial): MeshStandardMaterial {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
    if (typeof prev === 'function') {
      (prev as (s: WebGLProgramParametersWithUniforms) => void)(shader);
    }

    // Vertex — capture world position + up (own varyings; independent of any
    // other patch's varyings so chaining order doesn't matter).
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGrainWorld;
        varying float vGrainUp;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vGrainUp = normalize(mat3(modelMatrix) * objectNormal).y;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    // Fragment — two-octave value-noise grain + up-facing lift, added last.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGrainWorld;
        varying float vGrainUp;
        float aqGrainHash(vec2 p) {
          p = fract(p * vec2(123.34, 345.45));
          p += dot(p, p + 34.345);
          return fract(p.x * p.y);
        }
        float aqGrainNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = aqGrainHash(i);
          float b = aqGrainHash(i + vec2(1.0, 0.0));
          float c = aqGrainHash(i + vec2(0.0, 1.0));
          float d = aqGrainHash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          vec2 gp = vGrainWorld.xz * ${GRAIN_FREQ.toFixed(4)};
          float g = aqGrainNoise(gp) * 0.7 + aqGrainNoise(gp * 4.0) * 0.3;
          float grain = (g - 0.5) * 2.0 * ${GRAIN_AMP.toFixed(4)};
          float lift = clamp(vGrainUp, 0.0, 1.0) * ${UP_LIFT.toFixed(4)};
          gl_FragColor.rgb += grain + lift;
        }`,
      );
  };
  material.needsUpdate = true;
  return material;
}
