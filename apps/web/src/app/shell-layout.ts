// Pure helpers for the editor shell layout (Stage 4-followup: Figma-style
// resizable + collapsible side panels + responsive drawer mode).
//
// These live in a separate file so they're easy to unit-test without spinning
// up the Angular TestBed — see shell-layout.spec.ts.

// ─── Width clamping ──────────────────────────────────────────────────────

/**
 * Clamp a panel width to its allowed `[min, max]` range. Non-finite inputs
 * (NaN / Infinity / -Infinity, or values rejected by the storage layer)
 * collapse to `defaultValue`, so a corrupted persisted preference can never
 * push the layout into an invisible state.
 */
export function clampPanelWidth(
  raw: number,
  min: number,
  max: number,
  defaultValue: number,
): number {
  if (!Number.isFinite(raw)) return defaultValue;
  if (raw < min) return min;
  if (raw > max) return max;
  return raw;
}

// ─── Storage keys (load-bearing — referenced from tests) ────────────────

export const SHELL_STORAGE_KEYS = {
  sidebarWidth: 'aquascape.ui.shell.sidebarWidth',
  railWidth: 'aquascape.ui.shell.railWidth',
  sidebarCollapsed: 'aquascape.ui.shell.sidebarCollapsed',
  railCollapsed: 'aquascape.ui.shell.railCollapsed',
} as const;

// ─── Width bounds ────────────────────────────────────────────────────────

/**
 * Min/max/default widths for each panel. Two layouts:
 *
 *   - `wide` (>= 1200px viewport): the published Figma-style spec.
 *   - `medium` (768 – 1199px): slightly tighter mins so the canvas stays
 *     usable on smaller laptops without overwriting persisted user widths.
 *
 * Phone width (< 768px) uses the drawer overlay and ignores these.
 */
export interface PanelBounds {
  readonly min: number;
  readonly max: number;
  readonly defaultValue: number;
}

export const SIDEBAR_BOUNDS_WIDE: PanelBounds = { min: 220, max: 560, defaultValue: 320 };
export const RAIL_BOUNDS_WIDE: PanelBounds = { min: 200, max: 480, defaultValue: 280 };
export const SIDEBAR_BOUNDS_MEDIUM: PanelBounds = { min: 200, max: 560, defaultValue: 320 };
export const RAIL_BOUNDS_MEDIUM: PanelBounds = { min: 180, max: 480, defaultValue: 280 };

// ─── Responsive breakpoints ──────────────────────────────────────────────

/** < 768px CSS pixels: drawer overlay mode for both side panels. */
export const PHONE_MAX_PX = 767;
/** 768 – 1199px: medium layout (rail auto-collapses, smaller mins). */
export const TABLET_MAX_PX = 1199;

export type ShellBreakpoint = 'phone' | 'tablet' | 'wide';

/**
 * Resolve a viewport width (CSS px) to a named breakpoint. Used by the
 * `AppComponent` to pick `wide` / `medium` bounds and to toggle the
 * drawer-overlay layout below 768px.
 */
export function resolveBreakpoint(viewportPx: number): ShellBreakpoint {
  if (viewportPx <= PHONE_MAX_PX) return 'phone';
  if (viewportPx <= TABLET_MAX_PX) return 'tablet';
  return 'wide';
}

/**
 * Bounds for `sidebar` / `rail` at a given breakpoint. `phone` shares the
 * wide bounds (the drawer width when expanded uses min(280px, viewport)).
 */
export function boundsFor(breakpoint: ShellBreakpoint, panel: 'sidebar' | 'rail'): PanelBounds {
  if (breakpoint === 'tablet') {
    return panel === 'sidebar' ? SIDEBAR_BOUNDS_MEDIUM : RAIL_BOUNDS_MEDIUM;
  }
  return panel === 'sidebar' ? SIDEBAR_BOUNDS_WIDE : RAIL_BOUNDS_WIDE;
}
