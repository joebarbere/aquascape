// Cross-component coordination for the plant palette → canvas drag-and-drop.
// Stage 4 F4.1.
//
// Mirrors the HardscapeDragService pattern. The palette starts a drag on
// pointerdown; the canvas reads `active` to render a ghost preview, and
// subscribes to `dropped$` for the single fire-once placement event.
//
// One important difference from hardscape: a dropped plant CAN be a carpet
// patch (`PlantEntry.defaultDensity` set), in which case the canvas
// dispatches a scatter-shaped `AddObject`. The catalog entry is the only
// thing the service needs to surface — the canvas owns the patch-vs-single
// decision, which keeps this lib free of scene-model knowledge.

import { Injectable, signal } from '@angular/core';
import { Subject, type Observable } from 'rxjs';

import type { PlantEntry } from '@aquascape/domain/catalog';

export interface PlantDragSnapshot {
  readonly entry: PlantEntry;
  readonly clientX: number;
  readonly clientY: number;
}

export interface PlantDropEvent {
  readonly entry: PlantEntry;
  readonly clientX: number;
  readonly clientY: number;
}

@Injectable({ providedIn: 'root' })
export class PlantDragService {
  private readonly activeSignal = signal<PlantDragSnapshot | null>(null);
  readonly active = this.activeSignal.asReadonly();

  private readonly droppedSubject = new Subject<PlantDropEvent>();
  readonly dropped$: Observable<PlantDropEvent> = this.droppedSubject.asObservable();

  start(entry: PlantEntry, clientX: number, clientY: number): void {
    this.activeSignal.set({ entry, clientX, clientY });
  }

  update(clientX: number, clientY: number): void {
    const current = this.activeSignal();
    if (current === null) return;
    this.activeSignal.set({ ...current, clientX, clientY });
  }

  cancel(): void {
    this.activeSignal.set(null);
  }

  drop(clientX: number, clientY: number): void {
    const current = this.activeSignal();
    if (current === null) return;
    this.activeSignal.set(null);
    this.droppedSubject.next({ entry: current.entry, clientX, clientY });
  }
}
