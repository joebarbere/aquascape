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
  Substrate,
  SubstrateRegion,
  Layer,
  SceneObject,
  HardscapeObject,
  PlantObject,
  DecorObject,
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
  ReorderLayersCommand,
  AddObjectCommand,
  RemoveObjectCommand,
  MoveObjectCommand,
  ReshapeObjectCommand,
  SetTankDimensionsCommand,
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
  reorderLayers,
  addObject,
  removeObject,
  moveObject,
  reshapeObject,
  setTankDimensions,
  SET_TANK_DIMENSIONS_MAX_MM,
  composite,
  identityTransform,
} from './commands';

// ─── History ──────────────────────────────────────────────────────────────
export { createHistory } from './history';
export type { History, HistoryEntry, HistoryOptions } from './history';
