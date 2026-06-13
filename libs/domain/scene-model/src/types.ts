/**
 * In-memory scene types for `@aquascape/domain/scene-model`.
 *
 * These shapes mirror — and are intentionally re-declared from — the canonical
 * on-disk types in `@aquascape/domain/document` (`aqua-document.ts`). The
 * in-memory `Scene` is the on-disk `AquaDocument` minus its `format` /
 * `schemaVersion` / `meta` envelope; marshaling between the two lives in
 * `libs/domain/document/src/marshal.ts` and is a one-to-one wrap/unwrap.
 *
 * RULES
 * -----
 * 1. Plain serializable data only — no class instances, no functions,
 *    no getters/proxies. `JSON.parse(JSON.stringify(scene))` is lossless.
 * 2. Canonical units = millimetres (`Millimetres`). cm/in are display-only.
 * 3. Canonical coordinates = right-handed; +x right, +y up, +z back; origin
 *    at the tank front-bottom-left interior corner. Both renderers read the
 *    same numbers.
 * 4. Catalog data is referenced (`CatalogRef`), never inlined.
 */

import type { Transform } from '@aquascape/domain/geometry';

// ─── Primitives ───────────────────────────────────────────────────────────

/** Millimetres, stored as a number (integers strongly preferred). */
export type Millimetres = number;

/** UUID v4 string. */
export type Uuid = string;

/** sRGB hex color, e.g. "#2e7d32". Alpha optional as #RRGGBBAA. */
export type HexColor = string;

/**
 * Branded UUID for a scene object. Use {@link newObjectId} to mint one.
 * The brand is compile-time only; at runtime it is just a string and
 * serializes losslessly.
 */
export type ObjectId = string & { readonly __brand: 'ObjectId' };

/**
 * Branded UUID for a layer. Use {@link newLayerId} to mint one.
 * Compile-time brand only; serializes as a plain string.
 */
export type LayerId = string & { readonly __brand: 'LayerId' };

// ─── Catalog & assets ─────────────────────────────────────────────────────

/** Stable reference into a content catalog. Mirrors `aqua-document.ts`. */
export interface CatalogRef {
  /** Catalog namespace, e.g. "core". */
  catalog: string;
  /** Stable id within the catalog, e.g. "rock.seiryu.large-01". */
  id: string;
  /** Catalog item version the document was authored against. */
  version: number;
}

/** Reference to a binary asset. Mirrors `aqua-document.ts`. */
export interface AssetRef {
  id: Uuid;
  /** Path within the container ("assets/<id>.<ext>") or a data:/https: URI. */
  uri: string;
  mimeType: string;
  width?: number;
  height?: number;
  /** SHA-256 of the bytes, for integrity and dedupe. */
  hash?: string;
}

// ─── Tank ─────────────────────────────────────────────────────────────────

export interface Tank {
  /** Interior dimensions in mm. */
  width: Millimetres;
  height: Millimetres;
  depth: Millimetres;
  /** Glass thickness, used for rendering and (later) volume precision. */
  glassThickness?: Millimetres;
  /**
   * Water surface height above the interior floor (canonical integer mm).
   * Absent ⇒ the editorial default fill: `height −
   * DEFAULT_WATER_GAP_BELOW_RIM_MM` (see `effectiveWaterLevelMm` in
   * `selectors.ts` — consumers must go through that helper rather than
   * re-deriving the default). Set via `SetWaterLevelCommand`; the UI lets
   * users author it in mm or US gallons (gallons are a display-only
   * conversion over `width × depth × level`).
   */
  waterLevelMm?: Millimetres;
  /**
   * Persisted water-chemistry snapshot (Stage 13 F13.2 / ADR-0006). Mirrors
   * the on-disk `Tank.waterChemistry` in `aqua-document.ts`: the persistable
   * subset of `domain/water-sim`'s `WaterState` (`chemistry` block) plus the
   * denormalized `cycle` stage and a per-type `algae` coverage block. Absent ⇒
   * "no chemistry recorded". The live tick is owned by a runtime
   * `WaterChemistryService`; only this snapshot round-trips through the
   * document so a saved tank reloads mid-cycle. Marshaled verbatim on `tank`.
   */
  waterChemistry?: WaterChemistry;
  /** Optional reference to a known preset. */
  presetRef?: CatalogRef;
  style: TankStyle;
}

/**
 * Persisted water-chemistry snapshot. Mirrors `WaterChemistry` in
 * `@aquascape/domain/document` (`aqua-document.ts`) field-for-field — keep the
 * two in lock-step. Plain serializable data only.
 */
export interface WaterChemistry {
  /**
   * The persistable subset of `water-sim`'s `WaterState`. Field-for-field
   * mirror so the runtime service can lift it back into a `WaterState` and
   * resume `simulateChemistry` exactly. Every field is a snapshot (none is
   * recomputed — the model can't reconstruct colony capacities or the cycling
   * clock from concentrations alone).
   */
  chemistry: {
    /** Total ammonia as nitrogen, mg/L. */
    ammonia: number;
    /** Nitrite as nitrogen, mg/L. */
    nitrite: number;
    /** Nitrate as nitrogen, mg/L. */
    nitrate: number;
    /** Water pH. */
    ph: number;
    /** Ammonia-oxidiser colony capacity (dimensionless). */
    aobColony: number;
    /** Nitrite-oxidiser colony capacity (dimensionless). */
    nobColony: number;
    /** Total simulated weeks advanced — the cycling clock. */
    ageWeeks: number;
    /** `water-sim` rate-model engine version that produced this snapshot. */
    engineVersion: number;
  };
  /**
   * Denormalized tank-cycling stage (a pure function of `chemistry` via
   * `water-sim`'s `cycleProgress`), persisted for offline display.
   */
  cycle: 'uncycled' | 'cycling' | 'cycled';
  /**
   * Per-type algae coverage scalars. Omit a type whose coverage is zero —
   * absent reads as "none". Independent accumulated state, so a snapshot.
   */
  algae?: {
    'green-spot'?: number;
    hair?: number;
    'black-beard'?: number;
    diatom?: number;
  };
}

export interface TankStyle {
  frame: 'rimless' | 'framed' | 'braced';
  frameColor?: HexColor;
  /** Water tint applied in rendering; null/omitted = clear. */
  waterTint?: HexColor;
  /**
   * Background behind the tank. Discriminated by `kind`:
   *   - `'color'`    — flat solid color.
   *   - `'image'`    — a referenced backdrop image asset.
   *   - `'gradient'` — a linear multi-stop gradient.
   *   - `'none'`     — no background.
   *
   * For `'gradient'`:
   *   - `angle` is rotation in RADIANS from horizontal (0 = left→right,
   *     π/2 = bottom→top). Matches `Transform.rotation`'s convention.
   *   - `stops` has ≥ 2 entries; each `at` is in `[0, 1]`; entries are sorted
   *     ascending by `at`. Endpoints should be 0 and 1 for portability.
   */
  background:
    | { kind: 'color'; color: HexColor }
    | { kind: 'image'; asset: AssetRef }
    | {
        kind: 'gradient';
        /** Rotation in radians from horizontal. 0 = left→right, π/2 = bottom→top. */
        angle: number;
        /** ≥ 2 stops, sorted ascending by `at` ∈ [0, 1]. */
        stops: Array<{ at: number; color: HexColor }>;
      }
    | { kind: 'none' };
}

// ─── Substrate ────────────────────────────────────────────────────────────

export interface Substrate {
  /** One or more regions blended left-to-right across the tank. */
  regions: SubstrateRegion[];
}

export interface SubstrateRegion {
  id: Uuid;
  /** Material catalog reference (soil/sand/gravel + texture/color). */
  material: CatalogRef;
  /** Horizontal extent of this region as a fraction of tank width [0..1]. */
  fromX: number;
  toX: number;
  /** Optional blend width (mm) at the region boundaries. */
  blend?: Millimetres;
  /**
   * Height profile across the region as control points defining the substrate
   * top surface. x is fraction of region width [0..1]; y is height in mm from
   * tank floor.
   */
  profile: Array<{ x: number; y: Millimetres }>;
}

// ─── Scene objects ────────────────────────────────────────────────────────

interface SceneObjectBase {
  id: ObjectId;
  transform: Transform;
  /** Optional group id; objects sharing a groupId move/transform together. */
  groupId?: ObjectId;
  /** Author note shown in the inspector. */
  note?: string;
}

export interface HardscapeObject extends SceneObjectBase {
  kind: 'hardscape';
  ref: CatalogRef;
  category?: 'rock' | 'wood' | 'other';
}

export interface PlantObject extends SceneObjectBase {
  kind: 'plant';
  ref: CatalogRef;
  zone?: 'foreground' | 'midground' | 'background';
  growth: {
    ageWeeks: number;
    /** Per-object size multiplier (e.g. trimmed vs. overgrown). Default 1. */
    vigor: number;
  };
  scatter?: {
    polygon: Array<{ x: Millimetres; y: Millimetres }>;
    density: number;
    seed?: number;
  };
}

export interface DecorObject extends SceneObjectBase {
  kind: 'decor';
  ref: CatalogRef;
  excludeFromScapeExport?: boolean;
}

/** Discriminated union over object kinds. */
export type SceneObject = HardscapeObject | PlantObject | DecorObject;

// ─── Layers ───────────────────────────────────────────────────────────────

export interface Layer {
  id: LayerId;
  name: string;
  /** 0..1 */
  opacity: number;
  visible: boolean;
  locked: boolean;
  /** Objects within a layer, ordered back-to-front. */
  objects: SceneObject[];
  /**
   * Optional layout-zone hint (mirrors `AquaDocument.Layer.zone`, schema v2).
   * Influences Z placement in the 3D renderer (Stage 10); the 2D renderer
   * projects along −z so it is a no-op there but is preserved as authoring
   * metadata. Omitted = "no zone preference"; the renderer falls back to
   * each object's own `transform.position.z`. Additive in v2: v1 docs load
   * with this field absent on every layer.
   */
  zone?: 'foreground' | 'midground' | 'background';
}

// ─── Livestock ────────────────────────────────────────────────────────────

/**
 * A planned-livestock entry. Mirrors the on-disk `LivestockEntry` from
 * `aqua-document.ts` minimally — same field set, just re-declared so the
 * scene-model has no dependency on `@aquascape/domain/document`.
 *
 * Livestock entries do NOT live in any layer; the locked-layer guard does
 * NOT apply to livestock commands. They round-trip through `documentToScene`
 * / `sceneToDocument` on the `Scene` itself (Stage 7 F7.1 promoted them off
 * the envelope into the scene so undo/redo via Commands could reach them).
 */
export interface LivestockEntry {
  id: Uuid;
  ref: CatalogRef;
  quantity: number;
  /** Optional link to a DecorObject rendering this species in-scene. */
  decorObjectId?: Uuid;
}

// ─── Equipment ────────────────────────────────────────────────────────────

/**
 * A planned-equipment entry (filter, heater, light, CO2, etc.). Mirrors the
 * on-disk `EquipmentEntry` from `aqua-document.ts` — same field set, just
 * re-declared so the scene-model has no dependency on
 * `@aquascape/domain/document`.
 *
 * Equipment entries do NOT live in any layer; the locked-layer guard does
 * NOT apply to equipment commands. They round-trip through `documentToScene`
 * / `sceneToDocument` on the `Scene` itself (Stage 7 F7.3 promoted them off
 * the envelope into the scene so undo/redo via Commands could reach them —
 * the symmetric follow-up to the F7.1 livestock promotion).
 */
export interface EquipmentEntry {
  id: Uuid;
  ref: CatalogRef;
  /** Free-form config keyed by the catalog's defaultSettings shape. */
  settings?: Record<string, number | string | boolean>;
  note?: string;
}

// ─── Dosing (Nutrients & additives + dosing, F-B) ─────────────────────────

/**
 * The canonical hobby parameter axes a nutrient dose moves, mirrored from the
 * catalog's `NutrientContributions` so the scene-model has no dependency on
 * `@aquascape/domain/catalog`. ppm for the nutrient axes (`no3` / `po4` / `k` /
 * `fe` / `mg` / `ca`); degrees of general / carbonate hardness (dGH / dKH) for
 * `gh` / `kh`. Every field optional — a recorded dose carries only the axes the
 * product actually contributes.
 */
export interface DoseDeltas {
  no3?: number;
  po4?: number;
  k?: number;
  fe?: number;
  mg?: number;
  ca?: number;
  gh?: number;
  kh?: number;
}

/**
 * A single recorded dosing event in the runtime scene's {@link Scene.doseLog}.
 *
 * **Runtime-only / chemistry deferred.** A `DoseEvent` records that the user
 * dosed a product; it does NOT mutate any water-chemistry state, because the
 * canonical `Tank.waterChemistry` field is a deferred Stage 13 addition that
 * does not exist yet. A future water-sim consumes `doseLog` to apply the
 * chemistry effect. Until then this is the "UX now, chemistry later" record.
 *
 * The event is fully self-describing — the `DoseNutrient` command factory
 * resolves the catalog row and computes the deltas at construction time, so
 * `DoseNutrient.apply` / `invert` are a pure push / pop of a finished record
 * (they never reach into the catalog).
 *
 * Determinism: `seq` is a monotonic per-dose sequence number assigned by the
 * command factory's caller (or the highest existing `doseLog[].seq + 1`), used
 * to give the log a stable total order independent of array index so replay /
 * collaboration stay deterministic.
 */
export interface DoseEvent {
  /** Stable identity for this dose event (UUID). */
  id: Uuid;
  /** Monotonic ordering key — strictly increasing across a scene's dose log. */
  seq: number;
  /** The dosed product, referenced by catalog id (never inlined). */
  ref: CatalogRef;
  /** The amount the user dosed, in `unit`. */
  amount: number;
  /** Unit of `amount` — grams (dry) or millilitres (liquid). */
  unit: 'g' | 'ml';
  /**
   * Whether the dosed product publicly discloses per-dose ppm/dGH figures.
   * Mirrors `NutrientEntry.disclosed`; drives which of `deltas` / `affects`
   * a downstream water-sim trusts as numbers vs. as a qualitative hint.
   */
  disclosed: boolean;
  /**
   * The computed per-parameter deltas for THIS dose — present (and trusted as
   * real numbers) only for `disclosed: true` products, where the factory scales
   * the catalog `contributes` block linearly by `amount / dose.amount`. Omitted
   * for proprietary products: no numbers are ever fabricated.
   */
  deltas?: DoseDeltas;
  /**
   * The product's qualitative `affects` list (copied from the catalog entry).
   * Always present — it is the only honest signal for a proprietary product and
   * a useful highlight hint even when `deltas` is available.
   */
  affects: string[];
}

// ─── Scene root ───────────────────────────────────────────────────────────

/**
 * In-memory scene: tank + substrate + ordered layers + a deterministic seed.
 *
 * Equivalent to the on-disk `AquaDocument` minus the `format` / `schemaVersion`
 * / `meta` envelope. The marshaling layer in `libs/domain/document/` (F1.3)
 * wraps/unwraps that envelope.
 */
export interface Scene {
  tank: Tank;
  substrate: Substrate;
  /** Ordered back-to-front; index 0 is drawn first (furthest back). */
  layers: Layer[];
  /** Deterministic seed for any stochastic operation. */
  seed: number;
  /**
   * Planned livestock for the scape. Optional — absent on a fresh scene
   * stays absent through document round-trips (the marshal layer uses the
   * spread-trick so the on-disk field is omitted when undefined).
   *
   * Lives on the scene (not on the envelope) so livestock mutations can
   * flow through the Command pipeline with undo/redo support. Stage 7 F7.1.
   */
  livestock?: LivestockEntry[];
  /**
   * Planned equipment for the scape (filter / heater / light / CO2 / etc.).
   * Optional — absent on a fresh scene stays absent through document
   * round-trips (the marshal layer uses the spread-trick so the on-disk
   * field is omitted when undefined).
   *
   * Lives on the scene (not on the envelope) so equipment mutations can
   * flow through the Command pipeline with undo/redo support. Stage 7 F7.3
   * — the symmetric follow-up to the F7.1 livestock promotion that closes
   * the marshal asymmetry CLAUDE.md documents.
   */
  equipment?: EquipmentEntry[];
  /**
   * Append-only log of dosing events (Nutrients & additives + dosing, F-B).
   * Optional + additive — absent on a fresh scene, and an absent field
   * round-trips losslessly through the document marshalling layer (persistence
   * of `doseLog` is a deferred, separately-owned PR; today the on-disk
   * `.aqua` format does NOT carry it, so this is a RUNTIME-ONLY field).
   *
   * `DoseNutrient.apply` appends a {@link DoseEvent}; its `invert` removes the
   * same event. The chemistry EFFECT of a dose is deferred to Stage 13's
   * `Tank.waterChemistry`; a future water-sim reads this log to apply deltas.
   *
   * Treated as immutable: commands replace the array wholesale rather than
   * mutating it in place, so renderer references stay valid.
   */
  doseLog?: readonly DoseEvent[];
}
