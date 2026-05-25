// Template browser dialog. Stage 5 F5.1 + F5.2.
//
// Modal triggered from the editor-shell toolbar. Lists built-in starter
// templates first, then any personal templates the user has saved. Each
// card has a "New from this" button that instantiates the template + a
// "Delete" button (personal entries only). A separate "Save current as
// template…" field at the bottom serves F5.2.
//
// The host (apps/web's AppComponent) reads `selectScene` + `selectEnvelope`
// and passes them in via inputs because this component lives in
// `features/editor-shell` which deliberately doesn't depend on
// `@aquascape/state` — keeping the layer pure.
//
// Visibility is controlled by `open()` / `close()` methods; the host
// drives them from a toolbar button. Esc closes via @HostListener.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';

import type { DocumentEnvelope } from '@aquascape/domain/document';
import type { Scene } from '@aquascape/domain/scene-model';

import { TemplatesService } from './templates.service';

/** Event payload — host dispatches `SceneActions.setScene` + `documentReset`. */
export interface TemplateInstantiateEvent {
  readonly scene: Scene;
  readonly templateName: string;
}

@Component({
  selector: 'aquascape-template-browser',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    @if (visible()) {
      <div class="template-browser-backdrop" (click)="close()" aria-hidden="true"></div>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-browser-title"
        class="template-browser"
      >
        <header class="template-browser__header">
          <h2 id="template-browser-title" class="template-browser__title">Templates</h2>
          <button
            type="button"
            class="template-browser__close"
            (click)="close()"
            aria-label="Close template browser"
            title="Close (Esc)"
          >
            ×
          </button>
        </header>

        <section class="template-browser__section" aria-labelledby="template-browser-builtins">
          <h3 id="template-browser-builtins" class="template-browser__section-title">
            Starter templates
          </h3>
          <ul class="template-browser__grid" role="list">
            @for (t of templates.builtins; track t.id) {
              <li class="template-browser__card">
                <h4 class="template-browser__card-title">{{ t.name }}</h4>
                <p class="template-browser__card-desc">{{ t.description }}</p>
                <button
                  type="button"
                  class="template-browser__primary"
                  (click)="onInstantiate(t.id)"
                  [attr.aria-label]="'New document from ' + t.name"
                >
                  New from this
                </button>
              </li>
            }
          </ul>
        </section>

        <section
          class="template-browser__section"
          aria-labelledby="template-browser-personals"
        >
          <h3 id="template-browser-personals" class="template-browser__section-title">
            Your templates
            <span class="template-browser__count">{{ templates.personalCount() }}</span>
          </h3>
          @if (templates.personalCount() === 0) {
            <p class="template-browser__empty">
              Save your current layout as a template to reuse it later.
            </p>
          } @else {
            <ul class="template-browser__grid" role="list">
              @for (t of templates.personal(); track t.id) {
                <li class="template-browser__card template-browser__card--personal">
                  <h4 class="template-browser__card-title">{{ t.name }}</h4>
                  <p class="template-browser__card-desc">{{ t.description }}</p>
                  <div class="template-browser__card-actions">
                    <button
                      type="button"
                      class="template-browser__primary"
                      (click)="onInstantiate(t.id)"
                      [attr.aria-label]="'New document from ' + t.name"
                    >
                      New from this
                    </button>
                    <button
                      type="button"
                      class="template-browser__delete"
                      (click)="onDelete(t.id)"
                      [attr.aria-label]="'Delete template ' + t.name"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              }
            </ul>
          }
        </section>

        <section
          class="template-browser__section template-browser__save"
          aria-labelledby="template-browser-save"
        >
          <h3 id="template-browser-save" class="template-browser__section-title">
            Save current as template
          </h3>
          @if (currentScene === null) {
            <p class="template-browser__empty">No scene to save yet.</p>
          } @else {
            <div class="template-browser__save-row">
              <input
                type="text"
                class="template-browser__save-name"
                [value]="saveName()"
                (input)="onSaveNameChange($event)"
                placeholder="Template name"
                aria-label="Template name"
              />
              <button
                type="button"
                class="template-browser__primary"
                (click)="onSave()"
                [disabled]="saveName().trim().length === 0"
              >
                Save as template
              </button>
            </div>
            @if (lastSaveError(); as err) {
              <p class="template-browser__error" role="alert">{{ err }}</p>
            }
          }
        </section>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .template-browser-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        z-index: 2000;
      }
      .template-browser {
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: min(640px, 92vw);
        max-height: 86vh;
        overflow-y: auto;
        background: var(--surface, #1c1f24);
        color: var(--text, #f0f2f5);
        border: 1px solid var(--border, #2d3138);
        border-radius: 10px;
        box-shadow: 0 12px 60px rgba(0, 0, 0, 0.5);
        z-index: 2001;
        padding: 20px;
        font-family: system-ui, sans-serif;
      }
      .template-browser__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .template-browser__title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }
      .template-browser__close {
        background: transparent;
        color: inherit;
        border: none;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .template-browser__close:hover {
        background: var(--surface-hover, #2a2d35);
      }
      .template-browser__section {
        margin-top: 16px;
      }
      .template-browser__section-title {
        margin: 0 0 8px;
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted, #999);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .template-browser__count {
        color: var(--text-muted, #777);
        font-weight: 500;
        font-size: 11px;
        background: var(--surface-2, #2a2d35);
        padding: 1px 6px;
        border-radius: 8px;
      }
      .template-browser__grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .template-browser__card {
        background: var(--surface-2, #2a2d35);
        border: 1px solid var(--border, #3a3d44);
        border-radius: 6px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .template-browser__card-title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }
      .template-browser__card-desc {
        margin: 0;
        font-size: 12px;
        color: var(--text-muted, #b0b3b8);
        line-height: 1.35;
        flex: 1;
      }
      .template-browser__card-actions {
        display: flex;
        gap: 6px;
      }
      .template-browser__primary {
        background: var(--accent, #3a8eff);
        color: #fff;
        border: none;
        padding: 5px 10px;
        border-radius: 4px;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .template-browser__primary:hover {
        background: var(--accent-hover, #2a7eef);
      }
      .template-browser__primary:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .template-browser__delete {
        background: transparent;
        color: var(--text-muted, #b0b3b8);
        border: 1px solid var(--border, #3a3d44);
        padding: 5px 10px;
        border-radius: 4px;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .template-browser__delete:hover {
        color: #ff6b6b;
        border-color: #ff6b6b;
      }
      .template-browser__empty {
        margin: 0;
        font-size: 12px;
        color: var(--text-muted, #999);
        font-style: italic;
      }
      .template-browser__save-row {
        display: flex;
        gap: 8px;
      }
      .template-browser__save-name {
        flex: 1;
        background: var(--surface-2, #2a2d35);
        color: inherit;
        border: 1px solid var(--border-strong, #4a4d54);
        border-radius: 4px;
        padding: 6px 8px;
        font: inherit;
        font-size: 13px;
      }
      .template-browser__error {
        margin: 6px 0 0;
        font-size: 12px;
        color: #ff6b6b;
      }
    `,
  ],
})
export class TemplateBrowserComponent {
  readonly templates = inject(TemplatesService);

  /** Current scene from the host (NgRx selectScene). May be null briefly. */
  @Input() currentScene: Scene | null = null;
  /** Current document envelope from the host (NgRx selectEnvelope). */
  @Input() currentEnvelope: DocumentEnvelope | null = null;

  readonly visible = signal<boolean>(false);
  readonly saveName = signal<string>('');
  readonly lastSaveError = signal<string | null>(null);

  open(): void {
    this.visible.set(true);
    this.lastSaveError.set(null);
  }

  close(): void {
    this.visible.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visible()) this.close();
  }

  onSaveNameChange(event: Event): void {
    this.saveName.set((event.target as HTMLInputElement).value);
  }

  /**
   * Instantiate a template (built-in or personal) → produces a fresh scene
   * and emits via the `instantiate` output. The host dispatches the
   * actions to actually replace the scene + reset the document.
   */
  onInstantiate(id: string): void {
    const listing = this.templates.all().find((t) => t.id === id);
    if (listing === undefined) return;
    const scene = this.templates.instantiateTemplate(listing.document);
    this.instantiate.emit({ scene, templateName: listing.name });
    this.close();
  }

  /** Output: an instantiation that the host must apply via store dispatch. */
  @Output() readonly instantiate = new EventEmitter<TemplateInstantiateEvent>();

  async onDelete(id: string): Promise<void> {
    await this.templates.deletePersonalTemplate(id);
  }

  async onSave(): Promise<void> {
    if (this.currentScene === null) return;
    const name = this.saveName().trim();
    if (name.length === 0) return;
    try {
      await this.templates.saveAsTemplate(this.currentScene, this.currentEnvelope, name);
      this.saveName.set('');
      this.lastSaveError.set(null);
    } catch (err) {
      this.lastSaveError.set(err instanceof Error ? err.message : 'Save failed');
    }
  }
}

