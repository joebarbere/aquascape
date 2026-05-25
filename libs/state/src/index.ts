// Public API for @aquascape/state.
//
// NgRx-based store layer. Stage 0 was a stub; F1.1 Phase B introduces the
// first feature (`scene`) and the `provideSceneStore()` composition helper
// that the app shells call at bootstrap.

import type { Provider, EnvironmentProviders } from '@angular/core';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';

import { documentFeature, DocumentEffects } from './document';
import { sceneFeature, SceneEffects } from './scene';
import { selectionFeature, SelectionEffects } from './selection';

/**
 * Compose the scene-feature providers (state slice + effects) for a
 * bootstrap providers array. Call alongside `provideStore({})` /
 * `provideEffects()` at the app's composition root.
 *
 * Returns an `EnvironmentProviders` so the caller spreads it in directly:
 *
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     provideStore({}),
 *     provideEffects(),
 *     provideSceneStore(),
 *   ],
 * });
 * ```
 */
export function provideSceneStore(): Array<Provider | EnvironmentProviders> {
  return [provideState(sceneFeature), provideEffects(SceneEffects)];
}

/**
 * Compose the document-feature providers. Pair with `provideSceneStore()` —
 * the two are independent stores but several effects dispatch into both
 * (open/save/recover/new), so providing one without the other surfaces as
 * silently-dropped actions at runtime. Always provide both at the app root.
 *
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     provideStore({}),
 *     provideEffects(),
 *     provideSceneStore(),
 *     provideDocumentStore(),
 *   ],
 * });
 * ```
 */
export function provideDocumentStore(): Array<Provider | EnvironmentProviders> {
  return [provideState(documentFeature), provideEffects(DocumentEffects)];
}

/**
 * Compose the selection-feature providers. The selection slice is transient
 * editor state (NOT persisted in the `.aqua` document). Always provide
 * alongside `provideSceneStore()` so the `setScene` → `selectionWasReset`
 * effect can fire.
 */
export function provideSelectionStore(): Array<Provider | EnvironmentProviders> {
  return [provideState(selectionFeature), provideEffects(SelectionEffects)];
}

// Feature surface — actions, selectors, and the default-scene factory.
export {
  SceneActions,
  SCENE_FEATURE_KEY,
  initialSceneState,
  sceneFeature,
  SceneEffects,
  selectSceneState,
  selectScene,
  selectHistory,
  selectTank,
  selectTankPresetRef,
  selectSubstrate,
  selectSubstrateRegions,
  selectLivestock,
  selectLivestockById,
  selectCanUndo,
  selectCanRedo,
  defaultScene,
  DEFAULT_TANK_WIDTH_MM,
  DEFAULT_TANK_HEIGHT_MM,
  DEFAULT_TANK_DEPTH_MM,
} from './scene';
export type { SceneState } from './scene';

// Document feature.
export {
  AUTOSAVE_DEBOUNCE_MS,
  DEFAULT_NEW_FILENAME,
  DOCUMENT_FEATURE_KEY,
  DocumentActions,
  DocumentEffects,
  MAX_RECENT_FILES,
  STORAGE_KEY_AUTOSAVE_DRAFT,
  STORAGE_KEY_RECENT_FILES,
  UNTITLED_NAME,
  documentFeature,
  initialDocumentState,
  selectCanSave,
  selectDisplayTitle,
  selectDocumentState,
  selectEnvelope,
  selectFileId,
  selectHasFile,
  selectHasPendingDraft,
  selectIsDirty,
  selectIsUntitled,
  selectLastAutosavedAt,
  selectLastError,
  selectLastSavedAt,
  selectName,
  selectPendingDraft,
  selectRecentFiles,
  selectStatus,
} from './document';
export type { DocumentState, DocumentStatus, PendingDraft, RecentFileEntry } from './document';

// Selection feature (Stage 3 F3.3).
export {
  SELECTION_FEATURE_KEY,
  SelectionActions,
  SelectionEffects,
  initialSelectionState,
  selectFirstSelected,
  selectHasSelection,
  selectIsSelected,
  selectSelectedIds,
  selectSelectionCount,
  selectSelectionState,
  selectionFeature,
} from './selection';
export type { SelectionState } from './selection';
