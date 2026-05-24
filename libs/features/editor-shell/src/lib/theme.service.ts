// Theme preference service. Stage 4 follow-up — v1 polish.
//
// Holds one of three values:
//   - 'system' (default) — follow the OS via `prefers-color-scheme`. The
//     CSS in `apps/web/src/styles.css` does the actual flipping.
//   - 'light' — pin `<html data-theme="light">`.
//   - 'dark'  — pin `<html data-theme="dark">`.
//
// Persisted via `StorageService` under `STORAGE_KEY_THEME`. Read once at
// component construction; future toggles write through immediately so a
// reload preserves the choice. Tests can pass a mock `StorageService` via
// the standard platform-api token.
//
// Why a service signal rather than NgRx? Theme preference is transient
// editor UI state (NOT persisted in the `.aqua` document), no other
// reducer depends on it, and it has exactly one consumer (the
// `<html data-theme>` attribute). Mirrors `PreviewTimeService` /
// `PlantDragService`.

import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

export type ThemePreference = 'system' | 'light' | 'dark';

/** localStorage / IndexedDB key for the persisted theme preference. */
export const STORAGE_KEY_THEME = 'aquascape.theme';

const VALID: ReadonlyArray<ThemePreference> = ['system', 'light', 'dark'];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly storage: StorageService = inject(STORAGE_SERVICE);

  /**
   * User's preference (or 'system' if untouched). The DOM `data-theme`
   * attribute below is kept in sync via the signal — readers only need to
   * call `preference()`.
   */
  private readonly preferenceSignal = signal<ThemePreference>('system');
  readonly preference = this.preferenceSignal.asReadonly();

  /**
   * The theme actually being applied right now: `'light'` or `'dark'`.
   * Always resolved (never `'system'`) — readers that need to render a
   * theme-specific value (e.g. a renderer canvas) read this instead of
   * `preference`. Re-evaluates when the preference changes, AND when the
   * OS reports a `prefers-color-scheme` change via the media query.
   */
  private readonly osDarkSignal = signal<boolean>(this.detectOsDark());
  readonly effective = computed<'light' | 'dark'>(() => {
    const p = this.preferenceSignal();
    if (p === 'system') return this.osDarkSignal() ? 'dark' : 'light';
    return p;
  });

  constructor() {
    // Prime from storage. Storage is async — apply preference on resolve.
    void this.storage
      .get<unknown>(STORAGE_KEY_THEME)
      .then((value) => {
        if (typeof value === 'string' && (VALID as readonly string[]).includes(value)) {
          this.applyPreference(value as ThemePreference);
        }
      })
      .catch(() => {
        // Storage read failure is non-fatal — fall back to 'system'.
      });

    // Listen for OS theme changes so the effective signal updates when the
    // user flips their OS scheme while the app is open.
    const win = (this.doc.defaultView ?? null) as (Window & typeof globalThis) | null;
    if (win !== null && typeof win.matchMedia === 'function') {
      const mql = win.matchMedia('(prefers-color-scheme: dark)');
      const listener = (e: MediaQueryListEvent): void => this.osDarkSignal.set(e.matches);
      // Modern browsers + Electron 33 only — no legacy `addListener` fallback.
      mql.addEventListener('change', listener);
    }
  }

  setPreference(next: ThemePreference): void {
    this.applyPreference(next);
    void this.storage.set(STORAGE_KEY_THEME, next).catch(() => {
      // Persist failure is non-fatal — the in-memory preference still
      // applies for this session.
    });
  }

  private applyPreference(next: ThemePreference): void {
    this.preferenceSignal.set(next);
    const root = this.doc.documentElement;
    if (next === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', next);
    }
  }

  private detectOsDark(): boolean {
    const win = (this.doc.defaultView ?? null) as (Window & typeof globalThis) | null;
    if (win === null || typeof win.matchMedia !== 'function') return false;
    return win.matchMedia('(prefers-color-scheme: dark)').matches;
  }
}
