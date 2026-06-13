// Cross-component coordination for the decorations palette → canvas
// drag-and-drop. Mirrors `HardscapeDragService` (the panel contract for
// palette drags), typed over `DecorEntry`.
//
// The palette starts a drag with `start(entry, clientX, clientY)`; pointer-
// move calls `update(clientX, clientY)` so the canvas can render a ghost
// preview that follows the cursor. Pointer-up on the canvas calls `drop`:
// if a drag is active, the canvas gets the entry + final cursor coords and
// converts to world coords + dispatches AddObject.
//
// State lives in two signals — `active` (the dragged entry + cursor) and a
// `dropped$` event observable that the canvas subscribes to. Signals are
// fine for the drag lifecycle; the drop is event-shaped so a single drop
// fires once even if both palette and canvas subscribe.
//
// `providedIn: 'root'` so palette + canvas (different feature libs) share
// the same instance via Angular DI.

import { Injectable, signal } from '@angular/core';
import { Subject, type Observable } from 'rxjs';

import type { DecorEntry } from '@aquascape/domain/catalog';

export interface DecorDragSnapshot {
  readonly entry: DecorEntry;
  readonly clientX: number;
  readonly clientY: number;
}

export interface DecorDropEvent {
  readonly entry: DecorEntry;
  readonly clientX: number;
  readonly clientY: number;
}

@Injectable({ providedIn: 'root' })
export class DecorDragService {
  private readonly activeSignal = signal<DecorDragSnapshot | null>(null);

  /** Readonly signal of the in-flight drag, or `null` when idle. */
  readonly active = this.activeSignal.asReadonly();

  private readonly droppedSubject = new Subject<DecorDropEvent>();
  /** One emission per successful drop. The canvas subscribes here. */
  readonly dropped$: Observable<DecorDropEvent> = this.droppedSubject.asObservable();

  /** Begin a drag. Called by the palette tile on pointer-down. */
  start(entry: DecorEntry, clientX: number, clientY: number): void {
    this.activeSignal.set({ entry, clientX, clientY });
  }

  /** Update the cursor position for ghost rendering. */
  update(clientX: number, clientY: number): void {
    const current = this.activeSignal();
    if (current === null) return;
    this.activeSignal.set({ ...current, clientX, clientY });
  }

  /** Cancel without dropping (Escape, dragstart on a non-canvas element). */
  cancel(): void {
    this.activeSignal.set(null);
  }

  /**
   * Finalize a drag at `(clientX, clientY)`. Emits a single `dropped$`
   * event for the listener that hits first. The canvas component owns the
   * "is this point inside the canvas?" check; calling this from elsewhere
   * is the same as `cancel()` from the service's perspective.
   */
  drop(clientX: number, clientY: number): void {
    const current = this.activeSignal();
    if (current === null) return;
    this.activeSignal.set(null);
    this.droppedSubject.next({ entry: current.entry, clientX, clientY });
  }
}
