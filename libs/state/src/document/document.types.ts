// Document feature shared types. Kept in their own file so the actions /
// reducer / selectors / effects can all import without circular deps.

/**
 * A recent-files entry. Persisted as JSON in `StorageService` under the
 * `STORAGE_KEY_RECENT_FILES` key. Kept deliberately small: just the platform
 * `fileId` (handle on web / absolute path on Electron), the display name,
 * and an ISO timestamp so the UI can show "opened 3 days ago".
 *
 * Note: `fileId` semantics differ by platform — a web fallback (no FSA) may
 * mint a synthetic id that doesn't reopen, in which case the UI surfaces the
 * entry as "name only" rather than a working link.
 */
export interface RecentFileEntry {
  fileId: string;
  name: string;
  openedAt: string;
}

/**
 * Metadata about a draft autosave the loader found on boot. The actual
 * document bytes live in `StorageService` under
 * `STORAGE_KEY_AUTOSAVE_DRAFT` — we keep only what the recovery prompt
 * needs in NgRx so the store stays light.
 */
export interface PendingDraft {
  name: string;
  savedAt: string;
  /** `null` if the draft was authored on a previous browser/session where
   * no file was associated yet (a never-saved New Document). */
  fileId: string | null;
}

/** Storage keys owned by the document feature. Single source of truth. */
export const STORAGE_KEY_RECENT_FILES = 'aquascape.recentFiles';
export const STORAGE_KEY_AUTOSAVE_DRAFT = 'aquascape.autosaveDraft';

/** Maximum number of recent-file entries kept in the persisted list. */
export const MAX_RECENT_FILES = 10;

/** Display name shown until the user saves for the first time. */
export const UNTITLED_NAME = 'Untitled';

/** Suggested filename for Save As on a new document. */
export const DEFAULT_NEW_FILENAME = 'untitled.aqua';
