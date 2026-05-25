// View-only "room wall" background service. Stage 5.x (deferred from the
// F5.3 overlay slice).
//
// Holds the four fields the renderer's `WallBackground` parameter consumes:
//
//   - `enabled`  — master toggle. False by default so first-run shows a
//     clean canvas.
//   - `color`    — solid hex fill (`#rrggbb` / `#rrggbbaa`).
//   - `widthMm`  — wall width in world millimetres. Centred on the tank's
//     x centre when painted.
//   - `heightMm` — wall height in world millimetres. Centred on the
//     tank's y centre when painted.
//
// All four are persisted independently via `StorageService` under
// `aquascape.ui.wall.*` so the next session restores exactly the state
// the user left. The wall is NOT serialised into `Scene` / `.aqua`: it's
// per-user / per-install UI state, which matches the "view-only" decision
// taken when the wall scope was deferred from the F5.3 overlay slice.
// When the broader "customise the entire room" work lands, the schema
// can promote these signals into the document at that point.
//
// Why a service signal rather than NgRx? Same reasons as
// `OverlayOptionsService` / `ViewportService` / `PreviewTimeService`:
// transient editor UI state, single renderer consumer, persistence
// handled directly via the platform-api `StorageService` token.
//
// Why explicit setters with write-through (no `effect()` / `firstRun`
// dance)? Writes only happen on user-driven changes — no derived state
// to mirror. Mirrors `OverlayOptionsService.setGoldenRatio` etc.

import { Injectable, computed, inject, signal } from '@angular/core';

import type { WallBackground } from '@aquascape/rendering/renderer-api';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

/** StorageService key for the wall's master toggle. */
export const STORAGE_KEY_WALL_ENABLED = 'aquascape.ui.wall.enabled';
/** StorageService key for the wall fill colour. */
export const STORAGE_KEY_WALL_COLOR = 'aquascape.ui.wall.color';
/** StorageService key for the wall width (mm). */
export const STORAGE_KEY_WALL_WIDTH_MM = 'aquascape.ui.wall.widthMm';
/** StorageService key for the wall height (mm). */
export const STORAGE_KEY_WALL_HEIGHT_MM = 'aquascape.ui.wall.heightMm';

/** Default wall colour — neutral dark slate that reads against any tank. */
export const DEFAULT_WALL_COLOR = '#2a2d35';
/** Default wall width in mm — comfortably beyond a typical 600 mm tank. */
export const DEFAULT_WALL_WIDTH_MM = 1200;
/** Default wall height in mm — taller than a typical 360 mm tank. */
export const DEFAULT_WALL_HEIGHT_MM = 600;

/** Min / max widths the UI accepts, clamped before being persisted. */
export const MIN_WALL_DIM_MM = 100;
export const MAX_WALL_DIM_MM = 10_000;

/** Reject anything that isn't `#rrggbb` or `#rrggbbaa`. */
const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

function clampDimMm(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WALL_WIDTH_MM;
  if (value < MIN_WALL_DIM_MM) return MIN_WALL_DIM_MM;
  if (value > MAX_WALL_DIM_MM) return MAX_WALL_DIM_MM;
  return value;
}

@Injectable({ providedIn: 'root' })
export class WallBackgroundService {
  private readonly storage: StorageService = inject(STORAGE_SERVICE);

  private readonly enabledSignal = signal<boolean>(false);
  private readonly colorSignal = signal<string>(DEFAULT_WALL_COLOR);
  private readonly widthMmSignal = signal<number>(DEFAULT_WALL_WIDTH_MM);
  private readonly heightMmSignal = signal<number>(DEFAULT_WALL_HEIGHT_MM);

  readonly enabled = this.enabledSignal.asReadonly();
  readonly color = this.colorSignal.asReadonly();
  readonly widthMm = this.widthMmSignal.asReadonly();
  readonly heightMm = this.heightMmSignal.asReadonly();

  /**
   * The full `WallBackground` shape the renderer consumes. Memoised so the
   * renderer call site can pass `wall()` directly each render without
   * rebuilding the object.
   */
  readonly wall = computed<WallBackground>(() => ({
    enabled: this.enabledSignal(),
    color: this.colorSignal(),
    widthMm: this.widthMmSignal(),
    heightMm: this.heightMmSignal(),
  }));

  constructor() {
    void this.hydrate();
  }

  setEnabled(next: boolean): void {
    this.enabledSignal.set(next);
    void this.storage.set(STORAGE_KEY_WALL_ENABLED, next).catch(() => {
      // Persist failure is non-fatal — the in-memory value still applies.
    });
  }

  setColor(next: string): void {
    if (!isValidColor(next)) return;
    this.colorSignal.set(next);
    void this.storage.set(STORAGE_KEY_WALL_COLOR, next).catch(() => {
      // Persist failure is non-fatal.
    });
  }

  setWidthMm(next: number): void {
    const clamped = clampDimMm(next);
    this.widthMmSignal.set(clamped);
    void this.storage.set(STORAGE_KEY_WALL_WIDTH_MM, clamped).catch(() => {
      // Persist failure is non-fatal.
    });
  }

  setHeightMm(next: number): void {
    const clamped = clampDimMm(next);
    this.heightMmSignal.set(clamped);
    void this.storage.set(STORAGE_KEY_WALL_HEIGHT_MM, clamped).catch(() => {
      // Persist failure is non-fatal.
    });
  }

  /**
   * Reset to the shipped defaults. Used by the panel's "Reset" affordance
   * (no UI for it yet) and the spec helpers.
   */
  reset(): void {
    this.setEnabled(false);
    this.setColor(DEFAULT_WALL_COLOR);
    this.setWidthMm(DEFAULT_WALL_WIDTH_MM);
    this.setHeightMm(DEFAULT_WALL_HEIGHT_MM);
  }

  private async hydrate(): Promise<void> {
    // Issue all four reads in parallel so the hydration resolves in a
    // single Promise.all microtask round instead of four sequential awaits
    // — keeps the test's `flushPromises` predictable and is one fewer
    // round-trip in production storage backends with measurable latency.
    try {
      const [enabled, color, widthMm, heightMm] = await Promise.all([
        this.storage.get<unknown>(STORAGE_KEY_WALL_ENABLED),
        this.storage.get<unknown>(STORAGE_KEY_WALL_COLOR),
        this.storage.get<unknown>(STORAGE_KEY_WALL_WIDTH_MM),
        this.storage.get<unknown>(STORAGE_KEY_WALL_HEIGHT_MM),
      ]);
      if (typeof enabled === 'boolean') this.enabledSignal.set(enabled);
      if (isValidColor(color)) this.colorSignal.set(color);
      if (typeof widthMm === 'number' && Number.isFinite(widthMm)) {
        this.widthMmSignal.set(clampDimMm(widthMm));
      }
      if (typeof heightMm === 'number' && Number.isFinite(heightMm)) {
        this.heightMmSignal.set(clampDimMm(heightMm));
      }
    } catch {
      // Storage read failure is non-fatal — defaults stay in place.
    }
  }
}
