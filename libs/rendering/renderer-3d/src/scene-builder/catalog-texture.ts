/**
 * Catalog-driven PBR textures — Bucket 2 of the 3D fidelity plan.
 *
 * Patches a `MeshStandardMaterial` (via `onBeforeCompile`, chaining any prior
 * patch — caustics, grain, stone-noise, plant sway) to sample the catalog
 * entry's albedo / normal / roughness maps **triplanar in world space**:
 *
 *  - No UV dependence. `ExtrudeGeometry` UVs live in shape-path coordinates
 *    (useless on side walls), and the hardscape noise displacement would
 *    stretch any authored UVs anyway. World-space triplanar projects the
 *    tiling texture along all three world axes and blends by the surface
 *    normal — the standard answer for procedural / displaced geometry.
 *  - Anchored to the tank (same rationale as the caustics): the pattern
 *    doesn't slide when the camera orbits, and the X-mirror the renderer
 *    applies (negative-determinant world matrix) is harmless because the
 *    blend weights use `abs(normal)` and a mirrored albedo pattern is
 *    visually indistinguishable for natural materials.
 *
 * APPLICATION SEMANTICS (modulate, don't replace)
 * -----------------------------------------------
 *  - **Albedo** multiplies `diffuseColor.rgb` (injected after
 *    `<color_fragment>`, i.e. BEFORE lighting) with a strength mix. The maps
 *    are authored around mean luminance ≈ 0.5, so the `2.0 ×` recentring
 *    makes the multiply identity-on-average — the authored catalog colour
 *    stays the identity of the material and the map supplies the variation.
 *  - **Roughness** multiplies `roughnessFactor` (after
 *    `<roughnessmap_fragment>`) with the same 2.0 recentring, clamped.
 *  - **Normal** perturbs the lit normal via a swizzled-UDN triplanar blend
 *    in world space, rotated into view space (after
 *    `<normal_fragment_begin>`). Strength is deliberately modest — the
 *    procedural hardscape vertex noise already supplies the macro shape;
 *    the normal map adds micro relief.
 *
 * The texture uniforms hold `TextureCache` textures (see
 * `../texture-cache.ts`): they start as NEUTRAL placeholders (identity
 * modulation) and upgrade in place when the PNG arrives — no material
 * recompile, no black flash, and a missing asset degrades to the
 * pre-Bucket-2 procedural look instead of failing.
 *
 * GLSL is generated CONDITIONALLY per supplied map — a material whose entry
 * only carries an albedo ref compiles no normal/roughness samplers. Absent
 * `textures` on the entry (or no resolver from the host) ⇒ this function is
 * never called and the shader source is byte-identical to pre-Bucket-2.
 */

import type {
  MeshStandardMaterial,
  Texture,
  WebGLProgramParametersWithUniforms,
} from 'three';

import type { CatalogTextureKind } from '../texture-cache';

/**
 * Resolver the host renderer hands to the scene builders: maps a catalog
 * `textures` ref (e.g. `stone-gray.albedo.png`) to a live (possibly still
 * placeholder) `THREE.Texture`. Backed by the renderer's `TextureCache`.
 */
export type CatalogTextureResolver = (ref: string, kind: CatalogTextureKind) => Texture;

/** Resolved texture set for one material. Any subset may be present. */
export interface CatalogTextureSet {
  albedo?: Texture;
  normal?: Texture;
  roughness?: Texture;
}

/**
 * World-mm per texture repeat, per material family. Hardscape tiles coarser
 * (rock strata are decimetre-scale features), substrate finer (granules),
 * plants finest (leaf detail). Tuned against the 256² catalog texture pack.
 */
export const TEX_TILE_HARDSCAPE_MM = 90;
export const TEX_TILE_SUBSTRATE_MM = 48;
export const TEX_TILE_PLANT_MM = 36;

/**
 * Albedo modulation strength ∈ [0, 1]. 0 = authored colour only, 1 = full
 * `2 × map` multiply. Kept below 1 so the catalog colour stays dominant
 * (architecture invariant: catalog colours are authored data, the texture
 * is decoration).
 */
export const TEX_ALBEDO_STRENGTH = 0.85;
/**
 * Plants use a gentler albedo modulation — the species' authored green is
 * how users identify a plant in the palette, and the thin cross-plane
 * slabs read noisy under a full-strength multiply.
 */
export const TEX_ALBEDO_STRENGTH_PLANT = 0.5;
/** Normal perturbation strength. Micro relief only — see header. */
export const TEX_NORMAL_STRENGTH = 0.6;
/** Roughness modulation strength ∈ [0, 1] (mixed like the albedo). */
export const TEX_ROUGHNESS_STRENGTH = 0.8;

/** Options for `applyCatalogTextures`. */
export interface CatalogTextureOptions {
  /** World-mm per tile repeat (one of the `TEX_TILE_*` constants). */
  tileMm: number;
  /** Albedo strength override (default `TEX_ALBEDO_STRENGTH`). */
  albedoStrength?: number;
  /** Normal strength override (default `TEX_NORMAL_STRENGTH`; 0 disables). */
  normalStrength?: number;
}

/**
 * Patch `material` to triplanar-sample the supplied catalog texture set.
 * Mutates + returns the same material. Chains any existing
 * `onBeforeCompile` (caustics / grain / stone-noise / plant sway) — the
 * chain rule from `docs/caveats/renderer-3d.md` is load-bearing: this
 * patch ALWAYS calls the previous handler first. No-ops (returns the
 * untouched material) when the set is empty.
 *
 * Injection anchors differ from the additive passes: albedo + roughness +
 * normal feed the LIGHTING pipeline (`<color_fragment>` /
 * `<roughnessmap_fragment>` / `<normal_fragment_begin>`), whereas caustics
 * + grain add onto the final colour (`<dithering_fragment>`). Both patch
 * styles `.replace()` KEEP the original `#include` line, so chained patches
 * always find their anchors regardless of order.
 */
export function applyCatalogTextures(
  material: MeshStandardMaterial,
  textures: CatalogTextureSet,
  options: CatalogTextureOptions,
): MeshStandardMaterial {
  const hasAlbedo = textures.albedo !== undefined;
  const hasNormal = textures.normal !== undefined;
  const hasRoughness = textures.roughness !== undefined;
  if (!hasAlbedo && !hasNormal && !hasRoughness) return material;

  const tile = Math.max(1, options.tileMm);
  const albedoStrength = options.albedoStrength ?? TEX_ALBEDO_STRENGTH;
  const normalStrength = options.normalStrength ?? TEX_NORMAL_STRENGTH;

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
    if (typeof prev === 'function') {
      (prev as (s: WebGLProgramParametersWithUniforms) => void)(shader);
    }
    if (hasAlbedo) shader.uniforms['uAqTexAlbedo'] = { value: textures.albedo };
    if (hasNormal) shader.uniforms['uAqTexNormal'] = { value: textures.normal };
    if (hasRoughness) shader.uniforms['uAqTexRough'] = { value: textures.roughness };

    // Vertex — own world-position + world-normal varyings (independent of
    // the caustics/grain varyings so chain order never matters; same
    // capture-it-yourself lesson as `caustics.ts` — `<worldpos_vertex>`
    // only emits under certain defines).
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vAqTexWorld;
        varying vec3 vAqTexNormalW;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vAqTexNormalW = normalize(mat3(modelMatrix) * objectNormal);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vAqTexWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    // Fragment — triplanar helpers + the three (conditional) injections.
    const samplerDecls = [
      hasAlbedo ? 'uniform sampler2D uAqTexAlbedo;' : '',
      hasNormal ? 'uniform sampler2D uAqTexNormal;' : '',
      hasRoughness ? 'uniform sampler2D uAqTexRough;' : '',
    ].join('\n        ');

    let fragment = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
        varying vec3 vAqTexWorld;
        varying vec3 vAqTexNormalW;
        ${samplerDecls}
        vec3 aqTriWeights(vec3 n) {
          vec3 an = abs(normalize(n));
          return an / (an.x + an.y + an.z);
        }
        vec4 aqTriplanar(sampler2D map, vec3 w, vec3 wts) {
          return texture2D(map, w.zy / ${tile.toFixed(1)}) * wts.x
               + texture2D(map, w.xz / ${tile.toFixed(1)}) * wts.y
               + texture2D(map, w.xy / ${tile.toFixed(1)}) * wts.z;
        }`,
    );

    if (hasAlbedo) {
      // Before lighting: modulate the authored diffuse. The 2.0× recentres
      // the ~0.5-mean (linear) map at identity; the mix keeps the catalog
      // colour dominant. (The texture's SRGBColorSpace means the hardware
      // decodes to linear before this multiply.)
      fragment = fragment.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 aqWts = aqTriWeights(vAqTexNormalW);
          vec3 aqAlb = aqTriplanar(uAqTexAlbedo, vAqTexWorld, aqWts).rgb;
          diffuseColor.rgb *= mix(vec3(1.0), 2.0 * aqAlb, ${albedoStrength.toFixed(4)});
        }`,
      );
    }
    if (hasRoughness) {
      fragment = fragment.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          vec3 aqWts = aqTriWeights(vAqTexNormalW);
          float aqR = aqTriplanar(uAqTexRough, vAqTexWorld, aqWts).g;
          roughnessFactor = clamp(
            roughnessFactor * mix(1.0, 2.0 * aqR, ${TEX_ROUGHNESS_STRENGTH.toFixed(4)}),
            0.04, 1.0);
        }`,
      );
    }
    if (hasNormal && normalStrength > 0) {
      // Swizzled-UDN triplanar normal blend in WORLD space, rotated into
      // view space (three's `normal` is view-space at this anchor). Each
      // plane's tangent-space xy lands on that plane's world axes; the
      // geometric world normal supplies the base direction. Wholesale
      // view-space overwrite is safe here because the patched materials
      // are FrontSide (substrate / hardscape); plants pass strength 0.
      fragment = fragment.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        {
          vec3 aqWts = aqTriWeights(vAqTexNormalW);
          vec3 aqTx = texture2D(uAqTexNormal, vAqTexWorld.zy / ${tile.toFixed(1)}).rgb * 2.0 - 1.0;
          vec3 aqTy = texture2D(uAqTexNormal, vAqTexWorld.xz / ${tile.toFixed(1)}).rgb * 2.0 - 1.0;
          vec3 aqTz = texture2D(uAqTexNormal, vAqTexWorld.xy / ${tile.toFixed(1)}).rgb * 2.0 - 1.0;
          vec3 aqDelta = vec3(0.0, aqTx.y, aqTx.x) * aqWts.x
                       + vec3(aqTy.x, 0.0, aqTy.y) * aqWts.y
                       + vec3(aqTz.x, aqTz.y, 0.0) * aqWts.z;
          vec3 aqWorldN = normalize(normalize(vAqTexNormalW) + aqDelta * ${normalStrength.toFixed(4)});
          normal = normalize((viewMatrix * vec4(aqWorldN, 0.0)).xyz);
        }`,
      );
    }
    shader.fragmentShader = fragment;
  };
  material.needsUpdate = true;
  return material;
}

/**
 * Convenience: resolve a catalog entry's `textures` refs through the host
 * resolver into a `CatalogTextureSet`. Returns null when the entry has no
 * refs or no resolver is available — callers skip the patch entirely (the
 * opt-in contract: no resolver ⇒ byte-identical pre-Bucket-2 shaders).
 */
export function resolveTextureSet(
  refs: { albedo?: string; normal?: string; roughness?: string } | undefined,
  resolve: CatalogTextureResolver | undefined,
): CatalogTextureSet | null {
  if (refs === undefined || resolve === undefined) return null;
  const set: CatalogTextureSet = {};
  if (refs.albedo !== undefined) set.albedo = resolve(refs.albedo, 'albedo');
  if (refs.normal !== undefined) set.normal = resolve(refs.normal, 'normal');
  if (refs.roughness !== undefined) set.roughness = resolve(refs.roughness, 'roughness');
  if (set.albedo === undefined && set.normal === undefined && set.roughness === undefined) {
    return null;
  }
  return set;
}
