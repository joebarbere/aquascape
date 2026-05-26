// View-mode service. Stage 10 F10.2.
//
// Holds the active canvas renderer mode — `'2d'` or `'3d'`. Drives the
// app-shell renderer swap (`apps/web`'s two-canvas pair + active-renderer
// lookup) and the toolbar `ViewToggleComponent`.
//
// Per-user UI preference; persisted via `StorageService` under
// `aquascape.ui.viewMode` so the next session restores the user's last
// chosen mode. NOT serialised into `Scene` / `.aqua`: the mode is an
// editing-host concern, not a document concern. The 3D renderer reads
// the same document the 2D renderer reads.
//
// Why a service signal rather than NgRx? Same reasons as
// `OverlayOptionsService` / `WallBackgroundService` / `BackdropService`:
// transient editor UI state, single shell consumer, persistence handled
// directly via the platform-api `StorageService` token.
//
// Why an `effect()` + firstRun guard rather than write-through setters?
// The spec calls for this shape explicitly so the storage write follows
// the same persistence shape every per-panel collapse flag already uses
// (`composition-overlays.component.ts`, `snap-settings.component.ts`, etc).
// The guard skips the synchronous initial dependency-registering run so
// the hydrated value from storage isn't immediately clobbered by the
// seeded default.

import { Injectable, effect, inject, signal } from '@angular/core';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

/** Discriminator for the active renderer + canvas. */
export type ViewMode = '2d' | '3d';

/** StorageService key for the persisted view mode. */
export const STORAGE_KEY_VIEW_MODE = 'aquascape.ui.viewMode';

const VALID: ReadonlyArray<ViewMode> = ['2d', '3d'];

@Injectable({ providedIn: 'root' })
export class ViewModeService {
  private readonly storage: StorageService = inject(STORAGE_SERVICE);

  /** The active canvas mode. Defaults to `'2d'` on first load. */
  readonly mode = signal<ViewMode>('2d');

  constructor() {
    // Prime from storage. Storage is async; the effect below will fire on
    // the resolved value WITHOUT writing it back (the firstRun-after-
    // hydrate write is suppressed too: the hydrate sets the signal BEFORE
    // the effect's first real run, so the dependency-registering pass is
    // already aware of the persisted value).
    void this.storage
      .get<unknown>(STORAGE_KEY_VIEW_MODE)
      .then((value) => {
        if (typeof value === 'string' && (VALID as readonly string[]).includes(value)) {
          this.mode.set(value as ViewMode);
        }
      })
      .catch(() => {
        // Storage read failure is non-fatal — fall back to '2d'.
      });

    // Persist mode flips. The `firstRun` guard skips the synchronous
    // initial dependency-registering invocation so we don't immediately
    // overwrite the (async-)hydrated value with the seeded default.
    // Matches the pattern in `composition-overlays.component.ts` and
    // `snap-settings.component.ts`.
    let firstRun = true;
    effect(() => {
      const value = this.mode();
      if (firstRun) {
        firstRun = false;
        return;
      }
      this.storage.set(STORAGE_KEY_VIEW_MODE, value).catch(() => {
        // Persist failure is non-fatal — the in-memory mode still applies
        // for this session.
      });
    });
  }

  /**
   * Flip `'2d'` ↔ `'3d'`. Keyboard shortcut path; the segmented buttons
   * call `setMode` directly so a click on the already-active button is a
   * no-op (preserving signal identity → OnPush components don't re-paint).
   */
  toggle(): void {
    this.mode.update((m) => (m === '2d' ? '3d' : '2d'));
  }

  /**
   * Set the mode directly. Idempotent — calling with the current mode
   * is a no-op (signal identity preserved). Used by the segmented
   * control's two buttons.
   */
  setMode(mode: ViewMode): void {
    if (this.mode() === mode) return;
    this.mode.set(mode);
  }
}
