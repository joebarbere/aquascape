/**
 * fast-check arbitraries that produce structurally-valid `AquaDocument`s for
 * round-trip and property tests.
 *
 * Coverage goal: exercise every branch the JSON Schema admits — every
 * background `kind`, every scene-object `kind`, optional fields present and
 * absent, multi-region substrates, livestock + equipment, extensions bag.
 * The generators stay deterministic-by-seed (fast-check default) so failures
 * are reproducible.
 *
 * The arbitraries produce documents that are *both* `JSON.parse(JSON.stringify(x))`
 * lossless (no `undefined`s, no NaN/Infinity) AND pass `validateAquaDocument`.
 */

import fc from 'fast-check';

import type {
  AquaDocument,
  AssetRef,
  CatalogRef,
  DecorObject,
  DocumentMeta,
  EquipmentEntry,
  HardscapeObject,
  HexColor,
  Layer,
  LivestockEntry,
  PlantObject,
  RenderRecord,
  SceneObject,
  Substrate,
  SubstrateRegion,
  Tank,
  TankStyle,
  Transform,
  WaterChemistry,
} from '@aquascape/domain/document';
import { CURRENT_SCHEMA_VERSION } from '@aquascape/domain/document';

// ─── Primitives ───────────────────────────────────────────────────────────

/** UUID v4 string (compatible with AJV's `format: "uuid"`). */
const arbUuid = (): fc.Arbitrary<string> => fc.uuid({ version: 4 });

/**
 * Sane finite number, bounded so test-time arithmetic never NaNs out and
 * with `-0` folded to `0`. The fold matters because `JSON.stringify(-0) === '0'`
 * but `Object.is(-0, 0) === false`, and Jest's `toEqual` distinguishes them —
 * so a raw `fc.double` producing `-0` would break the JSON round-trip
 * invariant the format promises. No real document ever stores `-0`.
 */
const arbFiniteNumber = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map((x) => (Object.is(x, -0) ? 0 : x));

const arbMm = (min = 1, max = 10_000): fc.Arbitrary<number> =>
  fc.integer({ min, max });

/**
 * Recursively fold `-0` → `0` inside an arbitrary JSON value. Same rationale
 * as {@link arbFiniteNumber}: `JSON.stringify(-0) === '0'` collapses `-0` on
 * write, but `Object.is(-0, 0)` is `false` and Jest's `toEqual` distinguishes
 * them — so any nested `-0` in the `extensions` bag would break the
 * round-trip property without showing up as a real-document edge case. We
 * normalize the generated value rather than rejecting it, because rejecting
 * shrinks badly under fast-check.
 */
function foldMinusZero(value: unknown): unknown {
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(foldMinusZero);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = foldMinusZero(v);
    }
    return out;
  }
  return value;
}

const arbHex = (): fc.Arbitrary<HexColor> =>
  fc
    .tuple(
      fc.integer({ min: 0, max: 0xff }),
      fc.integer({ min: 0, max: 0xff }),
      fc.integer({ min: 0, max: 0xff }),
    )
    .map(
      ([r, g, b]) =>
        `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
    );

const arbIsoTimestamp = (): fc.Arbitrary<string> =>
  fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map((d) => d.toISOString());

const arbCatalogRef = (): fc.Arbitrary<CatalogRef> =>
  fc.record({
    catalog: fc.constantFrom('core', 'community:demo'),
    id: fc.stringMatching(/^[a-z][a-z0-9.-]{2,40}$/),
    version: fc.integer({ min: 1, max: 5 }),
  });

const arbAssetRef = (): fc.Arbitrary<AssetRef> =>
  fc.record(
    {
      id: arbUuid(),
      uri: fc.constantFrom('assets/photo.png', 'assets/render-01.jpg'),
      mimeType: fc.constantFrom('image/png', 'image/jpeg'),
      width: fc.integer({ min: 0, max: 4096 }),
      height: fc.integer({ min: 0, max: 4096 }),
      hash: fc.hexaString({ minLength: 8, maxLength: 16 }),
    },
    { requiredKeys: ['id', 'uri', 'mimeType'] },
  );

// ─── Transform ────────────────────────────────────────────────────────────

const arbTransform = (): fc.Arbitrary<Transform> =>
  fc.record({
    position: fc.record({ x: arbMm(0, 1000), y: arbMm(0, 1000), z: arbMm(0, 1000) }),
    rotation: fc.record({
      x: arbFiniteNumber(-Math.PI, Math.PI),
      y: arbFiniteNumber(-Math.PI, Math.PI),
      z: arbFiniteNumber(-Math.PI, Math.PI),
    }),
    scale: fc.record({
      x: arbFiniteNumber(0.01, 5),
      y: arbFiniteNumber(0.01, 5),
      z: arbFiniteNumber(0.01, 5),
    }),
    flipX: fc.boolean(),
    flipY: fc.boolean(),
  });

// ─── Tank ─────────────────────────────────────────────────────────────────

const arbBackground = (): fc.Arbitrary<TankStyle['background']> =>
  fc.oneof(
    fc.record({ kind: fc.constant('none' as const) }),
    fc.record({ kind: fc.constant('color' as const), color: arbHex() }),
    fc.record({ kind: fc.constant('image' as const), asset: arbAssetRef() }),
    fc
      .tuple(
        arbFiniteNumber(-Math.PI, Math.PI),
        fc.array(arbFiniteNumber(0, 1), { minLength: 2, maxLength: 5 }),
        fc.array(arbHex(), { minLength: 2, maxLength: 5 }),
      )
      .map(([angle, ats, colors]) => {
        // Pair shortest, dedupe by `at`, then sort ascending. AJV requires at ∈ [0,1].
        const len = Math.min(ats.length, colors.length);
        const seen = new Set<number>();
        const pairs: Array<{ at: number; color: HexColor }> = [];
        for (let i = 0; i < len; i++) {
          const at = Math.min(1, Math.max(0, ats[i]!));
          if (seen.has(at)) continue;
          seen.add(at);
          pairs.push({ at, color: colors[i]! });
        }
        // Need ≥ 2 distinct stops. If dedupe collapsed us below that, splice in 0 and 1.
        if (!seen.has(0)) {
          pairs.unshift({ at: 0, color: colors[0]! });
        }
        if (!seen.has(1)) {
          pairs.push({ at: 1, color: colors[colors.length - 1]! });
        }
        pairs.sort((a, b) => a.at - b.at);
        return { kind: 'gradient' as const, angle, stops: pairs };
      }),
  );

const arbTankStyle = (): fc.Arbitrary<TankStyle> =>
  fc.record(
    {
      frame: fc.constantFrom('rimless', 'framed', 'braced') as fc.Arbitrary<TankStyle['frame']>,
      frameColor: arbHex(),
      waterTint: arbHex(),
      background: arbBackground(),
    },
    { requiredKeys: ['frame', 'background'] },
  );

/**
 * v4: optional persisted water-chemistry snapshot. Mirrors `water-sim`'s
 * `WaterState` (`chemistry` block) + denormalized `cycle` stage + optional
 * per-type `algae` block. Present-or-absent on the tank is toggled by
 * `requiredKeys` so the round-trip property exercises both branches.
 */
const arbWaterChemistry = (): fc.Arbitrary<WaterChemistry> =>
  fc.record(
    {
      chemistry: fc.record({
        ammonia: arbFiniteNumber(0, 8),
        nitrite: arbFiniteNumber(0, 8),
        nitrate: arbFiniteNumber(0, 80),
        ph: arbFiniteNumber(5.5, 8.6),
        aobColony: arbFiniteNumber(0, 10),
        nobColony: arbFiniteNumber(0, 10),
        ageWeeks: arbFiniteNumber(0, 52),
        engineVersion: fc.integer({ min: 1, max: 3 }),
      }),
      cycle: fc.constantFrom('uncycled', 'cycling', 'cycled') as fc.Arbitrary<
        WaterChemistry['cycle']
      >,
      // Each algae type is independently present-or-absent (absent = none).
      algae: fc.record(
        {
          'green-spot': arbFiniteNumber(0, 1),
          hair: arbFiniteNumber(0, 1),
          'black-beard': arbFiniteNumber(0, 1),
          diatom: arbFiniteNumber(0, 1),
        },
        { requiredKeys: [] },
      ),
    },
    { requiredKeys: ['chemistry', 'cycle'] },
  );

const arbTank = (): fc.Arbitrary<Tank> =>
  fc.record(
    {
      width: arbMm(100, 2000),
      height: arbMm(100, 1000),
      depth: arbMm(100, 1000),
      glassThickness: arbMm(3, 19),
      // v3: optional authored water level. Present-or-absent toggled by
      // `requiredKeys` (same pattern as Layer.zone) so the round-trip
      // property exercises both branches. Bounded to [1, 100] so it never
      // exceeds the minimum generated height — the [1, height] range is
      // advisory in the schema, but generated documents stay semantically sane.
      waterLevelMm: arbMm(1, 100),
      // v4: optional persisted chemistry snapshot. Present-or-absent toggled
      // by `requiredKeys` so the round-trip property exercises both branches.
      waterChemistry: arbWaterChemistry(),
      presetRef: arbCatalogRef(),
      style: arbTankStyle(),
    },
    { requiredKeys: ['width', 'height', 'depth', 'style'] },
  );

// ─── Substrate ────────────────────────────────────────────────────────────

const arbProfilePoint = (): fc.Arbitrary<{ x: number; y: number }> =>
  fc.record({ x: arbFiniteNumber(0, 1), y: arbMm(0, 500) });

const arbSubstrateRegion = (): fc.Arbitrary<SubstrateRegion> =>
  fc
    .tuple(
      arbUuid(),
      arbCatalogRef(),
      arbFiniteNumber(0, 1),
      arbFiniteNumber(0, 1),
      arbMm(0, 50),
      fc.array(arbProfilePoint(), { minLength: 2, maxLength: 8 }),
    )
    .map(([id, material, a, b, blend, profile]) => ({
      id,
      material,
      fromX: Math.min(a, b),
      toX: Math.max(a, b),
      blend,
      profile,
    }));

const arbSubstrate = (): fc.Arbitrary<Substrate> =>
  fc.record({
    regions: fc.array(arbSubstrateRegion(), { minLength: 1, maxLength: 3 }),
  });

// ─── Scene objects ────────────────────────────────────────────────────────

const arbHardscapeObject = (): fc.Arbitrary<HardscapeObject> =>
  fc.record(
    {
      kind: fc.constant('hardscape' as const),
      id: arbUuid(),
      transform: arbTransform(),
      groupId: arbUuid(),
      note: fc.string({ minLength: 0, maxLength: 40 }),
      ref: arbCatalogRef(),
      category: fc.constantFrom('rock', 'wood', 'other') as fc.Arbitrary<
        NonNullable<HardscapeObject['category']>
      >,
    },
    { requiredKeys: ['kind', 'id', 'transform', 'ref'] },
  );

const arbScatterPolygonPoint = (): fc.Arbitrary<{ x: number; y: number }> =>
  fc.record({ x: arbMm(0, 1000), y: arbMm(0, 1000) });

const arbPlantObject = (): fc.Arbitrary<PlantObject> =>
  fc.record(
    {
      kind: fc.constant('plant' as const),
      id: arbUuid(),
      transform: arbTransform(),
      groupId: arbUuid(),
      note: fc.string({ minLength: 0, maxLength: 40 }),
      ref: arbCatalogRef(),
      zone: fc.constantFrom('foreground', 'midground', 'background') as fc.Arbitrary<
        NonNullable<PlantObject['zone']>
      >,
      growth: fc.record({
        ageWeeks: fc.integer({ min: 0, max: 52 }),
        vigor: arbFiniteNumber(0.1, 3),
      }),
      scatter: fc.record(
        {
          polygon: fc.array(arbScatterPolygonPoint(), { minLength: 3, maxLength: 6 }),
          density: arbFiniteNumber(0.1, 100),
          seed: fc.integer({ min: 0, max: 1_000_000 }),
        },
        { requiredKeys: ['polygon', 'density'] },
      ),
    },
    { requiredKeys: ['kind', 'id', 'transform', 'ref', 'growth'] },
  );

const arbDecorObject = (): fc.Arbitrary<DecorObject> =>
  fc.record(
    {
      kind: fc.constant('decor' as const),
      id: arbUuid(),
      transform: arbTransform(),
      groupId: arbUuid(),
      note: fc.string({ minLength: 0, maxLength: 40 }),
      ref: arbCatalogRef(),
      excludeFromScapeExport: fc.boolean(),
    },
    { requiredKeys: ['kind', 'id', 'transform', 'ref'] },
  );

const arbSceneObject = (): fc.Arbitrary<SceneObject> =>
  fc.oneof(arbHardscapeObject(), arbPlantObject(), arbDecorObject());

// ─── Layer + Meta + Document ──────────────────────────────────────────────

const arbLayer = (): fc.Arbitrary<Layer> =>
  fc.record(
    {
      id: arbUuid(),
      name: fc.string({ minLength: 1, maxLength: 24 }),
      opacity: arbFiniteNumber(0, 1),
      visible: fc.boolean(),
      locked: fc.boolean(),
      objects: fc.array(arbSceneObject(), { minLength: 0, maxLength: 4 }),
      // v2: optional zone hint. Present-or-absent toggled by `requiredKeys`
      // so the round-trip property exercises both branches.
      zone: fc.constantFrom('foreground', 'midground', 'background') as fc.Arbitrary<
        NonNullable<Layer['zone']>
      >,
    },
    { requiredKeys: ['id', 'name', 'opacity', 'visible', 'locked', 'objects'] },
  );

const arbDocumentMeta = (): fc.Arbitrary<DocumentMeta> =>
  fc.record(
    {
      id: arbUuid(),
      title: fc.string({ minLength: 1, maxLength: 60 }),
      description: fc.string({ minLength: 0, maxLength: 200 }),
      author: fc.string({ minLength: 0, maxLength: 40 }),
      createdAt: arbIsoTimestamp(),
      updatedAt: arbIsoTimestamp(),
      appVersion: fc.constantFrom('1.0.0', '1.0.1', '1.1.0'),
      isTemplate: fc.boolean(),
      tags: fc.array(fc.string({ minLength: 1, maxLength: 16 }), { maxLength: 4 }),
      remixOf: fc.record(
        {
          documentId: arbUuid(),
          author: fc.string({ minLength: 1, maxLength: 30 }),
          source: fc.string({ minLength: 1, maxLength: 30 }),
        },
        { requiredKeys: ['documentId'] },
      ),
      seed: fc.integer({ min: 0, max: 1_000_000 }),
    },
    { requiredKeys: ['id', 'title', 'createdAt', 'updatedAt', 'appVersion', 'seed'] },
  );

const arbLivestockEntry = (): fc.Arbitrary<LivestockEntry> =>
  fc.record(
    {
      id: arbUuid(),
      ref: arbCatalogRef(),
      quantity: fc.integer({ min: 1, max: 50 }),
      decorObjectId: arbUuid(),
    },
    { requiredKeys: ['id', 'ref', 'quantity'] },
  );

const arbEquipmentEntry = (): fc.Arbitrary<EquipmentEntry> =>
  fc.record(
    {
      id: arbUuid(),
      ref: arbCatalogRef(),
      // settings is `Record<string, number | string | boolean>` per the schema.
      settings: fc.dictionary(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.oneof(fc.integer(), fc.string(), fc.boolean()),
        { maxKeys: 4 },
      ),
      note: fc.string({ minLength: 0, maxLength: 40 }),
    },
    { requiredKeys: ['id', 'ref'] },
  );

const arbRenderRecord = (): fc.Arbitrary<RenderRecord> =>
  fc.record({
    id: arbUuid(),
    createdAt: arbIsoTimestamp(),
    provider: fc.record({
      kind: fc.constantFrom('local', 'hosted') as fc.Arbitrary<'local' | 'hosted'>,
      name: fc.constantFrom('sdxl-local', 'replicate', 'openai-images'),
    }),
    request: fc.record(
      {
        prompt: fc.string({ minLength: 1, maxLength: 80 }),
        seed: fc.integer({ min: 0, max: 1_000_000 }),
        sourceRenderAssetId: arbUuid(),
        params: fc.dictionary(
          fc.string({ minLength: 1, maxLength: 12 }),
          fc.oneof(fc.integer(), fc.string({ maxLength: 12 }), fc.boolean()),
          { maxKeys: 4 },
        ),
      },
      { requiredKeys: ['prompt'] },
    ),
    resultAsset: arbAssetRef(),
  });

/**
 * Top-level `AquaDocument` arbitrary.
 *
 * Combines all the per-shape arbitraries above and fans optionals in/out so a
 * single run exercises every code path the schema and the loader admit.
 */
export const arbAquaDocument = (): fc.Arbitrary<AquaDocument> =>
  fc
    .tuple(
      arbDocumentMeta(),
      arbTank(),
      arbSubstrate(),
      fc.array(arbLayer(), { minLength: 0, maxLength: 3 }),
      fc.option(fc.array(arbLivestockEntry(), { minLength: 0, maxLength: 3 }), {
        nil: undefined,
      }),
      fc.option(fc.array(arbEquipmentEntry(), { minLength: 0, maxLength: 3 }), {
        nil: undefined,
      }),
      fc.option(fc.array(arbRenderRecord(), { minLength: 0, maxLength: 2 }), {
        nil: undefined,
      }),
      fc.option(
        fc
          .dictionary(fc.string({ minLength: 1, maxLength: 12 }), fc.jsonValue(), {
            maxKeys: 3,
          })
          // fc.jsonValue() can produce `-0` deep inside an object or array;
          // fold those to `0` so the round-trip property doesn't flake.
          .map((dict) => foldMinusZero(dict) as Record<string, unknown>),
        { nil: undefined },
      ),
    )
    .map(([meta, tank, substrate, layers, livestock, equipment, renderHistory, extensions]) => {
      const doc: AquaDocument = {
        format: 'aquascape',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        meta,
        tank,
        substrate,
        layers,
      };
      if (livestock !== undefined) doc.livestock = livestock;
      if (equipment !== undefined) doc.equipment = equipment;
      if (renderHistory !== undefined) doc.renderHistory = renderHistory;
      if (extensions !== undefined) doc.extensions = extensions as Record<string, unknown>;
      return doc;
    });
