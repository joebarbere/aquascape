// Composition-overlay preference service. Stage 5 F5.3.
//
// Holds three independent booleans driving the renderer's view-only
// composition guides (`OverlayOptions` from `@aquascape/rendering/
// renderer-api`):
//
//   - goldenRatio  — the four φ-derived guide lines.
//   - thirds       — the four rule-of-thirds guide lines.
//   - focalPoints  — the four golden-ratio intersection markers.
//
// Every flag defaults to `false` ("first-run shows a clean canvas") and
// each is persisted independently via StorageService under
// `aquascape.ui.overlays.<flag>` so the next session restores exactly the
// state the user left.
//
// Why a service signal rather than NgRx?
//   - Overlays are transient editor UI state — NOT persisted in `.aqua`.
//   - Exactly one consumer (the renderer call site in apps/web).
//   - Mirrors PreviewTimeService / ThemeService.
//
// Why explicit setters that write through to storage (no `effect()` /
// `firstRun` guard like the per-panel collapse pattern)?
//   - Writes only happen on user-driven toggles. There is no derived
//     state to mirror, so the effect + firstRun dance would be ceremony.
//   - Mirrors ThemeService.setPreference exactly.

import { Injectable, computed, inject, signal } from '@angular/core';

import type { OverlayOptions } from '@aquascape/rendering/renderer-api';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

/** StorageService key for the golden-ratio overlay flag. */
export const STORAGE_KEY_OVERLAY_GOLDEN = 'aquascape.ui.overlays.goldenRatio';
/** StorageService key for the rule-of-thirds overlay flag. */
export const STORAGE_KEY_OVERLAY_THIRDS = 'aquascape.ui.overlays.thirds';
/** StorageService key for the focal-points overlay flag. */
export const STORAGE_KEY_OVERLAY_FOCAL = 'aquascape.ui.overlays.focalPoints';

@Injectable({ providedIn: 'root' })
export class OverlayOptionsService {
  private readonly storage: StorageService = inject(STORAGE_SERVICE);

  private readonly goldenRatioSignal = signal<boolean>(false);
  private readonly thirdsSignal = signal<boolean>(false);
  private readonly focalPointsSignal = signal<boolean>(false);

  readonly goldenRatio = this.goldenRatioSignal.asReadonly();
  readonly thirds = this.thirdsSignal.asReadonly();
  readonly focalPoints = this.focalPointsSignal.asReadonly();

  /**
   * The full overlay-options shape the renderer consumes. Memoised so the
   * renderer call site can pass `overlays()` directly without rebuilding
   * an object every change-detection tick.
   */
  readonly overlays = computed<OverlayOptions>(() => ({
    goldenRatio: this.goldenRatioSignal(),
    thirds: this.thirdsSignal(),
    focalPoints: this.focalPointsSignal(),
  }));

  /** True iff any of the three overlays is currently enabled. */
  readonly anyEnabled = computed<boolean>(
    () => this.goldenRatioSignal() || this.thirdsSignal() || this.focalPointsSignal(),
  );

  constructor() {
    void this.hydrateFlag(STORAGE_KEY_OVERLAY_GOLDEN, this.goldenRatioSignal);
    void this.hydrateFlag(STORAGE_KEY_OVERLAY_THIRDS, this.thirdsSignal);
    void this.hydrateFlag(STORAGE_KEY_OVERLAY_FOCAL, this.focalPointsSignal);
  }

  setGoldenRatio(next: boolean): void {
    this.goldenRatioSignal.set(next);
    void this.storage.set(STORAGE_KEY_OVERLAY_GOLDEN, next).catch(() => {
      // Persist failure is non-fatal — the in-memory flag still applies.
    });
  }

  setThirds(next: boolean): void {
    this.thirdsSignal.set(next);
    void this.storage.set(STORAGE_KEY_OVERLAY_THIRDS, next).catch(() => {
      // Persist failure is non-fatal.
    });
  }

  setFocalPoints(next: boolean): void {
    this.focalPointsSignal.set(next);
    void this.storage.set(STORAGE_KEY_OVERLAY_FOCAL, next).catch(() => {
      // Persist failure is non-fatal.
    });
  }

  private async hydrateFlag(
    key: string,
    target: ReturnType<typeof signal<boolean>>,
  ): Promise<void> {
    try {
      const value = await this.storage.get<unknown>(key);
      if (typeof value === 'boolean') {
        target.set(value);
      }
    } catch {
      // Storage read failure is non-fatal — keep the default (false).
    }
  }
}
