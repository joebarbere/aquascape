/**
 * Test fixtures and fast-check arbitraries for `domain/scene-model`.
 *
 * These are NOT part of the public API — they live in `src/` so spec files
 * can co-locate, but `src/index.ts` deliberately does not re-export them.
 * The published lib stays slim.
 */

import fc from 'fast-check';
import { identityTransform } from '@aquascape/domain/geometry';
import type { Transform } from '@aquascape/domain/geometry';

import { asLayerId, asObjectId } from './ids';
import type {
  CatalogRef,
  Layer,
  LayerId,
  ObjectId,
  PlantObject,
  Scene,
  SceneObject,
  Substrate,
  Tank,
  TankStyle,
  HardscapeObject,
  DecorObject,
} from './types';

// ─── Hand-crafted fixtures ────────────────────────────────────────────────

export const sampleTank: Tank = {
  width: 360,
  height: 220,
  depth: 220,
  glassThickness: 5,
  style: {
    frame: 'rimless',
    background: { kind: 'color', color: '#0b0d0e' },
  },
};

export const sampleSubstrate: Substrate = {
  regions: [
    {
      id: '1a2b3c4d-0001-4000-8000-000000000001',
      material: { catalog: 'core', id: 'substrate.soil', version: 1 },
      fromX: 0,
      toX: 1,
      profile: [
        { x: 0, y: 30 },
        { x: 1, y: 50 },
      ],
    },
  ],
};

export const sampleCatalogRef: CatalogRef = {
  catalog: 'core',
  id: 'rock.seiryu.large-01',
  version: 1,
};

export function makeHardscape(id: string, x = 100, y = 50, z = 80): HardscapeObject {
  return {
    kind: 'hardscape',
    id: asObjectId(id),
    ref: sampleCatalogRef,
    category: 'rock',
    transform: {
      ...identityTransform(),
      position: { x, y, z },
    },
  };
}

export function makePlant(id: string, x = 50, y = 30, z = 60): PlantObject {
  return {
    kind: 'plant',
    id: asObjectId(id),
    ref: { catalog: 'core', id: 'plant.eleocharis', version: 1 },
    growth: { ageWeeks: 4, vigor: 1 },
    transform: {
      ...identityTransform(),
      position: { x, y, z },
    },
  };
}

export function makeDecor(id: string): DecorObject {
  return {
    kind: 'decor',
    id: asObjectId(id),
    ref: { catalog: 'core', id: 'decor.fish.boraras', version: 1 },
    transform: identityTransform(),
  };
}

export function makeLayer(
  id: string,
  name: string,
  objects: SceneObject[] = [],
  locked = false,
): Layer {
  return {
    id: asLayerId(id),
    name,
    opacity: 1,
    visible: true,
    locked,
    objects,
  };
}

/** A small scene with two layers and a couple of objects for unit tests. */
export function makeScene(): Scene {
  return {
    tank: structuredClone(sampleTank),
    substrate: structuredClone(sampleSubstrate),
    layers: [
      makeLayer('11111111-0000-4000-8000-000000000001', 'Hardscape', [
        makeHardscape('aaaaaaaa-0000-4000-8000-000000000001', 200, 80, 100),
        makeHardscape('aaaaaaaa-0000-4000-8000-000000000002', 110, 50, 90),
      ]),
      makeLayer('11111111-0000-4000-8000-000000000002', 'Carpet', [
        makePlant('bbbbbbbb-0000-4000-8000-000000000001'),
      ]),
    ],
    seed: 1337,
  };
}

// ─── fast-check arbitraries ───────────────────────────────────────────────

/**
 * Finite number arbitrary that never emits `-0`.
 *
 * `JSON.stringify(-0)` produces `"0"`, so any arbitrary that can emit
 * `-0` will make the JSON round-trip property fail (cosmetically). The
 * scene model treats `-0` and `0` as observationally equivalent; we
 * filter `-0` out at the source rather than smuggling a tolerant
 * deep-equals into every property test.
 */
const finite = (max = 1000): fc.Arbitrary<number> =>
  fc.double({ min: -max, max, noNaN: true }).map((n) => (Object.is(n, -0) ? 0 : n));

/**
 * Uniform-scale, no-flips Transform. Matches the well-conditioned slice
 * that geometry's own property tests pin (see geometry/README.md).
 */
export const arbTransform = (): fc.Arbitrary<Transform> =>
  fc
    .record({
      position: fc.record({
        x: finite(1000),
        y: finite(1000),
        z: finite(1000),
      }),
      rotation: fc.record({
        x: finite(1.4),
        y: finite(1.4),
        z: finite(1.4),
      }),
      uniformScale: fc.double({ min: 0.1, max: 10, noNaN: true }),
    })
    .map(({ position, rotation, uniformScale }) => ({
      position,
      rotation,
      scale: { x: uniformScale, y: uniformScale, z: uniformScale },
      flipX: false,
      flipY: false,
    }));

export const arbCatalogRef = (): fc.Arbitrary<CatalogRef> =>
  fc.record({
    catalog: fc.constantFrom('core', 'community'),
    id: fc.string({ minLength: 1, maxLength: 20 }),
    version: fc.integer({ min: 1, max: 5 }),
  });

const arbObjectId = (): fc.Arbitrary<ObjectId> => fc.uuid({ version: 4 }).map(asObjectId);

const arbLayerId = (): fc.Arbitrary<LayerId> => fc.uuid({ version: 4 }).map(asLayerId);

export const arbHardscape = (): fc.Arbitrary<HardscapeObject> =>
  fc
    .record({
      id: arbObjectId(),
      ref: arbCatalogRef(),
      transform: arbTransform(),
      category: fc.constantFrom('rock', 'wood', 'other'),
    })
    .map((r) => ({
      kind: 'hardscape' as const,
      id: r.id,
      ref: r.ref,
      transform: r.transform,
      category: r.category,
    }));

export const arbPlant = (): fc.Arbitrary<PlantObject> =>
  fc
    .record({
      id: arbObjectId(),
      ref: arbCatalogRef(),
      transform: arbTransform(),
      ageWeeks: fc.integer({ min: 0, max: 52 }),
      vigor: fc.double({ min: 0.1, max: 3, noNaN: true }),
    })
    .map((r) => ({
      kind: 'plant' as const,
      id: r.id,
      ref: r.ref,
      transform: r.transform,
      growth: { ageWeeks: r.ageWeeks, vigor: r.vigor },
    }));

export const arbDecor = (): fc.Arbitrary<DecorObject> =>
  fc
    .record({
      id: arbObjectId(),
      ref: arbCatalogRef(),
      transform: arbTransform(),
    })
    .map((r) => ({
      kind: 'decor' as const,
      id: r.id,
      ref: r.ref,
      transform: r.transform,
    }));

export const arbSceneObject = (): fc.Arbitrary<SceneObject> =>
  fc.oneof(arbHardscape(), arbPlant(), arbDecor());

export const arbTank = (): fc.Arbitrary<Tank> =>
  fc
    .record({
      width: fc.integer({ min: 100, max: 2000 }),
      height: fc.integer({ min: 100, max: 1000 }),
      depth: fc.integer({ min: 100, max: 1000 }),
    })
    .map((r) => ({
      width: r.width,
      height: r.height,
      depth: r.depth,
      style: { frame: 'rimless', background: { kind: 'none' } } satisfies TankStyle,
    }));

export const arbSubstrate = (): fc.Arbitrary<Substrate> => fc.constant({ regions: [] });

/** Build a layer with `n` distinct objects. Ids are unique per layer. */
export const arbLayer = (): fc.Arbitrary<Layer> =>
  fc
    .record({
      id: arbLayerId(),
      name: fc.string({ minLength: 1, maxLength: 20 }),
      opacity: fc.double({ min: 0, max: 1, noNaN: true }),
      visible: fc.boolean(),
      locked: fc.boolean(),
      objects: fc.uniqueArray(arbSceneObject(), {
        maxLength: 4,
        selector: (o) => o.id,
      }),
    })
    .map((r) => ({
      id: r.id,
      name: r.name,
      opacity: r.opacity,
      visible: r.visible,
      locked: r.locked,
      objects: r.objects,
    }));

/**
 * A random scene with layer & object ids guaranteed unique across the
 * whole scene (not just per-layer).
 */
export const arbScene = (): fc.Arbitrary<Scene> =>
  fc
    .record({
      tank: arbTank(),
      substrate: arbSubstrate(),
      layers: fc.uniqueArray(arbLayer(), { maxLength: 4, selector: (l) => l.id }),
      seed: fc.integer({ min: 0, max: 1_000_000 }),
    })
    .map((r) => {
      // Dedupe object ids across layers — keep first occurrence.
      const seen = new Set<string>();
      const layers = r.layers.map((l) => ({
        ...l,
        objects: l.objects.filter((o) => {
          if (seen.has(o.id)) return false;
          seen.add(o.id);
          return true;
        }),
      }));
      return {
        tank: r.tank,
        substrate: r.substrate,
        layers,
        seed: r.seed,
      };
    });
