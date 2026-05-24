// Cursor position service — v1 QoL.
//
// Lets the canvas host publish the current cursor's world-space position
// (mm) so the status bar can display it. Like the other small editor-UI
// services (PreviewTimeService, PlantDragService, ThemeService), this is
// transient state — never persisted in the `.aqua` document, never
// reduced by an NgRx feature. A single signal is the lightest cross-
// component bridge.
//
// `null` means "cursor is outside the canvas" — the status bar hides the
// readout in that case rather than showing stale coordinates.

import { Injectable, signal } from '@angular/core';

export interface CursorWorldPosition {
  /** Millimetres along +x (right). */
  readonly x: number;
  /** Millimetres along +y (up). */
  readonly y: number;
}

@Injectable({ providedIn: 'root' })
export class CursorPositionService {
  readonly position = signal<CursorWorldPosition | null>(null);

  set(p: CursorWorldPosition | null): void {
    this.position.set(p);
  }
}
