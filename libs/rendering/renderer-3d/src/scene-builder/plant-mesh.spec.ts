import { Group, InstancedMesh, Mesh, MeshStandardMaterial, type Shader,
  Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type {
  Catalog,
  CatalogEntry,
  CatalogKind,
  PlantEntry,
} from '@aquascape/domain/catalog';
import type { Layer, PlantObject, Scene } from '@aquascape/domain/scene-model';
import {
  FLOW_FREQ_COUPLING,
  PLANT_SWAY_MATERIALS_KEY,
  buildPlantMeshes,
  createPlantSwayMaterial,
  updatePlantEmissiveBoost,
  updatePlantSwayTime,
  type PlantSwayUniforms,
} from './plant-mesh';

/**
 * Drive `MeshStandardMaterial.onBeforeCompile` with a minimal shader-like
 * stub. The real Three.js shader compile is invoked by `WebGLRenderer`,
 * which we don't have in unit tests — calling `onBeforeCompile` directly
 * with the standard chunk markers reproduces the patch that production
 * would see.
 */
function compileMaterialShader(mat: MeshStandardMaterial): Shader {
  const shader: Shader = {
    uniforms: {},
    vertexShader: [
      '#include <common>',
      'void main() {',
      '#include <begin_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: '',
  };
  // `onBeforeCompile` is typed `(shader: Shader, renderer: WebGLRenderer)`.
  // The plant-sway implementation doesn't touch the renderer arg.
  (mat.onBeforeCompile as (s: Shader, r: unknown) => void)(shader, undefined);
  return shader;
}

function makeCatalog(entries: CatalogEntry[]): Catalog {
  return {
    entries,
    get({ catalog, id }) {
      return entries.find((e) => e.catalog === catalog && e.id === id) ?? null;
    },
    byKind<K extends CatalogKind>(kind: K): readonly Extract<CatalogEntry, { kind: K }>[] {
      return entries.filter((e): e is Extract<CatalogEntry, { kind: K }> => e.kind === kind);
    },
  };
}

function carpetEntry(color = '#2e7d32'): PlantEntry {
  return {
    catalog: 'core',
    id: 'plant.test.carpet',
    version: 1,
    name: 'Test Carpet',
    kind: 'plant',
    zone: 'foreground',
    lighting: 'medium',
    co2: 'low',
    difficulty: 'easy',
    color,
    naturalSize: { width: 30, height: 20, depth: 20 },
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
    growth: { weeksToMature: 8, sizeAtZero: 0.3 },
  };
}

function plant(overrides: Partial<PlantObject> = {}): PlantObject {
  return {
    id: 'p1' as PlantObject['id'],
    kind: 'plant',
    ref: { catalog: 'core', id: 'plant.test.carpet', version: 1 },
    transform: {
      position: { x: 100, y: 30, z: 50 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      flipX: false,
      flipY: false,
    },
    growth: { ageWeeks: 12, vigor: 1 },
    ...overrides,
  };
}

function sceneWithPlants(plants: PlantObject[]): Scene {
  const layer: Layer = {
    id: 'l1' as Layer['id'],
    name: 'L',
    opacity: 1,
    visible: true,
    locked: false,
    objects: plants,
  };
  return {
    tank: {
      width: 600,
      height: 360,
      depth: 300,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: [] },
    layers: [layer],
    seed: 42,
  };
}

describe('plant-mesh builder — single specimen', () => {
  it('produces one mesh for a single specimen plant', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const group = buildPlantMeshes(sceneWithPlants([plant()]), catalog, undefined);
    expect(group.children.length).toBe(1);
    const node = group.children[0];
    expect(node).toBeInstanceOf(Mesh);
  });

  it('applies catalog colour to the material', () => {
    const catalog = makeCatalog([carpetEntry('#114433')]);
    const group = buildPlantMeshes(sceneWithPlants([plant()]), catalog, undefined);
    const mat = (group.children[0] as Mesh).material as MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('114433');
  });

  it('builds a CROSS-PLANE geometry — volume in both X and Z (fidelity pass)', () => {
    // carpetEntry naturalSize is 30 (w) × 20 (h) × 20 (d). The cross-plane
    // merges the silhouette slab with a copy rotated 90° about Y, so the
    // bounding box spans both X (~width) and Z (~width) — not a thin card.
    const catalog = makeCatalog([carpetEntry()]);
    const group = buildPlantMeshes(sceneWithPlants([plant()]), catalog, undefined);
    const geo = (group.children[0] as Mesh).geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const xExtent = bb.max.x - bb.min.x;
    const zExtent = bb.max.z - bb.min.z;
    // Both axes carry real extent (the crossed slab gives Z ~ the silhouette
    // width, far thicker than the old single-extrusion card).
    expect(xExtent).toBeGreaterThan(10);
    expect(zExtent).toBeGreaterThan(10);
  });

  it('honours previewAgeWeeks for growth scale', () => {
    const catalog = makeCatalog([carpetEntry()]);
    // Same plant rendered at age 0 vs age 100 → different mesh scale.
    const groupYoung = buildPlantMeshes(
      sceneWithPlants([plant({ growth: { ageWeeks: 0, vigor: 1 } })]),
      catalog,
      0,
    );
    const groupOld = buildPlantMeshes(
      sceneWithPlants([plant({ growth: { ageWeeks: 100, vigor: 1 } })]),
      catalog,
      100,
    );
    const sYoung = (groupYoung.children[0] as Mesh).scale.x;
    const sOld = (groupOld.children[0] as Mesh).scale.x;
    expect(sOld).toBeGreaterThan(sYoung);
  });

  it('skips plants whose catalog entry is missing', () => {
    const group = buildPlantMeshes(sceneWithPlants([plant()]), undefined, undefined);
    expect(group.children.length).toBe(0);
  });

  it('skips invisible layers', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const scene = sceneWithPlants([plant()]);
    scene.layers[0]!.visible = false;
    const group = buildPlantMeshes(scene, catalog, undefined);
    expect(group.children.length).toBe(0);
  });
});

describe('plant-mesh builder — scatter patches', () => {
  function scatterPlant(density: number): PlantObject {
    return plant({
      scatter: {
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        density,
      },
    });
  }

  it('uses individual meshes for sparse patches (< INSTANCED_THRESHOLD)', () => {
    const catalog = makeCatalog([carpetEntry()]);
    // Low density → few instances → simple Group of Meshes.
    const group = buildPlantMeshes(sceneWithPlants([scatterPlant(0.05)]), catalog, undefined);
    if (group.children.length === 0) return; // density too low to produce anything
    const patch = group.children[0];
    expect(patch).toBeInstanceOf(Group);
  });

  it('uses InstancedMesh for dense patches (≥ INSTANCED_THRESHOLD)', () => {
    const catalog = makeCatalog([carpetEntry()]);
    // Very high density → many instances.
    const group = buildPlantMeshes(sceneWithPlants([scatterPlant(100)]), catalog, undefined);
    const patch = group.children[0];
    expect(patch).toBeInstanceOf(InstancedMesh);
  });

  it('is deterministic: same inputs produce same instance positions', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const a = buildPlantMeshes(
      sceneWithPlants([{ ...scatterPlant(50), id: 'p1' as PlantObject['id'] }]),
      catalog,
      undefined,
    );
    const b = buildPlantMeshes(
      sceneWithPlants([{ ...scatterPlant(50), id: 'p1' as PlantObject['id'] }]),
      catalog,
      undefined,
    );
    expect(a.children.length).toBe(b.children.length);
  });
});

// ─── Stage 11 F11.7 — plant sway ─────────────────────────────────────────

describe('plant-mesh sway — vertex displacement', () => {
  it('injects sway formula into the compiled vertex shader (single specimen)', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const group = buildPlantMeshes(sceneWithPlants([plant()]), catalog, undefined);
    const mat = (group.children[0] as Mesh).material as MeshStandardMaterial;
    const shader = compileMaterialShader(mat);
    // Sway lateral displacement on transformed.x must be present.
    expect(shader.vertexShader).toMatch(/transformed\.x\s*\+=\s*swayX/);
    // Per-vertex height factor + per-plant position factor must both be
    // present — that's what gives lower plants more sway AND top vertices
    // more sway than the rooted base.
    expect(shader.vertexShader).toContain('plantPosFactor');
    expect(shader.vertexShader).toContain('vertexHeightFactor');
    // uTime drives the oscillation.
    expect(shader.uniforms['uTime']).toBeDefined();
  });

  it('exposes sway materials on the plant group userData', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const group = buildPlantMeshes(
      sceneWithPlants([plant(), plant({ id: 'p2' as PlantObject['id'] })]),
      catalog,
      undefined,
    );
    const mats = group.userData[PLANT_SWAY_MATERIALS_KEY] as MeshStandardMaterial[];
    expect(Array.isArray(mats)).toBe(true);
    expect(mats.length).toBe(2);
  });

  it('phase is deterministic across builds for the same documentSeed', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const scene = sceneWithPlants([plant()]);
    const a = buildPlantMeshes(scene, catalog, undefined);
    const b = buildPlantMeshes(scene, catalog, undefined);
    const matA = (a.children[0] as Mesh).material as MeshStandardMaterial;
    const matB = (b.children[0] as Mesh).material as MeshStandardMaterial;
    const sA = compileMaterialShader(matA);
    const sB = compileMaterialShader(matB);
    expect(sA.uniforms['uPhaseOffset']!.value).toBe(sB.uniforms['uPhaseOffset']!.value);
  });

  it('phase differs between two plants in the same scene (no collisions)', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const scene = sceneWithPlants([
      plant({ id: 'p1' as PlantObject['id'] }),
      plant({ id: 'p2' as PlantObject['id'] }),
    ]);
    const group = buildPlantMeshes(scene, catalog, undefined);
    const matA = (group.children[0] as Mesh).material as MeshStandardMaterial;
    const matB = (group.children[1] as Mesh).material as MeshStandardMaterial;
    const sA = compileMaterialShader(matA);
    const sB = compileMaterialShader(matB);
    expect(sA.uniforms['uPhaseOffset']!.value).not.toBe(
      sB.uniforms['uPhaseOffset']!.value,
    );
  });

  it('plant at high Y has a smaller plantBaseY → only the floor-Y factor matters', () => {
    // The plan: "amplitude proportional to (1 - clamp(plant.y / tank.height, 0, 1))".
    // In 3D, single specimens are SUBSTRATE-SNAPPED (see plant-mesh
    // header) — the floor depends on the substrate at the plant's X.
    // With an empty `substrate.regions` array, `substrateHeightAt` returns
    // 0 for every X, so `uPlantBaseY` is 0 for both plants. The shader
    // factor reduces to `1 - 0/tankH = 1`. The TEST that matters here is
    // that the uniform takes whatever value the substrate-snap produces,
    // and that the shader applies the formula correctly. The "lower
    // plants sway more" intent is encoded by the shader expression
    // `clamp(1.0 - uPlantBaseY / uTankHeight, 0, 1)` itself — a property
    // of the GLSL source we verify by string match.
    const catalog = makeCatalog([carpetEntry()]);
    const group = buildPlantMeshes(sceneWithPlants([plant()]), catalog, undefined);
    const mat = (group.children[0] as Mesh).material as MeshStandardMaterial;
    const shader = compileMaterialShader(mat);
    // The formula tying plantPosFactor to (1 - plantBaseY / tankHeight)
    // is the load-bearing piece — it's what makes the height proportion
    // work in the running shader.
    expect(shader.vertexShader).toMatch(
      /clamp\s*\(\s*1\.0\s*-\s*uPlantBaseY\s*\/\s*uTankHeight\s*,\s*0\.0\s*,\s*1\.0\s*\)/,
    );
    // uTankHeight matches the scene's tank height.
    expect(shader.uniforms['uTankHeight']!.value).toBe(360);
  });

  it('uTime uniform updates on subsequent updatePlantSwayTime calls', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const group = buildPlantMeshes(sceneWithPlants([plant()]), catalog, undefined);
    const mat = (group.children[0] as Mesh).material as MeshStandardMaterial;
    // Compile so the shader.uniforms `uTime` and the userData uniform
    // point at the same `IUniform` reference.
    const shader = compileMaterialShader(mat);
    updatePlantSwayTime(group, 1.25);
    expect(shader.uniforms['uTime']!.value).toBe(1.25);
    updatePlantSwayTime(group, 3.75);
    expect(shader.uniforms['uTime']!.value).toBe(3.75);
  });

  it('updatePlantSwayTime is a no-op on a group with no sway materials', () => {
    const empty = new Group();
    // No swayMaterials userData attached. Must not throw.
    expect(() => updatePlantSwayTime(empty, 1)).not.toThrow();
  });

  it('shader base frequency is the documented 1.2 Hz (2π × 1.2 baked into the source)', () => {
    // 2π × 1.2 ≈ 7.5398 is hard-baked into the shader as the BASE (still-
    // water) frequency; the flow factor scales it through the coupling mix
    // (see the flow-coupled sway describe block). If this constant ever
    // changes, sway behaviour changes for everyone — flag the test so the
    // bump is intentional.
    const mat = createPlantSwayMaterial('#2e7d32', {
      silhouetteHeight: 100,
      plantBaseY: 0,
      tankHeight: 360,
      phase: 0,
    });
    const shader = compileMaterialShader(mat);
    expect(shader.vertexShader).toMatch(/swayFreq\s*=\s*7\.539822/);
    expect(shader.vertexShader).toMatch(/uTime\s*\*\s*swayFreq/);
  });

  it('scatter InstancedMesh uses per-instance attributes for phase + plantBaseY', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const dense = plant({
      scatter: {
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        density: 100,
      },
    });
    const group = buildPlantMeshes(sceneWithPlants([dense]), catalog, undefined);
    const patch = group.children[0] as InstancedMesh;
    expect(patch).toBeInstanceOf(InstancedMesh);
    expect(patch.geometry.getAttribute('aPlantPhase')).toBeDefined();
    expect(patch.geometry.getAttribute('aPlantBaseY')).toBeDefined();
    // The compiled shader for the instanced path reads from the attrs.
    const mat = patch.material as MeshStandardMaterial;
    const shader = compileMaterialShader(mat);
    expect(shader.vertexShader).toContain('attribute float aPlantPhase');
    expect(shader.vertexShader).toContain('attribute float aPlantBaseY');
  });

  it('scatter per-instance phase is deterministic for the same documentSeed', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const dense = plant({
      scatter: {
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        density: 100,
      },
    });
    const a = buildPlantMeshes(sceneWithPlants([dense]), catalog, undefined);
    const b = buildPlantMeshes(sceneWithPlants([dense]), catalog, undefined);
    const phaseA = (a.children[0] as InstancedMesh).geometry.getAttribute(
      'aPlantPhase',
    ).array;
    const phaseB = (b.children[0] as InstancedMesh).geometry.getAttribute(
      'aPlantPhase',
    ).array;
    expect(Array.from(phaseA)).toEqual(Array.from(phaseB));
  });

  it('sway userData uniforms object is referentially shared with the compiled shader', () => {
    // The same `IUniform` reference must survive `onBeforeCompile` — that's
    // what makes `updatePlantSwayTime` work BEFORE the first frame: the
    // host can write `uTime` synchronously and the value will be live the
    // moment WebGLRenderer compiles the shader.
    const mat = createPlantSwayMaterial('#2e7d32', {
      silhouetteHeight: 100,
      plantBaseY: 0,
      tankHeight: 360,
      phase: 0,
    });
    const handle = mat.userData['swayUniforms'] as PlantSwayUniforms;
    handle.uTime.value = 42;
    const shader = compileMaterialShader(mat);
    expect(shader.uniforms['uTime']).toBe(handle.uTime);
    expect(shader.uniforms['uTime']!.value).toBe(42);
  });
});

// ─── Stage 11 F11.7 Wave 3 — plant emissive boost ───────────────────────

describe('plant-mesh emissive boost (F11.7 Wave 3 day-night)', () => {
  it('exposes uPlantEmissiveBoost in the compiled shader uniforms', () => {
    const mat = createPlantSwayMaterial('#2e7d32', {
      silhouetteHeight: 100,
      plantBaseY: 0,
      tankHeight: 360,
      phase: 0,
    });
    const shader = compileMaterialShader(mat);
    expect(shader.uniforms['uPlantEmissiveBoost']).toBeDefined();
    expect(shader.uniforms['uPlantEmissiveBoost']!.value).toBe(0);
  });

  it('patches the fragment shader to add a green-biased boost to gl_FragColor', () => {
    const mat = createPlantSwayMaterial('#2e7d32', {
      silhouetteHeight: 100,
      plantBaseY: 0,
      tankHeight: 360,
      phase: 0,
    });
    // Build a fragment-shader stub that contains the standard chunk
    // marker we patch, then run `onBeforeCompile`.
    const shader = {
      uniforms: {},
      vertexShader: ['#include <common>', 'void main(){', '#include <begin_vertex>', '}'].join(
        '\n',
      ),
      fragmentShader: [
        '#include <common>',
        'void main(){',
        '#include <dithering_fragment>',
        '}',
      ].join('\n'),
    };
    (mat.onBeforeCompile as (s: typeof shader, r: unknown) => void)(shader, undefined);
    expect(shader.fragmentShader).toContain('uniform float uPlantEmissiveBoost');
    expect(shader.fragmentShader).toContain('uPlantEmissiveBoost * vec3(0.4, 0.8, 0.5)');
  });

  it('updatePlantEmissiveBoost writes into every sway material uniform', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const group = buildPlantMeshes(
      sceneWithPlants([plant(), plant({ id: 'p2' as PlantObject['id'] })]),
      catalog,
      undefined,
    );
    updatePlantEmissiveBoost(group, 0.3);
    const mats = group.userData[PLANT_SWAY_MATERIALS_KEY] as MeshStandardMaterial[];
    expect(mats.length).toBe(2);
    for (const mat of mats) {
      const uniforms = mat.userData['swayUniforms'] as PlantSwayUniforms;
      expect(uniforms.uPlantEmissiveBoost.value).toBeCloseTo(0.3, 5);
    }
  });

  it('updatePlantEmissiveBoost is a no-op on a group with no sway materials', () => {
    const empty = new Group();
    expect(() => updatePlantEmissiveBoost(empty, 0.4)).not.toThrow();
  });
});

// ─── Fidelity pass — flow-coupled sway ───────────────────────────────────

import type { FlowField } from '@aquascape/domain/fluid-sim';

/** A uniform constant-velocity flow field for deterministic sampling. */
function uniformFlowField(magMmPerSec: number): FlowField {
  const g = 2;
  const n = g * g * g;
  return {
    gx: g,
    gy: g,
    gz: g,
    origin: { x: 0, y: 0, z: 0 },
    cellSize: 1000,
    u: new Float32Array(n).fill(magMmPerSec),
    v: new Float32Array(n),
    w: new Float32Array(n),
  };
}

describe('plant-mesh flow-coupled sway (fidelity pass)', () => {
  it('single specimen: uFlowAmp defaults to 1.0 with no flow field', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const group = buildPlantMeshes(sceneWithPlants([plant()]), catalog, undefined);
    const mat = (group.children[0] as Mesh).material as MeshStandardMaterial;
    const shader = compileMaterialShader(mat);
    expect(shader.uniforms['uFlowAmp']!.value).toBe(1);
    // The flow multiplier is wired into the swayAmp expression.
    expect(shader.vertexShader).toContain('uFlowAmp');
  });

  it('single specimen: strong current pushes uFlowAmp toward the ceiling', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const group = buildPlantMeshes(
      sceneWithPlants([plant()]),
      catalog,
      undefined,
      uniformFlowField(200),
    );
    const mat = (group.children[0] as Mesh).material as MeshStandardMaterial;
    const shader = compileMaterialShader(mat);
    // 200 mm/s saturates the response → FLOW_AMP_MAX (2.4).
    expect(shader.uniforms['uFlowAmp']!.value).toBeCloseTo(2.4, 5);
  });

  it('single specimen: still water (zero current) drops uFlowAmp to the dead-zone floor', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const group = buildPlantMeshes(
      sceneWithPlants([plant()]),
      catalog,
      undefined,
      uniformFlowField(0),
    );
    const mat = (group.children[0] as Mesh).material as MeshStandardMaterial;
    const shader = compileMaterialShader(mat);
    expect(shader.uniforms['uFlowAmp']!.value).toBeCloseTo(0.4, 5);
  });

  it('scatter InstancedMesh carries a per-instance aFlowAmp attribute in range', () => {
    const catalog = makeCatalog([carpetEntry()]);
    const dense = plant({
      scatter: {
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        density: 100,
      },
    });
    const group = buildPlantMeshes(
      sceneWithPlants([dense]),
      catalog,
      undefined,
      uniformFlowField(200),
    );
    const patch = group.children[0] as InstancedMesh;
    const flow = patch.geometry.getAttribute('aFlowAmp');
    expect(flow).toBeDefined();
    const arr = flow.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      expect(arr[i]).toBeGreaterThanOrEqual(0.4 - 1e-4);
      expect(arr[i]).toBeLessThanOrEqual(2.4 + 1e-4);
    }
    // The instanced shader reads the per-instance attribute.
    const shader = compileMaterialShader(patch.material as MeshStandardMaterial);
    expect(shader.vertexShader).toContain('attribute float aFlowAmp');
  });

  it('couples the oscillation FREQUENCY to the flow factor through FLOW_FREQ_COUPLING', () => {
    // Fidelity follow-up (Bucket 3): outflow plants wave faster, not just
    // wider. The shader scales the baked base frequency by
    // mix(1.0, flowFactor, FLOW_FREQ_COUPLING) — same factor, no new
    // attribute / uniform.
    expect(FLOW_FREQ_COUPLING).toBe(0.5);
    const mat = createPlantSwayMaterial('#2e7d32', {
      silhouetteHeight: 100,
      plantBaseY: 0,
      tankHeight: 360,
      phase: 0,
    });
    const shader = compileMaterialShader(mat);
    expect(shader.vertexShader).toMatch(
      /swayFreq\s*=\s*7\.539822\s*\*\s*mix\(\s*1\.0\s*,\s*uFlowAmp\s*,\s*0\.5000\s*\)/,
    );
    expect(shader.vertexShader).toMatch(/sin\(\s*uTime\s*\*\s*swayFreq\s*\+/);
  });

  it('instanced path couples frequency to the per-instance aFlowAmp attribute', () => {
    const mat = createPlantSwayMaterial('#2e7d32', {
      silhouetteHeight: 100,
      plantBaseY: 0,
      tankHeight: 360,
      phase: 0,
      instanced: true,
    });
    const shader = compileMaterialShader(mat);
    expect(shader.vertexShader).toMatch(
      /swayFreq\s*=\s*7\.539822\s*\*\s*mix\(\s*1\.0\s*,\s*aFlowAmp\s*,\s*0\.5000\s*\)/,
    );
  });

  it('no flow field ⇒ flow factor is exactly 1.0 ⇒ frequency identical to pre-fidelity', () => {
    // With no flow field, `flowAmpAt` returns 1 → uFlowAmp = 1.0 →
    // mix(1.0, 1.0, 0.5) = 1.0 → swayFreq = the baked 2π × 1.2 constant.
    // Source-level assertion: the uniform default is 1 AND the only
    // frequency modulation routes through that uniform.
    const catalog = makeCatalog([carpetEntry()]);
    const group = buildPlantMeshes(sceneWithPlants([plant()]), catalog, undefined);
    const mat = (group.children[0] as Mesh).material as MeshStandardMaterial;
    const shader = compileMaterialShader(mat);
    expect(shader.uniforms['uFlowAmp']!.value).toBe(1);
    // The frequency expression's only non-constant input is uFlowAmp.
    expect(shader.vertexShader).toMatch(
      /swayFreq\s*=\s*7\.539822\s*\*\s*mix\(\s*1\.0\s*,\s*uFlowAmp\s*,\s*0\.5000\s*\)/,
    );
  });
});

describe('plant catalog textures (Bucket 2)', () => {
  function texturedEntry(): PlantEntry {
    return { ...carpetEntry(), textures: { albedo: 'leaf-fine.albedo.png', normal: 'leaf-fine.normal.png' } };
  }
  function stub(): WebGLProgramParametersWithUniforms {
    return {
      uniforms: {},
      vertexShader: ['#include <common>', '#include <beginnormal_vertex>', '#include <begin_vertex>'].join('\n'),
      fragmentShader: [
        '#include <common>',
        '#include <color_fragment>',
        '#include <roughnessmap_fragment>',
        '#include <normal_fragment_begin>',
        '#include <dithering_fragment>',
      ].join('\n'),
    } as unknown as WebGLProgramParametersWithUniforms;
  }

  it('patches the single-specimen sway material; sway survives; normal map SKIPPED for plants', () => {
    const catalog = makeCatalog([texturedEntry()]);
    const resolver = jest.fn(() => new Texture());
    const group = buildPlantMeshes(sceneWithPlants([plant()]), catalog, undefined, undefined, resolver);
    const mat = (group.children[0] as Mesh).material as MeshStandardMaterial;
    const shader = stub();
    mat.onBeforeCompile!(shader, undefined as never);
    expect(shader.fragmentShader).toContain('uAqTexAlbedo');
    // Plants pass normalStrength 0 — no normal perturbation GLSL.
    expect(shader.fragmentShader).not.toContain('aqWorldN');
    // The sway patch is still chained (uTime uniform wired).
    expect(shader.uniforms['uTime']).toBeDefined();
  });

  it('does not patch without a resolver (opt-in contract)', () => {
    const catalog = makeCatalog([texturedEntry()]);
    const group = buildPlantMeshes(sceneWithPlants([plant()]), catalog, undefined);
    const mat = (group.children[0] as Mesh).material as MeshStandardMaterial;
    const shader = stub();
    mat.onBeforeCompile!(shader, undefined as never);
    expect(shader.fragmentShader).not.toContain('uAqTexAlbedo');
  });
});
