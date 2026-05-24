// Editor shell toolbar. F1.4 (New/Open/Save/Save As + Recent) + F1.5 (recovery banner).
//
// Sits above the canvas as a single header row. Dispatches into the document
// feature; never reads files / dialogs directly. Keyboard shortcuts
// (Ctrl/Cmd + N / O / S / Shift+S) live here too because this component is
// the only place that knows about all four intents.
//
// Recovery banner: when the document store reports a `pendingDraft` on boot,
// the toolbar renders a thin inline prompt with Recover / Discard. We use an
// inline banner rather than a modal so the user isn't blocked from interacting
// with the canvas while deciding.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  DocumentActions,
  selectDisplayTitle,
  selectHasPendingDraft,
  selectLastError,
  selectPendingDraft,
  selectRecentFiles,
  selectStatus,
} from '@aquascape/state';
import { Store } from '@ngrx/store';

import { ThemeToggleComponent } from './theme-toggle.component';

@Component({
  selector: 'aquascape-editor-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ThemeToggleComponent],
  template: `
    <header class="editor-shell" role="banner">
      <div class="title-block">
        <span class="app-name">Aquascape</span>
        <span class="separator" aria-hidden="true">·</span>
        <span class="doc-title" [attr.aria-label]="'Document title'">{{ title() }}</span>
        @if (status() !== 'idle') {
          <span class="status" role="status" aria-live="polite">{{ statusLabel() }}</span>
        }
      </div>

      <nav class="actions" aria-label="File actions">
        <button
          type="button"
          class="action"
          (click)="onNew()"
          aria-label="New document (Ctrl+N)"
          title="New document (Ctrl+N)"
        >
          New
        </button>
        <button
          type="button"
          class="action"
          (click)="onOpen()"
          aria-label="Open document (Ctrl+O)"
          title="Open document (Ctrl+O)"
        >
          Open
        </button>
        <button
          type="button"
          class="action"
          (click)="onSave()"
          aria-label="Save document (Ctrl+S)"
          title="Save document (Ctrl+S)"
        >
          Save
        </button>
        <button
          type="button"
          class="action"
          (click)="onSaveAs()"
          aria-label="Save document as (Ctrl+Shift+S)"
          title="Save document as (Ctrl+Shift+S)"
        >
          Save As
        </button>

        @if (recentFiles().length > 0) {
          <details class="recent">
            <summary class="action" aria-label="Open recent file">Recent</summary>
            <ul role="menu" aria-label="Recent files">
              @for (entry of recentFiles(); track entry.fileId) {
                <li role="menuitem">
                  <button type="button" class="recent-entry" (click)="onOpenRecent(entry.fileId)">
                    {{ entry.name }}
                  </button>
                </li>
              }
            </ul>
          </details>
        }

        <aquascape-theme-toggle></aquascape-theme-toggle>
      </nav>
    </header>

    @if (hasPendingDraft()) {
      <aside class="recovery-banner" role="status" aria-live="polite">
        <span class="recovery-message">
          Unsaved changes from {{ pendingDraft()?.savedAt | date: 'short' }} were found.
        </span>
        <span class="recovery-actions">
          <button type="button" class="recover" (click)="onRecover()">Recover</button>
          <button type="button" class="discard" (click)="onDiscard()">Discard</button>
        </span>
      </aside>
    }

    @if (lastError() !== null) {
      <aside class="error-banner" role="alert">
        {{ lastError() }}
      </aside>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .editor-shell {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 12px;
        height: 44px;
        background: #20232a;
        color: #eef0f4;
        border-bottom: 1px solid #2c3038;
        font-family: system-ui, sans-serif;
        font-size: 13px;
      }
      .title-block {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .app-name {
        font-weight: 600;
      }
      .separator {
        opacity: 0.5;
      }
      .doc-title {
        opacity: 0.95;
      }
      .status {
        margin-left: 8px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.75;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .action {
        background: transparent;
        color: inherit;
        border: 1px solid transparent;
        padding: 6px 10px;
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
      }
      .action:hover,
      .action:focus-visible {
        background: #2c3038;
        outline: none;
      }
      .recent {
        position: relative;
      }
      .recent ul {
        position: absolute;
        right: 0;
        top: 100%;
        margin: 4px 0 0;
        padding: 4px 0;
        list-style: none;
        background: #2c3038;
        border: 1px solid #3a3f48;
        border-radius: 6px;
        min-width: 220px;
        z-index: 10;
      }
      .recent-entry {
        display: block;
        width: 100%;
        padding: 6px 12px;
        background: transparent;
        color: inherit;
        border: none;
        text-align: left;
        cursor: pointer;
        font: inherit;
      }
      .recent-entry:hover,
      .recent-entry:focus-visible {
        background: #3a3f48;
        outline: none;
      }
      .recovery-banner,
      .error-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 8px 12px;
        font-family: system-ui, sans-serif;
        font-size: 13px;
      }
      .recovery-banner {
        background: var(--warning-bg, #fff7d6);
        color: var(--warning-text, #5a4500);
        border-bottom: 1px solid var(--border, #f0e2a0);
      }
      .error-banner {
        background: var(--danger, #ffe3e0);
        color: var(--danger-text, #7a1f1a);
        border-bottom: 1px solid var(--border, #f4b5af);
      }
      .recovery-actions button {
        margin-left: 8px;
      }
    `,
  ],
})
export class EditorShellComponent {
  private readonly store = inject(Store);

  readonly title = toSignal(this.store.select(selectDisplayTitle), { initialValue: 'Untitled' });
  readonly status = toSignal(this.store.select(selectStatus), { initialValue: 'idle' as const });
  readonly recentFiles = toSignal(this.store.select(selectRecentFiles), { initialValue: [] });
  readonly hasPendingDraft = toSignal(this.store.select(selectHasPendingDraft), {
    initialValue: false,
  });
  readonly pendingDraft = toSignal(this.store.select(selectPendingDraft), { initialValue: null });
  readonly lastError = toSignal(this.store.select(selectLastError), { initialValue: null });

  /** Friendly status text for the title-block status pill. */
  statusLabel(): string {
    switch (this.status()) {
      case 'opening':
        return 'Opening…';
      case 'saving':
        return 'Saving…';
      default:
        return '';
    }
  }

  onNew(): void {
    this.store.dispatch(DocumentActions.newDocumentRequested());
  }

  onOpen(): void {
    this.store.dispatch(DocumentActions.openDocumentRequested());
  }

  onSave(): void {
    this.store.dispatch(DocumentActions.saveDocumentRequested());
  }

  onSaveAs(): void {
    this.store.dispatch(DocumentActions.saveAsDocumentRequested());
  }

  onOpenRecent(fileId: string): void {
    this.store.dispatch(DocumentActions.openRecentFileRequested({ fileId }));
  }

  onRecover(): void {
    this.store.dispatch(DocumentActions.draftRecoveryRequested());
  }

  onDiscard(): void {
    this.store.dispatch(DocumentActions.draftDiscarded());
  }

  /**
   * Document-level keybindings. Bound to the host so they work whenever the
   * app has keyboard focus, not only when the toolbar itself is focused.
   * Cmd on macOS / Ctrl elsewhere.
   */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === 'n') {
      event.preventDefault();
      this.onNew();
    } else if (key === 'o') {
      event.preventDefault();
      this.onOpen();
    } else if (key === 's' && event.shiftKey) {
      event.preventDefault();
      this.onSaveAs();
    } else if (key === 's') {
      event.preventDefault();
      this.onSave();
    }
  }
}
