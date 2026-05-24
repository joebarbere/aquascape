// Document feature barrel. F1.6.

export { DocumentActions } from './document.actions';
export {
  DOCUMENT_FEATURE_KEY,
  documentFeature,
  initialDocumentState,
  type DocumentState,
  type DocumentStatus,
} from './document.reducer';
export {
  AUTOSAVE_DEBOUNCE_MS,
  DocumentEffects,
} from './document.effects';
export {
  DOCUMENT_FEATURE_NAME,
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
} from './document.selectors';
export {
  DEFAULT_NEW_FILENAME,
  MAX_RECENT_FILES,
  STORAGE_KEY_AUTOSAVE_DRAFT,
  STORAGE_KEY_RECENT_FILES,
  UNTITLED_NAME,
  type PendingDraft,
  type RecentFileEntry,
} from './document.types';
