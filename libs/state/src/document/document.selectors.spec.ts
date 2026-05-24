// Document selectors. F1.6.

import { initialDocumentState } from './document.reducer';
import {
  selectCanSave,
  selectDisplayTitle,
  selectHasFile,
  selectHasPendingDraft,
  selectIsUntitled,
} from './document.selectors';
import { UNTITLED_NAME } from './document.types';

const wrap = (overrides: Partial<ReturnType<typeof initialDocumentState>> = {}) => ({
  document: { ...initialDocumentState(), ...overrides },
});

describe('document selectors', () => {
  describe('selectDisplayTitle', () => {
    it('prefixes "• " when the document is dirty', () => {
      expect(selectDisplayTitle(wrap({ name: 'Iwagumi', isDirty: true }))).toBe('• Iwagumi');
    });
    it('omits the marker when clean', () => {
      expect(selectDisplayTitle(wrap({ name: 'Iwagumi', isDirty: false }))).toBe('Iwagumi');
    });
  });

  describe('selectHasFile / selectCanSave', () => {
    it('selectHasFile reflects fileId presence', () => {
      expect(selectHasFile(wrap({ fileId: null }))).toBe(false);
      expect(selectHasFile(wrap({ fileId: 'f-1' }))).toBe(true);
    });

    it('selectCanSave requires dirty + has-file', () => {
      expect(selectCanSave(wrap({ fileId: 'f-1', isDirty: false }))).toBe(false);
      expect(selectCanSave(wrap({ fileId: null, isDirty: true }))).toBe(false);
      expect(selectCanSave(wrap({ fileId: 'f-1', isDirty: true }))).toBe(true);
    });
  });

  describe('selectIsUntitled', () => {
    it('is true only for the fresh new-document state', () => {
      expect(selectIsUntitled(wrap())).toBe(true);
      expect(selectIsUntitled(wrap({ name: UNTITLED_NAME, fileId: 'f' }))).toBe(false);
      expect(selectIsUntitled(wrap({ name: 'X', fileId: null }))).toBe(false);
    });
  });

  describe('selectHasPendingDraft', () => {
    it('flips when pendingDraft is present', () => {
      expect(selectHasPendingDraft(wrap({ pendingDraft: null }))).toBe(false);
      expect(
        selectHasPendingDraft(
          wrap({ pendingDraft: { name: 'X', savedAt: 't', fileId: null } }),
        ),
      ).toBe(true);
    });
  });
});
