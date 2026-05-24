// Hardscape palette side panel. Stage 3 F3.1 / F3.2.
//
// Filterable browser of `core` hardscape entries with pointer-events
// drag-out to the canvas. Each tile renders its silhouette as an inline
// SVG so the thumbnail looks like the rendered shape.
//
// Filter UI: a row of category radios (All / Rock / Wood). Future stages
// can add subcategory pills.
//
// Drag mechanism:
//  - pointerdown on a tile starts the drag via `HardscapeDragService.start`.
//  - pointermove / pointerup are bound at the document level (one listener,
//    not per-tile) so the user can drag outside the panel without losing
//    the gesture. setPointerCapture isn't used — document-level listeners
//    handle the cross-element case naturally.
//  - Escape cancels.
//
// The ghost preview is rendered by the canvas (apps/web), not here — the
// service hands the canvas the entry + cursor coords; the canvas decides
// what to paint. That keeps the palette free of canvas geometry.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { HardscapeEntry } from '@aquascape/domain/catalog';

import { HardscapeDragService } from './hardscape-drag.service';

type CategoryFilter = 'all' | 'rock' | 'wood' | 'other';

@Component({
  selector: 'aquascape-hardscape-tool',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <section class="hardscape-tool" aria-labelledby="hardscape-tool-heading">
      <header class="hardscape-tool__header">
        <h2 id="hardscape-tool-heading">Hardscape</h2>
      </header>

      <div class="hardscape-tool__filters" role="radiogroup" aria-label="Category filter">
        @for (cat of categories; track cat.value) {
          <button
            type="button"
            class="filter"
            role="radio"
            [class.active]="filter() === cat.value"
            [attr.aria-checked]="filter() === cat.value"
            (click)="filter.set(cat.value)"
          >
            {{ cat.label }}
          </button>
        }
      </div>

      <div class="hardscape-tool__grid">
        @for (entry of visibleEntries(); track entry.id) {
          <button
            type="button"
            class="tile"
            [attr.aria-label]="'Drag ' + entry.name + ' onto the canvas'"
            (pointerdown)="onPointerDown($event, entry)"
          >
            <svg
              class="tile__silhouette"
              viewBox="-1.1 -1.1 2.2 2.2"
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
            >
              <polygon
                [attr.points]="svgPoints(entry)"
                [attr.fill]="entry.color"
                stroke="#222"
                stroke-width="0.04"
              />
            </svg>
            <span class="tile__name">{{ entry.name }}</span>
          </button>
        }
      </div>

      @if (visibleEntries().length === 0) {
        <p class="hardscape-tool__empty">No hardscape items match the filter.</p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 12px;
        font-family: system-ui, sans-serif;
        font-size: 13px;
      }
      .hardscape-tool__header h2 {
        margin: 0 0 8px;
        font-size: 14px;
        font-weight: 600;
      }
      .hardscape-tool__filters {
        display: flex;
        gap: 4px;
        margin-bottom: 8px;
      }
      .filter {
        padding: 4px 10px;
        background: transparent;
        color: inherit;
        border: 1px solid #ccc;
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
      }
      .filter.active {
        background: #20232a;
        color: #fff;
        border-color: #20232a;
      }
      .hardscape-tool__grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
      }
      .tile {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 6px;
        background: #fff;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        cursor: grab;
        font: inherit;
        touch-action: none;
      }
      .tile:active {
        cursor: grabbing;
      }
      .tile__silhouette {
        width: 64px;
        height: 64px;
      }
      .tile__name {
        margin-top: 4px;
        font-size: 11px;
        text-align: center;
        line-height: 1.2;
      }
      .hardscape-tool__empty {
        margin: 8px 0 0;
        color: #777;
        font-style: italic;
      }
    `,
  ],
})
export class HardscapeToolComponent {
  private readonly dragService = inject(HardscapeDragService);
  private readonly destroyRef = inject(DestroyRef);

  readonly categories: ReadonlyArray<{ value: CategoryFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'rock', label: 'Rock' },
    { value: 'wood', label: 'Wood' },
  ];

  readonly filter = signal<CategoryFilter>('all');

  private readonly allEntries: ReadonlyArray<HardscapeEntry> = coreCatalog.byKind('hardscape');

  readonly visibleEntries = computed<ReadonlyArray<HardscapeEntry>>(() => {
    const f = this.filter();
    if (f === 'all') return this.allEntries;
    return this.allEntries.filter((e) => e.category === f);
  });

  /** SVG `points=` attribute for a hardscape silhouette. */
  svgPoints(entry: HardscapeEntry): string {
    return entry.silhouette.map((p) => `${p.x},${p.y}`).join(' ');
  }

  // ── Drag handlers ──────────────────────────────────────────────────────

  onPointerDown(event: PointerEvent, entry: HardscapeEntry): void {
    // Only react to primary pointer. Prevent text-selection cursor on drag.
    if (event.button !== 0) return;
    event.preventDefault();
    this.dragService.start(entry, event.clientX, event.clientY);
    // Bind document-level move / up listeners so the user can drag off-panel.
    const onMove = (e: PointerEvent): void => {
      this.dragService.update(e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent): void => {
      cleanup();
      this.dragService.drop(e.clientX, e.clientY);
    };
    const cleanup = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    // Ensure cleanup on destroy if the drag is still in flight.
    this.destroyRef.onDestroy(() => {
      cleanup();
      this.dragService.cancel();
    });
  }

  /** Escape cancels an in-flight drag. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.dragService.cancel();
  }
}
