// Document-feature action group. F1.6.
//
// The "document" feature is the on-disk identity of what the user is editing:
// a file path/handle, a display name, a dirty flag, the original meta + extras
// envelope, and a persisted recent-files list. The "scene" feature owns the
// editable scene graph; the two stay separate so the scene reducer never needs
// to know whether the doc came from disk, a draft, or a fresh "New Document".
//
// Effect → state direction is explicit in action names: `*Requested` are UI
// intents the effect picks up; `*Succeeded` / `*Failed` carry resolved data
// from async work. Reducers never reach for the file system or storage — the
// effect performs IO, then dispatches an outcome that's pure data.
//
// A handful of actions deliberately fan out to multiple reducers:
//   - `Document Opened` is observed by BOTH the scene reducer (replaces the
//     scene + clears history via `SceneActions.setScene`, dispatched alongside)
//     and the document reducer (sets fileId/name/envelope, clears dirty).
//   - `New Document` is analogous (default scene + envelope-less doc).
// The effect dispatches both `Set Scene` and `Document Opened` so each
// reducer reads only its own action.

import type { DocumentEnvelope } from '@aquascape/domain/document';
import { createActionGroup, emptyProps, props } from '@ngrx/store';

import type { PendingDraft, RecentFileEntry } from './document.types';

export const DocumentActions = createActionGroup({
  source: 'Document',
  events: {
    // ── New / Open / Save / Save As (UI intents) ──────────────────────────
    'New Document Requested': emptyProps(),

    'Open Document Requested': emptyProps(),

    /**
     * Open a specific entry from the recent-files list. Distinct from the
     * generic open intent because the effect skips the file picker.
     */
    'Open Recent File Requested': props<{ fileId: string }>(),

    'Save Document Requested': emptyProps(),
    'Save As Document Requested': emptyProps(),

    // ── Open / save outcomes ──────────────────────────────────────────────

    /**
     * A file has been read off disk, parsed, migrated, and validated. The
     * scene reducer observes `Set Scene` (dispatched alongside) to replace
     * its scene; the document reducer observes this to set identity + envelope.
     */
    'Document Opened': props<{
      fileId: string;
      name: string;
      envelope: DocumentEnvelope;
    }>(),

    'Open Document Failed': props<{ message: string }>(),

    /**
     * A document has been packed + written to disk. The document reducer
     * clears `isDirty`, stamps the new `fileId`/`name`, and the effect
     * removes any autosave draft from storage.
     */
    'Document Saved': props<{ fileId: string; name: string }>(),

    'Save Document Failed': props<{ message: string }>(),

    /**
     * A New-Document command has been honoured. Scene reducer observes
     * `Set Scene` (dispatched alongside) with a default scene; this action
     * resets the doc identity (fileId=null, name="Untitled", isDirty=false,
     * envelope=null).
     */
    'Document Reset': emptyProps(),

    // ── Dirty tracking ────────────────────────────────────────────────────

    /**
     * Mark the document as having unsaved changes. Dispatched by the
     * `markDirtyOnSceneEdit$` effect when the scene reducer commits a
     * successful command — also fires on undo/redo since both move the
     * scene away from the last-saved state.
     */
    'Mark Dirty': emptyProps(),

    // ── Recent files ──────────────────────────────────────────────────────

    /**
     * Recent files loaded from `StorageService` on boot. Reducer commits.
     */
    'Recent Files Loaded': props<{ entries: readonly RecentFileEntry[] }>(),

    /** Reducer adds (or hoists) the entry to the front of the recent list. */
    'Recent File Pushed': props<{ entry: RecentFileEntry }>(),

    /** Reducer removes the matching entry. */
    'Recent File Removed': props<{ fileId: string }>(),

    // ── Autosave + crash recovery (F1.5) ──────────────────────────────────

    /**
     * The autosave effect has written a draft to storage. State carries
     * only the timestamp for UI display ("Autosaved 5s ago"); the document
     * bytes live in storage, not in NgRx.
     */
    'Autosave Draft Written': props<{ savedAt: string }>(),

    /**
     * On-boot effect found a draft in storage. Reducer surfaces it via
     * `pendingDraft` so the UI can prompt the user.
     */
    'Draft Discovered': props<{ draft: PendingDraft }>(),

    /** User accepted the draft recovery prompt. Effect re-loads + replaces scene. */
    'Draft Recovery Requested': emptyProps(),

    /** User dismissed the prompt. Effect clears the draft from storage. */
    'Draft Discarded': emptyProps(),

    /** Effect: the draft slot in storage has been cleared. Reducer clears `pendingDraft`. */
    'Draft Cleared': emptyProps(),
  },
});
