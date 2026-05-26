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
import { LIVESTOCK_VERTEX_SHADER } from './shaders';

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeSnapshot(
  entries: ReadonlyArray<{
    archetype: number;
    position?: [number, number, number];
    orientation?: [number, number, number, number];
    phase?: number;
    scale?: number;
  }>,
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

  return { entityCount: n, ids, position, orientation, phase, archetype, scale };
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
  };
  return `aquascape:livestock/${label[archetypeId]!}`;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('buildLivestockMeshes', () => {
  describe('group construction', () => {
    let bundle: LivestockMeshBundle;
    afterEach(() => bundle.dispose());

    it('returns a named Group containing one InstancedMesh per archetype', () => {
      bundle = buildLivestockMeshes();
      expect(bundle.group.name).toBe('aquascape:livestock');
      expect(bundle.group.children).toHaveLength(6);
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
      expect(bundle.group.children).toHaveLength(6);
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
