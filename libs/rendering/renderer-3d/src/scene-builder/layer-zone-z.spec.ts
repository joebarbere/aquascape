import type { HardscapeObject, Layer, LayerId, ObjectId, Scene } from '@aquascape/domain/scene-model';
import { computeZonedZ } from './layer-zone-z';

function rockObj(id: string, z: number): HardscapeObject {
  return {
    id: id as ObjectId,
    kind: 'hardscape',
    ref: { catalog: 'core', id: 'rock.test', version: 1 },
    transform: {
      position: { x: 0, y: 0, z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      flipX: false,
      flipY: false,
    },
  };
}

function sceneWithLayer(
  objects: HardscapeObject[],
  zone?: 'foreground' | 'midground' | 'background',
  tankDepth = 300,
): Scene {
  const layer: Layer = {
    id: 'L' as LayerId,
    name: 'layer',
    opacity: 1,
    visible: true,
    locked: false,
    objects,
    ...(zone !== undefined ? { zone } : {}),
  };
  return {
    tank: {
      width: 600,
      height: 360,
      depth: tankDepth,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: [] },
    layers: [layer],
    seed: 1,
  };
}

describe('computeZonedZ', () => {
  it('passes through transform.position.z unchanged when the layer has no zone', () => {
    const scene = sceneWithLayer([rockObj('a', 73), rockObj('b', 200)]);
    expect(computeZonedZ(scene, 'a' as ObjectId, 'L' as LayerId)).toBe(73);
    expect(computeZonedZ(scene, 'b' as ObjectId, 'L' as LayerId)).toBe(200);
  });

  it('foreground band remaps onto [0, tank.depth / 3]', () => {
    // tank depth 300 → foreground band [0, 100]. Two rocks at z = 10 and 90
    // (spread 80). The MIN remaps to 0, the MAX remaps to 100.
    const scene = sceneWithLayer([rockObj('a', 10), rockObj('b', 90)], 'foreground');
    expect(computeZonedZ(scene, 'a' as ObjectId, 'L' as LayerId)).toBeCloseTo(0, 6);
    expect(computeZonedZ(scene, 'b' as ObjectId, 'L' as LayerId)).toBeCloseTo(100, 6);
  });

  it('midground band remaps onto [tank.depth / 3, 2 × tank.depth / 3]', () => {
    const scene = sceneWithLayer([rockObj('a', 0), rockObj('b', 50)], 'midground');
    // depth 300 → midground [100, 200].
    expect(computeZonedZ(scene, 'a' as ObjectId, 'L' as LayerId)).toBeCloseTo(100, 6);
    expect(computeZonedZ(scene, 'b' as ObjectId, 'L' as LayerId)).toBeCloseTo(200, 6);
  });

  it('background band remaps onto [2 × tank.depth / 3, tank.depth]', () => {
    const scene = sceneWithLayer([rockObj('a', 0), rockObj('b', 1)], 'background');
    // depth 300 → background [200, 300]
    expect(computeZonedZ(scene, 'a' as ObjectId, 'L' as LayerId)).toBeCloseTo(200, 6);
    expect(computeZonedZ(scene, 'b' as ObjectId, 'L' as LayerId)).toBeCloseTo(300, 6);
  });

  it('preserves relative ordering within a band (algorithm A)', () => {
    // Three rocks at z = 0, 25, 100 with band foreground [0, 100].
    // Min (0) → 0, max (100) → 100, mid (25) → 25.
    const scene = sceneWithLayer(
      [rockObj('a', 0), rockObj('b', 25), rockObj('c', 100)],
      'foreground',
    );
    const za = computeZonedZ(scene, 'a' as ObjectId, 'L' as LayerId);
    const zb = computeZonedZ(scene, 'b' as ObjectId, 'L' as LayerId);
    const zc = computeZonedZ(scene, 'c' as ObjectId, 'L' as LayerId);
    expect(za).toBeLessThan(zb);
    expect(zb).toBeLessThan(zc);
    expect(zb).toBeCloseTo(25, 6);
  });

  it('places a single-object layer at the band centre (no relative ordering possible)', () => {
    const scene = sceneWithLayer([rockObj('a', 999)], 'midground');
    // depth 300 → midground centre = 150.
    expect(computeZonedZ(scene, 'a' as ObjectId, 'L' as LayerId)).toBe(150);
  });

  it('places every object at the band centre when the layer z-spread is zero', () => {
    const scene = sceneWithLayer(
      [rockObj('a', 50), rockObj('b', 50), rockObj('c', 50)],
      'background',
    );
    const centre = 250; // depth 300 → background [200, 300] → centre 250
    expect(computeZonedZ(scene, 'a' as ObjectId, 'L' as LayerId)).toBe(centre);
    expect(computeZonedZ(scene, 'b' as ObjectId, 'L' as LayerId)).toBe(centre);
    expect(computeZonedZ(scene, 'c' as ObjectId, 'L' as LayerId)).toBe(centre);
  });

  it('falls back to the object Z (or 0) when the caller passes a wrong layer id', () => {
    const scene = sceneWithLayer([rockObj('a', 73)], 'foreground');
    expect(computeZonedZ(scene, 'a' as ObjectId, 'NOPE' as LayerId)).toBe(73);
    expect(computeZonedZ(scene, 'ghost' as ObjectId, 'NOPE' as LayerId)).toBe(0);
  });

  it('falls back to the object Z when the object is not in the named layer', () => {
    const scene = sceneWithLayer([rockObj('a', 73)], 'foreground');
    // Object id `ghost` doesn't exist in layer L; lookup walks all layers,
    // doesn't find it, returns 0.
    expect(computeZonedZ(scene, 'ghost' as ObjectId, 'L' as LayerId)).toBe(0);
  });

  it('returns the original z when tank depth is 0 (degenerate scene)', () => {
    const scene = sceneWithLayer([rockObj('a', 73)], 'foreground', 0);
    expect(computeZonedZ(scene, 'a' as ObjectId, 'L' as LayerId)).toBe(73);
  });
});
