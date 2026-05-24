// Public API for @aquascape/domain/document.
//
// Owns the .aqua v1 schema, (de)serialization, validation, the Migration chain,
// and marshaling between the on-disk `AquaDocument` and the in-memory `Scene`.
// Plan §2.7 / Stage 1 F1.3.

// ─── Canonical types (schema v1) ──────────────────────────────────────────
export type {
  AquaDocument,
  AssetRef,
  CatalogRef,
  DecorObject,
  DocumentMeta,
  EquipmentEntry,
  HardscapeObject,
  HexColor,
  IsoTimestamp,
  Layer,
  LivestockEntry,
  Migration,
  Millimetres,
  PlantObject,
  RenderRecord,
  SceneObject,
  Substrate,
  SubstrateRegion,
  Tank,
  TankStyle,
  Transform,
  Uuid,
  Vec2,
  Vec3,
} from './aqua-document';
export { AQUA_CONTAINER, CURRENT_SCHEMA_VERSION } from './aqua-document';

// ─── Validation ───────────────────────────────────────────────────────────
export {
  AQUA_DOCUMENT_JSON_SCHEMA,
  type ValidationError,
  type ValidationResult,
  validateAquaDocument,
} from './validator';

// ─── Migrations ───────────────────────────────────────────────────────────
export {
  AQUA_MIGRATIONS,
  type MigrationError,
  type MigrationResult,
  runMigrations,
} from './migrations';

// ─── Container (ZIP / bare JSON) ──────────────────────────────────────────
export {
  type AquaContainerAssets,
  type AquaContainerContents,
  isZipContainer,
  packAquaContainer,
  readAquaContainer,
} from './container';

// ─── Load / serialize ─────────────────────────────────────────────────────
export {
  type LoadError,
  type LoadOptions,
  type LoadResult,
  type LoadSuccess,
  loadAquaDocument,
  packAquaDocument,
  serializeAquaDocument,
} from './serialize';

// ─── AquaDocument ↔ Scene marshaling ──────────────────────────────────────
export { type DocumentEnvelope, documentToScene, sceneToDocument } from './marshal';
