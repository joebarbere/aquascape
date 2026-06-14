// Public API for @aquascape/domain/scene-model.
//
// In-memory Scene model + Command primitive + undo/redo history.
// Plan §2.3 / Stage 0 F0.3. Framework-free. See ./README.md for the
// design choices (command shape, locked-layer-guard semantics, ReorderLayers
// semantics, MoveObject delta vs absolute).

// ─── Types ────────────────────────────────────────────────────────────────
export type {
  Scene,
  Tank,
  TankStyle,
  WaterChemistry,
  Substrate,
  SubstrateRegion,
  Layer,
  LivestockEntry,
  EquipmentEntry,
  SceneObject,
  HardscapeObject,
  PlantObject,
  DecorObject,
  DoseEvent,
  DoseDeltas,
  CatalogRef,
  AssetRef,
  ObjectId,
  LayerId,
  Uuid,
  Millimetres,
  HexColor,
} from './types';

// ─── IDs ──────────────────────────────────────────────────────────────────
export {
  newObjectId,
  newLayerId,
  asObjectId,
  asLayerId,
  setIdFactory,
  defaultIdFactory,
} from './ids';
export type { IdFactory } from './ids';

// ─── Selectors ────────────────────────────────────────────────────────────
export {
  getObjectById,
  getObjectWithLayer,
  getLayerById,
  getActiveLayer,
  iterateObjects,
  selectLivestock,
  selectLivestockById,
  selectEquipment,
  selectEquipmentById,
  selectDoseLog,
  selectDoseEventById,
  nextDoseSeq,
  effectiveWaterLevelMm,
  DEFAULT_WATER_GAP_BELOW_RIM_MM,
} from './selectors';

// ─── Commands ─────────────────────────────────────────────────────────────
export type {
  Command,
  CommandResult,
  RejectReason,
  NoopCommand,
  AddLayerCommand,
  RemoveLayerCommand,
  RenameLayerCommand,
  SetLayerOpacityCommand,
  SetLayerVisibilityCommand,
  SetLayerLockedCommand,
  SetLayerZoneCommand,
  ReorderLayersCommand,
  AddObjectCommand,
  RemoveObjectCommand,
  MoveObjectCommand,
  ReshapeObjectCommand,
  MirrorObjectCommand,
  ReorderObjectInLayerCommand,
  SetObjectGroupIdCommand,
  SetTankDimensionsCommand,
  SetTankStyleCommand,
  SetWaterLevelCommand,
  CompositeCommand,
} from './commands';

export {
  applyCommand,
  invertCommand,
  noop,
  addLayer,
  removeLayer,
  renameLayer,
  setLayerOpacity,
  setLayerVisibility,
  setLayerLocked,
  setLayerZone,
  reorderLayers,
  addObject,
  removeObject,
  moveObject,
  reshapeObject,
  mirrorObject,
  reorderObjectInLayer,
  setObjectGroupId,
  setTankDimensions,
  SET_TANK_DIMENSIONS_MAX_MM,
  setTankStyle,
  setWaterLevel,
  composite,
  identityTransform,
} from './commands';

// ─── Substrate commands (Stage 2 F2.2) ────────────────────────────────────
export type {
  AddSubstrateRegionCommand,
  RegionId,
  RemoveSubstrateRegionCommand,
  SetSubstrateRegionExtentCommand,
  SetSubstrateRegionMaterialCommand,
  SetSubstrateRegionProfileCommand,
  SubstrateCommand,
} from './substrate-commands';

export {
  addSubstrateRegion,
  asRegionId,
  removeSubstrateRegion,
  setSubstrateRegionExtent,
  setSubstrateRegionMaterial,
  setSubstrateRegionProfile,
  validateSubstrateRegion,
} from './substrate-commands';

// ─── Livestock commands (Stage 7 F7.1) ────────────────────────────────────
export type {
  AddLivestockEntryCommand,
  LivestockCommand,
  RemoveLivestockEntryCommand,
  UpdateLivestockQuantityCommand,
} from './livestock-commands';

export {
  addLivestockEntry,
  removeLivestockEntry,
  updateLivestockQuantity,
} from './livestock-commands';

// ─── Equipment commands (Stage 7 F7.3) ────────────────────────────────────
export type {
  AddEquipmentEntryCommand,
  EquipmentCommand,
  RemoveEquipmentEntryCommand,
  SetEquipmentNoteCommand,
  UpdateEquipmentSettingsCommand,
} from './equipment-commands';

export {
  addEquipmentEntry,
  removeEquipmentEntry,
  setEquipmentNote,
  updateEquipmentSettings,
} from './equipment-commands';

// ─── Nutrient dosing commands (Nutrients & additives + dosing, F-B) ────────
// (Water-change command types are re-exported below alongside its builders.)
export type {
  DoseNutrientCommand,
  RemoveDoseEventCommand,
  NutrientCommand,
  ResolvedNutrient,
} from './nutrient-commands';

export {
  doseNutrient,
  removeDoseEvent,
  computeDoseDeltas,
} from './nutrient-commands';

// ─── Water-change command (Stage 13 F13.5a) ───────────────────────────────
export type {
  WaterChangeCommand,
  ReplacementWater,
} from './water-change-commands';

export { waterChange, applyWaterChange } from './water-change-commands';

// ─── History ──────────────────────────────────────────────────────────────
export { createHistory } from './history';
export type { History, HistoryEntry, HistoryOptions } from './history';
