// Export dialog. Stage 6 F6.1 + F6.2.
//
// Modal triggered from the editor-shell toolbar. Two artefacts the user
// can export:
//   1. Image (PNG / JPEG) at a chosen resolution. Pipes through
//      `renderSceneToImageBytes` → `RenderExportService.exportPng`.
//   2. Layout summary (Markdown / JSON). Same `exportPng` channel since
//      the platform-api method takes raw bytes + a suggested filename
//      — the MIME on the download side comes from the extension.
//
// Esc / backdrop click closes the modal. The export buttons surface
// loading + success / error feedback inline so the dialog stays the
// gesture's home.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';

import {
  RESOLUTION_PRESETS,
  formatSummaryJson,
  formatSummaryMarkdown,
  renderSceneToImageBytes,
  summarizeScene,
  type CanvasLike,
  type ExportImageFormat,
  type ExportResolution,
} from '@aquascape/features/export';
import { coreCatalog } from '@aquascape/domain/catalog';
import type { Scene } from '@aquascape/domain/scene-model';
import type { RenderExportService } from '@aquascape/platform/platform-api';
import { RENDER_EXPORT_SERVICE } from '@aquascape/platform/platform-api/angular';

type SummaryFormat = 'markdown' | 'json';

interface FeedbackState {
  readonly kind: 'idle' | 'busy' | 'ok' | 'error';
  readonly message: string;
}

@Component({
  selector: 'aquascape-export-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    @if (visible()) {
      <div class="export-backdrop" (click)="close()" aria-hidden="true"></div>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        class="export-dialog"
      >
        <header class="export-dialog__header">
          <h2 id="export-dialog-title" class="export-dialog__title">Export</h2>
          <button
            type="button"
            class="export-dialog__close"
            (click)="close()"
            aria-label="Close export dialog"
            title="Close (Esc)"
          >
            ×
          </button>
        </header>

        @if (currentScene === null) {
          <p class="export-dialog__empty">No scene to export yet.</p>
        } @else {
          <section class="export-dialog__section">
            <h3 class="export-dialog__section-title">Image</h3>

            <label class="export-dialog__field">
              <span class="export-dialog__field-label">Format</span>
              <select
                [value]="format()"
                (change)="onFormatChange($event)"
                aria-label="Image format"
              >
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
              </select>
            </label>

            <label class="export-dialog__field">
              <span class="export-dialog__field-label">Resolution</span>
              <select
                [value]="resolutionId()"
                (change)="onResolutionChange($event)"
                aria-label="Image resolution"
              >
                @for (p of presets; track p.id) {
                  <option [value]="p.id">{{ p.label }}</option>
                }
              </select>
            </label>

            @if (format() === 'jpeg') {
              <label class="export-dialog__field">
                <span class="export-dialog__field-label">JPEG quality</span>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  [value]="quality()"
                  (input)="onQualityChange($event)"
                  aria-label="JPEG quality"
                />
                <span class="export-dialog__field-value">{{ qualityLabel() }}</span>
              </label>
            }

            <button
              type="button"
              class="export-dialog__primary"
              (click)="onExportImage()"
              [disabled]="imageFeedback().kind === 'busy'"
            >
              {{ imageFeedback().kind === 'busy' ? 'Exporting…' : 'Export image' }}
            </button>
            @if (imageFeedback().kind !== 'idle' && imageFeedback().kind !== 'busy') {
              <p
                class="export-dialog__feedback"
                [class.export-dialog__feedback--error]="imageFeedback().kind === 'error'"
                role="status"
                aria-live="polite"
              >
                {{ imageFeedback().message }}
              </p>
            }
          </section>

          <section class="export-dialog__section">
            <h3 class="export-dialog__section-title">Layout summary</h3>
            <p class="export-dialog__hint">
              Tank dimensions, water volume, plant list, hardscape list, decor
              list.
            </p>

            <label class="export-dialog__field">
              <span class="export-dialog__field-label">Format</span>
              <select
                [value]="summaryFormat()"
                (change)="onSummaryFormatChange($event)"
                aria-label="Summary format"
              >
                <option value="markdown">Markdown (.md)</option>
                <option value="json">JSON (.json)</option>
              </select>
            </label>

            <button
              type="button"
              class="export-dialog__primary"
              (click)="onExportSummary()"
              [disabled]="summaryFeedback().kind === 'busy'"
            >
              {{ summaryFeedback().kind === 'busy' ? 'Exporting…' : 'Export summary' }}
            </button>
            @if (summaryFeedback().kind !== 'idle' && summaryFeedback().kind !== 'busy') {
              <p
                class="export-dialog__feedback"
                [class.export-dialog__feedback--error]="summaryFeedback().kind === 'error'"
                role="status"
                aria-live="polite"
              >
                {{ summaryFeedback().message }}
              </p>
            }
          </section>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .export-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        z-index: 2000;
      }
      .export-dialog {
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: min(480px, 92vw);
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
      .export-dialog__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .export-dialog__title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }
      .export-dialog__close {
        background: transparent;
        color: inherit;
        border: none;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .export-dialog__close:hover {
        background: var(--surface-hover, #2a2d35);
      }
      .export-dialog__section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--border, #2d3138);
      }
      .export-dialog__section-title {
        margin: 0 0 10px;
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted, #999);
      }
      .export-dialog__hint {
        margin: -4px 0 8px;
        font-size: 11px;
        color: var(--text-muted, #999);
        font-style: italic;
      }
      .export-dialog__field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 10px;
      }
      .export-dialog__field-label {
        font-size: 11px;
        color: var(--text-muted, #999);
      }
      .export-dialog__field-value {
        font-size: 11px;
        color: var(--text-muted, #b0b3b8);
      }
      .export-dialog__field select,
      .export-dialog__field input[type='range'] {
        font: inherit;
        background: var(--surface-2, #2a2d35);
        color: inherit;
        border: 1px solid var(--border-strong, #4a4d54);
        border-radius: 4px;
        padding: 5px 8px;
      }
      .export-dialog__primary {
        background: var(--accent, #3a8eff);
        color: #fff;
        border: none;
        padding: 8px 14px;
        border-radius: 4px;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .export-dialog__primary:hover:not(:disabled) {
        background: var(--accent-hover, #2a7eef);
      }
      .export-dialog__primary:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .export-dialog__feedback {
        margin: 8px 0 0;
        font-size: 12px;
        color: var(--text-muted, #b0b3b8);
      }
      .export-dialog__feedback--error {
        color: #ff6b6b;
      }
      .export-dialog__empty {
        margin: 0;
        font-size: 13px;
        font-style: italic;
        color: var(--text-muted, #999);
      }
    `,
  ],
})
export class ExportDialogComponent {
  private readonly renderExport: RenderExportService = inject(RENDER_EXPORT_SERVICE);

  /** Current scene (passed in from the host via @Input). */
  @Input() currentScene: Scene | null = null;
  /**
   * Optional canvas factory override — used by tests to supply a fake
   * canvas (jsdom's `HTMLCanvasElement.getContext` throws). Production
   * leaves this null and the offscreen pipeline falls back to
   * `document.createElement('canvas')`.
   */
  @Input() createCanvasOverride: (() => CanvasLike) | null = null;

  readonly presets = RESOLUTION_PRESETS;

  readonly visible = signal<boolean>(false);
  readonly format = signal<ExportImageFormat>('png');
  readonly resolutionId = signal<string>(RESOLUTION_PRESETS[0]?.id ?? '1080');
  readonly quality = signal<number>(0.92);
  readonly summaryFormat = signal<SummaryFormat>('markdown');
  readonly imageFeedback = signal<FeedbackState>({ kind: 'idle', message: '' });
  readonly summaryFeedback = signal<FeedbackState>({ kind: 'idle', message: '' });

  readonly qualityLabel = computed<string>(() => `${Math.round(this.quality() * 100)}%`);

  open(): void {
    this.visible.set(true);
    this.imageFeedback.set({ kind: 'idle', message: '' });
    this.summaryFeedback.set({ kind: 'idle', message: '' });
  }

  close(): void {
    this.visible.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visible()) this.close();
  }

  onFormatChange(event: Event): void {
    this.format.set((event.target as HTMLSelectElement).value as ExportImageFormat);
  }
  onResolutionChange(event: Event): void {
    this.resolutionId.set((event.target as HTMLSelectElement).value);
  }
  onQualityChange(event: Event): void {
    const v = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(v)) this.quality.set(v);
  }
  onSummaryFormatChange(event: Event): void {
    this.summaryFormat.set((event.target as HTMLSelectElement).value as SummaryFormat);
  }

  async onExportImage(): Promise<void> {
    const scene = this.currentScene;
    if (scene === null) return;
    const resolution = this.lookupResolution(this.resolutionId());
    if (resolution === null) return;
    this.imageFeedback.set({ kind: 'busy', message: '' });
    try {
      const bytes = await renderSceneToImageBytes({
        scene,
        catalog: coreCatalog,
        resolution,
        format: this.format(),
        quality: this.quality(),
        ...(this.createCanvasOverride !== null
          ? { createCanvas: this.createCanvasOverride }
          : {}),
      });
      const suggested = `aquascape-${resolution.widthCss}x${resolution.heightCss}.${this.format() === 'png' ? 'png' : 'jpg'}`;
      const result = await this.renderExport.exportPng({ bytes, suggestedName: suggested });
      if (result === null) {
        this.imageFeedback.set({ kind: 'error', message: 'Export cancelled.' });
        return;
      }
      this.imageFeedback.set({
        kind: 'ok',
        message: `Saved ${formatBytes(bytes.byteLength)} → ${result.path}`,
      });
    } catch (err) {
      this.imageFeedback.set({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Image export failed.',
      });
    }
  }

  async onExportSummary(): Promise<void> {
    const scene = this.currentScene;
    if (scene === null) return;
    this.summaryFeedback.set({ kind: 'busy', message: '' });
    try {
      const summary = summarizeScene(scene, coreCatalog);
      const text =
        this.summaryFormat() === 'markdown'
          ? formatSummaryMarkdown(summary)
          : formatSummaryJson(summary);
      const ext = this.summaryFormat() === 'markdown' ? 'md' : 'json';
      const suggested = `aquascape-summary.${ext}`;
      // Encode UTF-8 via TextEncoder which both Chromium + jsdom expose.
      const bytes = new TextEncoder().encode(text);
      const result = await this.renderExport.exportPng({ bytes, suggestedName: suggested });
      if (result === null) {
        this.summaryFeedback.set({ kind: 'error', message: 'Export cancelled.' });
        return;
      }
      this.summaryFeedback.set({
        kind: 'ok',
        message: `Saved ${formatBytes(bytes.byteLength)} → ${result.path}`,
      });
    } catch (err) {
      this.summaryFeedback.set({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Summary export failed.',
      });
    }
  }

  private lookupResolution(id: string): ExportResolution | null {
    return RESOLUTION_PRESETS.find((p) => p.id === id)?.resolution ?? null;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
