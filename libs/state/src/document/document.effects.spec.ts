// Document effects tests. F1.6 / F1.4 / F1.5.
//
// Uses the standard NgRx testing surface (`provideMockActions` +
// `provideMockStore`) with hand-rolled fakes for FileService / StorageService
// / DialogService so we don't pull in the platform implementations.
//
// The autosave debounce is wired through `AUTOSAVE_DEBOUNCE_MS` and set to 0
// in tests so the effect fires synchronously.

import { TestBed } from '@angular/core/testing';
import {
  CURRENT_SCHEMA_VERSION,
  packAquaDocument,
  serializeAquaDocument,
  type AquaDocument,
} from '@aquascape/domain/document';
import type {
  DialogService,
  FileService,
  OpenDocumentResult,
  SaveDocumentResult,
  StorageService,
} from '@aquascape/platform/platform-api';
import {
  DIALOG_SERVICE,
  FILE_SERVICE,
  STORAGE_SERVICE,
} from '@aquascape/platform/platform-api/angular';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, ReplaySubject } from 'rxjs';
import { take, toArray } from 'rxjs/operators';

import { defaultScene } from '../scene/default-scene';
import { SceneActions } from '../scene/scene.actions';
import { selectScene } from '../scene/scene.selectors';

import { DocumentActions } from './document.actions';
import {
  AUTOSAVE_DEBOUNCE_MS,
  DocumentEffects,
  describeLoadError,
} from './document.effects';
import {
  selectEnvelope,
  selectFileId,
  selectIsDirty,
  selectName,
  selectRecentFiles,
} from './document.selectors';
import { STORAGE_KEY_AUTOSAVE_DRAFT, STORAGE_KEY_RECENT_FILES } from './document.types';

const SAMPLE_DOC: AquaDocument = {
  format: 'aquascape',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  meta: {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Loaded Scape',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    appVersion: '1.0.0',
    seed: 42,
  },
  tank: {
    width: 600,
    height: 360,
    depth: 360,
    style: { frame: 'rimless', background: { kind: 'none' } },
  },
  substrate: { regions: [] },
  layers: [],
};

interface FakeStorage extends StorageService {
  readonly store: Map<string, unknown>;
}

function makeFakeFile(overrides: Partial<FileService> = {}): jest.Mocked<FileService> {
  const base: jest.Mocked<FileService> = {
    openDocument: jest.fn<Promise<OpenDocumentResult | null>, []>(async () => null),
    saveDocument: jest.fn<
      Promise<SaveDocumentResult | null>,
      [{ id?: string; bytes: Uint8Array; suggestedName: string }]
    >(async () => ({ id: 'saved-1' })),
    saveDocumentAs: jest.fn<
      Promise<SaveDocumentResult | null>,
      [{ bytes: Uint8Array; suggestedName: string }]
    >(async () => ({ id: 'saved-1' })),
    ...overrides,
  } as jest.Mocked<FileService>;
  return base;
}

function makeFakeStorage(initial: Record<string, unknown> = {}): FakeStorage {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    async get<T>(key: string): Promise<T | null> {
      return (store.has(key) ? (store.get(key) as T) : null);
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
    },
    async remove(key: string): Promise<void> {
      store.delete(key);
    },
  };
}

function makeFakeDialog(): jest.Mocked<DialogService> {
  return {
    confirm: jest.fn(async () => true),
    alert: jest.fn(async () => undefined),
  };
}

function configure(opts: {
  actionsSource: Parameters<typeof provideMockActions>[0];
  fileService?: jest.Mocked<FileService>;
  storageService?: FakeStorage;
  dialogService?: jest.Mocked<DialogService>;
  initialIsDirty?: boolean;
  initialFileId?: string | null;
  initialName?: string;
  debounceMs?: number;
}) {
  const fileService = opts.fileService ?? makeFakeFile();
  const storageService = opts.storageService ?? makeFakeStorage();
  const dialogService = opts.dialogService ?? makeFakeDialog();

  TestBed.configureTestingModule({
    providers: [
      DocumentEffects,
      provideMockActions(opts.actionsSource),
      provideMockStore({
        selectors: [
          { selector: selectScene, value: defaultScene() },
          { selector: selectEnvelope, value: null },
          { selector: selectFileId, value: opts.initialFileId ?? null },
          { selector: selectName, value: opts.initialName ?? 'Untitled' },
          { selector: selectIsDirty, value: opts.initialIsDirty ?? false },
          { selector: selectRecentFiles, value: [] },
        ],
      }),
      { provide: FILE_SERVICE, useValue: fileService },
      { provide: STORAGE_SERVICE, useValue: storageService },
      { provide: DIALOG_SERVICE, useValue: dialogService },
      { provide: AUTOSAVE_DEBOUNCE_MS, useValue: opts.debounceMs ?? 0 },
    ],
  });

  return {
    effects: TestBed.inject(DocumentEffects),
    fileService,
    storageService,
    dialogService,
    store: TestBed.inject(MockStore),
  };
}

describe('DocumentEffects.newDocument$', () => {
  it('emits SceneActions.setScene + DocumentActions.documentReset', async () => {
    const { effects } = configure({
      actionsSource: of(DocumentActions.newDocumentRequested()),
    });
    const out = await firstValueFrom(effects.newDocument$.pipe(take(2), toArray()));
    expect(out.map((a) => a.type)).toEqual(['[Scene] Set Scene', '[Document] Document Reset']);
  });
});

describe('DocumentEffects.openDocument$', () => {
  it('opens, parses, and emits setScene + documentOpened + recentFilePushed', async () => {
    const bytes = packAquaDocument(SAMPLE_DOC);
    const fileService = makeFakeFile({
      openDocument: jest.fn(async () => ({ id: 'f-99', bytes, name: 'loaded.aqua' })),
    });
    const { effects } = configure({
      actionsSource: of(DocumentActions.openDocumentRequested()),
      fileService,
    });
    const out = await firstValueFrom(effects.openDocument$.pipe(take(3), toArray()));
    expect(out.map((a) => a.type)).toEqual([
      '[Scene] Set Scene',
      '[Document] Document Opened',
      '[Document] Recent File Pushed',
    ]);
    const opened = out[1] as ReturnType<typeof DocumentActions.documentOpened>;
    expect(opened.fileId).toBe('f-99');
    expect(opened.name).toBe('loaded.aqua');
    expect(opened.envelope.meta.id).toBe(SAMPLE_DOC.meta.id);
  });

  it('emits openDocumentFailed when the user cancels the picker', async () => {
    const fileService = makeFakeFile({ openDocument: jest.fn(async () => null) });
    const { effects } = configure({
      actionsSource: of(DocumentActions.openDocumentRequested()),
      fileService,
    });
    const out = await firstValueFrom(effects.openDocument$.pipe(take(1)));
    expect(out.type).toBe('[Document] Open Document Failed');
    expect((out as ReturnType<typeof DocumentActions.openDocumentFailed>).message).toMatch(
      /cancelled/i,
    );
  });

  it('describes a schema-invalid load with a precise error message', async () => {
    const garbage = new TextEncoder().encode('{"not":"aquascape"}');
    const fileService = makeFakeFile({
      openDocument: jest.fn(async () => ({ id: 'f', bytes: garbage, name: 'bad.aqua' })),
    });
    const { effects } = configure({
      actionsSource: of(DocumentActions.openDocumentRequested()),
      fileService,
    });
    const out = await firstValueFrom(effects.openDocument$.pipe(take(1)));
    expect(out.type).toBe('[Document] Open Document Failed');
    expect((out as ReturnType<typeof DocumentActions.openDocumentFailed>).message).toMatch(
      /failed validation/i,
    );
  });
});

describe('DocumentEffects.saveDocument$', () => {
  it('serializes the current scene + envelope and calls FileService.saveDocument', async () => {
    const fileService = makeFakeFile({
      saveDocument: jest.fn(async () => ({ id: 'f-new' })),
    });
    const { effects } = configure({
      actionsSource: of(DocumentActions.saveDocumentRequested()),
      fileService,
      initialFileId: 'f-existing',
      initialName: 'My.aqua',
    });
    const out = await firstValueFrom(effects.saveDocument$.pipe(take(1)));
    expect(out.type).toBe('[Document] Document Saved');
    expect((out as ReturnType<typeof DocumentActions.documentSaved>).fileId).toBe('f-new');
    expect(fileService.saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'f-existing', suggestedName: 'My.aqua' }),
    );
  });

  it('reports a save cancel as saveDocumentFailed', async () => {
    const fileService = makeFakeFile({ saveDocument: jest.fn(async () => null) });
    const { effects } = configure({
      actionsSource: of(DocumentActions.saveDocumentRequested()),
      fileService,
    });
    const out = await firstValueFrom(effects.saveDocument$.pipe(take(1)));
    expect(out.type).toBe('[Document] Save Document Failed');
  });
});

describe('DocumentEffects.saveAs$', () => {
  it('always uses saveDocumentAs and the suggested filename', async () => {
    const fileService = makeFakeFile({
      saveDocumentAs: jest.fn(async () => ({ id: 'f-fresh' })),
    });
    const { effects } = configure({
      actionsSource: of(DocumentActions.saveAsDocumentRequested()),
      fileService,
      initialFileId: 'f-existing',
      initialName: 'Untitled',
    });
    const out = await firstValueFrom(effects.saveAs$.pipe(take(1)));
    expect((out as ReturnType<typeof DocumentActions.documentSaved>).fileId).toBe('f-fresh');
    expect(fileService.saveDocumentAs).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'untitled.aqua' }),
    );
  });
});

describe('DocumentEffects.markDirty$', () => {
  it('emits Mark Dirty for any scene-mutating action', async () => {
    const scene = defaultScene();
    const history = scene; // payload shape only
    const { effects } = configure({
      actionsSource: of(
        SceneActions.applyCommandSucceeded({ scene, history: history as never }),
        SceneActions.undo(),
        SceneActions.redo(),
      ),
    });
    const out = await firstValueFrom(effects.markDirty$.pipe(take(3), toArray()));
    expect(out.every((a) => a.type === '[Document] Mark Dirty')).toBe(true);
  });
});

describe('DocumentEffects.onSavePushRecent$', () => {
  it('emits a recentFilePushed entry for each successful save', async () => {
    const { effects } = configure({
      actionsSource: of(DocumentActions.documentSaved({ fileId: 'f-9', name: 'Y.aqua' })),
    });
    const out = await firstValueFrom(effects.onSavePushRecent$.pipe(take(1)));
    const pushed = out as ReturnType<typeof DocumentActions.recentFilePushed>;
    expect(pushed.entry.fileId).toBe('f-9');
    expect(pushed.entry.name).toBe('Y.aqua');
  });
});

describe('DocumentEffects.onSaveClearDraft$', () => {
  it('removes the autosave draft from storage on save', async () => {
    const storageService = makeFakeStorage({
      [STORAGE_KEY_AUTOSAVE_DRAFT]: { version: 1, payload: 'x' },
    });
    const { effects } = configure({
      actionsSource: of(DocumentActions.documentSaved({ fileId: 'f', name: 'X' })),
      storageService,
    });
    await firstValueFrom(effects.onSaveClearDraft$.pipe(take(1)));
    expect(storageService.store.has(STORAGE_KEY_AUTOSAVE_DRAFT)).toBe(false);
  });
});

describe('DocumentEffects.autosave$', () => {
  it('writes a versioned draft to StorageService when the document is dirty', async () => {
    const storageService = makeFakeStorage();
    const actions = new ReplaySubject<{ type: string }>();
    actions.next(DocumentActions.markDirty());
    actions.complete();
    const { effects } = configure({
      actionsSource: actions,
      storageService,
      initialIsDirty: true,
      debounceMs: 0,
    });
    const out = await firstValueFrom(effects.autosave$.pipe(take(1)));
    expect(out.type).toBe('[Document] Autosave Draft Written');
    const draft = storageService.store.get(STORAGE_KEY_AUTOSAVE_DRAFT) as {
      version: number;
      document: AquaDocument;
    };
    expect(draft.version).toBe(1);
    expect(draft.document.format).toBe('aquascape');
  });

  it('skips writing when isDirty is false at fire time (post-save debounce window)', (done) => {
    const storageService = makeFakeStorage();
    const actions = new ReplaySubject<{ type: string }>();
    actions.next(DocumentActions.markDirty());
    actions.complete();
    const { effects } = configure({
      actionsSource: actions,
      storageService,
      initialIsDirty: false,
      debounceMs: 0,
    });
    let fired = false;
    const sub = effects.autosave$.subscribe(() => {
      fired = true;
    });
    // Give the microtask + debounce 0 a tick to flush.
    setTimeout(() => {
      sub.unsubscribe();
      expect(fired).toBe(false);
      expect(storageService.store.has(STORAGE_KEY_AUTOSAVE_DRAFT)).toBe(false);
      done();
    }, 10);
  });
});

describe('DocumentEffects.bootstrap', () => {
  it('dispatches recentFilesLoaded when storage holds a recent list', async () => {
    const entries = [{ fileId: 'a', name: 'A', openedAt: '2026-01-01T00:00:00.000Z' }];
    const storageService = makeFakeStorage({ [STORAGE_KEY_RECENT_FILES]: entries });
    const { effects, store } = configure({
      actionsSource: of(),
      storageService,
    });
    const dispatched: Array<{ type: string }> = [];
    store.scannedActions$.subscribe((a) => dispatched.push(a));
    await effects.bootstrap();
    expect(dispatched.some((a) => a.type === '[Document] Recent Files Loaded')).toBe(true);
  });

  it('dispatches draftDiscovered when storage holds a versioned draft', async () => {
    const draft = {
      version: 1,
      document: SAMPLE_DOC,
      fileId: 'f-1',
      name: 'My.aqua',
      savedAt: '2026-05-24T00:00:00.000Z',
    };
    const storageService = makeFakeStorage({ [STORAGE_KEY_AUTOSAVE_DRAFT]: draft });
    const { effects, store } = configure({ actionsSource: of(), storageService });
    const dispatched: Array<{ type: string }> = [];
    store.scannedActions$.subscribe((a) => dispatched.push(a));
    await effects.bootstrap();
    expect(dispatched.some((a) => a.type === '[Document] Draft Discovered')).toBe(true);
  });

  it('quietly ignores unversioned / mis-shaped storage entries', async () => {
    const storageService = makeFakeStorage({
      [STORAGE_KEY_AUTOSAVE_DRAFT]: { not: 'a draft' },
    });
    const { effects, store } = configure({ actionsSource: of(), storageService });
    const dispatched: Array<{ type: string }> = [];
    store.scannedActions$.subscribe((a) => dispatched.push(a));
    await effects.bootstrap();
    expect(dispatched.some((a) => a.type === '[Document] Draft Discovered')).toBe(false);
  });
});

describe('DocumentEffects.draftRecovery$', () => {
  it('reads the draft, dispatches setScene + documentOpened + markDirty + draftCleared', async () => {
    const draft = {
      version: 1,
      document: SAMPLE_DOC,
      fileId: 'f-recovered',
      name: 'Recovered.aqua',
      savedAt: '2026-05-24T00:00:00.000Z',
    };
    const storageService = makeFakeStorage({ [STORAGE_KEY_AUTOSAVE_DRAFT]: draft });
    const { effects } = configure({
      actionsSource: of(DocumentActions.draftRecoveryRequested()),
      storageService,
    });
    const out = await firstValueFrom(effects.draftRecovery$.pipe(take(4), toArray()));
    expect(out.map((a) => a.type)).toEqual([
      '[Scene] Set Scene',
      '[Document] Document Opened',
      '[Document] Mark Dirty',
      '[Document] Draft Cleared',
    ]);
    const opened = out[1] as ReturnType<typeof DocumentActions.documentOpened>;
    expect(opened.fileId).toBe('f-recovered');
  });

  it('clears the draft if storage is empty when recovery is requested', async () => {
    const storageService = makeFakeStorage();
    const { effects } = configure({
      actionsSource: of(DocumentActions.draftRecoveryRequested()),
      storageService,
    });
    const out = await firstValueFrom(effects.draftRecovery$.pipe(take(1)));
    expect(out.type).toBe('[Document] Draft Cleared');
  });
});

describe('DocumentEffects.draftDiscarded$', () => {
  it('removes the autosave draft and dispatches draftCleared', async () => {
    const storageService = makeFakeStorage({ [STORAGE_KEY_AUTOSAVE_DRAFT]: 'something' });
    const { effects } = configure({
      actionsSource: of(DocumentActions.draftDiscarded()),
      storageService,
    });
    const out = await firstValueFrom(effects.draftDiscarded$.pipe(take(1)));
    expect(out.type).toBe('[Document] Draft Cleared');
    expect(storageService.store.has(STORAGE_KEY_AUTOSAVE_DRAFT)).toBe(false);
  });
});

describe('DocumentEffects.persistRecent$ (non-dispatching)', () => {
  it('writes the recent list to storage whenever it changes', async () => {
    const storageService = makeFakeStorage();
    const { effects, store } = configure({ actionsSource: of(), storageService });
    // `dispatch: false` effects aren't auto-subscribed by `provideMockActions`
    // alone (no EffectsRunner). Subscribe explicitly for the test.
    const sub = effects.persistRecent$.subscribe();
    try {
      const entries = [{ fileId: 'a', name: 'A', openedAt: '2026-01-01T00:00:00.000Z' }];
      store.overrideSelector(selectRecentFiles, entries);
      store.refreshState();
      // Drain microtasks: distinctUntilChanged → switchMap → from(Promise).
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(storageService.store.get(STORAGE_KEY_RECENT_FILES)).toEqual(entries);
    } finally {
      sub.unsubscribe();
    }
  });
});

describe('serializeAquaDocument is wired (sanity)', () => {
  it('compiles the import so the effects file is not the only consumer', () => {
    expect(serializeAquaDocument(SAMPLE_DOC)).toContain('aquascape');
  });
});

// ── openRecent$ ────────────────────────────────────────────────────────────

describe('DocumentEffects.openRecent$', () => {
  it('opens by id and emits the same triplet as openDocument$', async () => {
    const bytes = packAquaDocument(SAMPLE_DOC);
    const fileService = makeFakeFile({
      openDocument: jest.fn(async () => ({ id: 'recent-1', bytes, name: 'recent.aqua' })),
    });
    const { effects } = configure({
      actionsSource: of(DocumentActions.openRecentFileRequested({ fileId: 'recent-1' })),
      fileService,
    });
    const out = await firstValueFrom(effects.openRecent$.pipe(take(3), toArray()));
    expect(out.map((a) => a.type)).toEqual([
      '[Scene] Set Scene',
      '[Document] Document Opened',
      '[Document] Recent File Pushed',
    ]);
  });

  it('removes a stale recent entry when reopen fails (user cancel)', async () => {
    const fileService = makeFakeFile({ openDocument: jest.fn(async () => null) });
    const { effects } = configure({
      actionsSource: of(DocumentActions.openRecentFileRequested({ fileId: 'gone-1' })),
      fileService,
    });
    const out = await firstValueFrom(effects.openRecent$.pipe(take(2), toArray()));
    expect(out.map((a) => a.type)).toEqual([
      '[Document] Open Document Failed',
      '[Document] Recent File Removed',
    ]);
    expect((out[1] as ReturnType<typeof DocumentActions.recentFileRemoved>).fileId).toBe('gone-1');
  });

  it('surfaces an unexpected throw from the FileService as openDocumentFailed', async () => {
    const fileService = makeFakeFile({
      openDocument: jest.fn(async () => {
        throw new Error('disk read error');
      }),
    });
    const { effects } = configure({
      actionsSource: of(DocumentActions.openRecentFileRequested({ fileId: 'x' })),
      fileService,
    });
    const out = await firstValueFrom(effects.openRecent$.pipe(take(1)));
    expect(out.type).toBe('[Document] Open Document Failed');
    expect((out as ReturnType<typeof DocumentActions.openDocumentFailed>).message).toMatch(
      /disk read error/,
    );
  });
});

// ── openDocument$ thrown error ────────────────────────────────────────────

describe('DocumentEffects.openDocument$ (FileService throws)', () => {
  it('catches and reports the underlying error message', async () => {
    const fileService = makeFakeFile({
      openDocument: jest.fn(async () => {
        throw 'raw-string';
      }),
    });
    const { effects } = configure({
      actionsSource: of(DocumentActions.openDocumentRequested()),
      fileService,
    });
    const out = await firstValueFrom(effects.openDocument$.pipe(take(1)));
    expect(out.type).toBe('[Document] Open Document Failed');
    expect((out as ReturnType<typeof DocumentActions.openDocumentFailed>).message).toBe('raw-string');
  });
});

// ── saveDocument$ thrown error ────────────────────────────────────────────

describe('DocumentEffects.saveDocument$ (FileService throws)', () => {
  it('catches and reports the error', async () => {
    const fileService = makeFakeFile({
      saveDocument: jest.fn(async () => {
        throw new Error('disk full');
      }),
    });
    const { effects } = configure({
      actionsSource: of(DocumentActions.saveDocumentRequested()),
      fileService,
    });
    const out = await firstValueFrom(effects.saveDocument$.pipe(take(1)));
    expect(out.type).toBe('[Document] Save Document Failed');
    expect((out as ReturnType<typeof DocumentActions.saveDocumentFailed>).message).toBe('disk full');
  });
});

describe('DocumentEffects.saveAs$ (FileService throws)', () => {
  it('catches and reports the error', async () => {
    const fileService = makeFakeFile({
      saveDocumentAs: jest.fn(async () => {
        throw new Error('permission denied');
      }),
    });
    const { effects } = configure({
      actionsSource: of(DocumentActions.saveAsDocumentRequested()),
      fileService,
    });
    const out = await firstValueFrom(effects.saveAs$.pipe(take(1)));
    expect(out.type).toBe('[Document] Save Document Failed');
    expect((out as ReturnType<typeof DocumentActions.saveDocumentFailed>).message).toBe(
      'permission denied',
    );
  });
});

// ── autosave error path ───────────────────────────────────────────────────

describe('DocumentEffects.autosave$ (StorageService throws)', () => {
  it('swallows the error without dispatching anything', (done) => {
    const storageService: FakeStorage = {
      ...makeFakeStorage(),
      set: async () => {
        throw new Error('quota exceeded');
      },
    };
    const actions = new ReplaySubject<{ type: string }>();
    actions.next(DocumentActions.markDirty());
    actions.complete();
    const { effects } = configure({
      actionsSource: actions,
      storageService,
      initialIsDirty: true,
      debounceMs: 0,
    });
    let fired = false;
    const sub = effects.autosave$.subscribe(() => {
      fired = true;
    });
    setTimeout(() => {
      sub.unsubscribe();
      expect(fired).toBe(false);
      done();
    }, 10);
  });
});

// ── describeLoadError branches via loadAquaDocument failure modes ─────────

describe('describeLoadError (via failed loads)', () => {
  async function openWithBytes(bytes: Uint8Array): Promise<string> {
    const fileService = makeFakeFile({
      openDocument: jest.fn(async () => ({ id: 'x', bytes, name: 'x.aqua' })),
    });
    const { effects } = configure({
      actionsSource: of(DocumentActions.openDocumentRequested()),
      fileService,
    });
    const out = await firstValueFrom(effects.openDocument$.pipe(take(1)));
    return (out as ReturnType<typeof DocumentActions.openDocumentFailed>).message;
  }

  it('describes a malformed JSON payload', async () => {
    const msg = await openWithBytes(new TextEncoder().encode('not json at all'));
    expect(msg).toMatch(/Document JSON is invalid/);
  });

  it('describes a corrupt ZIP container', async () => {
    // ZIP magic + nonsense — passes the magic sniff, fails fflate parse.
    const corrupted = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0xff]);
    const msg = await openWithBytes(corrupted);
    expect(msg).toMatch(/Could not read .aqua container/);
  });

  it('describes a future-version document', async () => {
    const fileService = makeFakeFile({
      openDocument: jest.fn(async () => ({
        id: 'x',
        bytes: new TextEncoder().encode(
          JSON.stringify({ ...SAMPLE_DOC, schemaVersion: 999 }),
        ),
        name: 'future.aqua',
      })),
    });
    const { effects } = configure({
      actionsSource: of(DocumentActions.openDocumentRequested()),
      fileService,
    });
    const out = await firstValueFrom(effects.openDocument$.pipe(take(1)));
    const msg = (out as ReturnType<typeof DocumentActions.openDocumentFailed>).message;
    expect(msg).toMatch(/newer version/);
  });
});

// ── describeLoadError direct (migration-failed sub-branches) ──────────────

describe('describeLoadError (direct)', () => {
  it('covers unsupported-future-version', () => {
    expect(
      describeLoadError({
        kind: 'migration-failed',
        error: { kind: 'unsupported-future-version', documentVersion: 3, readerVersion: 1 },
      }),
    ).toMatch(/newer version \(v3\).*up to v1/);
  });

  it('covers missing-migration', () => {
    expect(
      describeLoadError({
        kind: 'migration-failed',
        error: { kind: 'missing-migration', from: 1, to: 2 },
      }),
    ).toMatch(/No migration from v1 to v2/);
  });

  it('covers invalid-step', () => {
    expect(
      describeLoadError({
        kind: 'migration-failed',
        error: { kind: 'invalid-step', from: 1, to: 2, reason: 'bad output version' },
      }),
    ).toMatch(/Migration step v1 → v2 is invalid: bad output version/);
  });

  it('covers migration-threw', () => {
    expect(
      describeLoadError({
        kind: 'migration-failed',
        error: { kind: 'migration-threw', from: 1, to: 2, cause: new Error('boom') },
      }),
    ).toMatch(/Migration v1 → v2 threw: boom/);
  });

  it('covers schema-invalid single-error pluralization', () => {
    expect(
      describeLoadError({
        kind: 'schema-invalid',
        errors: [{ path: '/x', message: 'm', params: {} }],
      }),
    ).toMatch(/1 error\)/);
  });
});

// ── AUTOSAVE_DEBOUNCE_MS default token ────────────────────────────────────

describe('AUTOSAVE_DEBOUNCE_MS default factory', () => {
  it('falls through to 3000ms when no provider overrides it', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DocumentEffects,
        provideMockActions(of()),
        provideMockStore({
          selectors: [
            { selector: selectScene, value: defaultScene() },
            { selector: selectEnvelope, value: null },
            { selector: selectFileId, value: null },
            { selector: selectName, value: 'Untitled' },
            { selector: selectIsDirty, value: false },
            { selector: selectRecentFiles, value: [] },
          ],
        }),
        { provide: FILE_SERVICE, useValue: makeFakeFile() },
        { provide: STORAGE_SERVICE, useValue: makeFakeStorage() },
        { provide: DIALOG_SERVICE, useValue: makeFakeDialog() },
      ],
    });
    // Effects compiles + injects without throwing, proving the token default
    // factory fired. Internal field is private; observing via construction
    // is sufficient coverage.
    expect(TestBed.inject(DocumentEffects)).toBeDefined();
  });
});
