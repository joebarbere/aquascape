// Public API for @aquascape/domain/catalog. Stage 2 F2.4.
//
// Content catalogs (substrate / tank / hardscape / plant / equipment /
// livestock) that the editor references via `CatalogRef`. Stage 2 ships the
// substrate kind + a content-type-agnostic loader/validator. Future stages
// (3 hardscape, 4 plant, 7 livestock + equipment, 8 community) add manifest
// branches under the same `oneOf` and per-kind manifests under
// `./data/<kind>/`.

// ─── Types ────────────────────────────────────────────────────────────────
export type {
  Catalog,
  CatalogEntry,
  CatalogEntryBase,
  CatalogKind,
  HexColor,
  Millimetres,
  SubstrateEntry,
} from './types';

// ─── Validator ────────────────────────────────────────────────────────────
export {
  CATALOG_ENTRY_JSON_SCHEMA,
  type ValidationError,
  type ValidationResult,
  validateCatalogEntry,
} from './validator';

// ─── Loader ───────────────────────────────────────────────────────────────
export {
  type CatalogLoadError,
  type CatalogLoadResult,
  type CatalogLoadWarning,
  emptyCatalog,
  loadCatalog,
} from './loader';

// ─── Core catalog (bundled) ───────────────────────────────────────────────
export {
  CORE_CATALOG_MANIFESTS,
  CORE_CATALOG_RESULT,
  coreCatalog,
} from './core-catalog';
