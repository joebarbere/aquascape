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
export type CatalogKind =
  | 'substrate'
  | 'tank'
  | 'hardscape'
  | 'plant'
  | 'equipment'
  | 'livestock'
  | 'decor'
  | 'nutrient';

/**
 * Optional photorealistic texture maps (Bucket 2 of the 3D fidelity plan,
 * 3D renderer only). Shared by `SubstrateEntry`, `HardscapeEntry`, and
 * `PlantEntry`.
 *
 * Refs are renderer-agnostic relative file names under the catalog texture
 * root — the host serves that root at `assets/catalog-textures/` and the 3D
 * renderer resolves `baseUrl + ref`. The 2D renderer ignores the field
 * entirely; the 3D renderer samples the maps triplanar in world space (no
 * UVs in the procedural geometry). An absent field = the procedural-only
 * pre-Bucket-2 look — every map is optional, so manifests can ship any
 * subset.
 *
 * Texture refs follow the family file-name convention
 * `<family>.{albedo,normal,roughness}.png` (e.g. `stone-gray.albedo.png`);
 * the schema constrains each ref to `^[a-z0-9._/-]+\.png$`.
 *
 * Livestock is deliberately EXCLUDED: per-species textures fight the
 * per-archetype InstancedMesh batching in `livestock-renderer-3d` (one draw
 * call per archetype, per-instance data limited to attribute slabs) —
 * deferred, documented in the plan.
 */
export interface CatalogTextureRefs {
  /** Base-colour map ref, relative to the catalog texture root. */
  albedo?: string;
  /** Tangent-space normal map ref. */
  normal?: string;
  /** Roughness map ref (grayscale, 0 = mirror, 1 = matte). */
  roughness?: string;
}

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
  /** Optional photorealistic texture maps (Bucket 2, 3D renderer only). */
  textures?: CatalogTextureRefs;
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
  /** Optional photorealistic texture maps (Bucket 2, 3D renderer only). */
  textures?: CatalogTextureRefs;
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
  /** Optional photorealistic texture maps (Bucket 2, 3D renderer only). */
  textures?: CatalogTextureRefs;
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
  /**
   * Stage 11 fidelity pass — when true, this species spawns as a roaming
   * PREDATOR in the 3D simulation: nearby prey fish accumulate fear-risk and
   * flee to cover (livestock-ecs FearSystem reads it via
   * `spawnFish({ predator: true })`). Additive + optional; no manifest
   * schemaVersion bump (the v3 schema gains it additively like the other
   * F11.x behaviour fields).
   */
  predator?: boolean;
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

  /**
   * Stage 11 F11.5 — flow contribution for filter / pump equipment. Drives
   * the FlowFieldSystem (`libs/domain/fluid-sim/`): each declared `outflowPos`
   * is a positive-divergence source, each `intakePos` a negative-divergence
   * sink, baked once per scene into a 32×32×32 velocity grid. When absent,
   * the equipment contributes no flow — backward-compatible with manifests
   * authored before F11.5. The structural `{ x; y; z }` shape mirrors
   * `Vec3` in `@aquascape/domain/geometry`; we re-declare it inline so the
   * catalog runtime has no upward dep on geometry.
   *
   * Coordinates are world-space millimetres in the document's right-handed
   * frame (origin = tank front-bottom-left interior corner, +x right, +y
   * up, +z back). `flowRate` is the manufacturer-style volumetric figure in
   * litres per hour, scaling the source/sink strength.
   *
   * Schema: catalog manifest schemaVersion stays at 3 — every subfield is
   * optional + additive, so older manifests load unchanged.
   */
  flow?: {
    /** World-space position where water exits the equipment (mm). */
    outflowPos?: { x: number; y: number; z: number };
    /**
     * Direction vector of the outflow jet (unit-ish). Default `(0, 0, 1)` —
     * pointing toward the back of the tank when omitted.
     */
    outflowVec?: { x: number; y: number; z: number };
    /**
     * World-space position where water enters the equipment intake (mm).
     * Optional — when absent, the intake is co-located with `outflowPos`
     * (filter sits as a single in-place point source).
     */
    intakePos?: { x: number; y: number; z: number };
    /** Volumetric flow rate (L/hr). Drives source/sink strength. Default 200. */
    flowRate?: number;
  };

  /**
   * Stage 11 F11.5 — air-stone air volumetric rate (mL/min). Drives the
   * `BubbleParticleSystem` spawn rate in `livestock-renderer-3d`. When
   * absent, the equipment is not an air-stone (or does not produce visible
   * bubbles). Backward-compatible — older manifests load unchanged.
   */
  airRateMl?: number;

  /**
   * Stage 11 F11.7 — optional daily photoperiod for lighting equipment
   * (hours per day, 0–24). Drives the F11.7 day-night cycle's "equipment"
   * mode (Wave 5 exposes the toggle UI). Only meaningful when
   * `category === 'light'`; ignored for non-lighting categories. Absent =
   * use the service's default 10 h on / 14 h off cycle.
   *
   * Schema: catalog manifest schemaVersion stays at 3 — additive within
   * the F11.5/F11.6 series, mirroring the `flow` / `airRateMl` pattern.
   */
  photoperiodHours?: number;

  /**
   * Light-emission parameters for `category: 'light'` equipment. Drives the
   * 3D renderer's overhead equipment lighting (one SpotLight + fixture mesh
   * per attached light). Every subfield is optional — the renderer supplies
   * defaults — and the whole block is additive (older manifests load
   * unchanged). Only meaningful when `category === 'light'`; ignored
   * otherwise. Omit unpublished figures rather than fabricating them.
   */
  light?: {
    /** Manufacturer-published luminous flux, in lumens. */
    lumens?: number;
    /** Correlated colour temperature, in Kelvin (e.g. 6500). */
    colorTempK?: number;
    /** Full beam spread angle, in degrees (LED panels are typically ~120). */
    beamAngleDeg?: number;
    /** Physical fixture length along the tank's width axis, in mm. */
    fixtureLengthMm?: number;
  };
}

// ─── Decor (3D-modelled classic ornaments) ────────────────────────────────

/**
 * A classic aquarium ornament — treasure chest, sunken galleon, skull,
 * castle tower… Unlike hardscape (procedural silhouette extrusion), decor
 * is 3D-modelled: `model` references a committed glTF-binary (GLB) file the
 * 3D renderer loads. The GLB carries its own authored PBR materials, so
 * there is deliberately NO `textures` block on decor — the triplanar
 * catalog-texture pipeline exists to dress procedural geometry, and layering
 * it over authored materials would fight the baker's work.
 *
 * - `category` drives the filter chips in the decorations-tool UI.
 * - `naturalSize` is the world-space bounding box at `transform.scale = 1`
 *   (mm). The GLB is authored to exactly this box — the renderer never has
 *   to measure or re-fit the mesh.
 * - `color` + `silhouette` are the deterministic 2D baseline, same
 *   convention as hardscape: the 2D renderer fills the closed polygon with
 *   `color` and the palette tile renders it as an SVG. The 3D renderer
 *   ignores both (the GLB is the 3D look).
 * - `model` is resolved by the 3D renderer as `baseUrl + ref` against the
 *   catalog model root — the host serves `libs/domain/catalog/assets/models/`
 *   at `assets/catalog-models/`. The 2D renderer ignores it.
 *
 * Core decor entries are generic archetypes of the classic resin ornaments
 * (no brand names, no fabricated manufacturer specs): `naturalSize` is the
 * authored model's bounding box, not a vendor figure.
 */
export interface DecorEntry extends CatalogEntryBase {
  kind: 'decor';
  /** Filter chips in the decorations-tool UI. */
  category: 'wreck' | 'ruin' | 'bones' | 'structure';
  /** Free-form secondary filter pill (e.g. 'pirate', 'greco-roman'). */
  subcategory?: string;
  /** World-space bounding box at transform.scale = 1 (mm). The GLB is authored to exactly this box. */
  naturalSize: { width: Millimetres; height: Millimetres; depth: Millimetres };
  /** 2D silhouette fill (3D renderer ignores; the GLB carries its own PBR materials). */
  color: HexColor;
  /** Closed polygon in normalized [-1,1] space, ≥3 points — same convention as hardscape. Drives the 2D renderer + palette tile SVG. */
  silhouette: ReadonlyArray<{ x: number; y: number }>;
  /**
   * Refuge value `[0, 1]` for the Stage 11 F11.3 FearSystem; loader defaults
   * by category when absent: structure → 0.6, wreck → 0.5, bones → 0.4,
   * ruin → 0.3 (decorations have swim-through cavities, unlike flat
   * hardscape 'other' decor, which defaults to 0).
   */
  coverScore?: number;
  /**
   * REQUIRED glTF-binary model ref relative to the catalog model root,
   * pattern `^[a-z0-9._/-]+\.glb$`. Host serves
   * `libs/domain/catalog/assets/models/` at `assets/catalog-models/`; the
   * 3D renderer resolves `baseUrl + ref`. 2D ignores.
   */
  model: string;
}

// ─── Nutrient (Nutrients & additives + dosing, F-A) ───────────────────────

/**
 * The coarse classification of a dosing product. Drives the future Dose-tool
 * picker filter chips and the `DoseNutrient` Command's category-default delta
 * (for proprietary products that don't disclose per-dose ppm).
 *
 * - `macro-salt`    — single-axis macro nutrient sources: dry fertiliser salts
 *                     (KNO3, KH2PO4, K2SO4, MgSO4, CaSO4) and the equivalent
 *                     single-macro liquid supplements (Flourish Nitrogen /
 *                     Phosphorus / Potassium). `form` disambiguates dry vs.
 *                     liquid.
 * - `micro-trace`   — chelated trace-element / iron mixes (CSM+B, Fe-DTPA,
 *                     Flourish Comprehensive / Trace / Iron).
 * - `all-in-one`    — combined macro+micro liquids (APT Complete, Thrive, …).
 * - `liquid-carbon` — glutaraldehyde-style carbon sources (Flourish Excel).
 * - `conditioner`   — dechlorinator / ammonia-detox water conditioners (Prime).
 * - `remineralizer` — GH/mineral builders for soft/RO water (Equilibrium, GH+).
 * - `buffer`        — KH/pH buffers (Alkaline Buffer, Acid Buffer).
 * - `bacteria`      — nitrifying-bacteria cycling seeds (Stability).
 */
export type NutrientCategory =
  | 'macro-salt'
  | 'micro-trace'
  | 'all-in-one'
  | 'liquid-carbon'
  | 'conditioner'
  | 'remineralizer'
  | 'buffer'
  | 'bacteria';

/**
 * The water-chemistry / husbandry parameters a dosing product moves. Used as a
 * qualitative descriptor on EVERY nutrient entry (disclosed or not) and, for
 * the future Dose tool, to drive which Stage 13 `Tank.waterChemistry` readouts
 * highlight after a dose. A proprietary product that doesn't publish per-dose
 * ppm still declares an honest `affects` list.
 *
 * - `no3` / `po4` / `k` / `fe` / `traces` — the planted-tank nutrient axes.
 * - `gh` / `kh` — general / carbonate hardness (remineralizers + buffers).
 * - `ph` — buffers that move pH up or down.
 * - `ammoniaDetox` — binds/detoxifies ammonia (Prime).
 * - `carbon` — supplies an organic carbon source (liquid carbon).
 * - `bacteriaSeed` — introduces nitrifying bacteria (cycling products).
 * - `dechlorinate` — removes chlorine / chloramine (conditioners).
 */
export type NutrientEffect =
  | 'no3'
  | 'po4'
  | 'k'
  | 'fe'
  | 'traces'
  | 'gh'
  | 'kh'
  | 'ph'
  | 'ammoniaDetox'
  | 'carbon'
  | 'bacteriaSeed'
  | 'dechlorinate';

/**
 * Per-dose parameter contributions, in the canonical hobby units: ppm for the
 * nutrient axes (`no3` / `po4` / `k` / `fe` / `mg` / `ca`), and degrees of
 * general/carbonate hardness (dGH / dKH) for `gh` / `kh`. The values are stated
 * for one representative `dose` (see `NutrientEntry.dose`); the `DoseNutrient`
 * Command scales them linearly by the user's chosen amount.
 *
 * **Honesty rule:** populate this block ONLY for products whose per-dose deltas
 * are publicly disclosed (dry salts with known stoichiometry, all-in-ones that
 * publish their NPK breakdown). For proprietary liquids that don't publish
 * per-dose ppm, set `disclosed: false` and OMIT this block — never fabricate
 * numbers. Every field is optional so a product can disclose a subset.
 */
export interface NutrientContributions {
  /** Nitrate (NO3) added, in ppm, per representative dose. */
  no3?: number;
  /** Phosphate (PO4) added, in ppm, per representative dose. */
  po4?: number;
  /** Potassium (K) added, in ppm, per representative dose. */
  k?: number;
  /** Iron (Fe) added, in ppm, per representative dose. */
  fe?: number;
  /** Magnesium (Mg) added, in ppm, per representative dose. */
  mg?: number;
  /** Calcium (Ca) added, in ppm, per representative dose. */
  ca?: number;
  /** General hardness raised, in degrees (dGH), per representative dose. */
  gh?: number;
  /** Carbonate hardness raised, in degrees (dKH), per representative dose. */
  kh?: number;
}

/**
 * A real-world aquarium nutrient / additive the user can dose in simulation
 * mode — dry fertiliser salts, all-in-one liquids, liquid carbon, water
 * conditioners, remineralizers, buffers, and bacteria cycling products.
 *
 * The nutrient catalog is the data layer for the "Nutrients & additives +
 * dosing" feature (F-A). The downstream `DoseNutrient` Command (F-B) resolves
 * an entry by `CatalogRef` and computes a `Tank.waterChemistry` delta —
 * scaling `contributes` linearly by amount for disclosed products, or applying
 * a category-default nudge for proprietary ones.
 *
 * **Honesty contract (carried from the plan into `docs/caveats/catalog.md`):**
 * - `disclosed: true` ⇒ the per-dose ppm/dGH values in `contributes` come from
 *   a public source (cited in `source`): dry-salt stoichiometry or a
 *   manufacturer's published NPK breakdown.
 * - `disclosed: false` ⇒ a proprietary product that doesn't publish per-dose
 *   values. The entry OMITS `contributes` and relies on the qualitative
 *   `affects` list only. Fabricating ppm for these products is forbidden.
 *
 * - `dose` is the representative dose the `contributes` figures are stated for
 *   (e.g. `{ amount: 5, unit: 'ml', perLitres: 100 }` = "5 ml per 100 L").
 * - `form` is `'dry'` (weighed salts) or `'liquid'` (bottled solutions).
 * - `formula` is the chemical formula for dry salts (e.g. `KNO3`), omitted for
 *   proprietary liquids.
 * - `color` is a UI swatch for the catalog browser / Dose picker — NOT a
 *   rendered scene colour (nutrients never paint into the canvas).
 * - `shrimpSafe` flags products safe for shrimp tanks (liquid carbon and some
 *   trace mixes are notoriously not). Optional — absent = unspecified.
 */
export interface NutrientEntry extends CatalogEntryBase {
  kind: 'nutrient';
  /** Coarse classification — drives the Dose picker filter + default delta. */
  category: NutrientCategory;
  /** Manufacturer / brand (e.g. "Seachem", "2Hr Aquarist", "DIY dry salt"). */
  brand: string;
  /** Physical form: weighed dry salts vs. bottled liquid. */
  form: 'dry' | 'liquid';
  /** The representative dose the `contributes` figures are stated for. */
  dose: {
    /** Amount of product per `perLitres` of tank water. */
    amount: number;
    /** Unit of `amount` — grams (dry) or millilitres (liquid). */
    unit: 'g' | 'ml';
    /** Tank-water volume the dose is stated against, in litres. */
    perLitres: number;
  };
  /**
   * Per-dose parameter contributions — ONLY when `disclosed: true`. Omitted for
   * proprietary products (see `disclosed`). Never fabricate these values.
   */
  contributes?: NutrientContributions;
  /**
   * Whether the per-dose `contributes` figures are publicly disclosed. `false`
   * marks a proprietary product whose entry carries qualitative `affects` only.
   */
  disclosed: boolean;
  /** Honest qualitative list of which parameters this product moves. */
  affects: NutrientEffect[];
  /** Chemical formula for dry salts (e.g. "KNO3"). Omitted for liquids. */
  formula?: string;
  /** Citation URL for the disclosed values / product page. */
  source?: string;
  /** UI swatch for the catalog browser / Dose picker. NOT a scene colour. */
  color: HexColor;
  /** True when the product is safe for shrimp tanks. Absent = unspecified. */
  shrimpSafe?: boolean;
  /** Free-form caveats (e.g. "overdosing melts Vallisneria / mosses"). */
  notes?: string;
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
  | EquipmentEntry
  | DecorEntry
  | NutrientEntry;

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
