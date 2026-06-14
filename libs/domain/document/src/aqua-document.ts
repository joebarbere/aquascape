/**
 * .aqua document format — TypeScript schema (v5)
 *
 * This is the canonical, framework-free definition of an Aquascape layout
 * document. It lives in `libs/domain/document` and is the single source of
 * truth that the renderers, the editor, persistence, and migrations all
 * agree on.
 *
 * VERSION HISTORY
 * ---------------
 * v1 — baseline (Stage 1).
 * v2 — added optional `Layer.zone` (`'foreground' | 'midground' | 'background'`).
 *      Additive + optional; the v1 → v2 migration is a no-op identity that
 *      only bumps `schemaVersion`. v1 documents in the wild keep loading
 *      transparently and round-trip into v2 with no `zone` invented.
 * v3 — added optional `Tank.waterLevelMm` (water-surface height above the
 *      interior floor, canonical integer mm). Additive + optional; the
 *      v2 → v3 migration is a no-op identity that only bumps `schemaVersion`
 *      and MUST NOT invent a water level — absent means "default fill",
 *      derived at render time, and absent stays absent through a round-trip.
 * v4 — added optional `Tank.waterChemistry` (a persisted snapshot of the
 *      `domain/water-sim` `WaterState` — ammonia/nitrite/nitrate/pH + the
 *      AOB/NOB colony capacities + `ageWeeks` cycling clock + `engineVersion`),
 *      plus the denormalized `cycle` stage and an `algae` per-type coverage
 *      block. Stage 13 F13.2 / ADR-0006. Additive + optional; the v3 → v4
 *      migration is a no-op identity that only bumps `schemaVersion` and MUST
 *      NOT invent chemistry — absent means "no chemistry recorded" (a tank
 *      that was never cycled in the editor) and absent stays absent through a
 *      round-trip. The live tick is owned by a runtime `WaterChemistryService`;
 *      the document stores only the snapshot needed to resume deterministically.
 * v5 — REMOVED the optional `renderHistory` field (and the `RenderRecord`
 *      interface). The AI photorealistic render feature (Stage 9) was dropped
 *      from scope, so the field — always optional, never written by any shipped
 *      code — is retired. The v4 → v5 migration STRIPS `renderHistory` from any
 *      document that somehow carried it (the schema's `additionalProperties:
 *      false` would otherwise reject such a doc). This is the first migration
 *      that deletes a key rather than being a pure version-stamp identity; it is
 *      still pure + total (delete-if-present is a no-op on every real document,
 *      since no shipped writer ever emitted `renderHistory`).
 *
 * DESIGN RULES
 * ------------
 * 1. CANONICAL UNITS. All linear measurements are stored in millimetres (mm)
 *    as integers. cm/in are a *display* concern only. This avoids float drift
 *    and makes round-trips exact.
 * 2. CANONICAL COORDINATES. The scene uses a right-handed coordinate space
 *    with origin at the tank's front-bottom-left interior corner:
 *      +x → right (tank width)
 *      +y → up    (tank height)
 *      +z → back  (tank depth, front-to-back)
 *    2D and 3D renderers consume the SAME coordinates; the 2D renderer simply
 *    projects along -z. This is what lets the 3D renderer (Three.js) drop in
 *    without changing the document.
 * 3. CATALOG BY REFERENCE. Objects reference catalog items by stable id +
 *    version, never by inlining catalog data. Documents stay small and
 *    portable; the catalog is resolved at load time.
 * 4. EVERYTHING SERIALIZABLE. No class instances, no functions — plain data
 *    only, so JSON.stringify/parse round-trips losslessly.
 * 5. VERSIONED + MIGRATABLE. `schemaVersion` drives a migration chain. Readers
 *    must run migrations up to their supported version before use.
 */

// ─────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────

/** Millimetres, stored as a number (integers strongly preferred). */
export type Millimetres = number;

/** ISO-8601 timestamp string, e.g. "2026-05-23T14:30:00.000Z". */
export type IsoTimestamp = string;

/** UUID v4 string. */
export type Uuid = string;

/** A 3D point/vector in canonical scene space (mm). */
export interface Vec3 {
  x: Millimetres;
  y: Millimetres;
  z: Millimetres;
}

/** A 2D point/vector (mm), used for profiles and 2D-only data. */
export interface Vec2 {
  x: Millimetres;
  y: Millimetres;
}

/** sRGB hex color, e.g. "#2e7d32". Alpha optional as #RRGGBBAA. */
export type HexColor = string;

/**
 * A full affine transform for a scene object.
 * rotation is in radians; for the 2D renderer only `rotation.z` (yaw about the
 * vertical axis as seen from the front, i.e. in-plane rotation) is applied.
 */
export interface Transform {
  position: Vec3;
  rotation: { x: number; y: number; z: number }; // radians
  scale: { x: number; y: number; z: number }; // multipliers, default 1
  /** Horizontal mirror about the object's local center. */
  flipX: boolean;
  /** Vertical mirror about the object's local center. */
  flipY: boolean;
}

/** Stable reference into a content catalog. */
export interface CatalogRef {
  /** Catalog namespace, e.g. "core", "community:tropiscape". */
  catalog: string;
  /** Stable id within the catalog, e.g. "rock.seiryu.large-01". */
  id: string;
  /**
   * Catalog item version the document was authored against. Loader may resolve
   * a newer compatible version; mismatches are surfaced, never silent.
   */
  version: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Document root
// ─────────────────────────────────────────────────────────────────────────

export const CURRENT_SCHEMA_VERSION = 5 as const;

export interface AquaDocument {
  /** Magic discriminator; always "aquascape". */
  format: 'aquascape';
  /** Integer schema version driving migrations. */
  schemaVersion: number;

  meta: DocumentMeta;
  tank: Tank;
  substrate: Substrate;
  /** Ordered back-to-front; index 0 is drawn first (furthest back). */
  layers: Layer[];

  /** Optional planning extras (added in later stages; always optional). */
  livestock?: LivestockEntry[];
  equipment?: EquipmentEntry[];

  /**
   * Free-form, namespaced extension bag for forward-compat. Unknown keys must
   * be preserved on save by conforming editors ("don't drop what you don't
   * understand").
   */
  extensions?: Record<string, unknown>;
}

export interface DocumentMeta {
  /** Document identity, stable across saves. */
  id: Uuid;
  title: string;
  description?: string;
  author?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /** App version that last wrote the file, e.g. "1.0.0". */
  appVersion: string;
  /** True if this document is intended to be loaded as an editable template. */
  isTemplate?: boolean;
  /** Style tags, e.g. ["iwagumi", "beginner"]. */
  tags?: string[];
  /** Attribution chain when a doc was imported/remixed from the gallery. */
  remixOf?: { documentId: Uuid; author?: string; source?: string };
  /**
   * Deterministic seed for any stochastic operation (scatter planting, growth
   * jitter). Stored so renders/sims are reproducible.
   */
  seed: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Tank
// ─────────────────────────────────────────────────────────────────────────

export interface Tank {
  /** Interior dimensions in mm. */
  width: Millimetres; // x
  height: Millimetres; // y
  depth: Millimetres; // z
  /** Glass thickness, used for rendering and (later) volume precision. */
  glassThickness?: Millimetres;
  /**
   * Water-surface height above the tank's interior floor, in canonical
   * integer millimetres. Added in schema v3 (additive + optional).
   *
   * Absent ⇒ the default fill is derived at render/consume time (scene-model's
   * `effectiveWaterLevelMm`, i.e. `height − DEFAULT_WATER_GAP_BELOW_RIM_MM`).
   * Writers MUST NOT materialise that default into the document — absent
   * stays absent through a round-trip so documents stay minimal.
   *
   * Advisory range `[1, height]`. The upper bound is a cross-field comparison
   * that JSON Schema cannot express, so the schema only enforces
   * `integer ≥ 1` — same policy as other advisory semantics (e.g. gradient
   * stop ordering). Consumers clamp via `effectiveWaterLevelMm`.
   */
  waterLevelMm?: Millimetres;
  /**
   * Persisted water-chemistry snapshot. Added in schema v4 (additive +
   * optional; Stage 13 F13.2 / ADR-0006).
   *
   * Mirrors the persistable subset of `domain/water-sim`'s `WaterState`
   * (`chemistry` block) plus the denormalized `cycle` stage and an `algae`
   * per-type coverage block. The runtime `WaterChemistryService` owns the live
   * tick; this field stores only the snapshot needed to RESUME a cycle
   * deterministically — so a saved tank reloads mid-cycle rather than starting
   * fresh.
   *
   * Absent ⇒ "no chemistry recorded" (a tank that was never cycled in the
   * editor). The v3 → v4 migration MUST NOT invent values — absent stays
   * absent through migration + round-trip, exactly like `waterLevelMm`. The
   * marshal carries the field verbatim on the `tank`.
   */
  waterChemistry?: WaterChemistry;
  /** Optional reference to a known preset, e.g. "core:ada-mini-m". */
  presetRef?: CatalogRef;
  style: TankStyle;
}

/**
 * Persisted water-chemistry state — the v4 snapshot of the `domain/water-sim`
 * simulation that lets a saved tank reload mid-cycle (Stage 13 F13.2 /
 * ADR-0006). Plain serializable data; the simulation logic lives in the
 * `water-sim` lib, the live tick in a runtime service, and only this snapshot
 * round-trips through the document.
 *
 * EVERY field of `WaterState` is persisted (none is recomputed): the snapshot
 * IS the resume point, and the model can't reconstruct the colony capacities,
 * the cycling clock, or the engine provenance from concentrations alone. The
 * `cycle` stage is a pure function of `chemistry` (`water-sim`'s
 * `cycleProgress`) — it's denormalized here so offline readers (e.g. the 2D
 * test-kit readout, gallery thumbnails) can show the stage without importing
 * `water-sim` or recomputing it; consumers that DO import `water-sim` MAY
 * recompute it from `chemistry`. The `algae` block accumulates over sim-time
 * and is genuinely independent state (not derivable from chemistry), so it is
 * a persisted snapshot too.
 */
export interface WaterChemistry {
  /**
   * The persistable subset of `water-sim`'s `WaterState`. Field-for-field
   * mirror so the runtime service can lift it back into a `WaterState`
   * (`freshWaterState(chemistry)`) and resume `simulateChemistry` exactly.
   */
  chemistry: {
    /** Total ammonia as nitrogen, mg/L (test-kit reading). */
    ammonia: number;
    /** Nitrite as nitrogen, mg/L. */
    nitrite: number;
    /** Nitrate as nitrogen, mg/L. Accumulates until a water change. */
    nitrate: number;
    /** Water pH. */
    ph: number;
    /** Ammonia-oxidiser colony capacity (dimensionless). 0 = brand-new tank. */
    aobColony: number;
    /** Nitrite-oxidiser colony capacity (dimensionless). 0 = brand-new tank. */
    nobColony: number;
    /** Total simulated weeks advanced — the cycling clock + jitter offset. */
    ageWeeks: number;
    /**
     * `water-sim` rate-model engine version that produced this snapshot
     * (replay / future-migration provenance). Mirrors `ENGINE_VERSION`.
     */
    engineVersion: number;
  };
  /**
   * Denormalized tank-cycling stage. A pure function of `chemistry` (via
   * `water-sim`'s `cycleProgress`), persisted so offline readers can display
   * it without importing the model.
   */
  cycle: 'uncycled' | 'cycling' | 'cycled';
  /**
   * Per-type algae coverage scalars (each a `[0, 1]`-ish accumulated score).
   * Omit a type whose coverage is zero — absent reads as "none". Independent
   * accumulated state (not derivable from chemistry), so it is a snapshot.
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
   *   - `'color'`  — flat solid color.
   *   - `'image'`  — a referenced backdrop image asset.
   *   - `'gradient'` — a linear multi-stop gradient (see below).
   *   - `'none'`   — no background; the renderer's clear color shows through.
   *
   * For `'gradient'`:
   *   - `angle` is rotation in RADIANS measured from horizontal. `0` = left→right
   *     (low `at` on the left, high `at` on the right); `π/2` = bottom→top.
   *     Radians are used for consistency with `Transform.rotation`, which is the
   *     only other angle in the format.
   *   - `stops` is an array of at least two stops, each `{ at, color }` where
   *     `at` is a fraction in `[0, 1]`. Stops MUST be sorted ascending by `at`;
   *     the first stop's `at` SHOULD be `0` and the last SHOULD be `1`.
   *     Renderers MAY extrapolate from the end stops if the bounds are not
   *     normalized, but the format prefers normalized stops for portability.
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

// ─────────────────────────────────────────────────────────────────────────
// Substrate
// ─────────────────────────────────────────────────────────────────────────

export interface Substrate {
  /** One or more regions blended left-to-right across the tank. */
  regions: SubstrateRegion[];
}

export interface SubstrateRegion {
  id: Uuid;
  /** Material catalog reference (soil/sand/gravel + texture/color). */
  material: CatalogRef;
  /**
   * Horizontal extent of this region as a fraction of tank width [0..1].
   * Regions are ordered; ranges may overlap to drive blending.
   */
  fromX: number;
  toX: number;
  /** Optional blend width (mm) at the region boundaries. */
  blend?: Millimetres;
  /**
   * Height profile across the region as control points defining the substrate
   * top surface. x is fraction of region width [0..1]; y is height in mm from
   * tank floor. Renderer interpolates (Catmull-Rom) between points.
   */
  profile: Array<{ x: number; y: Millimetres }>;
}

// ─────────────────────────────────────────────────────────────────────────
// Layers & scene objects
// ─────────────────────────────────────────────────────────────────────────

export interface Layer {
  id: Uuid;
  name: string;
  /** 0..1 */
  opacity: number;
  visible: boolean;
  locked: boolean;
  /** Objects within a layer, ordered back-to-front. */
  objects: SceneObject[];
  /**
   * Optional layout-zone hint added in schema v2. Influences Z placement in the
   * 3D renderer (Stage 10): `'foreground'` parks the layer's objects near the
   * front glass (low z), `'background'` near the back wall (high z), and
   * `'midground'` in the middle band. The 2D renderer projects along −z so the
   * hint is a no-op there; it survives as authoring metadata. Omitted means
   * "no zone preference" — the renderer falls back to each object's own
   * `transform.position.z`. Additive in v2: v1 documents load with `zone`
   * absent on every layer and the migration does not invent values.
   */
  zone?: 'foreground' | 'midground' | 'background';
}

/** Discriminated union over object kinds. */
export type SceneObject = HardscapeObject | PlantObject | DecorObject;

interface SceneObjectBase {
  id: Uuid;
  transform: Transform;
  /** Optional group id; objects sharing a groupId move/transform together. */
  groupId?: Uuid;
  /** Author note shown in the inspector. */
  note?: string;
}

export interface HardscapeObject extends SceneObjectBase {
  kind: 'hardscape';
  /** e.g. rock or driftwood catalog item. */
  ref: CatalogRef;
  /** Hardscape category for filtering UI, denormalized for offline display. */
  category?: 'rock' | 'wood' | 'other';
}

export interface PlantObject extends SceneObjectBase {
  kind: 'plant';
  ref: CatalogRef;
  /** Placement zone hint, used by templates/validation. */
  zone?: 'foreground' | 'midground' | 'background';
  /**
   * Growth simulation state. The growth engine is a pure function of
   * (plant catalog growth params, ageWeeks, seed); we persist ageWeeks and an
   * optional per-object growth multiplier so a saved scene reproduces exactly.
   */
  growth: {
    ageWeeks: number;
    /** Per-object size multiplier (e.g. trimmed vs. overgrown). Default 1. */
    vigor: number;
  };
  /**
   * Scatter/brush metadata when this plant represents a carpet patch rather
   * than a single specimen. Density drives instanced rendering; seed inherited
   * from doc unless overridden for reproducibility.
   */
  scatter?: {
    /** Patch outline in scene space (mm), polygon. */
    polygon: Vec2[];
    /** Instances per 100 cm². */
    density: number;
    seed?: number;
  };
}

/** Optional decorative/livestock sprite placed in the scene. */
export interface DecorObject extends SceneObjectBase {
  kind: 'decor';
  ref: CatalogRef;
  /** If true, excluded from "scape-only" exports (e.g. fish). */
  excludeFromScapeExport?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Planning extras (livestock / equipment) — optional
// ─────────────────────────────────────────────────────────────────────────

export interface LivestockEntry {
  id: Uuid;
  ref: CatalogRef; // species catalog item
  quantity: number;
  /** Optional link to a DecorObject rendering this species in-scene. */
  decorObjectId?: Uuid;
}

export interface EquipmentEntry {
  id: Uuid;
  ref: CatalogRef; // filter/heater/light/co2 catalog item
  /** Free-form config, e.g. { wattage: 25 } — validated per catalog schema. */
  settings?: Record<string, number | string | boolean>;
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Assets
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reference to a binary asset (e.g. an imported tank photo, a backdrop image).
 * In the zipped .aqua container these resolve to entries under /assets;
 * `uri` may also be a data: URL for small inlined assets.
 */
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

// ─────────────────────────────────────────────────────────────────────────
// Container format
// ─────────────────────────────────────────────────────────────────────────

/**
 * The on-disk `.aqua` file is a ZIP container:
 *
 *   /document.json     ← the AquaDocument above (UTF-8 JSON)
 *   /assets/<id>.<ext> ← binary assets referenced by AssetRef.uri
 *   /thumbnail.png     ← optional preview for galleries/file pickers
 *
 * Small documents with no binary assets MAY be saved as a bare JSON file with
 * the `.aqua` extension; readers must accept both (sniff for ZIP magic).
 */
export const AQUA_CONTAINER = {
  documentEntry: 'document.json',
  assetsDir: 'assets/',
  thumbnailEntry: 'thumbnail.png',
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Migration contract
// ─────────────────────────────────────────────────────────────────────────

/**
 * A migration upgrades a document object from version N to N+1. The migration
 * chain in `domain/document` applies these in sequence until the document
 * reaches the reader's CURRENT_SCHEMA_VERSION. Migrations must be pure and
 * total (never throw on a valid prior-version doc).
 */
export interface Migration {
  from: number;
  to: number;
  migrate(doc: unknown): unknown;
}
