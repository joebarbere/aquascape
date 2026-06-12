import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import type { Scene } from '@aquascape/domain/scene-model';
import { DEFAULT_WATER_GAP_BELOW_RIM_MM } from '@aquascape/domain/scene-model';
import { buildWaterMesh } from './water-mesh';

function sceneOf(tankW = 600, tankH = 360, tankD = 300): Scene {
  return {
    tank: {
      width: tankW,
      height: tankH,
      depth: tankD,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: [] },
    layers: [],
    seed: 1,
  };
}

describe('buildWaterMesh — geometry + placement', () => {
  it('returns a Mesh backed by a PlaneGeometry sized to tank.width × tank.depth', () => {
    const { mesh } = buildWaterMesh(sceneOf(900, 400, 350));
    expect(mesh).toBeInstanceOf(Mesh);
    const geo = mesh.geometry as PlaneGeometry;
    expect(geo).toBeInstanceOf(PlaneGeometry);
    // PlaneGeometry stores its construction params on `parameters`. The
    // unrotated plane is width × height in its local XY, then rotated -π/2
    // about X to lie in the XZ plane — so "height" in the geometry corresponds
    // to tank depth in world space.
    expect(geo.parameters.width).toBe(900);
    expect(geo.parameters.height).toBe(350);
  });

  it('uses a tessellated 16×16 grid so the wave displacement reads smoothly', () => {
    const { mesh } = buildWaterMesh(sceneOf());
    const geo = mesh.geometry as PlaneGeometry;
    expect(geo.parameters.widthSegments).toBe(16);
    expect(geo.parameters.heightSegments).toBe(16);
  });

  it('positions the plane centred over the tank and 5 mm below the interior rim', () => {
    const { mesh } = buildWaterMesh(sceneOf(600, 360, 300));
    expect(mesh.position.x).toBeCloseTo(300, 5);
    expect(mesh.position.y).toBeCloseTo(360 - DEFAULT_WATER_GAP_BELOW_RIM_MM, 5);
    expect(mesh.position.z).toBeCloseTo(150, 5);
  });

  it('rotates the plane −π/2 about X so it lies horizontal in the XZ plane', () => {
    const { mesh } = buildWaterMesh(sceneOf());
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('names the mesh so test introspection (and the disposeNode walker) can find it', () => {
    const { mesh } = buildWaterMesh(sceneOf());
    expect(mesh.name).toBe('aquascape:water-surface');
  });
});

describe('buildWaterMesh — material', () => {
  it('uses a ShaderMaterial set up for transparent overlay over opaque content', () => {
    const { mesh } = buildWaterMesh(sceneOf());
    const mat = mesh.material as ShaderMaterial;
    expect(mat).toBeInstanceOf(ShaderMaterial);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    // DoubleSide so the camera under the surface still sees it from below.
    expect(mat.side).toBe(2); // THREE.DoubleSide === 2
  });

  it('renderOrder = 1 so the transparent water draws AFTER opaque content', () => {
    const { mesh } = buildWaterMesh(sceneOf());
    expect(mesh.renderOrder).toBe(1);
  });

  it('exposes a uTime uniform initialised to 0', () => {
    const { mesh } = buildWaterMesh(sceneOf());
    const mat = mesh.material as ShaderMaterial;
    expect(mat.uniforms['uTime']).toBeDefined();
    expect(mat.uniforms['uTime']!.value).toBe(0);
  });
});

describe('buildWaterMesh — surface caustic shimmer (fidelity follow-up)', () => {
  it('fragment shader contains the procedural caustic function, world-anchored + time-driven', () => {
    const { mesh } = buildWaterMesh(sceneOf());
    const src = (mesh.material as ShaderMaterial).fragmentShader;
    // The layered-sine caustic (same flavour as caustics.ts's aqCaustic).
    expect(src).toContain('float aqWaterCaustic(vec2 p, float t)');
    // Sampled in world XZ via the existing varying, driven by uTime.
    expect(src).toMatch(/aqWaterCaustic\(\s*vWorldPosition\.xz\s*,\s*uTime\s*\)/);
    // Scaled by the day-night-driven strength uniform.
    expect(src).toContain('uCausticStrength');
  });

  it('the caustic ADDED alpha is capped so the surface never turns opaque', () => {
    const { mesh } = buildWaterMesh(sceneOf());
    const src = (mesh.material as ShaderMaterial).fragmentShader;
    // The cap constant exists and the alpha contribution routes through min().
    expect(src).toContain('WATER_CAUSTIC_ALPHA_CAP');
    expect(src).toMatch(/min\(\s*caus\s*\*\s*[0-9.]+\s*,\s*WATER_CAUSTIC_ALPHA_CAP\s*\)/);
    // The base alpha behaviour stays recognisable (0.20 + spec ramp).
    expect(src).toMatch(/0\.20\s*\+\s*spec\s*\*\s*0\.35/);
  });

  it('exposes a uCausticStrength uniform defaulting to 1 (noon)', () => {
    const { mesh } = buildWaterMesh(sceneOf());
    const mat = mesh.material as ShaderMaterial;
    expect(mat.uniforms['uCausticStrength']).toBeDefined();
    expect(mat.uniforms['uCausticStrength']!.value).toBe(1);
  });

  it('setCausticStrength writes the uniform (clamped at 0)', () => {
    const handle = buildWaterMesh(sceneOf());
    const mat = handle.mesh.material as ShaderMaterial;
    handle.setCausticStrength(0.4);
    expect(mat.uniforms['uCausticStrength']!.value).toBeCloseTo(0.4, 5);
    handle.setCausticStrength(-2);
    expect(mat.uniforms['uCausticStrength']!.value).toBe(0);
  });

  it('setCausticStrength is a no-op after dispose (render + dispose race)', () => {
    const handle = buildWaterMesh(sceneOf());
    const mat = handle.mesh.material as ShaderMaterial;
    handle.setCausticStrength(0.7);
    handle.dispose();
    handle.setCausticStrength(0.1);
    expect(mat.uniforms['uCausticStrength']!.value).toBeCloseTo(0.7, 5);
  });
});

describe('buildWaterMesh — vertex shader amplitude clamp', () => {
  it('vertex shader contains both stacked sine bands', () => {
    const { mesh } = buildWaterMesh(sceneOf());
    const mat = mesh.material as ShaderMaterial;
    // Low-frequency swell band.
    expect(mat.vertexShader).toMatch(/sin\(\s*pos\.x\s*\*\s*0\.008\s*\+\s*uTime\s*\*\s*0\.5\s*\)/);
    // High-frequency ripple band(s).
    expect(mat.vertexShader).toMatch(/sin\(\s*pos\.z\s*\*\s*0\.04\s*\+\s*uTime\s*\*\s*2\.0\s*\)/);
    expect(mat.vertexShader).toMatch(/cos\(\s*pos\.x\s*\*\s*0\.06\s*-\s*uTime\s*\*\s*1\.7\s*\)/);
  });

  it('vertex shader carries the <= 2 mm total amplitude clamp comment + numeric coefficients', () => {
    // Coefficients sum (1.2 + 0.6 + 0.2) = 2.0 — the ceiling on the
    // displacement per the F11.7 plan. Encode the literal constants so a
    // future tweak that pushes above 2 mm fails this regression test.
    const { mesh } = buildWaterMesh(sceneOf());
    const src = (mesh.material as ShaderMaterial).vertexShader;
    expect(src).toMatch(/\*\s*1\.2/); // swell amplitude
    expect(src).toMatch(/\*\s*0\.6/); // ripple A amplitude
    expect(src).toMatch(/\*\s*0\.2/); // ripple B amplitude
    expect(src).toMatch(/<=\s*2(\.0)?\s*mm/i); // human-readable clamp note
  });

  it('amplitude coefficients sum to 2.0 (the documented ceiling)', () => {
    // Parse the three multipliers out of the shader source and assert
    // they sum to 2.0 — same intent as the literal-match test above, but
    // catches a refactor that hits the numeric ceiling via different
    // coefficients while keeping the comment text.
    const { mesh } = buildWaterMesh(sceneOf());
    const src = (mesh.material as ShaderMaterial).vertexShader;
    const swell = Number(src.match(/sin\(\s*pos\.x\s*\*\s*0\.008[^)]*\)\s*\*\s*([0-9.]+)/)?.[1]);
    const rippleA = Number(src.match(/sin\(\s*pos\.z\s*\*\s*0\.04[^)]*\)\s*\*\s*([0-9.]+)/)?.[1]);
    const rippleB = Number(src.match(/cos\(\s*pos\.x\s*\*\s*0\.06[^)]*\)\s*\*\s*([0-9.]+)/)?.[1]);
    expect(swell + rippleA + rippleB).toBeCloseTo(2.0, 5);
  });
});

describe('buildWaterMesh — updateTime', () => {
  it('updateTime(t) writes t to the uTime uniform', () => {
    const handle = buildWaterMesh(sceneOf());
    const mat = handle.mesh.material as ShaderMaterial;
    handle.updateTime(1.5);
    expect(mat.uniforms['uTime']!.value).toBe(1.5);
    handle.updateTime(42);
    expect(mat.uniforms['uTime']!.value).toBe(42);
  });

  it('updateTime is a no-op after dispose (defensive — RAF + dispose race)', () => {
    const handle = buildWaterMesh(sceneOf());
    const mat = handle.mesh.material as ShaderMaterial;
    handle.updateTime(1.5);
    handle.dispose();
    // After dispose the material/uniforms are still observable in memory
    // (Three.js dispose just releases GPU resources), but our handle
    // refuses to write so a stale RAF callback can't corrupt state.
    handle.updateTime(99);
    expect(mat.uniforms['uTime']!.value).toBe(1.5);
  });
});

describe('buildWaterMesh — dispose', () => {
  it('dispose releases geometry + material', () => {
    const handle = buildWaterMesh(sceneOf());
    const geoSpy = jest.spyOn(handle.mesh.geometry, 'dispose');
    const matSpy = jest.spyOn(handle.mesh.material as ShaderMaterial, 'dispose');
    handle.dispose();
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
  });

  it('dispose is idempotent — geometry + material dispose run at most once', () => {
    const handle = buildWaterMesh(sceneOf());
    const geoSpy = jest.spyOn(handle.mesh.geometry, 'dispose');
    const matSpy = jest.spyOn(handle.mesh.material as ShaderMaterial, 'dispose');
    handle.dispose();
    handle.dispose();
    handle.dispose();
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
  });
});

describe('buildWaterMesh — adjustable fill line', () => {
  it('positions the plane at the authored tank.waterLevelMm', () => {
    const scene = sceneOf();
    const filled: Scene = {
      ...scene,
      tank: { ...scene.tank, waterLevelMm: 180 },
    };
    const { mesh } = buildWaterMesh(filled);
    expect(mesh.position.y).toBeCloseTo(180, 5);
  });

  it('clamps a stale authored level above the rim to the tank height', () => {
    const scene = sceneOf(600, 360, 300);
    const overfull: Scene = {
      ...scene,
      tank: { ...scene.tank, waterLevelMm: 9999 },
    };
    const { mesh } = buildWaterMesh(overfull);
    expect(mesh.position.y).toBeCloseTo(360, 5);
  });
});

describe('buildWaterMesh — authored water tint (retired tank-mesh plane)', () => {
  it('defaults the base colour to the editorial pale blue when no waterTint is set', () => {
    const { mesh } = buildWaterMesh(sceneOf());
    const mat = mesh.material as ShaderMaterial;
    const base = mat.uniforms['uBaseColor']!.value as Color;
    expect(base.r).toBeCloseTo(0.55, 5);
    expect(base.g).toBeCloseTo(0.75, 5);
    expect(base.b).toBeCloseTo(0.92, 5);
  });

  it('bakes style.waterTint into uBaseColor when authored', () => {
    const scene = sceneOf();
    const tinted: Scene = {
      ...scene,
      tank: {
        ...scene.tank,
        style: { ...scene.tank.style, waterTint: '#f4ede0' },
      },
    };
    const { mesh } = buildWaterMesh(tinted);
    const mat = mesh.material as ShaderMaterial;
    const base = mat.uniforms['uBaseColor']!.value as Color;
    // `Color.set('#hex')` converts sRGB → the linear working space; assert
    // against the same conversion rather than raw byte fractions.
    const expected = new Color('#f4ede0');
    expect(base.r).toBeCloseTo(expected.r, 6);
    expect(base.g).toBeCloseTo(expected.g, 6);
    expect(base.b).toBeCloseTo(expected.b, 6);
  });

  it('the fragment shader samples uBaseColor (no baked colour literal)', () => {
    const { mesh } = buildWaterMesh(sceneOf());
    const mat = mesh.material as ShaderMaterial;
    expect(mat.fragmentShader).toContain('uniform vec3 uBaseColor;');
    expect(mat.fragmentShader).not.toContain('vec3(0.55, 0.75, 0.92)');
  });
});

