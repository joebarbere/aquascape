// Public API for @aquascape/domain/catalog. Stage 2 F2.4 + Stage 3 F3.5.
//
// Content catalogs (substrate / tank / hardscape / plant / equipment /
// livestock) that the editor references via `CatalogRef`. Stages 2 + 3 +
// 4 + 7 F7.1 ship `substrate` + `hardscape` + `plant` + `livestock`
// kinds plus a content-type-agnostic loader/validator. Future stages
// (7 equipment, 8 community) add manifest branches under the same
// `oneOf` and per-kind manifests under `./data/<kind>/`.

// ─── Types ────────────────────────────────────────────────────────────────
export type {
  Catalog,
  CatalogEntry,
  CatalogEntryBase,
  CatalogKind,
  CatalogTextureRefs,
  DecorEntry,
  EquipmentEntry,
  HardscapeEntry,
  HexColor,
  LivestockEntry,
  Millimetres,
  NutrientCategory,
  NutrientContributions,
  NutrientEffect,
  NutrientEntry,
  PlantEntry,
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
export { CORE_CATALOG_MANIFESTS, CORE_CATALOG_RESULT, coreCatalog } from './core-catalog';
