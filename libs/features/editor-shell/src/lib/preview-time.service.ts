// Preview-age service for the time-slider gesture. Plan Stage 4 F4.4.
//
// Holds a single writable signal: the "preview week" the renderer should
// paint plants at. `null` (the default) means "use the document's stored
// `growth.ageWeeks` per plant" — i.e., the slider is at "Now" or untouched.
// Any number is passed straight to the renderer's `previewAgeWeeks`
// parameter and to scene-model growth math.
//
// Why a service signal rather than NgRx?
//  - The value is transient editor UI state (NOT persisted in `.aqua` docs).
//  - There's exactly one slider and one renderer reading it; the indirection
//    of an action + reducer would just be ceremony.
//  - Mirrors the PlantDragService / HardscapeDragService pattern — small,
//    cross-component, root-provided.
//
// Range conventions:
//  - `null`           → live mode, render with each plant's stored ageWeeks.
//  - any non-negative → override every plant to this preview age.

import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PreviewTimeService {
  /** Slider value in weeks, or `null` when the slider is in "Now" mode. */
  readonly previewAgeWeeks = signal<number | null>(null);

  /**
   * Convenience setter that clamps non-finite / negative inputs to `null`
   * so a stray UI event can't poison the renderer.
   */
  setPreviewAge(value: number | null): void {
    if (value === null) {
      this.previewAgeWeeks.set(null);
      return;
    }
    if (!Number.isFinite(value) || value < 0) {
      this.previewAgeWeeks.set(null);
      return;
    }
    this.previewAgeWeeks.set(value);
  }

  reset(): void {
    this.previewAgeWeeks.set(null);
  }
}
