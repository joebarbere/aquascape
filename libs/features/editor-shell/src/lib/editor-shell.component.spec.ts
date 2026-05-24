// EditorShellComponent tests. F1.4 / F1.5.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import {
  AUTOSAVE_DEBOUNCE_MS,
  DocumentActions,
  documentFeature,
  initialDocumentState,
  selectDisplayTitle,
  selectHasPendingDraft,
  selectLastError,
  selectPendingDraft,
  selectRecentFiles,
  selectStatus,
} from '@aquascape/state';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { EditorShellComponent } from './editor-shell.component';

function configure(initial?: ReturnType<typeof initialDocumentState>) {
  TestBed.configureTestingModule({
    imports: [EditorShellComponent],
    providers: [
      provideMockStore({
        initialState: { [documentFeature.name]: initial ?? initialDocumentState() },
        selectors: [
          { selector: selectDisplayTitle, value: 'Untitled' },
          { selector: selectStatus, value: 'idle' as const },
          { selector: selectRecentFiles, value: [] },
          { selector: selectHasPendingDraft, value: false },
          { selector: selectPendingDraft, value: null },
          { selector: selectLastError, value: null },
        ],
      }),
    ],
  });
  const fixture = TestBed.createComponent(EditorShellComponent);
  fixture.detectChanges();
  return { fixture, store: TestBed.inject(MockStore) };
}

function buttonByText(fixture: ComponentFixture<EditorShellComponent>, text: string): HTMLButtonElement {
  const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
  for (const b of buttons) {
    if (b.textContent?.trim() === text) return b;
  }
  throw new Error(`Button "${text}" not found`);
}

describe('EditorShellComponent', () => {
  // Suppress NgRx warnings about provideStore not being called — provideMockStore is sufficient.
  void provideStore;
  void provideEffects;
  void AUTOSAVE_DEBOUNCE_MS;

  it('renders the doc title from selectDisplayTitle', () => {
    const { fixture, store } = configure();
    store.overrideSelector(selectDisplayTitle, '• My Tank.aqua');
    store.refreshState();
    fixture.detectChanges();
    const title = fixture.nativeElement.querySelector('.doc-title') as HTMLElement;
    expect(title.textContent?.trim()).toBe('• My Tank.aqua');
  });

  it('shows an opening status pill when status is "opening"', () => {
    const { fixture, store } = configure();
    store.overrideSelector(selectStatus, 'opening');
    store.refreshState();
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.status') as HTMLElement).textContent).toContain(
      'Opening',
    );
  });

  it('shows a saving status pill when status is "saving"', () => {
    const { fixture, store } = configure();
    store.overrideSelector(selectStatus, 'saving');
    store.refreshState();
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.status') as HTMLElement).textContent).toContain(
      'Saving',
    );
  });

  it('hides the status pill when idle', () => {
    const { fixture } = configure();
    expect(fixture.nativeElement.querySelector('.status')).toBeNull();
  });

  it('renders the recent files list when non-empty', () => {
    const { fixture, store } = configure();
    store.overrideSelector(selectRecentFiles, [
      { fileId: 'a', name: 'A.aqua', openedAt: '2026-05-24T00:00:00.000Z' },
      { fileId: 'b', name: 'B.aqua', openedAt: '2026-05-24T00:00:00.000Z' },
    ]);
    store.refreshState();
    fixture.detectChanges();
    const entries = fixture.nativeElement.querySelectorAll('.recent-entry');
    expect(entries.length).toBe(2);
    expect((entries[0] as HTMLElement).textContent?.trim()).toBe('A.aqua');
  });

  describe('button → action dispatch', () => {
    it('New dispatches newDocumentRequested', () => {
      const { fixture, store } = configure();
      const spy = jest.spyOn(store, 'dispatch');
      buttonByText(fixture, 'New').click();
      expect(spy).toHaveBeenCalledWith(DocumentActions.newDocumentRequested());
    });
    it('Open dispatches openDocumentRequested', () => {
      const { fixture, store } = configure();
      const spy = jest.spyOn(store, 'dispatch');
      buttonByText(fixture, 'Open').click();
      expect(spy).toHaveBeenCalledWith(DocumentActions.openDocumentRequested());
    });
    it('Save dispatches saveDocumentRequested', () => {
      const { fixture, store } = configure();
      const spy = jest.spyOn(store, 'dispatch');
      buttonByText(fixture, 'Save').click();
      expect(spy).toHaveBeenCalledWith(DocumentActions.saveDocumentRequested());
    });
    it('Save As dispatches saveAsDocumentRequested', () => {
      const { fixture, store } = configure();
      const spy = jest.spyOn(store, 'dispatch');
      buttonByText(fixture, 'Save As').click();
      expect(spy).toHaveBeenCalledWith(DocumentActions.saveAsDocumentRequested());
    });
    it('Recent entry dispatches openRecentFileRequested with the fileId', () => {
      const { fixture, store } = configure();
      store.overrideSelector(selectRecentFiles, [
        { fileId: 'r-1', name: 'X.aqua', openedAt: '2026-05-24T00:00:00.000Z' },
      ]);
      store.refreshState();
      fixture.detectChanges();
      const spy = jest.spyOn(store, 'dispatch');
      (fixture.nativeElement.querySelector('.recent-entry') as HTMLButtonElement).click();
      expect(spy).toHaveBeenCalledWith(DocumentActions.openRecentFileRequested({ fileId: 'r-1' }));
    });
  });

  describe('keyboard shortcuts', () => {
    it('Ctrl+N dispatches newDocumentRequested', () => {
      const { fixture, store } = configure();
      const spy = jest.spyOn(store, 'dispatch');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }));
      expect(spy).toHaveBeenCalledWith(DocumentActions.newDocumentRequested());
      void fixture;
    });
    it('Ctrl+O dispatches openDocumentRequested', () => {
      const { fixture, store } = configure();
      const spy = jest.spyOn(store, 'dispatch');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }));
      expect(spy).toHaveBeenCalledWith(DocumentActions.openDocumentRequested());
      void fixture;
    });
    it('Ctrl+S dispatches saveDocumentRequested', () => {
      const { fixture, store } = configure();
      const spy = jest.spyOn(store, 'dispatch');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
      expect(spy).toHaveBeenCalledWith(DocumentActions.saveDocumentRequested());
      void fixture;
    });
    it('Ctrl+Shift+S dispatches saveAsDocumentRequested', () => {
      const { fixture, store } = configure();
      const spy = jest.spyOn(store, 'dispatch');
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true }),
      );
      expect(spy).toHaveBeenCalledWith(DocumentActions.saveAsDocumentRequested());
      void fixture;
    });
    it('Cmd (metaKey) also fires the shortcuts (macOS)', () => {
      const { fixture, store } = configure();
      const spy = jest.spyOn(store, 'dispatch');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }));
      expect(spy).toHaveBeenCalledWith(DocumentActions.saveDocumentRequested());
      void fixture;
    });
    it('ignores key presses without a modifier', () => {
      const { fixture, store } = configure();
      const spy = jest.spyOn(store, 'dispatch');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
      expect(spy).not.toHaveBeenCalled();
      void fixture;
    });
  });

  describe('recovery banner', () => {
    it('is hidden when no draft is pending', () => {
      const { fixture } = configure();
      expect(fixture.nativeElement.querySelector('.recovery-banner')).toBeNull();
    });

    it('is shown when a draft exists; Recover dispatches draftRecoveryRequested', () => {
      const { fixture, store } = configure();
      store.overrideSelector(selectHasPendingDraft, true);
      store.overrideSelector(selectPendingDraft, {
        name: 'Recovered.aqua',
        savedAt: '2026-05-24T00:00:00.000Z',
        fileId: null,
      });
      store.refreshState();
      fixture.detectChanges();
      const banner = fixture.nativeElement.querySelector('.recovery-banner');
      expect(banner).not.toBeNull();
      const spy = jest.spyOn(store, 'dispatch');
      buttonByText(fixture, 'Recover').click();
      expect(spy).toHaveBeenCalledWith(DocumentActions.draftRecoveryRequested());
    });

    it('Discard dispatches draftDiscarded', () => {
      const { fixture, store } = configure();
      store.overrideSelector(selectHasPendingDraft, true);
      store.overrideSelector(selectPendingDraft, {
        name: 'Recovered.aqua',
        savedAt: '2026-05-24T00:00:00.000Z',
        fileId: null,
      });
      store.refreshState();
      fixture.detectChanges();
      const spy = jest.spyOn(store, 'dispatch');
      buttonByText(fixture, 'Discard').click();
      expect(spy).toHaveBeenCalledWith(DocumentActions.draftDiscarded());
    });
  });

  describe('error banner', () => {
    it('renders lastError when present', () => {
      const { fixture, store } = configure();
      store.overrideSelector(selectLastError, 'something broke');
      store.refreshState();
      fixture.detectChanges();
      const banner = fixture.nativeElement.querySelector('.error-banner');
      expect(banner).not.toBeNull();
      expect((banner as HTMLElement).textContent?.trim()).toBe('something broke');
    });
  });
});
