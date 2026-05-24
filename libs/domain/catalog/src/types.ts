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

// ─── Placeholders for later stages ────────────────────────────────────────
//
// Each future kind adds a branch here AND a matching schema branch. Until
// then the loader rejects unknown kinds (verifiable via tests) so a typo'd
// manifest doesn't silently slip through.

export type CatalogEntry = SubstrateEntry;

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
  byKind<K extends CatalogKind>(
    kind: K,
  ): readonly Extract<CatalogEntry, { kind: K }>[];
}
