// Theme toggle — three-state cycle button. v1 polish.
//
// Cycles `system → light → dark → system`. Renders an emoji icon hinting
// at the current effective theme: ☀ for light, ☾ for dark, ◐ for system.
// Aria-label always names the current preference + the cycle target so
// screen-reader users get the same affordance.

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { ThemeService, type ThemePreference } from './theme.service';

const ORDER: ReadonlyArray<ThemePreference> = ['system', 'light', 'dark'];

@Component({
  selector: 'aquascape-theme-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="theme-toggle"
      (click)="onCycle()"
      [attr.aria-label]="ariaLabel()"
      [title]="ariaLabel()"
    >
      {{ icon() }}
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .theme-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 32px;
        height: 28px;
        padding: 0 8px;
        background: transparent;
        color: inherit;
        border: 1px solid var(--border-strong, #c0c0c0);
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
        font-size: 14px;
      }
      .theme-toggle:hover,
      .theme-toggle:focus-visible {
        background: var(--surface-hover, #f0f0f0);
        outline: none;
      }
    `,
  ],
})
export class ThemeToggleComponent {
  private readonly theme = inject(ThemeService);

  readonly preference = this.theme.preference;
  readonly effective = this.theme.effective;

  readonly icon = computed<string>(() => {
    switch (this.preference()) {
      case 'light':
        return '☀';
      case 'dark':
        return '☾';
      case 'system':
      default:
        return '◐';
    }
  });

  readonly ariaLabel = computed<string>(() => {
    const cur = this.preference();
    const next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length] ?? 'system';
    const eff = this.effective();
    const curLabel =
      cur === 'system' ? `system (currently ${eff})` : cur;
    return `Theme: ${curLabel}. Click to switch to ${next}.`;
  });

  onCycle(): void {
    const cur = this.preference();
    const next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length] ?? 'system';
    this.theme.setPreference(next);
  }
}
