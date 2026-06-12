import {
  MeshStandardMaterial,
  Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';

import { applyCaustics } from './caustics';
import {
  applyCatalogTextures,
  resolveTextureSet,
  TEX_TILE_HARDSCAPE_MM,
} from './catalog-texture';
import { applySubstrateGrain } from './substrate-grain';

/**
 * Shader stub carrying every chunk token the catalog-texture patch (and the
 * passes it chains with) anchor on. Mirrors `surface-detail.spec.ts`'s stub
 * plus the three lighting-pipeline anchors this patch injects at.
 */
function makeShaderStub(): WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: [
      '#include <common>',
      '#include <beginnormal_vertex>',
      '#include <begin_vertex>',
      'gl_Position = vec4(0.0);',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '#include <color_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <normal_fragment_begin>',
      '#include <dithering_fragment>',
      '}',
    ].join('\n'),
  } as unknown as WebGLProgramParametersWithUniforms;
}

function fullSet(): { albedo: Texture; normal: Texture; roughness: Texture } {
  return { albedo: new Texture(), normal: new Texture(), roughness: new Texture() };
}

describe('catalog-texture triplanar patch (Bucket 2)', () => {
  it('injects world-space triplanar sampling for a full texture set', () => {
    const set = fullSet();
    const mat = applyCatalogTextures(new MeshStandardMaterial(), set, {
      tileMm: TEX_TILE_HARDSCAPE_MM,
    });
    const shader = makeShaderStub();
    mat.onBeforeCompile!(shader, undefined as never);

    // Own varyings (independent of the caustics/grain varyings).
    expect(shader.vertexShader).toContain('vAqTexWorld');
    expect(shader.vertexShader).toContain('vAqTexNormalW');
    // Triplanar helper + all three injections.
    expect(shader.fragmentShader).toContain('aqTriplanar');
    expect(shader.fragmentShader).toMatch(/diffuseColor\.rgb\s*\*=\s*mix\(vec3\(1\.0\)/);
    expect(shader.fragmentShader).toMatch(/roughnessFactor\s*=\s*clamp\(/);
    expect(shader.fragmentShader).toContain('uAqTexNormal');
    // Uniforms wired to the SAME texture objects (the cache's in-place
    // placeholder→image upgrade depends on object identity).
    expect(shader.uniforms['uAqTexAlbedo']!.value).toBe(set.albedo);
    expect(shader.uniforms['uAqTexNormal']!.value).toBe(set.normal);
    expect(shader.uniforms['uAqTexRough']!.value).toBe(set.roughness);
  });

  it('generates GLSL conditionally — an albedo-only set compiles no normal/roughness samplers', () => {
    const mat = applyCatalogTextures(
      new MeshStandardMaterial(),
      { albedo: new Texture() },
      { tileMm: 50 },
    );
    const shader = makeShaderStub();
    mat.onBeforeCompile!(shader, undefined as never);
    expect(shader.fragmentShader).toContain('uAqTexAlbedo');
    expect(shader.fragmentShader).not.toContain('uAqTexNormal');
    expect(shader.fragmentShader).not.toContain('uAqTexRough');
    expect(shader.uniforms['uAqTexNormal']).toBeUndefined();
  });

  it('normalStrength 0 skips the normal injection even when a normal map exists', () => {
    const mat = applyCatalogTextures(new MeshStandardMaterial(), fullSet(), {
      tileMm: 50,
      normalStrength: 0,
    });
    const shader = makeShaderStub();
    mat.onBeforeCompile!(shader, undefined as never);
    // The sampler uniform record is still bound (harmless) but no normal
    // GLSL is generated — the `normal =` overwrite must be absent.
    expect(shader.fragmentShader).not.toContain('aqWorldN');
  });

  it('no-ops on an empty set (the opt-in contract)', () => {
    const mat = new MeshStandardMaterial();
    // Three ships a default no-op onBeforeCompile — assert IDENTITY is
    // preserved (no wrapper installed) rather than undefined-ness.
    const before = mat.onBeforeCompile;
    applyCatalogTextures(mat, {}, { tileMm: 50 });
    expect(mat.onBeforeCompile).toBe(before);
    const shader = makeShaderStub();
    mat.onBeforeCompile!(shader, undefined as never);
    expect(shader.fragmentShader).not.toContain('aqTriplanar');
  });

  it('chains caustics + grain + texture — all three patches survive together', () => {
    const mat = new MeshStandardMaterial();
    applyCaustics(mat, 360);
    applySubstrateGrain(mat);
    applyCatalogTextures(mat, fullSet(), { tileMm: 48 });
    const shader = makeShaderStub();
    mat.onBeforeCompile!(shader, undefined as never);
    expect(shader.fragmentShader).toContain('aqCaustic');
    expect(shader.fragmentShader).toContain('aqGrainNoise');
    expect(shader.fragmentShader).toContain('aqTriplanar');
    // Each patch keeps its `#include` anchors intact for the next one —
    // the original tokens must still be present after all three ran.
    expect(shader.fragmentShader).toContain('#include <dithering_fragment>');
    expect(shader.fragmentShader).toContain('#include <color_fragment>');
  });

  it('chains an arbitrary prior onBeforeCompile (plant sway pattern)', () => {
    const mat = new MeshStandardMaterial();
    let priorRan = false;
    mat.onBeforeCompile = () => {
      priorRan = true;
    };
    applyCatalogTextures(mat, fullSet(), { tileMm: 36 });
    mat.onBeforeCompile!(makeShaderStub(), undefined as never);
    expect(priorRan).toBe(true);
  });
});

describe('resolveTextureSet', () => {
  const tex = new Texture();
  const resolver = jest.fn(() => tex);

  beforeEach(() => resolver.mockClear());

  it('returns null without refs or without a resolver', () => {
    expect(resolveTextureSet(undefined, resolver)).toBeNull();
    expect(resolveTextureSet({ albedo: 'a.png' }, undefined)).toBeNull();
    expect(resolveTextureSet({}, resolver)).toBeNull();
  });

  it('resolves each present ref with its map kind', () => {
    const set = resolveTextureSet(
      { albedo: 'x.albedo.png', normal: 'x.normal.png', roughness: 'x.roughness.png' },
      resolver,
    );
    expect(set).toEqual({ albedo: tex, normal: tex, roughness: tex });
    expect(resolver).toHaveBeenCalledWith('x.albedo.png', 'albedo');
    expect(resolver).toHaveBeenCalledWith('x.normal.png', 'normal');
    expect(resolver).toHaveBeenCalledWith('x.roughness.png', 'roughness');
  });

  it('passes through a partial set', () => {
    const set = resolveTextureSet({ albedo: 'only.png' }, resolver);
    expect(set).toEqual({ albedo: tex });
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});
