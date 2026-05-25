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
//
// Collapsible header (Task A): the panel gains a self-collapsing header bar
// at the top of the template. The user toggles via click / Enter / Space.
// Collapsed state is persisted via `StorageService` so the layout survives
// reloads. Independent per panel — each panel owns its own signal.
//
// Paging (Task B): the tile grid is paginated 8-per-page to keep the narrow
// sidebar scannable as the catalog grows past ~10 entries. The pager hides
// when the visible list fits on one page. Filter changes reset to page 1.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { HardscapeEntry } from '@aquascape/domain/catalog';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';

import { HardscapeDragService } from './hardscape-drag.service';

type CategoryFilter = 'all' | 'rock' | 'wood' | 'other';

/** Default page size for the tile grid. 2 cols × 4 rows reads well in a sidebar. */
export const HARDSCAPE_TOOL_PAGE_SIZE = 8;

/** StorageService key for the collapsed-state flag. */
export const HARDSCAPE_TOOL_COLLAPSED_KEY = 'aquascape.ui.collapsed.hardscape-tool';

@Component({
  selector: 'aquascape-hardscape-tool',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <section class="hardscape-tool" aria-labelledby="hardscape-tool-heading">
      <header class="panel-header">
        <button
          type="button"
          class="panel-header__toggle"
          [attr.aria-expanded]="!collapsed()"
          aria-controls="hardscape-tool-body"
          (click)="toggleCollapsed()"
        >
          <span
            class="panel-header__chevron"
            [class.panel-header__chevron--open]="!collapsed()"
            aria-hidden="true"
            >›</span
          >
          <h2 id="hardscape-tool-heading" class="panel-header__title">Hardscape</h2>
          <span class="panel-header__count" aria-label="entries">{{ totalCount() }}</span>
        </button>
      </header>

      <div id="hardscape-tool-body" class="hardscape-tool__body" [hidden]="collapsed()">
        <div class="hardscape-tool__filters" role="radiogroup" aria-label="Category filter">
          @for (cat of categories; track cat.value) {
            <button
              type="button"
              class="filter"
              role="radio"
              [class.active]="filter() === cat.value"
              [attr.aria-checked]="filter() === cat.value"
              (click)="onFilterChange(cat.value)"
            >
              {{ cat.label }}
            </button>
          }
        </div>

        <div class="hardscape-tool__grid">
          @for (entry of pageEntries(); track entry.id) {
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

        @if (totalPages() > 1) {
          <nav class="pager" aria-label="Hardscape pages">
            <button
              type="button"
              class="pager__btn"
              data-testid="hardscape-pager-prev"
              [disabled]="page() <= 1"
              (click)="prevPage()"
              aria-label="Previous page"
            >
              « Prev
            </button>
            <span class="pager__indicator" aria-live="polite">
              Page {{ page() }} of {{ totalPages() }}
            </span>
            <button
              type="button"
              class="pager__btn"
              data-testid="hardscape-pager-next"
              [disabled]="page() >= totalPages()"
              (click)="nextPage()"
              aria-label="Next page"
            >
              Next »
            </button>
          </nav>
        }
      </div>
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
      .panel-header {
        margin: 0 0 8px;
      }
      .panel-header__toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 4px 6px;
        background: transparent;
        color: inherit;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
        text-align: left;
      }
      .panel-header__toggle:hover,
      .panel-header__toggle:focus-visible {
        background: var(--surface-hover, #f0f0f0);
        outline: none;
        border-color: var(--border, #e0e0e0);
      }
      .panel-header__chevron {
        display: inline-block;
        font-size: 16px;
        line-height: 1;
        width: 12px;
        transition: transform 0.15s ease;
        transform: rotate(0deg);
      }
      .panel-header__chevron--open {
        transform: rotate(90deg);
      }
      @media (prefers-reduced-motion: reduce) {
        .panel-header__chevron {
          transition: none;
        }
      }
      .panel-header__title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        flex: 1;
      }
      .panel-header__count {
        color: var(--text-muted, #777);
        font-variant-numeric: tabular-nums;
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--surface, #f1f1f3);
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
        color: var(--text-muted, #777);
        font-style: italic;
      }
      .pager {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-top: 8px;
      }
      .pager__btn {
        background: transparent;
        color: inherit;
        border: 1px solid var(--border-strong, #ccc);
        border-radius: 4px;
        padding: 3px 8px;
        cursor: pointer;
        font: inherit;
      }
      .pager__btn:hover:not(:disabled),
      .pager__btn:focus-visible:not(:disabled) {
        background: var(--surface-hover, #f0f0f0);
        outline: none;
      }
      .pager__btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .pager__indicator {
        font-size: 11px;
        color: var(--text-muted, #555);
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class HardscapeToolComponent {
  private readonly dragService = inject(HardscapeDragService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly storage = inject<StorageService>(STORAGE_SERVICE);

  readonly categories: ReadonlyArray<{ value: CategoryFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'rock', label: 'Rock' },
    { value: 'wood', label: 'Wood' },
  ];

  readonly filter = signal<CategoryFilter>('all');

  /** Collapsed-panel state. Hydrated from StorageService on construct. */
  readonly collapsed = signal<boolean>(false);

  /** 1-indexed current page. Resets to 1 on filter change. */
  readonly page = signal<number>(1);

  /**
   * Page size as a writable signal so tests can shrink it without standing
   * up a massive synthetic catalog. Initialised to the public constant.
   */
  readonly pageSize = signal<number>(HARDSCAPE_TOOL_PAGE_SIZE);

  private readonly allEntries: ReadonlyArray<HardscapeEntry> = coreCatalog.byKind('hardscape');

  readonly totalCount = computed<number>(() => this.allEntries.length);

  readonly visibleEntries = computed<ReadonlyArray<HardscapeEntry>>(() => {
    const f = this.filter();
    if (f === 'all') return this.allEntries;
    return this.allEntries.filter((e) => e.category === f);
  });

  readonly totalPages = computed<number>(() => {
    const n = this.visibleEntries().length;
    if (n === 0) return 1;
    return Math.ceil(n / this.pageSize());
  });

  /** Slice of `visibleEntries` for the current page. */
  readonly pageEntries = computed<ReadonlyArray<HardscapeEntry>>(() => {
    const visible = this.visibleEntries();
    const start = (this.page() - 1) * this.pageSize();
    return visible.slice(start, start + this.pageSize());
  });

  constructor() {
    // Hydrate the collapsed state on init. Failures are non-fatal — the
    // panel just stays open and the user re-collapses if needed.
    this.storage
      .get<boolean>(HARDSCAPE_TOOL_COLLAPSED_KEY)
      .then((stored) => {
        if (typeof stored === 'boolean') {
          this.collapsed.set(stored);
        }
      })
      .catch(() => {
        // Best-effort.
      });

    // Persist collapsed state on every change. `effect()` runs an initial
    // pass too — `firstRun` skips that so we don't immediately write back
    // the seeded value before the storage hydrate resolves.
    let firstRun = true;
    effect(() => {
      const value = this.collapsed();
      if (firstRun) {
        firstRun = false;
        return;
      }
      this.storage.set(HARDSCAPE_TOOL_COLLAPSED_KEY, value).catch(() => {
        // Best-effort.
      });
    });

    // Clamp the current page when the visible list shrinks (e.g. after a
    // filter change that didn't go through `onFilterChange`, or future
    // catalog hot-swap). Reads totalPages to take the effect dependency.
    effect(() => {
      const max = this.totalPages();
      if (this.page() > max) {
        this.page.set(max);
      }
    });
  }

  /** SVG `points=` attribute for a hardscape silhouette. */
  svgPoints(entry: HardscapeEntry): string {
    return entry.silhouette.map((p) => `${p.x},${p.y}`).join(' ');
  }

  // ── Header ────────────────────────────────────────────────────────────

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  // ── Filter + pager ────────────────────────────────────────────────────

  onFilterChange(next: CategoryFilter): void {
    this.filter.set(next);
    // Reset paging on filter change so the user doesn't land on a stale
    // out-of-range page (or a perplexing "Page 3 of 1").
    this.page.set(1);
  }

  prevPage(): void {
    this.page.update((p) => Math.max(1, p - 1));
  }

  nextPage(): void {
    this.page.update((p) => Math.min(this.totalPages(), p + 1));
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
