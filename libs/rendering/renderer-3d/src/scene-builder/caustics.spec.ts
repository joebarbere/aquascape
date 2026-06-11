import { MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import {
  applyCaustics,
  CAUSTIC_STRENGTH,
  CAUSTIC_UNIFORMS_KEY,
  type CausticUniforms,
  setCausticIntensity,
  updateCausticTime,
} from './caustics';

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
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '#include <dithering_fragment>',
      '}',
    ].join('\n'),
  } as unknown as WebGLProgramParametersWithUniforms;
}

describe('caustics', () => {
  it('stashes caustic uniforms on the material userData', () => {
    const mat = applyCaustics(new MeshStandardMaterial(), 360);
    const u = mat.userData[CAUSTIC_UNIFORMS_KEY] as CausticUniforms;
    expect(u).toBeDefined();
    expect(u.uCausticTime.value).toBe(0);
    expect(u.uCausticStrength.value).toBeCloseTo(CAUSTIC_STRENGTH, 5);
    expect(u.uCausticTankHeight.value).toBe(360);
  });

  it('clamps a non-positive tank height to a safe minimum', () => {
    const mat = applyCaustics(new MeshStandardMaterial(), 0);
    const u = mat.userData[CAUSTIC_UNIFORMS_KEY] as CausticUniforms;
    expect(u.uCausticTankHeight.value).toBeGreaterThan(0);
  });

  it('onBeforeCompile injects the caustic uniforms + GLSL into both shader stages', () => {
    const mat = applyCaustics(new MeshStandardMaterial(), 360);
    const shader = makeShaderStub();
    mat.onBeforeCompile!(shader, undefined as never);
    // Uniforms wired into the program.
    expect(shader.uniforms['uCausticTime']).toBeDefined();
    expect(shader.uniforms['uCausticStrength']).toBeDefined();
    expect(shader.uniforms['uCausticTankHeight']).toBeDefined();
    // Vertex stage captures world position + up.
    expect(shader.vertexShader).toContain('vCausticWorld');
    expect(shader.vertexShader).toContain('vCausticUp');
    // Fragment stage adds the caustic highlight.
    expect(shader.fragmentShader).toContain('aqCaustic');
    expect(shader.fragmentShader).toContain('gl_FragColor.rgb +=');
  });

  it('updateCausticTime advances every material time uniform', () => {
    const a = applyCaustics(new MeshStandardMaterial(), 360);
    const b = applyCaustics(new MeshStandardMaterial(), 360);
    updateCausticTime([a, b], 12.5);
    expect((a.userData[CAUSTIC_UNIFORMS_KEY] as CausticUniforms).uCausticTime.value).toBe(12.5);
    expect((b.userData[CAUSTIC_UNIFORMS_KEY] as CausticUniforms).uCausticTime.value).toBe(12.5);
  });

  it('setCausticIntensity scales strength by the day-night factor (and never negative)', () => {
    const mat = applyCaustics(new MeshStandardMaterial(), 360);
    setCausticIntensity([mat], 0.5);
    expect(
      (mat.userData[CAUSTIC_UNIFORMS_KEY] as CausticUniforms).uCausticStrength.value,
    ).toBeCloseTo(CAUSTIC_STRENGTH * 0.5, 5);
    setCausticIntensity([mat], -3);
    expect(
      (mat.userData[CAUSTIC_UNIFORMS_KEY] as CausticUniforms).uCausticStrength.value,
    ).toBe(0);
  });

  it('tolerates materials without caustic uniforms in the tick + intensity helpers', () => {
    const plain = new MeshStandardMaterial();
    expect(() => updateCausticTime([plain], 1)).not.toThrow();
    expect(() => setCausticIntensity([plain], 1)).not.toThrow();
  });
});
