import { MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import { applySubstrateGrain } from './substrate-grain';
import { applyHardscapeTexture } from './hardscape-texture';

/** Minimal `onBeforeCompile` shader stub carrying the chunk tokens we patch. */
function makeShaderStub(): WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: [
      '#include <common>',
      '#include <beginnormal_vertex>',
      '#include <begin_vertex>',
      'gl_Position = vec4(0.0);',
    ].join('\n'),
    fragmentShader: ['#include <common>', 'void main() {', '#include <dithering_fragment>', '}'].join(
      '\n',
    ),
  } as unknown as WebGLProgramParametersWithUniforms;
}

describe('substrate grain (enhancement A1)', () => {
  it('injects a world-space grain + up-lift into the fragment shader', () => {
    const mat = applySubstrateGrain(new MeshStandardMaterial());
    const shader = makeShaderStub();
    mat.onBeforeCompile!(shader, undefined as never);
    expect(shader.vertexShader).toContain('vGrainWorld');
    expect(shader.vertexShader).toContain('vGrainUp');
    expect(shader.fragmentShader).toContain('aqGrainNoise');
    expect(shader.fragmentShader).toMatch(/gl_FragColor\.rgb\s*\+=\s*grain/);
  });

  it('chains a prior onBeforeCompile (caustics-then-grain order)', () => {
    const mat = new MeshStandardMaterial();
    let priorRan = false;
    mat.onBeforeCompile = () => {
      priorRan = true;
    };
    applySubstrateGrain(mat);
    mat.onBeforeCompile!(makeShaderStub(), undefined as never);
    expect(priorRan).toBe(true);
  });
});

describe('hardscape texture (enhancement B4)', () => {
  it('injects a 3D value-noise into the fragment shader', () => {
    const mat = applyHardscapeTexture(new MeshStandardMaterial());
    const shader = makeShaderStub();
    mat.onBeforeCompile!(shader, undefined as never);
    expect(shader.vertexShader).toContain('vRockWorld');
    expect(shader.fragmentShader).toContain('aqRockNoise');
    expect(shader.fragmentShader).toMatch(/gl_FragColor\.rgb\s*\+=/);
  });

  it('chains a prior onBeforeCompile', () => {
    const mat = new MeshStandardMaterial();
    let priorRan = false;
    mat.onBeforeCompile = () => {
      priorRan = true;
    };
    applyHardscapeTexture(mat);
    mat.onBeforeCompile!(makeShaderStub(), undefined as never);
    expect(priorRan).toBe(true);
  });
});
