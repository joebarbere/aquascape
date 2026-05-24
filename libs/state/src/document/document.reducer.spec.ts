// Document feature reducer tests. F1.6.

import type { DocumentEnvelope } from '@aquascape/domain/document';

import { DocumentActions } from './document.actions';
import {
  DOCUMENT_FEATURE_KEY,
  documentFeature,
  initialDocumentState,
} from './document.reducer';
import { MAX_RECENT_FILES, UNTITLED_NAME, type RecentFileEntry } from './document.types';

const reduce = documentFeature.reducer;

const sampleEnvelope: DocumentEnvelope = {
  meta: {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Sample',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    appVersion: '1.0.0',
    seed: 1,
  },
};

describe('documentFeature', () => {
  it('registers under the DOCUMENT_FEATURE_KEY', () => {
    expect(documentFeature.name).toBe(DOCUMENT_FEATURE_KEY);
    expect(DOCUMENT_FEATURE_KEY).toBe('document');
  });
});

describe('initialDocumentState', () => {
  it('starts untitled, clean, with no file or envelope', () => {
    const state = initialDocumentState();
    expect(state.fileId).toBeNull();
    expect(state.name).toBe(UNTITLED_NAME);
    expect(state.isDirty).toBe(false);
    expect(state.envelope).toBeNull();
    expect(state.recentFiles).toEqual([]);
    expect(state.status).toBe('idle');
    expect(state.pendingDraft).toBeNull();
  });
});

describe('documentFeature.reducer', () => {
  const init = initialDocumentState();

  describe('intent → status flips', () => {
    it('open intent flips status to "opening" and clears lastError', () => {
      const dirty = { ...init, lastError: 'old error' };
      const next = reduce(dirty, DocumentActions.openDocumentRequested());
      expect(next.status).toBe('opening');
      expect(next.lastError).toBeNull();
    });

    it('open-recent intent also flips status to "opening"', () => {
      const next = reduce(init, DocumentActions.openRecentFileRequested({ fileId: 'x' }));
      expect(next.status).toBe('opening');
    });

    it('save intent flips status to "saving"', () => {
      const next = reduce(init, DocumentActions.saveDocumentRequested());
      expect(next.status).toBe('saving');
    });

    it('save-as intent also flips status to "saving"', () => {
      const next = reduce(init, DocumentActions.saveAsDocumentRequested());
      expect(next.status).toBe('saving');
    });

    it('new-document intent clears lastError but does not change status', () => {
      const before = { ...init, lastError: 'old' };
      const next = reduce(before, DocumentActions.newDocumentRequested());
      expect(next.lastError).toBeNull();
      expect(next.status).toBe('idle');
    });

    it('openDocumentFailed records the message and returns to idle', () => {
      const before = { ...init, status: 'opening' as const };
      const next = reduce(
        before,
        DocumentActions.openDocumentFailed({ message: 'no permission' }),
      );
      expect(next.status).toBe('idle');
      expect(next.lastError).toBe('no permission');
    });
  });

  describe('documentOpened', () => {
    it('stamps fileId/name/envelope and clears isDirty + status', () => {
      const dirty = { ...init, status: 'opening' as const, isDirty: true, pendingDraft: null };
      const next = reduce(
        dirty,
        DocumentActions.documentOpened({
          fileId: 'file-1',
          name: 'My Scape.aqua',
          envelope: sampleEnvelope,
        }),
      );
      expect(next.fileId).toBe('file-1');
      expect(next.name).toBe('My Scape.aqua');
      expect(next.envelope).toBe(sampleEnvelope);
      expect(next.isDirty).toBe(false);
      expect(next.status).toBe('idle');
    });
  });

  describe('documentSaved', () => {
    it('clears isDirty, stamps a lastSavedAt, and clears pendingDraft', () => {
      const before = {
        ...init,
        status: 'saving' as const,
        isDirty: true,
        pendingDraft: { name: 'X', savedAt: 'ts', fileId: null },
      };
      const next = reduce(
        before,
        DocumentActions.documentSaved({ fileId: 'f-1', name: 'X.aqua' }),
      );
      expect(next.isDirty).toBe(false);
      expect(next.status).toBe('idle');
      expect(next.fileId).toBe('f-1');
      expect(next.name).toBe('X.aqua');
      expect(next.pendingDraft).toBeNull();
      expect(next.lastSavedAt).not.toBeNull();
    });
  });

  describe('saveDocumentFailed', () => {
    it('records the message and goes back to idle', () => {
      const before = { ...init, status: 'saving' as const };
      const next = reduce(
        before,
        DocumentActions.saveDocumentFailed({ message: 'disk full' }),
      );
      expect(next.lastError).toBe('disk full');
      expect(next.status).toBe('idle');
    });
  });

  describe('documentReset', () => {
    it('returns to the initial state regardless of prior contents', () => {
      const muddled = {
        ...init,
        fileId: 'f',
        name: 'N',
        isDirty: true,
        envelope: sampleEnvelope,
        status: 'opening' as const,
        recentFiles: [{ fileId: 'a', name: 'A', openedAt: 't' }],
        pendingDraft: { name: 'D', savedAt: 't', fileId: null },
      };
      const next = reduce(muddled, DocumentActions.documentReset());
      expect(next).toEqual(initialDocumentState());
    });
  });

  describe('markDirty', () => {
    it('flips isDirty true and is a no-op when already dirty', () => {
      const first = reduce(init, DocumentActions.markDirty());
      expect(first.isDirty).toBe(true);
      const second = reduce(first, DocumentActions.markDirty());
      expect(second).toBe(first);
    });
  });

  describe('recent files', () => {
    const a: RecentFileEntry = { fileId: 'a', name: 'A', openedAt: '2026-01-01T00:00:00.000Z' };
    const b: RecentFileEntry = { fileId: 'b', name: 'B', openedAt: '2026-01-02T00:00:00.000Z' };
    const aPrime: RecentFileEntry = { ...a, openedAt: '2026-02-01T00:00:00.000Z' };

    it('loads the MRU list from storage and caps at MAX_RECENT_FILES', () => {
      const oversized = Array.from({ length: MAX_RECENT_FILES + 5 }, (_, i) => ({
        fileId: `f-${i}`,
        name: `n-${i}`,
        openedAt: '2026-01-01T00:00:00.000Z',
      }));
      const next = reduce(init, DocumentActions.recentFilesLoaded({ entries: oversized }));
      expect(next.recentFiles.length).toBe(MAX_RECENT_FILES);
      expect(next.recentFiles[0]?.fileId).toBe('f-0');
    });

    it('pushes a new entry to the front', () => {
      const next = reduce(init, DocumentActions.recentFilePushed({ entry: a }));
      expect(next.recentFiles).toEqual([a]);
    });

    it('hoists an existing entry to the front (dedupe on fileId)', () => {
      let state = reduce(init, DocumentActions.recentFilePushed({ entry: a }));
      state = reduce(state, DocumentActions.recentFilePushed({ entry: b }));
      state = reduce(state, DocumentActions.recentFilePushed({ entry: aPrime }));
      expect(state.recentFiles.map((e) => e.fileId)).toEqual(['a', 'b']);
      expect(state.recentFiles[0]).toEqual(aPrime);
    });

    it('removes by fileId', () => {
      let state = reduce(init, DocumentActions.recentFilePushed({ entry: a }));
      state = reduce(state, DocumentActions.recentFilePushed({ entry: b }));
      state = reduce(state, DocumentActions.recentFileRemoved({ fileId: 'a' }));
      expect(state.recentFiles.map((e) => e.fileId)).toEqual(['b']);
    });
  });

  describe('autosave + recovery', () => {
    it('records the last autosave timestamp', () => {
      const next = reduce(
        init,
        DocumentActions.autosaveDraftWritten({ savedAt: '2026-05-24T00:00:00.000Z' }),
      );
      expect(next.lastAutosavedAt).toBe('2026-05-24T00:00:00.000Z');
    });

    it('surfaces a draft from boot via pendingDraft', () => {
      const draft = { name: 'recovered', savedAt: 'ts', fileId: 'f-9' };
      const next = reduce(init, DocumentActions.draftDiscovered({ draft }));
      expect(next.pendingDraft).toEqual(draft);
    });

    it('clears pendingDraft on draftCleared', () => {
      const withDraft = {
        ...init,
        pendingDraft: { name: 'X', savedAt: 't', fileId: null },
      };
      const next = reduce(withDraft, DocumentActions.draftCleared());
      expect(next.pendingDraft).toBeNull();
    });
  });
});
