// View-mode toggle — segmented "2D | 3D | Fish eye" control. Stage 10
// F10.2; fish-eye segment added with the fish-eye view mode.
//
// Mounted in `EditorShellComponent`'s toolbar next to the export button.
// Pressing a segment calls `ViewModeService.setMode(...)`; clicking the
// already-active segment is a no-op (idempotent — preserves signal
// identity so OnPush consumers don't repaint).
//
// SEGMENTED VS SINGLE TOGGLE
// --------------------------
// Two-button segmented over a single cycling button because:
//   * The active mode is always visible at a glance (no hidden state).
//   * The keyboard tab order is predictable (two real buttons).
//   * Matches macOS-style segmented controls users already know.
//
// KEYBOARD SHORTCUT
// -----------------
// Cmd/Ctrl+Shift+3 toggles via a document-level `HostListener`. The same
// "ignore when target is INPUT/TEXTAREA/SELECT" guard the
// `EditorShellComponent` uses for its Cmd/N/O/S/Z shortcuts applies here,
// so users typing in numeric inputs can't accidentally swap views.

import { ChangeDetectionStrategy, Component, HostListener, computed, inject } from '@angular/core';

import { ViewModeService, type ViewMode } from './view-mode.service';

@Component({
  selector: 'aquascape-view-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="view-toggle" role="group" aria-label="Canvas view mode">
      <button
        type="button"
        class="seg"
        [class.is-active]="mode() === '2d'"
        [attr.aria-pressed]="mode() === '2d'"
        [attr.aria-label]="ariaLabel2d()"
        [title]="ariaLabel2d()"
        (click)="onSelect('2d')"
      >
        2D
      </button>
      <button
        type="button"
        class="seg"
        [class.is-active]="mode() === '3d'"
        [attr.aria-pressed]="mode() === '3d'"
        [attr.aria-label]="ariaLabel3d()"
        [title]="ariaLabel3d()"
        (click)="onSelect('3d')"
      >
        3D
      </button>
      <button
        type="button"
        class="seg"
        [class.is-active]="mode() === 'fish-eye'"
        [attr.aria-pressed]="mode() === 'fish-eye'"
        [attr.aria-label]="ariaLabelFishEye()"
        [title]="ariaLabelFishEye()"
        (click)="onSelect('fish-eye')"
      >
        Fish eye
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .view-toggle {
        display: inline-flex;
        align-items: stretch;
        height: 30px;
        border: 1px solid var(--border-strong, #3a3f48);
        border-radius: 14px;
        overflow: hidden;
        background: transparent;
      }
      .seg {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 36px;
        padding: 0 10px;
        background: transparent;
        color: inherit;
        border: 0;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.02em;
      }
      .seg + .seg {
        border-left: 1px solid var(--border-strong, #3a3f48);
      }
      .seg:hover,
      .seg:focus-visible {
        background: var(--surface-hover, #2c3038);
        outline: none;
      }
      .seg.is-active {
        background: var(--accent, #0891b2);
        color: var(--accent-text, #ffffff);
      }
      .seg.is-active:hover,
      .seg.is-active:focus-visible {
        background: var(--accent-hover, #0a6f8d);
      }
    `,
  ],
})
export class ViewToggleComponent {
  private readonly viewMode = inject(ViewModeService);

  readonly mode = this.viewMode.mode;

  readonly ariaLabel2d = computed<string>(() =>
    this.mode() === '2d' ? '2D view (active)' : 'Switch to 2D view',
  );

  readonly ariaLabel3d = computed<string>(() =>
    this.mode() === '3d' ? '3D view (active)' : 'Switch to 3D view',
  );

  readonly ariaLabelFishEye = computed<string>(() =>
    this.mode() === 'fish-eye'
      ? 'Fish-eye view (active)'
      : 'Switch to fish-eye view (camera rides a fish)',
  );

  onSelect(mode: ViewMode): void {
    this.viewMode.setMode(mode);
  }

  /**
   * Document-level keyboard shortcut: Cmd/Ctrl+Shift+3 toggles 2D ↔ 3D.
   * Matches the `EditorShellComponent`'s convention of ignoring form-
   * field targets so users typing in numeric inputs don't trip the swap.
   */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod || !event.shiftKey) return;
    // Match EditorShellComponent's guard: skip when typing in a form field.
    const target = event.target as HTMLElement | null;
    if (
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      return;
    }
    // Use `event.code` to detect the "3" key independent of any modifier-
    // induced key remapping (Shift+3 → "#" on US layouts; `event.key` is
    // unreliable here, but `event.code` stays "Digit3").
    if (event.code !== 'Digit3' && event.key !== '3') return;
    event.preventDefault();
    this.viewMode.toggle();
  }
}
