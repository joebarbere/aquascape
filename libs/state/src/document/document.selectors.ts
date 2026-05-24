// Document feature selectors. F1.6.
//
// `createFeature` already exposes the base selectors (`selectDocumentState`
// plus one per field). The hand-rolled selectors below add derived UI shapes
// — formatted title strings, "have we ever saved this?" predicates, etc. —
// so components don't reach into the raw fields.

import { createSelector } from '@ngrx/store';

import { documentFeature } from './document.reducer';
import { UNTITLED_NAME } from './document.types';

export const {
  name: DOCUMENT_FEATURE_NAME,
  selectDocumentState,
  selectFileId,
  selectName,
  selectIsDirty,
  selectEnvelope,
  selectLastSavedAt,
  selectRecentFiles,
  selectStatus,
  selectLastError,
  selectPendingDraft,
  selectLastAutosavedAt,
} = documentFeature;

/**
 * Title-bar string: name with a leading `•` when dirty, used by the editor
 * shell's header and the document.title binding. Stable when fields don't
 * change so the OnPush header doesn't redraw on every store emission.
 */
export const selectDisplayTitle = createSelector(
  selectName,
  selectIsDirty,
  (name, isDirty) => `${isDirty ? '• ' : ''}${name}`,
);

/** True once the doc has an associated on-disk identity. */
export const selectHasFile = createSelector(
  selectFileId,
  (id): boolean => id !== null,
);

/**
 * True when a save can proceed in place (vs. requiring Save As). On platforms
 * where re-saving requires a fresh picker every time (web Fallback mode), the
 * effect collapses Save into Save As regardless of this selector.
 */
export const selectCanSave = createSelector(
  selectIsDirty,
  selectHasFile,
  (isDirty, hasFile) => isDirty && hasFile,
);

/** Friendly subtitle used when no document has been opened yet. */
export const selectIsUntitled = createSelector(
  selectName,
  selectFileId,
  (name, fileId) => fileId === null && name === UNTITLED_NAME,
);

/** True iff an autosave draft is waiting to be recovered or discarded. */
export const selectHasPendingDraft = createSelector(
  selectPendingDraft,
  (draft): boolean => draft !== null,
);
