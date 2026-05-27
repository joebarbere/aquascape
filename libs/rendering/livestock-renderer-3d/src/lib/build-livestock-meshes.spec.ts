/**
 * Tests for `buildLivestockMeshes` (Stage 11 F11.1 Wave 3).
 *
 * The unit tests don't rasterize — they assert on the constructed
 * scene graph (one `InstancedMesh` per archetype, expected attribute
 * sizes, correct grouping under `syncFromSnapshot`) and on the
 * vertex-shader source string for the carangiform formula.
 *
 * No `Math.random()` here — every snapshot is hand-built so failures
 * are deterministically reproducible.
 */

import {
  buildBarbGeometry,
  buildCoryCylinderGeometry,
  buildCrawlerGeometry,
  buildDeepBodiedGeometry,
  buildEelGeometry,
  buildHatchetWedgeGeometry,
  buildSlimTetraGeometry,
} from '@aquascape/domain/fish-anatomy';
import { FISH_ARCHETYPE, type WorldSnapshot } from '@aquascape/domain/livestock-ecs';
import {
  BufferGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  ShaderMaterial,
} from 'three';
import { buildLivestockMeshes, type LivestockMeshBundle } from './build-livestock-meshes';
import {
  LIVESTOCK_BUBBLE_FRAGMENT_SHADER,
  LIVESTOCK_BUBBLE_VERTEX_SHADER,
  LIVESTOCK_FOOD_VERTEX_SHADER,
  LIVESTOCK_VERTEX_SHADER,
} from './shaders';

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeSnapshot(
  entries: ReadonlyArray<{
    archetype: number;
    position?: [number, number, number];
    orientation?: [number, number, number, number];
    phase?: number;
    scale?: number;
  }>,
  foodSprites: ReadonlyArray<[number, number, number]> = [],
  bubbles: ReadonlyArray<[number, number, number]> = [],
): WorldSnapshot {
  const n = entries.length;
  const ids = new Uint32Array(n);
  const position = new Float32Array(n * 3);
  const orientation = new Float32Array(n * 4);
  const phase = new Float32Array(n);
  const archetype = new Uint8Array(n);
  const scale = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const e = entries[i]!;
    ids[i] = i + 1;
    const p = e.position ?? [0, 0, 0];
    position[i * 3 + 0] = p[0];
    position[i * 3 + 1] = p[1];
    position[i * 3 + 2] = p[2];
    const q = e.orientation ?? [0, 0, 0, 1];
    orientation[i * 4 + 0] = q[0];
    orientation[i * 4 + 1] = q[1];
    orientation[i * 4 + 2] = q[2];
    orientation[i * 4 + 3] = q[3];
    phase[i] = e.phase ?? 0;
    archetype[i] = e.archetype;
    scale[i] = e.scale ?? 30;
  }

  const fsCount = foodSprites.length;
  const foodSpritePosition = new Float32Array(fsCount * 3);
  for (let i = 0; i < fsCount; i++) {
    const p = foodSprites[i]!;
    foodSpritePosition[i * 3 + 0] = p[0];
    foodSpritePosition[i * 3 + 1] = p[1];
    foodSpritePosition[i * 3 + 2] = p[2];
  }

  const bubbleCount = bubbles.length;
  const bubblePosition = new Float32Array(bubbleCount * 3);
  for (let i = 0; i < bubbleCount; i++) {
    const p = bubbles[i]!;
    bubblePosition[i * 3 + 0] = p[0];
    bubblePosition[i * 3 + 1] = p[1];
    bubblePosition[i * 3 + 2] = p[2];
  }

  // The bubble fields are typed on WorldSnapshot by the parallel agent
  // (F11.5 ECS extension). Until that lands we cast the literal so the
  // renderer tests can prove the contract is wired end-to-end.
  return {
    entityCount: n,
    ids,
    position,
    orientation,
    phase,
    archetype,
    scale,
    foodSpriteCount: fsCount,
    foodSpritePosition,
    bubbleCount,
    bubblePosition,
  } as unknown as WorldSnapshot;
}

function meshForArchetype(bundle: LivestockMeshBundle, archetypeId: number): InstancedMesh {
  for (const child of bundle.group.children) {
    if ((child as InstancedMesh).isInstancedMesh) {
      const mesh = child as InstancedMesh;
      const expected = `aquascape:livestock/`;
      if (mesh.name.startsWith(expected) && mesh.name === expectedNameFor(archetypeId)) {
        return mesh;
      }
    }
  }
  throw new Error(`no InstancedMesh for archetype ${archetypeId}`);
}

function expectedNameFor(archetypeId: number): string {
  const label: Record<number, string> = {
    [FISH_ARCHETYPE.SLIM_TETRA]: 'slim-tetra',
    [FISH_ARCHETYPE.DEEP_BODIED]: 'deep-bodied',
    [FISH_ARCHETYPE.BARB]: 'barb',
    [FISH_ARCHETYPE.CORY_CYLINDER]: 'cory-cylinder',
    [FISH_ARCHETYPE.EEL]: 'eel',
    [FISH_ARCHETYPE.HATCHET_WEDGE]: 'hatchet-wedge',
    [FISH_ARCHETYPE.CRAWLER]: 'crawler',
  };
  return `aquascape:livestock/${label[archetypeId]!}`;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('buildLivestockMeshes', () => {
  describe('group construction', () => {
    let bundle: LivestockMeshBundle;
    afterEach(() => bundle.dispose());

    it('returns a named Group containing one InstancedMesh per archetype + food sprite + bubble billboard meshes', () => {
      bundle = buildLivestockMeshes();
      expect(bundle.group.name).toBe('aquascape:livestock');
      // 7 archetypes (F11.6 Wave 2 added crawler) + food sprite mesh + bubble billboard mesh.
      expect(bundle.group.children).toHaveLength(9);
      for (const child of bundle.group.children) {
        expect((child as InstancedMesh).isInstancedMesh).toBe(true);
      }
    });

    it('matches each InstancedMesh to its fish-anatomy descriptor vertex count', () => {
      bundle = buildLivestockMeshes();
      const pairs: ReadonlyArray<[number, () => { positions: Float32Array }]> = [
        [FISH_ARCHETYPE.SLIM_TETRA, buildSlimTetraGeometry],
        [FISH_ARCHETYPE.DEEP_BODIED, buildDeepBodiedGeometry],
        [FISH_ARCHETYPE.BARB, buildBarbGeometry],
        [FISH_ARCHETYPE.CORY_CYLINDER, buildCoryCylinderGeometry],
        [FISH_ARCHETYPE.EEL, buildEelGeometry],
        [FISH_ARCHETYPE.HATCHET_WEDGE, buildHatchetWedgeGeometry],
        [FISH_ARCHETYPE.CRAWLER, buildCrawlerGeometry],
      ];
      for (const [archetypeId, builder] of pairs) {
        const mesh = meshForArchetype(bundle, archetypeId);
        const expected = builder().positions.length / 3;
        const got = (mesh.geometry as BufferGeometry).getAttribute('position').count;
        expect(got).toBe(expected);
      }
    });

    it('disables frustum culling on every archetype mesh', () => {
      bundle = buildLivestockMeshes();
      for (const child of bundle.group.children) {
        expect((child as InstancedMesh).frustumCulled).toBe(false);
      }
    });

    it('records the five named fin/body groups on each geometry', () => {
      bundle = buildLivestockMeshes();
      const mesh = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
      const groups = (mesh.geometry as BufferGeometry).groups;
      expect(groups).toHaveLength(5);
      const materialIndexes = groups
        .map((g) => g.materialIndex)
        .filter((x): x is number => x !== undefined);
      expect(materialIndexes).toEqual([0, 1, 2, 3, 4]);
    });

    it('starts every mesh at count = 0 (no draws until first sync)', () => {
      bundle = buildLivestockMeshes();
      for (const child of bundle.group.children) {
        expect((child as InstancedMesh).count).toBe(0);
      }
    });
  });

  describe('per-instance attributes', () => {
    let bundle: LivestockMeshBundle;
    afterEach(() => bundle.dispose());

    it('attaches all 7 per-instance attributes sized to maxInstancesPerArchetype', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 32 });
      const mesh = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
      const geo = mesh.geometry as BufferGeometry;

      const expected: ReadonlyArray<[string, number]> = [
        ['instancePosition', 3],
        ['instanceQuat', 4],
        ['instanceScale', 1],
        ['instancePhase', 1],
        ['instanceTailBeatFreq', 1],
        ['instanceAmpHead', 1],
        ['instanceAmpTail', 1],
      ];

      for (const [name, stride] of expected) {
        const attr = geo.getAttribute(name) as InstancedBufferAttribute;
        expect(attr).toBeDefined();
        // `count` is element count (not array length); array length =
        // count * itemSize. Both checks pin down stride too.
        expect(attr.count).toBe(32);
        expect(attr.itemSize).toBe(stride);
        expect(attr.array.length).toBe(32 * stride);
        expect(attr.usage).toBeDefined(); // DynamicDrawUsage = 35048
      }
    });

    it('uses 256 as the default maxInstancesPerArchetype', () => {
      bundle = buildLivestockMeshes();
      const mesh = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
      const geo = mesh.geometry as BufferGeometry;
      expect((geo.getAttribute('instancePosition') as InstancedBufferAttribute).count).toBe(256);
    });

    it('initialises instanceQuat to the identity quaternion (0,0,0,1)', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 4 });
      const mesh = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
      const geo = mesh.geometry as BufferGeometry;
      const quat = geo.getAttribute('instanceQuat').array as Float32Array;
      for (let i = 0; i < 4; i++) {
        expect(quat[i * 4 + 0]).toBe(0);
        expect(quat[i * 4 + 1]).toBe(0);
        expect(quat[i * 4 + 2]).toBe(0);
        expect(quat[i * 4 + 3]).toBe(1);
      }
    });

    it('initialises instance scale + freq + amp defaults', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 2 });
      const mesh = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
      const geo = mesh.geometry as BufferGeometry;
      expect((geo.getAttribute('instanceScale').array as Float32Array)[0]).toBe(1);
      expect((geo.getAttribute('instanceTailBeatFreq').array as Float32Array)[0]).toBe(4);
      expect((geo.getAttribute('instanceAmpHead').array as Float32Array)[0]).toBeCloseTo(0.02, 5);
      expect((geo.getAttribute('instanceAmpTail').array as Float32Array)[0]).toBeCloseTo(0.12, 5);
    });

    it('rejects non-positive maxInstancesPerArchetype', () => {
      expect(() => buildLivestockMeshes({ maxInstancesPerArchetype: 0 })).toThrow(
        /maxInstancesPerArchetype/,
      );
      expect(() => buildLivestockMeshes({ maxInstancesPerArchetype: -1 })).toThrow(
        /maxInstancesPerArchetype/,
      );
      expect(() => buildLivestockMeshes({ maxInstancesPerArchetype: Infinity })).toThrow(
        /maxInstancesPerArchetype/,
      );
    });
  });

  describe('syncFromSnapshot', () => {
    let bundle: LivestockMeshBundle;
    afterEach(() => bundle.dispose());

    it('routes entities into the correct per-archetype bucket', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 16 });
      const snap = makeSnapshot([
        { archetype: FISH_ARCHETYPE.SLIM_TETRA, position: [10, 0, 0] },
        { archetype: FISH_ARCHETYPE.DEEP_BODIED, position: [20, 0, 0] },
        { archetype: FISH_ARCHETYPE.SLIM_TETRA, position: [30, 0, 0] },
      ]);

      bundle.syncFromSnapshot(snap, 0);

      const slim = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
      const deep = meshForArchetype(bundle, FISH_ARCHETYPE.DEEP_BODIED);
      const barb = meshForArchetype(bundle, FISH_ARCHETYPE.BARB);

      expect(slim.count).toBe(2);
      expect(deep.count).toBe(1);
      expect(barb.count).toBe(0);

      const slimPos = (slim.geometry as BufferGeometry).getAttribute('instancePosition')
        .array as Float32Array;
      expect(slimPos[0]).toBe(10);
      expect(slimPos[3]).toBe(30);

      const deepPos = (deep.geometry as BufferGeometry).getAttribute('instancePosition')
        .array as Float32Array;
      expect(deepPos[0]).toBe(20);
    });

    it('writes position, orientation, phase, scale into the matching attributes', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 4 });
      const snap = makeSnapshot([
        {
          archetype: FISH_ARCHETYPE.BARB,
          position: [100, 50, 25],
          orientation: [0.1, 0.2, 0.3, 0.927],
          phase: 1.234,
          scale: 45,
        },
      ]);

      bundle.syncFromSnapshot(snap, 0);

      const barb = meshForArchetype(bundle, FISH_ARCHETYPE.BARB);
      const geo = barb.geometry as BufferGeometry;
      const pos = geo.getAttribute('instancePosition').array as Float32Array;
      const quat = geo.getAttribute('instanceQuat').array as Float32Array;
      const phase = geo.getAttribute('instancePhase').array as Float32Array;
      const scale = geo.getAttribute('instanceScale').array as Float32Array;

      expect(Array.from(pos.slice(0, 3))).toEqual([100, 50, 25]);
      expect(quat[0]).toBeCloseTo(0.1, 5);
      expect(quat[1]).toBeCloseTo(0.2, 5);
      expect(quat[2]).toBeCloseTo(0.3, 5);
      expect(quat[3]).toBeCloseTo(0.927, 5);
      expect(phase[0]).toBeCloseTo(1.234, 5);
      expect(scale[0]).toBeCloseTo(45, 5);
    });

    it('flags the updated attributes as needsUpdate after sync', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 4 });
      const snap = makeSnapshot([{ archetype: FISH_ARCHETYPE.SLIM_TETRA }]);
      bundle.syncFromSnapshot(snap, 0);
      const mesh = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
      const geo = mesh.geometry as BufferGeometry;
      // Three's `needsUpdate = true` setter flips a `version` counter
      // and resets the flag to false. Either way, version > 0 proves
      // we asked for an upload.
      expect((geo.getAttribute('instancePosition') as InstancedBufferAttribute).version).toBe(1);
      expect((geo.getAttribute('instanceQuat') as InstancedBufferAttribute).version).toBe(1);
      expect((geo.getAttribute('instancePhase') as InstancedBufferAttribute).version).toBe(1);
      expect((geo.getAttribute('instanceScale') as InstancedBufferAttribute).version).toBe(1);
    });

    it('updates the uTime uniform on every sync', () => {
      bundle = buildLivestockMeshes();
      const snap = makeSnapshot([]);

      bundle.syncFromSnapshot(snap, 1.5);
      let mesh = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
      let mat = mesh.material as ShaderMaterial;
      expect(mat.uniforms['uTime']!.value).toBe(1.5);

      bundle.syncFromSnapshot(snap, 4.25);
      mesh = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
      mat = mesh.material as ShaderMaterial;
      expect(mat.uniforms['uTime']!.value).toBe(4.25);
    });

    it('clamps to maxInstancesPerArchetype and warns once on overflow', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 2 });

      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const snap = makeSnapshot([
          { archetype: FISH_ARCHETYPE.SLIM_TETRA, position: [1, 0, 0] },
          { archetype: FISH_ARCHETYPE.SLIM_TETRA, position: [2, 0, 0] },
          { archetype: FISH_ARCHETYPE.SLIM_TETRA, position: [3, 0, 0] },
          { archetype: FISH_ARCHETYPE.SLIM_TETRA, position: [4, 0, 0] },
        ]);

        bundle.syncFromSnapshot(snap, 0);
        const slim = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
        expect(slim.count).toBe(2);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]![0]).toMatch(/exceeded maxInstancesPerArchetype/);

        // Second sync with the same overflow doesn't re-warn.
        bundle.syncFromSnapshot(snap, 0.5);
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    it('resets per-archetype counts to zero when the snapshot is empty', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 4 });
      const populated = makeSnapshot([{ archetype: FISH_ARCHETYPE.SLIM_TETRA }]);
      bundle.syncFromSnapshot(populated, 0);
      expect(meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA).count).toBe(1);

      bundle.syncFromSnapshot(makeSnapshot([]), 0.1);
      for (const child of bundle.group.children) {
        expect((child as InstancedMesh).count).toBe(0);
      }
    });

    it('ignores entries with unknown archetype ids without crashing', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 4 });
      const snap = makeSnapshot([
        { archetype: FISH_ARCHETYPE.SLIM_TETRA },
        // Archetype id 99 is not in the enum — should be silently
        // dropped (the renderer doesn't know how to mesh it).
        { archetype: 99 },
      ]);
      expect(() => bundle.syncFromSnapshot(snap, 0)).not.toThrow();
      expect(meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA).count).toBe(1);
    });

    it('is allocation-stable across repeated calls (same TypedArray identity)', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 4 });
      const mesh = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
      const geo = mesh.geometry as BufferGeometry;
      const arrBefore = geo.getAttribute('instancePosition').array;

      for (let i = 0; i < 10; i++) {
        bundle.syncFromSnapshot(makeSnapshot([{ archetype: FISH_ARCHETYPE.SLIM_TETRA }]), i * 0.1);
      }

      const arrAfter = geo.getAttribute('instancePosition').array;
      expect(arrAfter).toBe(arrBefore);
    });
  });

  describe('food sprite billboards (F11.4 Wave 4)', () => {
    let bundle: LivestockMeshBundle;
    afterEach(() => bundle.dispose());

    it('adds a dedicated InstancedMesh for food sprites under the same group', () => {
      bundle = buildLivestockMeshes();
      // 7 archetypes (F11.6 Wave 2 added crawler) + food sprite + bubble = 9 children.
      expect(bundle.group.children).toHaveLength(9);
      expect(bundle.foodSpriteMesh.isInstancedMesh).toBe(true);
      expect(bundle.foodSpriteMesh.name).toBe('aquascape:livestock/food-sprite');
      // The exposed handle is a sibling under the same group, not a
      // separate scene-graph node.
      expect(bundle.group.children).toContain(bundle.foodSpriteMesh);
    });

    it('uses a 4-vertex quad geometry for the billboard', () => {
      bundle = buildLivestockMeshes();
      const geo = bundle.foodSpriteMesh.geometry as BufferGeometry;
      // PlaneGeometry has 4 vertices + 2 triangles regardless of size.
      expect(geo.getAttribute('position').count).toBe(4);
    });

    it('attaches the instancePosition attribute sized to maxFoodSprites', () => {
      bundle = buildLivestockMeshes({ maxFoodSprites: 32 });
      const geo = bundle.foodSpriteMesh.geometry as BufferGeometry;
      const attr = geo.getAttribute('instancePosition') as InstancedBufferAttribute;
      expect(attr).toBeDefined();
      expect(attr.count).toBe(32);
      expect(attr.itemSize).toBe(3);
      expect(attr.array.length).toBe(32 * 3);
    });

    it('defaults maxFoodSprites to 64', () => {
      bundle = buildLivestockMeshes();
      const geo = bundle.foodSpriteMesh.geometry as BufferGeometry;
      const attr = geo.getAttribute('instancePosition') as InstancedBufferAttribute;
      expect(attr.count).toBe(64);
    });

    it('starts with foodSpriteMesh.count === 0 (no draws until first sync)', () => {
      bundle = buildLivestockMeshes();
      expect(bundle.foodSpriteMesh.count).toBe(0);
    });

    it('disables frustum culling on the food sprite mesh', () => {
      bundle = buildLivestockMeshes();
      expect(bundle.foodSpriteMesh.frustumCulled).toBe(false);
    });

    it('renders transparent + depth-write-off so the soft alpha mask reads cleanly', () => {
      bundle = buildLivestockMeshes();
      const mat = bundle.foodSpriteMesh.material as ShaderMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
    });

    it('rejects non-positive maxFoodSprites', () => {
      expect(() => buildLivestockMeshes({ maxFoodSprites: 0 })).toThrow(/maxFoodSprites/);
      expect(() => buildLivestockMeshes({ maxFoodSprites: -1 })).toThrow(/maxFoodSprites/);
      expect(() => buildLivestockMeshes({ maxFoodSprites: Infinity })).toThrow(/maxFoodSprites/);
    });

    it('writes snapshot.foodSpritePosition into the instancePosition attribute', () => {
      bundle = buildLivestockMeshes({ maxFoodSprites: 16 });
      const snap = makeSnapshot(
        [],
        [
          [100, 200, 50],
          [150, 180, 60],
          [200, 160, 70],
        ],
      );

      bundle.syncFromSnapshot(snap, 0);

      expect(bundle.foodSpriteMesh.count).toBe(3);
      const arr = (
        bundle.foodSpriteMesh.geometry as BufferGeometry
      ).getAttribute('instancePosition').array as Float32Array;
      expect(arr[0]).toBeCloseTo(100, 5);
      expect(arr[1]).toBeCloseTo(200, 5);
      expect(arr[2]).toBeCloseTo(50, 5);
      expect(arr[3]).toBeCloseTo(150, 5);
      expect(arr[6]).toBeCloseTo(200, 5);
      expect(arr[8]).toBeCloseTo(70, 5);
    });

    it('flags the instancePosition attribute as needsUpdate after a non-empty sync', () => {
      bundle = buildLivestockMeshes({ maxFoodSprites: 4 });
      const snap = makeSnapshot([], [[1, 2, 3]]);
      bundle.syncFromSnapshot(snap, 0);
      const attr = (
        bundle.foodSpriteMesh.geometry as BufferGeometry
      ).getAttribute('instancePosition') as InstancedBufferAttribute;
      // `version` increments per `needsUpdate = true` setter call.
      expect(attr.version).toBe(1);
    });

    it('sets foodSpriteMesh.count = 0 when the snapshot has no sprites', () => {
      bundle = buildLivestockMeshes({ maxFoodSprites: 4 });
      const populated = makeSnapshot([], [[1, 2, 3]]);
      bundle.syncFromSnapshot(populated, 0);
      expect(bundle.foodSpriteMesh.count).toBe(1);

      const empty = makeSnapshot([], []);
      bundle.syncFromSnapshot(empty, 0.1);
      expect(bundle.foodSpriteMesh.count).toBe(0);
    });

    it('clamps to maxFoodSprites and warns once on overflow', () => {
      bundle = buildLivestockMeshes({ maxFoodSprites: 2 });

      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const snap = makeSnapshot(
          [],
          [
            [1, 0, 0],
            [2, 0, 0],
            [3, 0, 0],
            [4, 0, 0],
          ],
        );

        bundle.syncFromSnapshot(snap, 0);
        expect(bundle.foodSpriteMesh.count).toBe(2);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]![0]).toMatch(/food sprite count.*exceeds maxFoodSprites/);

        // Second overflow doesn't re-warn.
        bundle.syncFromSnapshot(snap, 0.5);
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    it('keeps the fish slabs working when the snapshot also has food sprites', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 4, maxFoodSprites: 4 });
      const snap = makeSnapshot(
        [{ archetype: FISH_ARCHETYPE.SLIM_TETRA }],
        [[10, 20, 30]],
      );
      bundle.syncFromSnapshot(snap, 0);
      expect(meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA).count).toBe(1);
      expect(bundle.foodSpriteMesh.count).toBe(1);
    });

    it('exposes the food fragment uniform with the chosen colour', () => {
      bundle = buildLivestockMeshes({ foodColor: 0x123456 });
      const mat = bundle.foodSpriteMesh.material as ShaderMaterial;
      const color = mat.uniforms['uFoodColor']!.value as { getHex: () => number };
      expect(color.getHex()).toBe(0x123456);
    });
  });

  describe('food sprite billboard shader', () => {
    it('contains the view-space billboard formula `mvPosition.xy += position.xy`', () => {
      // Load-bearing — without this line the quad stays in world-space
      // orientation and fails to face the camera under orbit.
      expect(LIVESTOCK_FOOD_VERTEX_SHADER).toMatch(/mvPosition\.xy\s*\+=\s*position\.xy/);
    });

    it('writes gl_Position from projectionMatrix * mvPosition', () => {
      expect(LIVESTOCK_FOOD_VERTEX_SHADER).toMatch(
        /gl_Position\s*=\s*projectionMatrix\s*\*\s*mvPosition/,
      );
    });

    it('compiles a ShaderMaterial without throwing (smoke test)', () => {
      const bundle = buildLivestockMeshes();
      try {
        const mat = bundle.foodSpriteMesh.material as ShaderMaterial;
        expect(mat.vertexShader).toBe(LIVESTOCK_FOOD_VERTEX_SHADER);
        expect(mat.fragmentShader).toBeDefined();
        expect(mat.uniforms['uFoodColor']).toBeDefined();
      } finally {
        bundle.dispose();
      }
    });
  });

  describe('food sprite dispose', () => {
    it('disposes the food sprite geometry + material on bundle.dispose()', () => {
      const bundle = buildLivestockMeshes();
      const geo = bundle.foodSpriteMesh.geometry as BufferGeometry;
      const mat = bundle.foodSpriteMesh.material as Material;
      const geoSpy = jest.spyOn(geo, 'dispose');
      const matSpy = jest.spyOn(mat, 'dispose');

      bundle.dispose();

      expect(geoSpy).toHaveBeenCalledTimes(1);
      expect(matSpy).toHaveBeenCalledTimes(1);
    });

    it('detaches the food sprite mesh from the group', () => {
      const bundle = buildLivestockMeshes();
      const food = bundle.foodSpriteMesh;
      expect(bundle.group.children).toContain(food);
      bundle.dispose();
      expect(bundle.group.children).not.toContain(food);
    });

    it('is idempotent for the food sprite slot — second dispose is a no-op', () => {
      const bundle = buildLivestockMeshes();
      const geo = bundle.foodSpriteMesh.geometry as BufferGeometry;
      const mat = bundle.foodSpriteMesh.material as Material;
      bundle.dispose();

      const geoSpy = jest.spyOn(geo, 'dispose');
      const matSpy = jest.spyOn(mat, 'dispose');
      expect(() => bundle.dispose()).not.toThrow();
      expect(geoSpy).not.toHaveBeenCalled();
      expect(matSpy).not.toHaveBeenCalled();
    });
  });

  describe('bubble billboards (F11.5 Wave 5)', () => {
    let bundle: LivestockMeshBundle;
    afterEach(() => bundle.dispose());

    it('adds a dedicated InstancedMesh for bubbles under the same group', () => {
      bundle = buildLivestockMeshes();
      // 7 archetypes + food sprite + bubble = 9 children.
      expect(bundle.group.children).toHaveLength(9);
      expect(bundle.bubbleMesh.isInstancedMesh).toBe(true);
      expect(bundle.bubbleMesh.name).toBe('aquascape:livestock/bubble');
      expect(bundle.group.children).toContain(bundle.bubbleMesh);
    });

    it('uses a 4-vertex quad geometry for the bubble billboard', () => {
      bundle = buildLivestockMeshes();
      const geo = bundle.bubbleMesh.geometry as BufferGeometry;
      // PlaneGeometry has 4 vertices + 2 triangles regardless of size.
      expect(geo.getAttribute('position').count).toBe(4);
    });

    it('attaches the instancePosition attribute sized to maxBubbles', () => {
      bundle = buildLivestockMeshes({ maxBubbles: 128 });
      const geo = bundle.bubbleMesh.geometry as BufferGeometry;
      const attr = geo.getAttribute('instancePosition') as InstancedBufferAttribute;
      expect(attr).toBeDefined();
      expect(attr.count).toBe(128);
      expect(attr.itemSize).toBe(3);
      expect(attr.array.length).toBe(128 * 3);
    });

    it('defaults maxBubbles to 256', () => {
      bundle = buildLivestockMeshes();
      const geo = bundle.bubbleMesh.geometry as BufferGeometry;
      const attr = geo.getAttribute('instancePosition') as InstancedBufferAttribute;
      expect(attr.count).toBe(256);
    });

    it('starts with bubbleMesh.count === 0 (no draws until first sync)', () => {
      bundle = buildLivestockMeshes();
      expect(bundle.bubbleMesh.count).toBe(0);
    });

    it('disables frustum culling on the bubble mesh', () => {
      bundle = buildLivestockMeshes();
      expect(bundle.bubbleMesh.frustumCulled).toBe(false);
    });

    it('renders transparent + depth-write-off so the bubble alpha mask reads cleanly', () => {
      bundle = buildLivestockMeshes();
      const mat = bundle.bubbleMesh.material as ShaderMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
    });

    it('rejects non-positive maxBubbles', () => {
      expect(() => buildLivestockMeshes({ maxBubbles: 0 })).toThrow(/maxBubbles/);
      expect(() => buildLivestockMeshes({ maxBubbles: -1 })).toThrow(/maxBubbles/);
      expect(() => buildLivestockMeshes({ maxBubbles: Infinity })).toThrow(/maxBubbles/);
    });

    it('writes snapshot.bubblePosition into the instancePosition attribute', () => {
      bundle = buildLivestockMeshes({ maxBubbles: 16 });
      const snap = makeSnapshot(
        [],
        [],
        [
          [10, 100, 20],
          [11, 120, 21],
          [12, 140, 22],
          [13, 160, 23],
        ],
      );

      bundle.syncFromSnapshot(snap, 0);

      expect(bundle.bubbleMesh.count).toBe(4);
      const arr = (
        bundle.bubbleMesh.geometry as BufferGeometry
      ).getAttribute('instancePosition').array as Float32Array;
      expect(arr[0]).toBeCloseTo(10, 5);
      expect(arr[1]).toBeCloseTo(100, 5);
      expect(arr[2]).toBeCloseTo(20, 5);
      expect(arr[3]).toBeCloseTo(11, 5);
      expect(arr[6]).toBeCloseTo(12, 5);
      expect(arr[11]).toBeCloseTo(23, 5);
    });

    it('flags the instancePosition attribute as needsUpdate after a non-empty sync', () => {
      bundle = buildLivestockMeshes({ maxBubbles: 4 });
      const snap = makeSnapshot([], [], [[1, 2, 3]]);
      bundle.syncFromSnapshot(snap, 0);
      const attr = (
        bundle.bubbleMesh.geometry as BufferGeometry
      ).getAttribute('instancePosition') as InstancedBufferAttribute;
      expect(attr.version).toBe(1);
    });

    it('sets bubbleMesh.count = 0 when the snapshot has no bubbles', () => {
      bundle = buildLivestockMeshes({ maxBubbles: 4 });
      const populated = makeSnapshot([], [], [[1, 2, 3]]);
      bundle.syncFromSnapshot(populated, 0);
      expect(bundle.bubbleMesh.count).toBe(1);

      const empty = makeSnapshot([], [], []);
      bundle.syncFromSnapshot(empty, 0.1);
      expect(bundle.bubbleMesh.count).toBe(0);
    });

    it('clamps to maxBubbles and warns once on overflow', () => {
      bundle = buildLivestockMeshes({ maxBubbles: 2 });

      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const snap = makeSnapshot(
          [],
          [],
          [
            [1, 10, 0],
            [2, 20, 0],
            [3, 30, 0],
            [4, 40, 0],
          ],
        );

        bundle.syncFromSnapshot(snap, 0);
        expect(bundle.bubbleMesh.count).toBe(2);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]![0]).toMatch(/bubble count.*exceeds maxBubbles/);

        // Second overflow doesn't re-warn.
        bundle.syncFromSnapshot(snap, 0.5);
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    it('keeps the fish + food slabs working when the snapshot also has bubbles', () => {
      bundle = buildLivestockMeshes({
        maxInstancesPerArchetype: 4,
        maxFoodSprites: 4,
        maxBubbles: 4,
      });
      const snap = makeSnapshot(
        [{ archetype: FISH_ARCHETYPE.SLIM_TETRA }],
        [[10, 20, 30]],
        [
          [40, 50, 60],
          [41, 70, 60],
        ],
      );
      bundle.syncFromSnapshot(snap, 0);
      expect(meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA).count).toBe(1);
      expect(bundle.foodSpriteMesh.count).toBe(1);
      expect(bundle.bubbleMesh.count).toBe(2);
    });

    it('is allocation-stable across repeated bubble syncs (same TypedArray identity)', () => {
      bundle = buildLivestockMeshes({ maxBubbles: 16 });
      const arrBefore = (
        bundle.bubbleMesh.geometry as BufferGeometry
      ).getAttribute('instancePosition').array;
      for (let i = 0; i < 10; i++) {
        bundle.syncFromSnapshot(makeSnapshot([], [], [[i, 100, 0]]), i * 0.1);
      }
      const arrAfter = (
        bundle.bubbleMesh.geometry as BufferGeometry
      ).getAttribute('instancePosition').array;
      expect(arrAfter).toBe(arrBefore);
    });
  });

  describe('bubble billboard shader', () => {
    it('contains the view-space billboard formula `mvPosition.xy += position.xy`', () => {
      // Same load-bearing line as the food sprite — without it the
      // quad fails to face the camera under orbit.
      expect(LIVESTOCK_BUBBLE_VERTEX_SHADER).toMatch(/mvPosition\.xy\s*\+=\s*position\.xy/);
    });

    it('writes gl_Position from projectionMatrix * mvPosition', () => {
      expect(LIVESTOCK_BUBBLE_VERTEX_SHADER).toMatch(
        /gl_Position\s*=\s*projectionMatrix\s*\*\s*mvPosition/,
      );
    });

    it('hard-codes the blue-white bubble tone (~#e0f4ff family)', () => {
      // The vec3(0.85, 0.95, 1.00) baseline is the load-bearing colour;
      // the fragment mixes it with vec3(1.0) under a small top-of-sphere
      // highlight to produce the bubble read.
      expect(LIVESTOCK_BUBBLE_FRAGMENT_SHADER).toMatch(
        /vec3\(\s*0\.85\s*,\s*0\.95\s*,\s*1\.00\s*\)/,
      );
    });

    it('anchors the highlight above the geometric centre (vec2(0.5, 0.65))', () => {
      // Off-centre highlight → sphere-catching-light read. Centering
      // would lose the bubble silhouette.
      expect(LIVESTOCK_BUBBLE_FRAGMENT_SHADER).toMatch(/vec2\(\s*0\.5\s*,\s*0\.65\s*\)/);
    });

    it('compiles a ShaderMaterial without throwing (smoke test)', () => {
      const bundle = buildLivestockMeshes();
      try {
        const mat = bundle.bubbleMesh.material as ShaderMaterial;
        expect(mat.vertexShader).toBe(LIVESTOCK_BUBBLE_VERTEX_SHADER);
        expect(mat.fragmentShader).toBe(LIVESTOCK_BUBBLE_FRAGMENT_SHADER);
      } finally {
        bundle.dispose();
      }
    });
  });

  describe('bubble dispose', () => {
    it('disposes the bubble geometry + material on bundle.dispose()', () => {
      const bundle = buildLivestockMeshes();
      const geo = bundle.bubbleMesh.geometry as BufferGeometry;
      const mat = bundle.bubbleMesh.material as Material;
      const geoSpy = jest.spyOn(geo, 'dispose');
      const matSpy = jest.spyOn(mat, 'dispose');

      bundle.dispose();

      expect(geoSpy).toHaveBeenCalledTimes(1);
      expect(matSpy).toHaveBeenCalledTimes(1);
    });

    it('detaches the bubble mesh from the group', () => {
      const bundle = buildLivestockMeshes();
      const bubble = bundle.bubbleMesh;
      expect(bundle.group.children).toContain(bubble);
      bundle.dispose();
      expect(bundle.group.children).not.toContain(bubble);
    });

    it('is idempotent for the bubble slot — second dispose is a no-op', () => {
      const bundle = buildLivestockMeshes();
      const geo = bundle.bubbleMesh.geometry as BufferGeometry;
      const mat = bundle.bubbleMesh.material as Material;
      bundle.dispose();

      const geoSpy = jest.spyOn(geo, 'dispose');
      const matSpy = jest.spyOn(mat, 'dispose');
      expect(() => bundle.dispose()).not.toThrow();
      expect(geoSpy).not.toHaveBeenCalled();
      expect(matSpy).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('disposes every geometry and material exactly once', () => {
      const bundle = buildLivestockMeshes();
      const geometries: BufferGeometry[] = [];
      const materials: Material[] = [];
      for (const child of bundle.group.children) {
        const mesh = child as InstancedMesh;
        geometries.push(mesh.geometry as BufferGeometry);
        materials.push(mesh.material as Material);
      }

      const geoSpies = geometries.map((g) => jest.spyOn(g, 'dispose'));
      const matSpies = materials.map((m) => jest.spyOn(m, 'dispose'));

      bundle.dispose();

      for (const spy of geoSpies) expect(spy).toHaveBeenCalledTimes(1);
      for (const spy of matSpies) expect(spy).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — calling dispose twice does not throw or re-dispose', () => {
      const bundle = buildLivestockMeshes();
      // Capture refs BEFORE first dispose, since dispose detaches children.
      const meshes = bundle.group.children.map((c) => c as InstancedMesh);

      bundle.dispose();

      const geoSpies = meshes.map((m) => jest.spyOn(m.geometry as BufferGeometry, 'dispose'));
      const matSpies = meshes.map((m) => jest.spyOn(m.material as Material, 'dispose'));

      expect(() => bundle.dispose()).not.toThrow();
      for (const spy of geoSpies) expect(spy).not.toHaveBeenCalled();
      for (const spy of matSpies) expect(spy).not.toHaveBeenCalled();
    });

    it('clears all children from the group after dispose', () => {
      const bundle = buildLivestockMeshes();
      // 7 archetypes (F11.6 Wave 2 added crawler) + food sprite + bubble = 9 children.
      expect(bundle.group.children).toHaveLength(9);
      bundle.dispose();
      expect(bundle.group.children).toHaveLength(0);
    });

    it('makes syncFromSnapshot a no-op after dispose', () => {
      const bundle = buildLivestockMeshes();
      bundle.dispose();
      // No throw, no work — meshes are already detached + geometries disposed.
      expect(() =>
        bundle.syncFromSnapshot(makeSnapshot([{ archetype: FISH_ARCHETYPE.SLIM_TETRA }]), 1),
      ).not.toThrow();
    });
  });

  describe('carangiform vertex shader', () => {
    it('embeds the documented amplitude envelope formula', () => {
      // Either the canonical form or a whitespace-equivalent variant
      // is acceptable, but the load-bearing identifiers + power-curve
      // shape must be present.
      expect(LIVESTOCK_VERTEX_SHADER).toMatch(/instanceAmpHead/);
      expect(LIVESTOCK_VERTEX_SHADER).toMatch(/instanceAmpTail/);
      expect(LIVESTOCK_VERTEX_SHADER).toMatch(/pow\(\s*s\s*,\s*uEnvelopeExp\s*\)/);
    });

    it('embeds the documented phase formula and lateral (+Z) displacement', () => {
      // phase = 2π * (uTime * freq − s) + instancePhase
      expect(LIVESTOCK_VERTEX_SHADER).toMatch(
        /2\.0\s*\*\s*PI\s*\*\s*\(\s*uTime\s*\*\s*instanceTailBeatFreq\s*-\s*s\s*\)\s*\+\s*instancePhase/,
      );
      // displaced = position + vec3(0, 0, amp * sin(phase))
      expect(LIVESTOCK_VERTEX_SHADER).toMatch(
        /vec3\(\s*0\.0\s*,\s*0\.0\s*,\s*amp\s*\*\s*sin\(\s*phase\s*\)\s*\)/,
      );
    });

    it('rotates both the displaced position and the normal by the per-instance quaternion', () => {
      // We need the same rotation applied to `normal` so lighting is
      // stable across orientations — a regression here would yield
      // fish lit as if they were always facing +X.
      expect(LIVESTOCK_VERTEX_SHADER).toMatch(/rotateByQuat\(\s*scaled\s*,\s*instanceQuat\s*\)/);
      expect(LIVESTOCK_VERTEX_SHADER).toMatch(/rotateByQuat\(\s*normal\s*,\s*instanceQuat\s*\)/);
    });

    it('multiplies by projectionMatrix * modelViewMatrix for the final clip-space write', () => {
      expect(LIVESTOCK_VERTEX_SHADER).toMatch(
        /gl_Position\s*=\s*projectionMatrix\s*\*\s*modelViewMatrix\s*\*\s*vec4\(\s*worldPos/,
      );
    });

    it('compiles a ShaderMaterial without throwing (smoke test)', () => {
      // We don't need a GL context to construct a ShaderMaterial —
      // three only compiles the shader on first render. This catches
      // gross syntactic mistakes that surface at module-construction
      // time (mismatched braces in the prefix, missing uniforms list,
      // etc.).
      const bundle = buildLivestockMeshes();
      try {
        const mesh = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
        const mat = mesh.material as ShaderMaterial;
        expect(mat.vertexShader).toBe(LIVESTOCK_VERTEX_SHADER);
        expect(mat.fragmentShader).toBeDefined();
        expect(mat.uniforms['uTime']).toBeDefined();
        expect(mat.uniforms['uEnvelopeExp']!.value).toBeCloseTo(2.5, 5);
      } finally {
        bundle.dispose();
      }
    });
  });

  describe('crawler archetype (F11.6 Wave 2)', () => {
    let bundle: LivestockMeshBundle;
    afterEach(() => bundle.dispose());

    it('builds a 7th archetype InstancedMesh named "aquascape:livestock/crawler"', () => {
      bundle = buildLivestockMeshes();
      const crawler = meshForArchetype(bundle, FISH_ARCHETYPE.CRAWLER);
      expect(crawler.isInstancedMesh).toBe(true);
      expect(crawler.name).toBe('aquascape:livestock/crawler');
    });

    it('matches the crawler InstancedMesh geometry to buildCrawlerGeometry()', () => {
      bundle = buildLivestockMeshes();
      const crawler = meshForArchetype(bundle, FISH_ARCHETYPE.CRAWLER);
      const expectedVerts = buildCrawlerGeometry().positions.length / 3;
      const got = (crawler.geometry as BufferGeometry).getAttribute('position').count;
      expect(got).toBe(expectedVerts);
    });

    it('routes Archetype=CRAWLER entities into the crawler bucket', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 8 });
      const snap = makeSnapshot([
        { archetype: FISH_ARCHETYPE.CRAWLER, position: [10, 5, 20] },
        { archetype: FISH_ARCHETYPE.SLIM_TETRA, position: [30, 100, 40] },
        { archetype: FISH_ARCHETYPE.CRAWLER, position: [50, 5, 60] },
      ]);

      bundle.syncFromSnapshot(snap, 0);

      const crawler = meshForArchetype(bundle, FISH_ARCHETYPE.CRAWLER);
      const slim = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
      expect(crawler.count).toBe(2);
      expect(slim.count).toBe(1);

      const cPos = (crawler.geometry as BufferGeometry).getAttribute('instancePosition')
        .array as Float32Array;
      expect(cPos[0]).toBe(10);
      expect(cPos[3]).toBe(50);
    });

    it('zeroes instanceAmpHead + instanceAmpTail on crawler instances after sync (no tail wiggle)', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 4 });
      const snap = makeSnapshot([
        { archetype: FISH_ARCHETYPE.CRAWLER, position: [0, 0, 0], phase: 1.5 },
        { archetype: FISH_ARCHETYPE.CRAWLER, position: [50, 0, 0], phase: 3.0 },
      ]);
      bundle.syncFromSnapshot(snap, 0);

      const crawler = meshForArchetype(bundle, FISH_ARCHETYPE.CRAWLER);
      const geo = crawler.geometry as BufferGeometry;
      const ampHead = geo.getAttribute('instanceAmpHead').array as Float32Array;
      const ampTail = geo.getAttribute('instanceAmpTail').array as Float32Array;

      // Both crawler instances must have zero amp so the carangiform
      // vertex shader produces zero displacement regardless of phase.
      expect(ampHead[0]).toBe(0);
      expect(ampHead[1]).toBe(0);
      expect(ampTail[0]).toBe(0);
      expect(ampTail[1]).toBe(0);
    });

    it('leaves non-crawler archetype amps untouched (default tail-beat preserved)', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 4 });
      const snap = makeSnapshot([
        { archetype: FISH_ARCHETYPE.SLIM_TETRA, position: [0, 100, 0] },
        { archetype: FISH_ARCHETYPE.CRAWLER, position: [0, 5, 0] },
      ]);
      bundle.syncFromSnapshot(snap, 0);

      const slim = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
      const ampHead = (slim.geometry as BufferGeometry).getAttribute('instanceAmpHead')
        .array as Float32Array;
      const ampTail = (slim.geometry as BufferGeometry).getAttribute('instanceAmpTail')
        .array as Float32Array;
      // Construction-time defaults stand for tetras — 0.02 head, 0.12 tail.
      expect(ampHead[0]).toBeCloseTo(0.02, 5);
      expect(ampTail[0]).toBeCloseTo(0.12, 5);
    });

    it('flags the crawler amp attributes as needsUpdate after a sync that wrote zeroes', () => {
      bundle = buildLivestockMeshes({ maxInstancesPerArchetype: 4 });
      const snap = makeSnapshot([{ archetype: FISH_ARCHETYPE.CRAWLER, position: [0, 0, 0] }]);
      bundle.syncFromSnapshot(snap, 0);
      const crawler = meshForArchetype(bundle, FISH_ARCHETYPE.CRAWLER);
      const geo = crawler.geometry as BufferGeometry;
      // `version > 0` means the GPU was asked to upload the zeroed amp.
      expect((geo.getAttribute('instanceAmpHead') as InstancedBufferAttribute).version).toBe(1);
      expect((geo.getAttribute('instanceAmpTail') as InstancedBufferAttribute).version).toBe(1);
    });

    it('disposes the crawler mesh on bundle.dispose()', () => {
      bundle = buildLivestockMeshes();
      const crawler = meshForArchetype(bundle, FISH_ARCHETYPE.CRAWLER);
      const geo = crawler.geometry as BufferGeometry;
      const mat = crawler.material as ShaderMaterial;
      const geoSpy = jest.spyOn(geo, 'dispose');
      const matSpy = jest.spyOn(mat, 'dispose');
      bundle.dispose();
      expect(geoSpy).toHaveBeenCalledTimes(1);
      expect(matSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('custom default body color', () => {
    it('accepts a hex literal and stores the resulting Color on the material uniform', () => {
      // Three converts hex literals via the active working colour
      // space (sRGB → linear by default since r152), so we don't pin
      // exact channel values — just confirm the right hex was applied
      // by comparing against a freshly-constructed sibling Color.
      const bundle = buildLivestockMeshes({ defaultBodyColor: 0xff8800 });
      try {
        const mesh = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
        const mat = mesh.material as ShaderMaterial;
        const color = mat.uniforms['uBodyColor']!.value as { getHex: () => number };
        expect(color.getHex()).toBe(0xff8800);
      } finally {
        bundle.dispose();
      }
    });

    it('falls back to the default silver-tetra blue when no color is supplied', () => {
      const bundle = buildLivestockMeshes();
      try {
        const mesh = meshForArchetype(bundle, FISH_ARCHETYPE.SLIM_TETRA);
        const mat = mesh.material as ShaderMaterial;
        const color = mat.uniforms['uBodyColor']!.value as { getHex: () => number };
        expect(color.getHex()).toBe(0x9ec5d6);
      } finally {
        bundle.dispose();
      }
    });
  });
});
