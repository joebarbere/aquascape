/**
 * `@aquascape/domain/catalog` type surface.
 *
 * The catalog holds **content** — substrates, hardscape items, plants, fish,
 * equipment — that the editor references by `CatalogRef` (`{ catalog, id,
 * version }`). Each entry is plain serializable JSON; new kinds are added by
 * extending the `CatalogEntry` discriminated union and the matching branch
 * of `catalog-entry.schema.json`. Stage 2 ships substrate; Stages 3–7 add
 * the rest.
 *
 * Design rules:
 * - Entries are catalog-scoped + id-scoped: `(catalog, id)` is the natural
 *   primary key. Multiple catalogs (e.g. `core` + `community:tropiscape`)
 *   may publish the same `id`; the document's `CatalogRef.catalog` picks
 *   between them.
 * - `version` is the entry's own version (not the schema version). Bumping
 *   it on a breaking change lets readers compare against the document's
 *   `CatalogRef.version` and surface a mismatch.
 * - Colors are sRGB hex (`#RRGGBB`); units are millimetres for grain sizes,
 *   matching the rest of the document format.
 */

import type {
  AnimationParams,
  CuriosityParams,
  DepthParams,
  FearParams,
  FeedingParams,
  NippingParams,
  SchoolingParams,
  TerritoryParams,
} from '@aquascape/domain/livestock-behaviors';

/** Linear measurement in millimetres. Integers preferred. */
export type Millimetres = number;

/** sRGB hex color, e.g. "#2e7d32". */
export type HexColor = string;

/** Discriminated union over catalog content types. */
export type CatalogKind = 'substrate' | 'tank' | 'hardscape' | 'plant' | 'equipment' | 'livestock';

/** Shared envelope every catalog entry carries. */
export interface CatalogEntryBase {
  /** Catalog namespace, e.g. "core", "community:tropiscape". */
  catalog: string;
  /** Stable id within the catalog. Kebab-case dot-namespaced recommended. */
  id: string;
  /** Catalog entry version. Bump on breaking changes. */
  version: number;
  /** Human-readable display name. */
  name: string;
  /** Optional description shown in the inspector / catalog browser. */
  description?: string;
  /** Free-form tags for filtering / search. */
  tags?: string[];
}

// ─── Substrate (Stage 2 F2.1) ─────────────────────────────────────────────

/**
 * A substrate material — aquasoil, sand, gravel, etc. Carries enough to
 * render (color) and to display in the inspector (grain size + description).
 *
 * `color` is the base fill the renderer paints under the seeded grain noise;
 * future stages may add a `texture` reference for PNG-based rendering, but
 * the color path stays the deterministic baseline.
 */
export interface SubstrateEntry extends CatalogEntryBase {
  kind: 'substrate';
  /** Coarse material classification. Drives bioload + planting hints later. */
  material: 'soil' | 'sand' | 'gravel';
  /** Base fill color (sRGB hex). The renderer overlays seeded noise on top. */
  color: HexColor;
  /** Typical grain diameter (mm). Used for inspector display + future visuals. */
  grainSize?: Millimetres;
}

// ─── Hardscape (Stage 3 F3.5) ─────────────────────────────────────────────

/**
 * A rock / driftwood / decorative hardscape item. Renders as a closed
 * polygon silhouette filled with `color`; future stages may attach 3D
 * meshes (Stage 10) or photorealistic textures, but the silhouette path
 * stays the deterministic, offline-rendable baseline.
 *
 * - `category` drives the palette's filter tabs in the hardscape-tool UI.
 * - `subcategory` is a free string (e.g. 'seiryu', 'manzanita') used as a
 *   secondary filter pill.
 * - `naturalSize` is the world-space footprint at `transform.scale = 1`.
 *   The renderer scales the normalized silhouette by `naturalSize × 0.5`
 *   then by `transform.scale`, so the silhouette spans `naturalSize`
 *   when the user hasn't resized the object.
 * - `silhouette` is a closed convex-ish polygon in normalized `[-1, 1]`
 *   space (origin = object center). At least 3 points; the renderer
 *   implicitly closes the path back to point[0].
 */
export interface HardscapeEntry extends CatalogEntryBase {
  kind: 'hardscape';
  category: 'rock' | 'wood' | 'other';
  /** Secondary filter pill: 'seiryu' / 'manzanita' / etc. Free-form. */
  subcategory?: string;
  /** World-space footprint at `transform.scale = 1`. */
  naturalSize: { width: Millimetres; height: Millimetres; depth: Millimetres };
  /** Base fill color (sRGB hex). Stage 10's 3D renderer ignores this. */
  color: HexColor;
  /** Closed polygon in normalized `[-1, 1]` space. ≥ 3 points. */
  silhouette: ReadonlyArray<{ x: number; y: number }>;
  /**
   * Refuge value for fish in REFUGE mode (Stage 11 F11.3 FearSystem). Range
   * `[0, 1]` — 0 = not cover, 1 = perfect refuge.
   *
   * When absent at load time, the catalog loader fills it from `category`:
   * - `wood`  → 0.6   (driftwood + branches read as good cover)
   * - `rock`  → 0.4   (caves + crevices)
   * - `other` → 0     (decor like statues = not actual cover)
   *
   * Plants get a separate runtime-computed coverScore (= 0.5 × density of the
   * scatter polygon) inside the FearSystem; this field doesn't apply to plant
   * entries, only to hardscape rocks + wood + decor.
   */
  coverScore?: number;
}

// ─── Plant (Stage 4 F4.1) ─────────────────────────────────────────────────

/**
 * A plant species — anything green that grows in the tank. Carries the
 * planning metadata users care about (lighting, CO2, difficulty) plus the
 * growth params the F4.4 simulation reads.
 *
 * - `zone` drives which planting-tool tab the plant appears under.
 * - `lighting` / `co2` / `difficulty` are advisory metadata shown in the
 *   inspector; Stage 7 livestock/equipment compatibility checks may
 *   eventually cross-reference them.
 * - `naturalSize` is the mature footprint at `vigor = 1`. The renderer
 *   scales the silhouette by `naturalSize × 0.5 × transform.scale ×
 *   growthScale` so a freshly-planted specimen is small and grows.
 * - `silhouette` is a closed polygon in `[-1, 1]` (same convention as
 *   hardscape).
 * - `growth.weeksToMature` + `growth.sizeAtZero` parameterise the linear
 *   growth model in `@aquascape/domain/growth-sim`.
 * - `defaultDensity` is the planting-tool's "carpet brush" default for
 *   carpets; not meaningful for specimens.
 */
export interface PlantEntry extends CatalogEntryBase {
  kind: 'plant';
  zone: 'foreground' | 'midground' | 'background';
  lighting: 'low' | 'medium' | 'high';
  co2: 'none' | 'low' | 'high';
  difficulty: 'easy' | 'moderate' | 'advanced';
  color: HexColor;
  naturalSize: { width: Millimetres; height: Millimetres; depth: Millimetres };
  silhouette: ReadonlyArray<{ x: number; y: number }>;
  growth: {
    /** Wall-clock weeks from a fresh trim to mature size at vigor = 1. */
    weeksToMature: number;
    /** Scale at week 0, in [0, 1]. Plugs ~0.3, rosettes ~0.5, specimens ~0.7. */
    sizeAtZero: number;
  };
  /** Suggested carpet-brush density (instances per 100 cm²); carpets only. */
  defaultDensity?: number;
}

// ─── Livestock (Stage 7 F7.1) ─────────────────────────────────────────────

/**
 * A livestock species — fish, shrimp, snails the user might stock. F7.1
 * surfaces these as inventory only: the catalog browser, an inspector
 * swatch, and a quantity. The canvas is NOT changed — livestock do NOT
 * paint as silhouettes in F7.1. A future revision can add an optional
 * spritesheet ref (or a `decorObjectId` link via the document's
 * `LivestockEntry` envelope) when "decorative fish swimming" rendering
 * lands.
 *
 * - `group` drives the F7.1 UI filter tabs and the F7.2 bioload rules.
 * - `adultSize` is the typical adult body length in millimetres. Used by
 *   the inspector + F7.2 bioload estimation.
 * - `temperament` is advisory for F7.2's compatibility rule engine; not
 *   enforced anywhere by F7.1 alone.
 * - `temperatureRange.minC < maxC` and `pHRange.min < max` are CONTRACT
 *   invariants the manifest author owes the system. The JSON Schema can't
 *   express cross-field comparisons declaratively (it asserts each bound
 *   is finite and within plausible aquarium range only); downstream
 *   consumers should treat the values as advisory and surface "out of
 *   range" / "incompatible" warnings rather than crashing.
 * - `schoolingMin` is the minimum recommended group size; `1` means
 *   solitary / non-schooling. F7.2 surfaces a warning when `quantity <
 *   schoolingMin`.
 * - `bioloadClass` is advisory input to F7.2's bioload-vs-volume rule.
 *   A more precise per-species coefficient may replace it later.
 * - `color` is a display swatch for the catalog browser; it is NOT a
 *   rendered silhouette colour (livestock are not painted into the scene
 *   in F7.1).
 * - `compatibilityFlags` are optional pre-baked answers for F7.2's rule
 *   engine ("plays nice with delicate plants?", "nips long fins?",
 *   "needs brackish water?"). Cheap to declare now so the next sub-feature
 *   doesn't need a schema bump.
 */
export interface LivestockEntry extends CatalogEntryBase {
  kind: 'livestock';
  group: 'fish' | 'shrimp' | 'snail';
  /** Typical adult body length, in millimetres. */
  adultSize: Millimetres;
  temperament: 'peaceful' | 'semi-aggressive' | 'aggressive';
  /** Water temperature tolerance window, in Celsius. minC < maxC (advisory). */
  temperatureRange: { minC: number; maxC: number };
  /** Water pH tolerance window. min < max (advisory). */
  pHRange: { min: number; max: number };
  /** Minimum recommended group size. 1 = solitary / non-schooling. */
  schoolingMin: number;
  /** Advisory bioload bucket consumed by F7.2's bioload-vs-volume rule. */
  bioloadClass: 'low' | 'medium' | 'high';
  /** Display swatch in the catalog browser. NOT a rendered silhouette colour. */
  color: HexColor;
  /** Pre-baked answers for F7.2's compatibility rule engine. */
  compatibilityFlags?: {
    /** True when the species coexists with delicate live plants. */
    plantedOK?: boolean;
    /** True when the species is known to nip long fins. */
    finNipper?: boolean;
    /** True when the species needs brackish (non-freshwater) water. */
    brackish?: boolean;
  };
  /**
   * Optional per-species overrides for the Stage 11 F11.2 schooling +
   * vertical-stratification pipeline. Every subfield is optional; absent
   * fields resolve to the per-group preset via `resolveBehavior()` in
   * `@aquascape/domain/livestock-behaviors`. Manifest authors only declare
   * what they want to override (e.g. just `behavior.depth.preferredY = 0.88`
   * for a slightly-higher-than-default species).
   *
   * Schema: catalog manifest schemaVersion 3 introduces this block. v2
   * manifests load unchanged because every field is optional + additive —
   * `resolveBehavior()` handles a missing block by falling back to the
   * group preset.
   *
   * The `SchoolingParams` / `DepthParams` / `AnimationParams` types are
   * imported as `type only` from `@aquascape/domain/livestock-behaviors` so
   * the catalog runtime bundle never pulls behaviour code in. The dep edge
   * runs catalog → livestock-behaviors at the type level only.
   */
  behavior?: {
    schooling?: Partial<SchoolingParams>;
    depth?: Partial<DepthParams>;
    animation?: Partial<AnimationParams>;
    /**
     * Stage 11 F11.3 territoriality override. Explicit `null` opts OUT of the
     * per-species heuristic (e.g. a peaceful dwarf cichlid that shouldn't
     * inherit the cichlid territory default); a partial object overrides
     * subfields while keeping the heuristic's other values; absent leaves
     * `resolveBehavior()` free to pick from the per-species heuristic.
     */
    territory?: Partial<TerritoryParams> | null;
    /**
     * Stage 11 F11.3 fin-nipping override. Explicit `null` opts OUT of the
     * per-species nipping heuristic; partial objects override subfields.
     */
    nipping?: Partial<NippingParams> | null;
    /**
     * Stage 11 F11.3 anti-predator / fear override. No `| null` — every fish
     * carries fear (Lima & Dill 1990); manifest authors can only tune values,
     * not opt out.
     */
    fear?: Partial<FearParams>;
    /**
     * Stage 11 F11.4 per-species feeding override. `category` drives the
     * FeedingSystem's target selection (surface flake vs. midwater pellet vs.
     * substrate sinking wafer, plus algae-grazer / plant-eater / detritivore
     * passive uptake paths). `hungerRatePerSec` + `threshold` tune how
     * visibly hungry the species reads. No `| null` — every fish has hunger;
     * the lib still needs to resolve defaults for an absent block.
     */
    feeding?: Partial<FeedingParams>;
    /**
     * Stage 11 F11.4 curiosity / glass-surfing override. `ratePerSec = 0` is
     * a valid value that disables glass-surfing entirely for the species; no
     * `| null` is needed for opt-out. Defaults still resolve via
     * `resolveBehavior()` when the block is absent.
     */
    curiosity?: Partial<CuriosityParams>;
  };
}

// ─── Equipment (Stage 7 F7.3) ─────────────────────────────────────────────

/**
 * A piece of aquarium equipment — filters, heaters, lights, CO2 systems —
 * the user might attach to a tank. F7.3 surfaces these as inventory only:
 * the catalog browser, an inspector swatch, and a settings record. The
 * canvas is NOT changed — equipment does NOT paint as silhouettes in F7.3.
 *
 * - `category` drives the F7.3 UI filter chips and the future F7.4 setup
 *   sheet's per-category grouping.
 * - `subcategory` is a free-form secondary classification (e.g. `'canister'`
 *   / `'hob'` / `'sponge'` / `'internal'` for filters; `'submersible'` for
 *   heaters; `'led-pendant'` / `'led-clip'` for lights; `'diffuser'` /
 *   `'pressurised'` for CO2). Reserved for UI-side filter pills.
 * - `wattage` is the manufacturer-published power draw in watts. Used by
 *   the inspector + (future F7.4) electrical-load summary. Omitted when
 *   the manufacturer doesn't publish a figure rather than fabricated.
 * - `flowRateLph` is filter-specific (litres per hour). Ignored when
 *   undefined; non-filter equipment leaves it unset.
 * - `coverageLitres` is the manufacturer's recommended tank-size window.
 *   Either bound may be omitted (small clip lights often publish only an
 *   upper bound; large lights only a lower bound). Both values must be
 *   positive integers when present.
 * - `defaultSettings` are seed values the future settings UI populates on
 *   first attach. F7.3 v1 does NOT ship a settings editor — these are
 *   display-only. The shape mirrors the document-side
 *   `EquipmentEntry.settings` Record so a future "attach with defaults"
 *   flow can copy this verbatim into the document.
 * - `color` is a display swatch for the catalog browser; it is NOT a
 *   rendered silhouette colour (equipment is not painted into the scene
 *   in F7.3).
 */
export interface EquipmentEntry extends CatalogEntryBase {
  kind: 'equipment';
  category: 'filter' | 'heater' | 'light' | 'co2';
  /** Free-form sub-classification used by future UI filter pills. */
  subcategory?: string;
  /** Manufacturer-published power draw, in watts. Integer preferred. */
  wattage?: number;
  /** Manufacturer-published flow rate (litres per hour). Filter-specific. */
  flowRateLph?: number;
  /** Recommended tank-size window. Either bound is optional. */
  coverageLitres?: { min?: number; max?: number };
  /** Seed settings populated on first attach. Display-only in F7.3 v1. */
  defaultSettings?: Record<string, number | string | boolean>;
  /** Display swatch in the catalog browser. NOT a rendered silhouette colour. */
  color: HexColor;
}

// ─── Placeholders for later stages ────────────────────────────────────────
//
// Each future kind adds a branch here AND a matching schema branch. Until
// then the loader rejects unknown kinds (verifiable via tests) so a typo'd
// manifest doesn't silently slip through.

export type CatalogEntry =
  | SubstrateEntry
  | HardscapeEntry
  | PlantEntry
  | LivestockEntry
  | EquipmentEntry;

/**
 * Lookup table built from a validated catalog: `(catalog, id) -> entry`.
 * Wrapped in a method so callers don't reach into the raw map and assume
 * stable key encoding.
 */
export interface Catalog {
  /** All entries, in load order, for iteration / filtering. */
  readonly entries: readonly CatalogEntry[];

  /**
   * Look up a single entry by its `(catalog, id)` pair. Returns `null` when
   * the entry is unknown — callers fall back to the "missing reference"
   * inspector state rather than throwing.
   */
  get(args: { catalog: string; id: string }): CatalogEntry | null;

  /**
   * Filter entries by `kind`. Returns a fresh array; safe to sort in-place.
   */
  byKind<K extends CatalogKind>(kind: K): readonly Extract<CatalogEntry, { kind: K }>[];
}
