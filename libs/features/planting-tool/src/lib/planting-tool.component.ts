// Plant palette side panel. Stage 4 F4.1 / F4.5.
//
// Filterable browser of `core` plant entries with pointer-events drag-out
// to the canvas. Mirrors the hardscape palette tile/grid layout for
// consistency — same drag-and-drop mechanic, different catalog kind.
//
// Filter UI: zone radios (All / Foreground / Midground / Background). The
// catalog ships ~2 plants per zone; the filter keeps the palette readable
// without scrolling.
//
// Scatter brush (F4.5): for v1 we ship "implicit carpet" — dropping a plant
// whose catalog entry carries `defaultDensity` produces a circular scatter
// patch centered on the drop point, with the catalog's default density.
// The user can later edit the patch outline through the inspector (future
// work). A freehand brush polygon UI is deferred to a follow-up; this
// implicit behaviour ships scatter rendering end-to-end with no extra UI.

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
import type { PlantEntry } from '@aquascape/domain/catalog';

import { PlantDragService } from './plant-drag.service';

type ZoneFilter = 'all' | 'foreground' | 'midground' | 'background';

@Component({
  selector: 'aquascape-planting-tool',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <section class="planting-tool" aria-labelledby="planting-tool-heading">
      <header class="planting-tool__header">
        <h2 id="planting-tool-heading">Plants</h2>
      </header>

      <div class="planting-tool__filters" role="radiogroup" aria-label="Zone filter">
        @for (z of zones; track z.value) {
          <button
            type="button"
            class="filter"
            role="radio"
            [class.active]="filter() === z.value"
            [attr.aria-checked]="filter() === z.value"
            (click)="filter.set(z.value)"
          >
            {{ z.label }}
          </button>
        }
      </div>

      <div class="planting-tool__grid">
        @for (entry of visibleEntries(); track entry.id) {
          <button
            type="button"
            class="tile"
            [class.carpet]="isCarpet(entry)"
            [attr.aria-label]="ariaLabel(entry)"
            [title]="tooltipFor(entry)"
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
            @if (isCarpet(entry)) {
              <span class="tile__badge" aria-hidden="true">carpet</span>
            }
          </button>
        }
      </div>

      @if (visibleEntries().length === 0) {
        <p class="planting-tool__empty">No plants match the filter.</p>
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
      .planting-tool__header h2 {
        margin: 0 0 8px;
        font-size: 14px;
        font-weight: 600;
      }
      .planting-tool__filters {
        display: flex;
        gap: 4px;
        margin-bottom: 8px;
        flex-wrap: wrap;
      }
      .filter {
        padding: 4px 10px;
        background: transparent;
        color: inherit;
        border: 1px solid var(--border-strong, #ccc);
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
      }
      .filter.active {
        background: var(--accent, #20232a);
        color: var(--accent-text, #fff);
        border-color: var(--accent, #20232a);
      }
      .planting-tool__grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
      }
      .tile {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 6px;
        background: var(--surface-2, #fff);
        color: inherit;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: 4px;
        cursor: grab;
        font: inherit;
        touch-action: none;
      }
      .tile:hover,
      .tile:focus-visible {
        background: var(--surface-hover, #f0f0f0);
        outline: none;
      }
      .tile:active {
        cursor: grabbing;
      }
      .tile.carpet {
        background: var(--carpet-bg, #f4faf2);
        border-color: var(--carpet-border, #c6e0ba);
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
      .tile__badge {
        position: absolute;
        top: 4px;
        right: 4px;
        background: var(--carpet-badge, #3a8050);
        color: #fff;
        font-size: 10px;
        line-height: 1;
        padding: 2px 4px;
        border-radius: 3px;
      }
      .planting-tool__empty {
        margin: 8px 0 0;
        color: var(--text-muted, #777);
        font-style: italic;
      }
    `,
  ],
})
export class PlantingToolComponent {
  private readonly dragService = inject(PlantDragService);
  private readonly destroyRef = inject(DestroyRef);

  readonly zones: ReadonlyArray<{ value: ZoneFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'foreground', label: 'Foreground' },
    { value: 'midground', label: 'Midground' },
    { value: 'background', label: 'Background' },
  ];

  readonly filter = signal<ZoneFilter>('all');

  private readonly allEntries: ReadonlyArray<PlantEntry> = coreCatalog.byKind('plant');

  readonly visibleEntries = computed<ReadonlyArray<PlantEntry>>(() => {
    const f = this.filter();
    if (f === 'all') return this.allEntries;
    return this.allEntries.filter((e) => e.zone === f);
  });

  /** SVG `points=` attribute for a plant silhouette in normalized space. */
  svgPoints(entry: PlantEntry): string {
    return entry.silhouette.map((p) => `${p.x},${p.y}`).join(' ');
  }

  /** A plant is a "carpet" candidate when the catalog provides a defaultDensity. */
  isCarpet(entry: PlantEntry): boolean {
    return entry.defaultDensity !== undefined && entry.defaultDensity > 0;
  }

  ariaLabel(entry: PlantEntry): string {
    return this.isCarpet(entry)
      ? `Drag ${entry.name} onto the canvas to plant a carpet`
      : `Drag ${entry.name} onto the canvas`;
  }

  tooltipFor(entry: PlantEntry): string {
    const light = `${entry.lighting} light`;
    const co2 = `${entry.co2} CO₂`;
    const diff = entry.difficulty;
    return `${entry.name} — ${light}, ${co2}, ${diff}`;
  }

  // ── Drag handlers ──────────────────────────────────────────────────────

  onPointerDown(event: PointerEvent, entry: PlantEntry): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.dragService.start(entry, event.clientX, event.clientY);
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
    this.destroyRef.onDestroy(() => {
      cleanup();
      this.dragService.cancel();
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.dragService.cancel();
  }
}
