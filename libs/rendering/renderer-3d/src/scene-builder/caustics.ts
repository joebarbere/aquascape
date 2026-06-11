/**
 * Animated underwater caustics — Stage 11 fidelity pass (the deferred
 * F11.7.1 effect).
 *
 * Caustics are the dancing web of focused light that surface ripples cast
 * onto everything below — the single most "this is underwater" visual cue an
 * aquarium render can have. We add them by patching the substrate + hardscape
 * `MeshStandardMaterial`s via `onBeforeCompile`: a small procedural caustic
 * function (layered sines — no texture upload, no `examples/jsm` addon)
 * sampled in WORLD space so the pattern is anchored to the tank rather than
 * sliding across surfaces as the camera orbits, modulated by how up-facing
 * the surface is (light comes from above) and animated by a shared `uTime`.
 *
 * **Deliberately procedural, not a sampled noise texture.** The F11.7.1 plan
 * sketched a baked 2-channel noise texture; an in-shader function is cheaper
 * (one extra ALU block, no texture fetch / upload), deterministic (no asset,
 * no RNG), and keeps the renderer's idempotency contract trivially — the only
 * time-varying input is `uTime`, which the host advances off the wall clock
 * exactly like the water surface + plant sway.
 *
 * The host renderer collects every patched material (the builders stash them
 * on `group.userData[CAUSTIC_MATERIALS_KEY]`), advances `uCausticTime` each
 * RAF tick, and scales `uCausticStrength` by the day-night directional
 * intensity per render so the caustics fade out at night (no sun → no
 * focused light).
 */

import type {
  IUniform,
  MeshStandardMaterial,
  WebGLProgramParametersWithUniforms,
} from 'three';

/**
 * `userData` key the builders stash their patched-material list under, and
 * the renderer reads to find the materials it must tick `uCausticTime` on.
 */
export const CAUSTIC_MATERIALS_KEY = 'aquascape:causticMaterials';

/** Baseline caustic intensity at full (noon) directional light. Subtle. */
export const CAUSTIC_STRENGTH = 0.18;

/** Shape of the per-material caustic uniforms (exposed for the host tick). */
export interface CausticUniforms {
  uCausticTime: IUniform<number>;
  uCausticStrength: IUniform<number>;
  uCausticTankHeight: IUniform<number>;
}

/** `userData` key the per-material uniforms live under. */
export const CAUSTIC_UNIFORMS_KEY = 'causticUniforms';

/**
 * Patch a `MeshStandardMaterial` so its fragment shader adds an animated
 * caustic highlight. Mutates + returns the same material. The shared uniform
 * objects are stashed on `material.userData[CAUSTIC_UNIFORMS_KEY]` so the
 * host can mutate them even before the shader first compiles (the `IUniform`
 * identity is what `onBeforeCompile` wires into the program).
 */
export function applyCaustics(
  material: MeshStandardMaterial,
  tankHeight: number,
): MeshStandardMaterial {
  const uCausticTime: IUniform<number> = { value: 0 };
  const uCausticStrength: IUniform<number> = { value: CAUSTIC_STRENGTH };
  const uCausticTankHeight: IUniform<number> = { value: Math.max(1, tankHeight) };
  const uniforms: CausticUniforms = {
    uCausticTime,
    uCausticStrength,
    uCausticTankHeight,
  };
  material.userData[CAUSTIC_UNIFORMS_KEY] = uniforms;

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
    if (typeof prev === 'function') {
      (prev as (s: WebGLProgramParametersWithUniforms) => void)(shader);
    }
    shader.uniforms['uCausticTime'] = uCausticTime;
    shader.uniforms['uCausticStrength'] = uCausticStrength;
    shader.uniforms['uCausticTankHeight'] = uCausticTankHeight;

    // Vertex — capture world position + a world-space up component. We
    // compute these ourselves (rather than leaning on `<worldpos_vertex>`,
    // which only emits under certain material defines) right after the
    // standard chunks that define `transformed` / `objectNormal`.
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCausticWorld;
        varying float vCausticUp;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vCausticUp = normalize(mat3(modelMatrix) * objectNormal).y;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vCausticWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    // Fragment — the procedural caustic, added as a cool highlight after the
    // standard pipeline (post tone-map, like the plant emissive boost) so it
    // reads as focused light rather than altering the surface albedo.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCausticWorld;
        varying float vCausticUp;
        uniform float uCausticTime;
        uniform float uCausticStrength;
        uniform float uCausticTankHeight;
        float aqCaustic(vec2 p, float t) {
          vec2 a = p * 0.025;
          float v = sin(a.x + t * 1.3) * sin(a.y - t * 1.1);
          v += sin(a.x * 1.7 - t * 0.9 + 1.3) * sin(a.y * 1.3 + t * 1.7);
          v = v * 0.25 + 0.5;
          return pow(clamp(v, 0.0, 1.0), 3.0);
        }`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          float upF = clamp(vCausticUp, 0.0, 1.0);
          float depthF = mix(0.7, 1.0, clamp(vCausticWorld.y / uCausticTankHeight, 0.0, 1.0));
          float caus = aqCaustic(vCausticWorld.xz, uCausticTime) * upF * depthF * uCausticStrength;
          gl_FragColor.rgb += caus * vec3(0.85, 0.93, 1.0);
        }`,
      );
  };
  // Force a recompile if the material was already used.
  material.needsUpdate = true;
  return material;
}

/**
 * Advance `uCausticTime` on every patched material. Called by the host RAF
 * tick. No-op for materials without caustic uniforms, so it's safe to call
 * over a mixed list.
 */
export function updateCausticTime(
  materials: ReadonlyArray<MeshStandardMaterial>,
  timeSec: number,
): void {
  for (const mat of materials) {
    const u = mat.userData[CAUSTIC_UNIFORMS_KEY] as CausticUniforms | undefined;
    if (u === undefined) continue;
    u.uCausticTime.value = timeSec;
  }
}

/**
 * Scale caustic intensity by a `[0, 1]` factor (the day-night directional
 * intensity) so the caustics fade at night. Called once per render.
 */
export function setCausticIntensity(
  materials: ReadonlyArray<MeshStandardMaterial>,
  factor: number,
): void {
  const clamped = Math.max(0, factor);
  for (const mat of materials) {
    const u = mat.userData[CAUSTIC_UNIFORMS_KEY] as CausticUniforms | undefined;
    if (u === undefined) continue;
    u.uCausticStrength.value = CAUSTIC_STRENGTH * clamped;
  }
}
