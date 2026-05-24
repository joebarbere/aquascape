// Document feature effects. F1.6 / F1.4 / F1.5.
//
// All async work — file pickers, serialization, autosave, recovery — flows
// through here. The reducer stays data-in/data-out; the effects own platform
// IO. Each effect is single-purpose and named after its action source so the
// devtools trail reads top-down.
//
// Cross-feature dispatches: opening a file or recovering a draft dispatches
// BOTH `SceneActions.setScene({ scene })` (which the scene reducer observes
// to replace the scene + clear history) AND `DocumentActions.documentOpened`
// (which this feature observes to stamp identity + envelope). The two
// reducers are decoupled — neither imports the other — but a single user
// action lands consistently in both stores by emitting both.

import { Inject, Injectable, inject } from '@angular/core';
import type {
  AquaDocument,
  DocumentEnvelope,
  LoadResult,
  Migration,
} from '@aquascape/domain/document';
import {
  CURRENT_SCHEMA_VERSION,
  documentToScene,
  loadAquaDocument,
  packAquaDocument,
  sceneToDocument,
} from '@aquascape/domain/document';
import type {
  DialogService,
  FileService,
  StorageService,
} from '@aquascape/platform/platform-api';
import {
  DIALOG_SERVICE,
  FILE_SERVICE,
  STORAGE_SERVICE,
} from '@aquascape/platform/platform-api/angular';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concatLatestFrom } from '@ngrx/operators';
import { type Action, Store } from '@ngrx/store';
import { EMPTY, from, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  mergeMap,
  switchMap,
} from 'rxjs/operators';

import { defaultScene } from '../scene/default-scene';
import { SceneActions } from '../scene/scene.actions';
import { selectScene } from '../scene/scene.selectors';

import { DocumentActions } from './document.actions';
import {
  selectEnvelope,
  selectFileId,
  selectIsDirty,
  selectName,
  selectRecentFiles,
} from './document.selectors';
import {
  DEFAULT_NEW_FILENAME,
  MAX_RECENT_FILES,
  type PendingDraft,
  type RecentFileEntry,
  STORAGE_KEY_AUTOSAVE_DRAFT,
  STORAGE_KEY_RECENT_FILES,
  UNTITLED_NAME,
} from './document.types';

/**
 * Optional injection token for the autosave debounce. Tests pass `0` to make
 * the debounce synchronous; production default is 3000 ms (per F1.5 design).
 */
import { InjectionToken } from '@angular/core';

export const AUTOSAVE_DEBOUNCE_MS = new InjectionToken<number>('AUTOSAVE_DEBOUNCE_MS', {
  providedIn: 'root',
  factory: () => 3000,
});

/**
 * Shape of an autosave draft payload as stored. Versioned so the schema can
 * evolve without ambiguity for crash-recovery readers.
 */
interface AutosaveDraftPayload {
  /** Format-internal version of this draft envelope (NOT the .aqua schemaVersion). */
  readonly version: 1;
  /** The serialized AquaDocument (already migrated to CURRENT_SCHEMA_VERSION). */
  readonly document: AquaDocument;
  /** Last-known on-disk identity; null for a never-saved doc. */
  readonly fileId: string | null;
  /** Display name. */
  readonly name: string;
  /** ISO timestamp the draft was written. */
  readonly savedAt: string;
}

/** Stage 1 has no migration chain to inject; the loader takes the baseline. */
const NO_MIGRATIONS: readonly Migration[] = [];

@Injectable()
export class DocumentEffects {
  // `inject()` rather than constructor injection — keeps the class-field
  // `createEffect` declarations clean and consistent with `SceneEffects`.
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);
  private readonly fileService: FileService = inject(FILE_SERVICE);
  private readonly storageService: StorageService = inject(STORAGE_SERVICE);
  // Dialog service is unused in v1 of these effects but kept on the class so
  // the DI graph fails loudly at boot if a binding is missing (the toolbar
  // talks to it directly).
  private readonly dialogService: DialogService = inject(DIALOG_SERVICE);
  private readonly autosaveDebounceMs: number;

  constructor(@Inject(AUTOSAVE_DEBOUNCE_MS) autosaveDebounceMs: number) {
    void this.dialogService;
    this.autosaveDebounceMs = autosaveDebounceMs;
  }

  // ── New Document ────────────────────────────────────────────────────────
  readonly newDocument$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DocumentActions.newDocumentRequested),
      mergeMap(() => [
        SceneActions.setScene({ scene: defaultScene() }),
        DocumentActions.documentReset(),
      ]),
    ),
  );

  // ── Open Document ───────────────────────────────────────────────────────
  readonly openDocument$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DocumentActions.openDocumentRequested),
      switchMap(() =>
        from(this.fileService.openDocument()).pipe(
          mergeMap((result) => {
            if (result === null) {
              // User cancelled the picker — leave state idle.
              return [
                DocumentActions.openDocumentFailed({ message: 'Open cancelled' }),
              ];
            }
            return this.loadBytes(result.id, result.name, result.bytes);
          }),
          catchError((err: unknown) =>
            of(
              DocumentActions.openDocumentFailed({
                message: errorMessage(err),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // ── Open Recent ─────────────────────────────────────────────────────────
  //
  // Today this routes through the same FileService.openDocument() because the
  // Stage 0 in-memory transport ignores ids. F1.4 platform implementations
  // should re-open the file by id directly without a picker; for now the
  // behavioural contract is identical to a normal Open.
  readonly openRecent$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DocumentActions.openRecentFileRequested),
      switchMap(({ fileId }) =>
        from(this.fileService.openDocument()).pipe(
          mergeMap((result) => {
            if (result === null) {
              // Recent entry no longer reachable — surface as failure so the
              // UI can offer to remove the entry.
              return [
                DocumentActions.openDocumentFailed({
                  message: `Could not reopen ${fileId}`,
                }),
                DocumentActions.recentFileRemoved({ fileId }),
              ];
            }
            return this.loadBytes(result.id, result.name, result.bytes);
          }),
          catchError((err: unknown) =>
            of(DocumentActions.openDocumentFailed({ message: errorMessage(err) })),
          ),
        ),
      ),
    ),
  );

  // ── Save Document ───────────────────────────────────────────────────────
  readonly saveDocument$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DocumentActions.saveDocumentRequested),
      concatLatestFrom(() => [
        this.store.select(selectScene),
        this.store.select(selectEnvelope),
        this.store.select(selectFileId),
        this.store.select(selectName),
      ]),
      switchMap(([, scene, envelope, fileId, name]) => {
        const doc = sceneToDocument(scene, envelope ?? mintFreshEnvelope(name));
        const bytes = packAquaDocument(doc);
        const args = {
          ...(fileId !== null ? { id: fileId } : {}),
          bytes,
          suggestedName: filenameFor(name),
        };
        return from(this.fileService.saveDocument(args)).pipe(
          map((result) => {
            if (result === null) {
              return DocumentActions.saveDocumentFailed({ message: 'Save cancelled' });
            }
            return DocumentActions.documentSaved({ fileId: result.id, name });
          }),
          catchError((err: unknown) =>
            of(DocumentActions.saveDocumentFailed({ message: errorMessage(err) })),
          ),
        );
      }),
    ),
  );

  // ── Save As ─────────────────────────────────────────────────────────────
  readonly saveAs$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DocumentActions.saveAsDocumentRequested),
      concatLatestFrom(() => [
        this.store.select(selectScene),
        this.store.select(selectEnvelope),
        this.store.select(selectName),
      ]),
      switchMap(([, scene, envelope, name]) => {
        const doc = sceneToDocument(scene, envelope ?? mintFreshEnvelope(name));
        const bytes = packAquaDocument(doc);
        return from(
          this.fileService.saveDocumentAs({
            bytes,
            suggestedName: filenameFor(name),
          }),
        ).pipe(
          map((result) => {
            if (result === null) {
              return DocumentActions.saveDocumentFailed({ message: 'Save cancelled' });
            }
            return DocumentActions.documentSaved({ fileId: result.id, name });
          }),
          catchError((err: unknown) =>
            of(DocumentActions.saveDocumentFailed({ message: errorMessage(err) })),
          ),
        );
      }),
    ),
  );

  // ── On save: push to recent files, persist, clear autosave draft ────────
  readonly onSavePushRecent$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DocumentActions.documentSaved),
      map(({ fileId, name }) =>
        DocumentActions.recentFilePushed({
          entry: { fileId, name, openedAt: nowIso() },
        }),
      ),
    ),
  );

  readonly onSaveClearDraft$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DocumentActions.documentSaved, DocumentActions.documentReset),
      switchMap(() =>
        from(this.storageService.remove(STORAGE_KEY_AUTOSAVE_DRAFT)).pipe(
          map(() => DocumentActions.draftCleared()),
          catchError(() => of(DocumentActions.draftCleared())),
        ),
      ),
    ),
  );

  // ── Persist recent files whenever the list changes ──────────────────────
  readonly persistRecent$ = createEffect(
    () =>
      this.store.select(selectRecentFiles).pipe(
        distinctUntilChanged(),
        // Skip the initial emission to avoid clobbering storage with `[]`
        // before recentFilesLoaded fires.
        switchMap((entries) =>
          from(
            this.storageService.set(STORAGE_KEY_RECENT_FILES, entries.slice(0, MAX_RECENT_FILES)),
          ).pipe(
            map(() => null),
            catchError(() => of(null)),
          ),
        ),
      ),
    { dispatch: false },
  );

  // ── Dirty tracking: scene commits + undo/redo mark the doc dirty ────────
  readonly markDirty$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        SceneActions.applyCommandSucceeded,
        SceneActions.undo,
        SceneActions.redo,
        SceneActions.setTankPresetRef,
      ),
      // Reduce to one Mark Dirty per source event; reducer dedupes again
      // (no-op when already dirty), but this trims the action log.
      map(() => DocumentActions.markDirty()),
    ),
  );

  // ── Autosave (F1.5) ─────────────────────────────────────────────────────
  //
  // Triggered by `markDirty`, not by scene changes directly: that way the
  // debounce timer resets on the user's most recent edit, and we never
  // persist when nothing has changed (e.g. opening a doc dispatches
  // applyCommandSucceeded only via commands, not via setScene).
  readonly autosave$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DocumentActions.markDirty),
      debounceTime(this.autosaveDebounceMs),
      concatLatestFrom(() => [
        this.store.select(selectIsDirty),
        this.store.select(selectScene),
        this.store.select(selectEnvelope),
        this.store.select(selectFileId),
        this.store.select(selectName),
      ]),
      // The debounce may fire after a save cleared isDirty — skip in that case.
      filter(([, isDirty]) => isDirty),
      switchMap(([, , scene, envelope, fileId, name]) => {
        const savedAt = nowIso();
        const payload: AutosaveDraftPayload = {
          version: 1,
          document: sceneToDocument(scene, envelope ?? mintFreshEnvelope(name)),
          fileId,
          name,
          savedAt,
        };
        return from(this.storageService.set(STORAGE_KEY_AUTOSAVE_DRAFT, payload)).pipe(
          map(() => DocumentActions.autosaveDraftWritten({ savedAt })),
          catchError(() => EMPTY),
        );
      }),
    ),
  );

  /**
   * Bootstrap helper invoked by the composition root after the store is up.
   * Reads recent files + any draft from storage and dispatches the
   * corresponding success actions. Returns a Promise so callers can await it
   * before painting (the toolbar reads `pendingDraft` immediately).
   */
  async bootstrap(): Promise<void> {
    const [recent, draft] = await Promise.all([
      this.storageService.get<readonly RecentFileEntry[]>(STORAGE_KEY_RECENT_FILES).catch(() => null),
      this.storageService.get<AutosaveDraftPayload>(STORAGE_KEY_AUTOSAVE_DRAFT).catch(() => null),
    ]);
    if (recent !== null && Array.isArray(recent)) {
      this.store.dispatch(DocumentActions.recentFilesLoaded({ entries: recent }));
    }
    if (draft !== null && typeof draft === 'object' && draft.version === 1) {
      const summary: PendingDraft = {
        name: draft.name,
        savedAt: draft.savedAt,
        fileId: draft.fileId,
      };
      this.store.dispatch(DocumentActions.draftDiscovered({ draft: summary }));
    }
  }

  // ── Recovery flow (F1.5) ────────────────────────────────────────────────
  readonly draftRecovery$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DocumentActions.draftRecoveryRequested),
      switchMap(() =>
        from(this.storageService.get<AutosaveDraftPayload>(STORAGE_KEY_AUTOSAVE_DRAFT)).pipe(
          mergeMap((draft) => {
            if (draft === null || typeof draft !== 'object' || draft.version !== 1) {
              return of(DocumentActions.draftCleared());
            }
            const { scene, envelope } = documentToScene(draft.document);
            // Recovered document is presumed dirty (it was unsaved when the
            // session ended). The user must Save to clear the dirty flag.
            return [
              SceneActions.setScene({ scene }),
              DocumentActions.documentOpened({
                fileId: draft.fileId ?? '',
                name: draft.name,
                envelope,
              }),
              DocumentActions.markDirty(),
              DocumentActions.draftCleared(),
            ];
          }),
        ),
      ),
    ),
  );

  readonly draftDiscarded$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DocumentActions.draftDiscarded),
      switchMap(() =>
        from(this.storageService.remove(STORAGE_KEY_AUTOSAVE_DRAFT)).pipe(
          map(() => DocumentActions.draftCleared()),
        ),
      ),
    ),
  );

  // ── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Common path from "bytes in hand" to a `documentOpened` + `setScene` dispatch.
   * Returns a small array of actions for `mergeMap` to flatten into the stream.
   */
  private loadBytes(fileId: string, name: string, bytes: Uint8Array): Action[] {
    const loaded: LoadResult = loadAquaDocument(bytes, {
      migrations: NO_MIGRATIONS,
      targetVersion: CURRENT_SCHEMA_VERSION,
    });
    if (!loaded.ok) {
      return [DocumentActions.openDocumentFailed({ message: describeLoadError(loaded.error) })];
    }
    const { scene, envelope } = documentToScene(loaded.document);
    return [
      // Dispatch scene replacement FIRST so the renderer paints the new doc
      // before the document store flips status to idle (avoids a one-tick
      // flash of the previous scene with the new title).
      SceneActions.setScene({ scene }),
      DocumentActions.documentOpened({ fileId, name, envelope }),
      DocumentActions.recentFilePushed({ entry: { fileId, name, openedAt: nowIso() } }),
    ];
  }
}

// ── Local pure helpers (no DI, no rx) ───────────────────────────────────────

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function nowIso(): string {
  return new Date().toISOString();
}

function filenameFor(name: string): string {
  if (name === UNTITLED_NAME) return DEFAULT_NEW_FILENAME;
  return name.endsWith('.aqua') ? name : `${name}.aqua`;
}

/**
 * Synthesize a minimal envelope when the document store has none (a New
 * Document being saved for the first time). The envelope's `meta.seed` is
 * overwritten on save from `scene.seed`; the rest is just-enough to satisfy
 * the schema.
 */
function mintFreshEnvelope(title: string): DocumentEnvelope {
  const now = new Date().toISOString();
  return {
    meta: {
      id: newUuid(),
      title,
      createdAt: now,
      updatedAt: now,
      appVersion: '1.0.0',
      // Overwritten on save from scene.seed via `sceneToDocument`.
      seed: 0,
    },
  };
}

/**
 * UUID v4 generator with a `Math.random` fallback.
 *
 * Browsers + Electron renderer have `crypto.randomUUID`; jsdom under Jest
 * does not, so a fallback keeps tests + non-Chromium-isolated environments
 * working. The fallback is good enough for document identity (collisions
 * astronomically unlikely) but is NOT cryptographically suitable.
 */
function newUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Render a load failure into a user-facing message. Exported for unit tests —
 * the effect path calls this internally, but the sub-branches of
 * `migration-failed` are rare enough that driving them through the effect
 * stream is more friction than value.
 */
export function describeLoadError(err: LoadResult & { ok: false } extends { error: infer E } ? E : never): string {
  switch (err.kind) {
    case 'container-malformed':
      return `Could not read .aqua container: ${err.message}`;
    case 'json-parse-failed':
      return `Document JSON is invalid: ${err.message}`;
    case 'schema-invalid':
      return `Document failed validation (${err.errors.length} error${err.errors.length === 1 ? '' : 's'})`;
    case 'migration-failed':
      switch (err.error.kind) {
        case 'unsupported-future-version':
          return `Document is from a newer version (v${err.error.documentVersion}); this reader supports up to v${err.error.readerVersion}`;
        case 'missing-migration':
          return `No migration from v${err.error.from} to v${err.error.to}`;
        case 'invalid-step':
          return `Migration step v${err.error.from} → v${err.error.to} is invalid: ${err.error.reason}`;
        case 'migration-threw':
          return `Migration v${err.error.from} → v${err.error.to} threw: ${errorMessage(err.error.cause)}`;
      }
  }
}

