// Stage 11 F11.6 Wave 4 — toggle flag for the dev-only behavior-debug
// overlay (`BehaviorDebugOverlayComponent`).
//
// Lives in `apps/web/src/app/` rather than `features/editor-shell` because
// the overlay reads `LivestockSimulationService` (also app-shell-scoped)
// and is wired alongside the existing `attachDebugHook` debug surface. The
// service is intentionally tiny: a single signal flipped by AppComponent's
// `Ctrl+Shift+D` HostListener and read by the overlay component.
//
// CONTRACT
// --------
//  - The overlay is HIDDEN by default in every build configuration (dev or
//    production). Activation requires both `isDevMode()` AND `enabled()`
//    being true — the component checks both.
//  - Toggling is idempotent: pressing the chord N times leaves the flag
//    in the parity-of-N state. No autosave / persistence — this is a
//    transient developer affordance, not a user preference.
//  - Optional URL bootstrap: `?debug-behavior=1` flips `enabled` to true
//    on first read (handled inside the overlay's bootstrap, NOT here, so
//    this service stays test-friendly + framework-light).

import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class BehaviorDebugService {
  /** True when the F11 behavior debug overlay should render. */
  readonly enabled = signal<boolean>(false);

  /** Flip the flag. Called from AppComponent's `Ctrl+Shift+D` HostListener. */
  toggle(): void {
    this.enabled.set(!this.enabled());
  }

  /** Force the flag to a specific value (used by the URL bootstrap path). */
  setEnabled(value: boolean): void {
    this.enabled.set(value);
  }
}
