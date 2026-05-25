// Backdrop sidebar accordion. Stage 6 F6.3.
//
// Four controls:
//   - Enable toggle (master).
//   - File picker for the photo (input[type=file] accept=image/*).
//   - Opacity slider [0..1].
//   - Clear button (drops the loaded image but keeps the toggle).
//
// Drives `BackdropService`; the renderer call site in apps/web reads
// `backdropService.backdrop()` and feeds it to the 9th `render()` arg.
// Header badge reads "on" / "off" (mirrors the wall-background panel).

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';

import { BackdropService } from './backdrop.service';

/** StorageService key for the collapsed-state flag. */
export const BACKDROP_PANEL_COLLAPSED_KEY = 'aquascape.ui.collapsed.backdrop';

@Component({
  selector: 'aquascape-backdrop-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <section class="backdrop-panel" aria-labelledby="backdrop-panel-heading">
      <header class="panel-header">
        <button
          type="button"
          class="panel-header__toggle"
          [attr.aria-expanded]="!collapsed()"
          aria-controls="backdrop-panel-body"
          (click)="toggleCollapsed()"
        >
          <span
            class="panel-header__chevron"
            [class.panel-header__chevron--open]="!collapsed()"
            aria-hidden="true"
            >›</span
          >
          <h2 id="backdrop-panel-heading" class="panel-header__title">Backdrop</h2>
          <span class="panel-header__count" [attr.aria-label]="badge() === 'on' ? 'backdrop on' : 'backdrop off'">
            {{ badge() }}
          </span>
        </button>
      </header>

      <div id="backdrop-panel-body" class="backdrop-panel__body" [hidden]="collapsed()">
        <p class="backdrop-panel__hint">
          Composite your design onto a real-room photo. Not saved with the document.
        </p>

        <label class="backdrop-panel__field backdrop-panel__field--row">
          <input
            type="checkbox"
            [checked]="enabled()"
            (change)="onEnabledChange($event)"
            aria-label="Enable backdrop"
          />
          <span><strong>Enable backdrop</strong></span>
        </label>

        <label class="backdrop-panel__field">
          <span class="backdrop-panel__field-label">Photo</span>
          <input
            #fileInput
            type="file"
            accept="image/*"
            (change)="onFileChange($event)"
            aria-label="Choose backdrop photo"
          />
          @if (image() !== null) {
            <button
              type="button"
              class="backdrop-panel__clear"
              (click)="onClear()"
              aria-label="Clear backdrop photo"
            >
              Clear photo
            </button>
          }
        </label>

        @if (lastError(); as err) {
          <p class="backdrop-panel__error" role="alert">{{ err }}</p>
        }

        <label class="backdrop-panel__field">
          <span class="backdrop-panel__field-label">
            Opacity
            <span class="backdrop-panel__field-value">{{ opacityLabel() }}</span>
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            [value]="opacity()"
            (input)="onOpacityChange($event)"
            [disabled]="!enabled() || image() === null"
            aria-label="Backdrop opacity"
          />
        </label>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 12px;
        font-family: system-ui, sans-serif;
        font-size: 13px;
      }
      .panel-header {
        margin: 0 0 8px;
      }
      .panel-header__toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 4px 6px;
        background: transparent;
        color: inherit;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
        text-align: left;
      }
      .panel-header__toggle:hover,
      .panel-header__toggle:focus-visible {
        background: var(--surface-hover, #f0f0f0);
        outline: none;
        border-color: var(--border, #e0e0e0);
      }
      .panel-header__chevron {
        display: inline-block;
        font-size: 16px;
        line-height: 1;
        width: 12px;
        transition: transform 0.15s ease;
      }
      .panel-header__chevron--open {
        transform: rotate(90deg);
      }
      @media (prefers-reduced-motion: reduce) {
        .panel-header__chevron {
          transition: none;
        }
      }
      .panel-header__title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        flex: 1;
      }
      .panel-header__count {
        color: var(--text-muted, #777);
        font-variant-numeric: tabular-nums;
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--surface, #f1f1f3);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .backdrop-panel__hint {
        margin: 0 0 8px;
        color: var(--text-muted, #777);
        font-size: 11px;
        font-style: italic;
      }
      .backdrop-panel__field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 8px;
      }
      .backdrop-panel__field--row {
        flex-direction: row;
        align-items: center;
        gap: 8px;
      }
      .backdrop-panel__field-label {
        font-size: 11px;
        color: var(--text-muted, #555);
        display: flex;
        justify-content: space-between;
      }
      .backdrop-panel__field-value {
        color: var(--text-muted, #b0b3b8);
      }
      .backdrop-panel__field input[type='file'] {
        font: inherit;
        font-size: 12px;
        padding: 4px 0;
      }
      .backdrop-panel__field input[type='range'] {
        width: 100%;
      }
      .backdrop-panel__clear {
        margin-top: 6px;
        align-self: flex-start;
        background: transparent;
        color: var(--text-muted, #b0b3b8);
        border: 1px solid var(--border, #3a3d44);
        border-radius: 4px;
        padding: 4px 10px;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .backdrop-panel__clear:hover {
        color: #ff6b6b;
        border-color: #ff6b6b;
      }
      .backdrop-panel__error {
        margin: 0 0 6px;
        font-size: 12px;
        color: #ff6b6b;
      }
    `,
  ],
})
export class BackdropPanelComponent {
  private readonly backdropService = inject(BackdropService);
  private readonly storage = inject<StorageService>(STORAGE_SERVICE);

  readonly enabled = this.backdropService.enabled;
  readonly opacity = this.backdropService.opacity;
  readonly image = this.backdropService.image;
  readonly lastError = this.backdropService.lastError;

  readonly opacityLabel = computed<string>(() => `${Math.round(this.opacity() * 100)}%`);
  readonly badge = computed<string>(() => (this.backdropService.isLive() ? 'on' : 'off'));

  readonly collapsed = signal<boolean>(false);

  constructor() {
    this.storage
      .get<boolean>(BACKDROP_PANEL_COLLAPSED_KEY)
      .then((stored) => {
        if (typeof stored === 'boolean') this.collapsed.set(stored);
      })
      .catch(() => {
        // Best-effort.
      });

    let firstRun = true;
    effect(() => {
      const v = this.collapsed();
      if (firstRun) {
        firstRun = false;
        return;
      }
      this.storage.set(BACKDROP_PANEL_COLLAPSED_KEY, v).catch(() => {
        // Best-effort.
      });
    });
  }

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  onEnabledChange(event: Event): void {
    this.backdropService.setEnabled((event.target as HTMLInputElement).checked);
  }

  onOpacityChange(event: Event): void {
    const v = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(v)) this.backdropService.setOpacity(v);
  }

  async onFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined) return;
    try {
      await this.backdropService.setImageFromFile(file);
      // Auto-enable on first import so the user immediately sees the effect.
      if (!this.enabled()) this.backdropService.setEnabled(true);
    } catch {
      // Service already populated lastError; nothing more to do here.
    } finally {
      // Reset the input so picking the SAME file again still fires `change`.
      input.value = '';
    }
  }

  async onClear(): Promise<void> {
    await this.backdropService.clear();
  }
}
