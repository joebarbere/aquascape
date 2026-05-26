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
  /** Optional reference to a known preset. */
  presetRef?: CatalogRef;
  style: TankStyle;
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
}
