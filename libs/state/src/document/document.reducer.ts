// Document feature reducer + state shape. F1.6.
//
// State is intentionally narrow: the on-disk identity (`fileId` + `name`), a
// dirty flag, the captured envelope so save round-trips preserve unknown
// extensions, plus a recent-files list and a small async status surface.
// The scene itself lives in the scene feature, not here.
//
// All async work lives in `document.effects.ts`; this reducer is pure
// data-in/data-out.

import type { DocumentEnvelope } from '@aquascape/domain/document';
import { createFeature, createReducer, on } from '@ngrx/store';

import { DocumentActions } from './document.actions';
import {
  MAX_RECENT_FILES,
  type PendingDraft,
  type RecentFileEntry,
  UNTITLED_NAME,
} from './document.types';

export const DOCUMENT_FEATURE_KEY = 'document';

/** Async operation surface. Drives spinners + retry affordances in the UI. */
export type DocumentStatus = 'idle' | 'opening' | 'saving';

export interface DocumentState {
  /** Platform-specific handle id. `null` = new/unsaved (no on-disk identity yet). */
  readonly fileId: string | null;
  /** Display name shown in the title bar — basename, not full path. */
  readonly name: string;
  /** True if the scene/envelope has diverged from the last-saved bytes. */
  readonly isDirty: boolean;
  /**
   * The non-scene part of the on-disk document: `meta` plus any optional
   * `extensions` bag, carried verbatim. Captured on open, used on save to keep
   * round-trips lossless. `null` for a fresh New Document (the save effect
   * mints a minimal envelope).
   */
  readonly envelope: DocumentEnvelope | null;
  /** Last save time as ISO timestamp; `null` if never saved. */
  readonly lastSavedAt: string | null;
  /** Recent files MRU. Front is most-recent. Persisted to StorageService. */
  readonly recentFiles: readonly RecentFileEntry[];
  /** Async-operation status surface; mirrors loading/saving spinners. */
  readonly status: DocumentStatus;
  /** Last error message for UI toasts. Cleared on the next request. */
  readonly lastError: string | null;
  /** Set when boot finds an autosave draft; cleared after recover/discard. */
  readonly pendingDraft: PendingDraft | null;
  /** Last autosave timestamp, ISO. `null` until the first debounce fires. */
  readonly lastAutosavedAt: string | null;
}

/**
 * Fresh document state. Exported so tests and the eventual "new document"
 * command can produce a clean state without reaching into private internals.
 */
export function initialDocumentState(): DocumentState {
  return {
    fileId: null,
    name: UNTITLED_NAME,
    isDirty: false,
    envelope: null,
    lastSavedAt: null,
    recentFiles: [],
    status: 'idle',
    lastError: null,
    pendingDraft: null,
    lastAutosavedAt: null,
  };
}

const reducer = createReducer<DocumentState>(
  initialDocumentState(),

  // ── New / Open / Save intents flip status + clear last error ──────────
  on(DocumentActions.newDocumentRequested, (state) => ({ ...state, lastError: null })),
  on(DocumentActions.openDocumentRequested, DocumentActions.openRecentFileRequested, (state) => ({
    ...state,
    status: 'opening' as const,
    lastError: null,
  })),
  on(DocumentActions.saveDocumentRequested, DocumentActions.saveAsDocumentRequested, (state) => ({
    ...state,
    status: 'saving' as const,
    lastError: null,
  })),

  // ── Open outcomes ─────────────────────────────────────────────────────
  on(DocumentActions.documentOpened, (state, { fileId, name, envelope }) => ({
    ...state,
    fileId,
    name,
    envelope,
    isDirty: false,
    status: 'idle' as const,
    lastError: null,
    // Loading a file is a successful save-equivalent — clear any draft prompt.
    pendingDraft: null,
  })),

  on(DocumentActions.openDocumentFailed, (state, { message }) => ({
    ...state,
    status: 'idle' as const,
    lastError: message,
  })),

  // ── Save outcomes ─────────────────────────────────────────────────────
  on(DocumentActions.documentSaved, (state, { fileId, name }) => ({
    ...state,
    fileId,
    name,
    isDirty: false,
    lastSavedAt: nowIso(),
    status: 'idle' as const,
    lastError: null,
    // Clearing pendingDraft here too: a successful save subsumes any
    // unrecovered draft from a prior session.
    pendingDraft: null,
  })),

  on(DocumentActions.saveDocumentFailed, (state, { message }) => ({
    ...state,
    status: 'idle' as const,
    lastError: message,
  })),

  // ── New Document ──────────────────────────────────────────────────────
  on(DocumentActions.documentReset, () => initialDocumentState()),

  // ── Dirty tracking ────────────────────────────────────────────────────
  on(DocumentActions.markDirty, (state) => (state.isDirty ? state : { ...state, isDirty: true })),

  // ── Recent files ──────────────────────────────────────────────────────
  on(DocumentActions.recentFilesLoaded, (state, { entries }) => ({
    ...state,
    recentFiles: [...entries].slice(0, MAX_RECENT_FILES),
  })),

  on(DocumentActions.recentFilePushed, (state, { entry }) => ({
    ...state,
    recentFiles: pushRecent(state.recentFiles, entry),
  })),

  on(DocumentActions.recentFileRemoved, (state, { fileId }) => ({
    ...state,
    recentFiles: state.recentFiles.filter((e) => e.fileId !== fileId),
  })),

  // ── Autosave + crash recovery ─────────────────────────────────────────
  on(DocumentActions.autosaveDraftWritten, (state, { savedAt }) => ({
    ...state,
    lastAutosavedAt: savedAt,
  })),

  on(DocumentActions.draftDiscovered, (state, { draft }) => ({
    ...state,
    pendingDraft: draft,
  })),

  on(DocumentActions.draftCleared, (state) => ({
    ...state,
    pendingDraft: null,
  })),
);

/**
 * Hoist `entry` to the front, deduping by `fileId`, capped at
 * `MAX_RECENT_FILES`. Returned slice is a fresh array so reducers stay pure.
 */
function pushRecent(
  current: readonly RecentFileEntry[],
  entry: RecentFileEntry,
): readonly RecentFileEntry[] {
  const filtered = current.filter((e) => e.fileId !== entry.fileId);
  return [entry, ...filtered].slice(0, MAX_RECENT_FILES);
}

/** Wall-clock ISO timestamp. Pulled out as a one-liner so tests can mock it. */
function nowIso(): string {
  return new Date().toISOString();
}

export const documentFeature = createFeature({
  name: DOCUMENT_FEATURE_KEY,
  reducer,
});
