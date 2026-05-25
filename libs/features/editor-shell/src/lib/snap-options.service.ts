// Snap-options service. Stage 5 F5.4.
//
// Holds the user's snap preferences:
//   - `enabled`        master toggle; false short-circuits every snap.
//   - `toGrid`         snap to multiples of `gridSizeMm`.
//   - `toGuides`       snap to golden-ratio + thirds + focal-point lines.
//   - `toObjects`      snap to other objects' centre positions.
//   - `gridSizeMm`     grid spacing (1…100 mm).
//   - `toleranceCssPx` how close (in CSS px) before a snap engages.
//
// Persisted independently via `StorageService` under `aquascape.ui.snap.*`.
// Defaults: snap on, all three kinds on, grid 10 mm, tolerance 8 CSS px —
// matches the most common dev preference and the renderer's grid spacing.
//
// Same patterns as `OverlayOptionsService` / `WallBackgroundService`:
//   * root-provided signals
//   * setters write through immediately (no `effect()` / firstRun dance)
//   * `Promise.all` hydration so tests can flush deterministically

import { Injectable, computed, inject, signal } from '@angular/core';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  DEFAULT_GRID_SIZE_MM,
  DEFAULT_TOLERANCE_CSS_PX,
  MAX_GRID_SIZE_MM,
  MAX_TOLERANCE_CSS_PX,
  MIN_GRID_SIZE_MM,
  MIN_TOLERANCE_CSS_PX,
} from './snap-math';

export const STORAGE_KEY_SNAP_ENABLED = 'aquascape.ui.snap.enabled';
export const STORAGE_KEY_SNAP_TO_GRID = 'aquascape.ui.snap.toGrid';
export const STORAGE_KEY_SNAP_TO_GUIDES = 'aquascape.ui.snap.toGuides';
export const STORAGE_KEY_SNAP_TO_OBJECTS = 'aquascape.ui.snap.toObjects';
export const STORAGE_KEY_SNAP_GRID_SIZE_MM = 'aquascape.ui.snap.gridSizeMm';
export const STORAGE_KEY_SNAP_TOLERANCE_CSS_PX = 'aquascape.ui.snap.toleranceCssPx';

/**
 * Snap snapshot — the read-only options the host pipes into `snap-math`
 * during drag math. Re-built whenever any signal flips.
 */
export interface SnapOptions {
  readonly enabled: boolean;
  readonly toGrid: boolean;
  readonly toGuides: boolean;
  readonly toObjects: boolean;
  readonly gridSizeMm: number;
  readonly toleranceCssPx: number;
}

function clampGridSize(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_GRID_SIZE_MM;
  if (v < MIN_GRID_SIZE_MM) return MIN_GRID_SIZE_MM;
  if (v > MAX_GRID_SIZE_MM) return MAX_GRID_SIZE_MM;
  return v;
}
function clampTolerance(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_TOLERANCE_CSS_PX;
  if (v < MIN_TOLERANCE_CSS_PX) return MIN_TOLERANCE_CSS_PX;
  if (v > MAX_TOLERANCE_CSS_PX) return MAX_TOLERANCE_CSS_PX;
  return v;
}

@Injectable({ providedIn: 'root' })
export class SnapOptionsService {
  private readonly storage: StorageService = inject(STORAGE_SERVICE);

  private readonly enabledSignal = signal<boolean>(true);
  private readonly toGridSignal = signal<boolean>(true);
  private readonly toGuidesSignal = signal<boolean>(true);
  private readonly toObjectsSignal = signal<boolean>(true);
  private readonly gridSizeMmSignal = signal<number>(DEFAULT_GRID_SIZE_MM);
  private readonly toleranceCssPxSignal = signal<number>(DEFAULT_TOLERANCE_CSS_PX);

  readonly enabled = this.enabledSignal.asReadonly();
  readonly toGrid = this.toGridSignal.asReadonly();
  readonly toGuides = this.toGuidesSignal.asReadonly();
  readonly toObjects = this.toObjectsSignal.asReadonly();
  readonly gridSizeMm = this.gridSizeMmSignal.asReadonly();
  readonly toleranceCssPx = this.toleranceCssPxSignal.asReadonly();

  /** Snapshot used by the drag math; rebuilt on any signal change. */
  readonly options = computed<SnapOptions>(() => ({
    enabled: this.enabledSignal(),
    toGrid: this.toGridSignal(),
    toGuides: this.toGuidesSignal(),
    toObjects: this.toObjectsSignal(),
    gridSizeMm: this.gridSizeMmSignal(),
    toleranceCssPx: this.toleranceCssPxSignal(),
  }));

  /** Count of active snap kinds (0–3); drives the panel badge. */
  readonly activeKindCount = computed<number>(() => {
    if (!this.enabledSignal()) return 0;
    return (
      (this.toGridSignal() ? 1 : 0) +
      (this.toGuidesSignal() ? 1 : 0) +
      (this.toObjectsSignal() ? 1 : 0)
    );
  });

  constructor() {
    void this.hydrate();
  }

  setEnabled(next: boolean): void {
    this.enabledSignal.set(next);
    void this.storage.set(STORAGE_KEY_SNAP_ENABLED, next).catch(() => {
      // Persist failure is non-fatal.
    });
  }
  setToGrid(next: boolean): void {
    this.toGridSignal.set(next);
    void this.storage.set(STORAGE_KEY_SNAP_TO_GRID, next).catch(() => {
      // Persist failure is non-fatal.
    });
  }
  setToGuides(next: boolean): void {
    this.toGuidesSignal.set(next);
    void this.storage.set(STORAGE_KEY_SNAP_TO_GUIDES, next).catch(() => {
      // Persist failure is non-fatal.
    });
  }
  setToObjects(next: boolean): void {
    this.toObjectsSignal.set(next);
    void this.storage.set(STORAGE_KEY_SNAP_TO_OBJECTS, next).catch(() => {
      // Persist failure is non-fatal.
    });
  }
  setGridSizeMm(next: number): void {
    const c = clampGridSize(next);
    this.gridSizeMmSignal.set(c);
    void this.storage.set(STORAGE_KEY_SNAP_GRID_SIZE_MM, c).catch(() => {
      // Persist failure is non-fatal.
    });
  }
  setToleranceCssPx(next: number): void {
    const c = clampTolerance(next);
    this.toleranceCssPxSignal.set(c);
    void this.storage.set(STORAGE_KEY_SNAP_TOLERANCE_CSS_PX, c).catch(() => {
      // Persist failure is non-fatal.
    });
  }

  private async hydrate(): Promise<void> {
    try {
      const [enabled, toGrid, toGuides, toObjects, grid, tol] = await Promise.all([
        this.storage.get<unknown>(STORAGE_KEY_SNAP_ENABLED),
        this.storage.get<unknown>(STORAGE_KEY_SNAP_TO_GRID),
        this.storage.get<unknown>(STORAGE_KEY_SNAP_TO_GUIDES),
        this.storage.get<unknown>(STORAGE_KEY_SNAP_TO_OBJECTS),
        this.storage.get<unknown>(STORAGE_KEY_SNAP_GRID_SIZE_MM),
        this.storage.get<unknown>(STORAGE_KEY_SNAP_TOLERANCE_CSS_PX),
      ]);
      if (typeof enabled === 'boolean') this.enabledSignal.set(enabled);
      if (typeof toGrid === 'boolean') this.toGridSignal.set(toGrid);
      if (typeof toGuides === 'boolean') this.toGuidesSignal.set(toGuides);
      if (typeof toObjects === 'boolean') this.toObjectsSignal.set(toObjects);
      if (typeof grid === 'number' && Number.isFinite(grid)) {
        this.gridSizeMmSignal.set(clampGridSize(grid));
      }
      if (typeof tol === 'number' && Number.isFinite(tol)) {
        this.toleranceCssPxSignal.set(clampTolerance(tol));
      }
    } catch {
      // Storage failure non-fatal — defaults stay.
    }
  }
}
