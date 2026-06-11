/**
 * Hardscape surface texture (fidelity pass — enhancement B4).
 *
 * The per-vertex noise (`hardscape-noise.ts`) gives rocks an irregular
 * SILHOUETTE, but the material is a single flat colour, so they still read as
 * smooth moulded plastic / chocolate. This patches the hardscape
 * `MeshStandardMaterial` (via `onBeforeCompile`, chaining any prior patch like
 * caustics) to add a deterministic multi-octave 3D VALUE-NOISE that varies the
 * surface brightness in world space — exposed faces catch a little more light,
 * crevices sit darker — so the rock reads as textured stone.
 *
 * Pure + deterministic (world position in, no texture / RNG), additive on the
 * final fragment colour so the authored catalog colour is preserved and the
 * renderer's idempotency holds.
 */

import type {
  MeshStandardMaterial,
  WebGLProgramParametersWithUniforms,
} from 'three';

/** Brightness variation amplitude (added to the [0,1] fragment colour). */
const TEX_AMP = 0.1;
/** Base noise wavelength (world mm⁻¹). */
const TEX_FREQ = 0.06;

/**
 * Patch a hardscape material to add the procedural stone texture. Mutates +
 * returns the same material; chains any existing `onBeforeCompile`.
 */
export function applyHardscapeTexture(material: MeshStandardMaterial): MeshStandardMaterial {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
    if (typeof prev === 'function') {
      (prev as (s: WebGLProgramParametersWithUniforms) => void)(shader);
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRockWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRockWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRockWorld;
        float aqRockHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float aqRockNoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          float n000 = aqRockHash(i + vec3(0.0, 0.0, 0.0));
          float n100 = aqRockHash(i + vec3(1.0, 0.0, 0.0));
          float n010 = aqRockHash(i + vec3(0.0, 1.0, 0.0));
          float n110 = aqRockHash(i + vec3(1.0, 1.0, 0.0));
          float n001 = aqRockHash(i + vec3(0.0, 0.0, 1.0));
          float n101 = aqRockHash(i + vec3(1.0, 0.0, 1.0));
          float n011 = aqRockHash(i + vec3(0.0, 1.0, 1.0));
          float n111 = aqRockHash(i + vec3(1.0, 1.0, 1.0));
          return mix(
            mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
            mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
            f.z
          );
        }`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          vec3 rp = vRockWorld * ${TEX_FREQ.toFixed(4)};
          float t = aqRockNoise(rp) * 0.6 + aqRockNoise(rp * 3.0) * 0.3 + aqRockNoise(rp * 9.0) * 0.1;
          gl_FragColor.rgb += (t - 0.5) * 2.0 * ${TEX_AMP.toFixed(4)};
        }`,
      );
  };
  material.needsUpdate = true;
  return material;
}
