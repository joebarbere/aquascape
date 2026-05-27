// Livestock inventory side panel. Stage 7 F7.1.
//
// Two stacked sections inside one collapsible panel:
//
//   1. Browser — paginated tile grid of `coreCatalog.byKind('livestock')`
//      entries, filtered by group chip (all / fish / shrimp / snail). Click
//      a tile to dispatch `addLivestockEntry({ entry: { id, ref, quantity:1 } })`.
//      No drag-out: livestock is *inventory*, not canvas placement.
//
//   2. Inventory list — current `selectLivestock()` results as rows with
//      swatch + species name + `−` / quantity / `+` / `×` controls. Each
//      `±` dispatches `updateLivestockQuantity`; `×` dispatches
//      `removeLivestockEntry`. Quantity floor is 1; clicking `−` at qty 1
//      is a no-op (do not dispatch a rejected command).
//
// The component is intentionally named `LivestockToolComponent` even though
// the feature lib's directory is `livestock-equipment` — F7.3 will add a
// sibling `EquipmentToolComponent` in the same lib.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { LivestockEntry as CatalogLivestockEntry } from '@aquascape/domain/catalog';
import {
  addLivestockEntry,
  removeLivestockEntry,
  updateLivestockQuantity,
} from '@aquascape/domain/scene-model';
import type { LivestockEntry } from '@aquascape/domain/scene-model';
import type { StockingWarning } from '@aquascape/domain/stocking';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';
import {
  LivestockPulseActions,
  SceneActions,
  selectLivestock,
  selectStockingWarnings,
} from '@aquascape/state';

type GroupFilter = 'all' | 'fish' | 'shrimp' | 'snail';

/** Default page size for the browser tile grid. Matches planting-tool. */
export const LIVESTOCK_TOOL_PAGE_SIZE = 8;

/** StorageService key for the collapsed-state flag. */
export const LIVESTOCK_TOOL_COLLAPSED_KEY = 'aquascape.ui.collapsed.livestock-equipment';

/** Row record used by the inventory list — joins the scene entry to its catalog data. */
interface InventoryRow {
  entry: LivestockEntry;
  /** Catalog entry resolved from `entry.ref`, or null when the manifest is missing. */
  catalog: CatalogLivestockEntry | null;
  /** Display name shown in the row + the row's accessible label. */
  displayName: string;
}

@Component({
  selector: 'aquascape-livestock-tool',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <section class="livestock-tool" aria-labelledby="livestock-tool-heading">
      <header class="panel-header">
        <button
          type="button"
          class="panel-header__toggle"
          [attr.aria-expanded]="!collapsed()"
          aria-controls="livestock-tool-body"
          (click)="toggleCollapsed()"
        >
          <span
            class="panel-header__chevron"
            [class.panel-header__chevron--open]="!collapsed()"
            aria-hidden="true"
            >›</span
          >
          <h2 id="livestock-tool-heading" class="panel-header__title">Livestock</h2>
          <span class="panel-header__count" aria-label="entries">{{ inventoryCount() }}</span>
        </button>
      </header>

      <div id="livestock-tool-body" class="livestock-tool__body" [hidden]="collapsed()">
        <!-- ── Browser ─────────────────────────────────────────────────── -->
        <div class="livestock-tool__filters" role="radiogroup" aria-label="Group filter">
          @for (g of groups; track g.value) {
            <button
              type="button"
              class="filter"
              role="radio"
              [class.active]="filter() === g.value"
              [attr.aria-checked]="filter() === g.value"
              (click)="onFilterChange(g.value)"
            >
              {{ g.label }}
            </button>
          }
        </div>

        <div class="livestock-tool__grid">
          @for (entry of pageEntries(); track entry.id) {
            <button
              type="button"
              class="tile"
              [attr.aria-label]="'Add ' + entry.name + ' to livestock'"
              [title]="tooltipFor(entry)"
              (click)="onAdd(entry)"
            >
              <span
                class="tile__swatch"
                [style.background]="entry.color"
                aria-hidden="true"
              ></span>
              <span class="tile__name">{{ entry.name }}</span>
              <span class="tile__group" aria-hidden="true">{{ entry.group }}</span>
            </button>
          }
        </div>

        @if (visibleEntries().length === 0) {
          <p class="livestock-tool__empty">No species match the filter.</p>
        }

        @if (totalPages() > 1) {
          <nav class="pager" aria-label="Livestock pages">
            <button
              type="button"
              class="pager__btn"
              data-testid="livestock-pager-prev"
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
              data-testid="livestock-pager-next"
              [disabled]="page() >= totalPages()"
              (click)="nextPage()"
              aria-label="Next page"
            >
              Next »
            </button>
          </nav>
        }

        <!-- ── Inventory list ──────────────────────────────────────────── -->
        <div class="livestock-tool__inventory-header">
          <h3 class="livestock-tool__subheading">Inventory</h3>
          @if (canFeed()) {
            <button
              type="button"
              class="feed-btn"
              data-testid="livestock-feed-tank"
              aria-label="Feed tank — drops food sprites at the surface for fish to eat"
              (click)="onFeedTank()"
            >
              Feed tank
            </button>
          }
        </div>
        @if (inventoryRows().length === 0) {
          <p class="livestock-tool__empty">
            No livestock yet. Pick a species above to start planning.
          </p>
        } @else {
          <ul class="livestock-tool__list" role="list">
            @for (row of inventoryRows(); track row.entry.id) {
              <li class="inv-row" role="listitem" [attr.aria-label]="row.displayName">
                <span
                  class="inv-row__swatch"
                  [style.background]="row.catalog?.color ?? '#888'"
                  aria-hidden="true"
                ></span>
                <span class="inv-row__name">{{ row.displayName }}</span>
                <div class="inv-row__qty" role="group" aria-label="Quantity">
                  <button
                    type="button"
                    class="qty-btn"
                    aria-label="Decrease quantity"
                    [disabled]="row.entry.quantity <= 1"
                    (click)="onDecrease(row.entry)"
                  >
                    −
                  </button>
                  <span class="qty-value" aria-live="polite">{{ row.entry.quantity }}</span>
                  <button
                    type="button"
                    class="qty-btn"
                    aria-label="Increase quantity"
                    (click)="onIncrease(row.entry)"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  class="inv-row__remove"
                  aria-label="Remove from livestock list"
                  (click)="onRemove(row.entry)"
                >
                  ×
                </button>
              </li>
            }
          </ul>
        }

        <!-- ── Stocking guidance (F7.2) ────────────────────────────────── -->
        @if (warnings().length > 0) {
          <h3 class="livestock-tool__subheading">Stocking guidance</h3>
          <ul class="livestock-tool__warnings" role="list">
            @for (w of warnings(); track w.id) {
              <li
                class="warning"
                [class.warning--error]="w.severity === 'error'"
                [class.warning--warning]="w.severity === 'warning'"
                [class.warning--info]="w.severity === 'info'"
                [attr.role]="w.severity === 'error' ? 'alert' : 'status'"
                [attr.aria-label]="w.severity + ': ' + w.message"
              >
                <button
                  type="button"
                  class="warning__toggle"
                  [attr.aria-expanded]="isExpanded(w.id)"
                  [attr.aria-controls]="'warning-' + w.id + '-explanation'"
                  (click)="toggleExpanded(w.id)"
                >
                  <span class="warning__icon" aria-hidden="true">{{
                    severityIcon(w.severity)
                  }}</span>
                  <span class="warning__message">{{ w.message }}</span>
                  <span
                    class="warning__chevron"
                    [class.warning__chevron--open]="isExpanded(w.id)"
                    aria-hidden="true"
                    >›</span
                  >
                </button>
                @if (isExpanded(w.id)) {
                  <p
                    class="warning__explanation"
                    [id]="'warning-' + w.id + '-explanation'"
                  >
                    {{ w.explanation }}
                  </p>
                }
              </li>
            }
          </ul>
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
      .livestock-tool__filters {
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
      .livestock-tool__grid {
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
        cursor: pointer;
        font: inherit;
      }
      .tile:hover,
      .tile:focus-visible {
        background: var(--surface-hover, #f0f0f0);
        outline: none;
      }
      .tile__swatch {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 1px solid rgba(0, 0, 0, 0.15);
      }
      .tile__name {
        margin-top: 4px;
        font-size: 11px;
        text-align: center;
        line-height: 1.2;
      }
      .tile__group {
        margin-top: 2px;
        font-size: 10px;
        color: var(--text-muted, #777);
        text-transform: capitalize;
      }
      .livestock-tool__empty {
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
      .livestock-tool__subheading {
        margin: 12px 0 6px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-muted, #555);
      }
      .livestock-tool__inventory-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .livestock-tool__inventory-header .livestock-tool__subheading {
        flex: 1;
      }
      .feed-btn {
        padding: 4px 10px;
        background: var(--accent, #20232a);
        color: var(--accent-text, #fff);
        border: 1px solid var(--accent, #20232a);
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
        font-size: 11px;
      }
      .feed-btn:hover,
      .feed-btn:focus-visible {
        filter: brightness(1.1);
        outline: none;
      }
      .livestock-tool__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .inv-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: 4px;
        background: var(--surface-2, #fff);
      }
      .inv-row__swatch {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 1px solid rgba(0, 0, 0, 0.15);
        flex-shrink: 0;
      }
      .inv-row__name {
        flex: 1;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .inv-row__qty {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .qty-btn {
        width: 20px;
        height: 20px;
        background: transparent;
        color: inherit;
        border: 1px solid var(--border-strong, #ccc);
        border-radius: 3px;
        cursor: pointer;
        font: inherit;
        line-height: 1;
        padding: 0;
      }
      .qty-btn:hover:not(:disabled),
      .qty-btn:focus-visible:not(:disabled) {
        background: var(--surface-hover, #f0f0f0);
        outline: none;
      }
      .qty-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .qty-value {
        min-width: 18px;
        text-align: center;
        font-variant-numeric: tabular-nums;
        font-size: 12px;
      }
      .inv-row__remove {
        width: 20px;
        height: 20px;
        background: transparent;
        color: var(--danger, #b94a4a);
        border: 1px solid transparent;
        border-radius: 3px;
        cursor: pointer;
        font: inherit;
        line-height: 1;
        padding: 0;
      }
      .inv-row__remove:hover,
      .inv-row__remove:focus-visible {
        background: var(--danger, #b94a4a);
        color: #fff;
        outline: none;
      }
      .livestock-tool__warnings {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .warning {
        border: 1px solid var(--border, #e0e0e0);
        border-left-width: 3px;
        border-radius: 4px;
        background: var(--surface-2, #fff);
        overflow: hidden;
      }
      .warning--error {
        border-left-color: var(--danger, #b94a4a);
      }
      .warning--warning {
        border-left-color: var(--accent-warning, #c98a2b);
      }
      .warning--info {
        border-left-color: var(--accent-info, #4a7fb9);
      }
      .warning__toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 6px 8px;
        background: transparent;
        color: inherit;
        border: none;
        cursor: pointer;
        font: inherit;
        text-align: left;
      }
      .warning__toggle:hover,
      .warning__toggle:focus-visible {
        background: var(--surface-hover, #f0f0f0);
        outline: none;
      }
      .warning__icon {
        font-size: 13px;
        line-height: 1;
        flex-shrink: 0;
      }
      .warning--error .warning__icon {
        color: var(--danger, #b94a4a);
      }
      .warning--warning .warning__icon {
        color: var(--accent-warning, #c98a2b);
      }
      .warning--info .warning__icon {
        color: var(--accent-info, #4a7fb9);
      }
      .warning__message {
        flex: 1;
        font-size: 12px;
      }
      .warning__chevron {
        display: inline-block;
        font-size: 14px;
        line-height: 1;
        width: 12px;
        color: var(--text-muted, #777);
        transition: transform 0.15s ease;
        transform: rotate(0deg);
      }
      .warning__chevron--open {
        transform: rotate(90deg);
      }
      @media (prefers-reduced-motion: reduce) {
        .warning__chevron {
          transition: none;
        }
      }
      .warning__explanation {
        margin: 0;
        padding: 0 8px 8px 26px;
        font-size: 11px;
        line-height: 1.4;
        color: var(--text-muted, #555);
      }
    `,
  ],
})
export class LivestockToolComponent {
  private readonly store = inject(Store);
  private readonly storage = inject<StorageService>(STORAGE_SERVICE);

  readonly groups: ReadonlyArray<{ value: GroupFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'fish', label: 'Fish' },
    { value: 'shrimp', label: 'Shrimp' },
    { value: 'snail', label: 'Snails' },
  ];

  readonly filter = signal<GroupFilter>('all');

  /** Collapsed-panel state. Hydrated from StorageService on construct. */
  readonly collapsed = signal<boolean>(false);

  /** 1-indexed current page. Resets to 1 on filter change. */
  readonly page = signal<number>(1);

  /**
   * Page size as a writable signal so tests can shrink it without standing
   * up a synthetic catalog. Initialised to the public constant.
   */
  readonly pageSize = signal<number>(LIVESTOCK_TOOL_PAGE_SIZE);

  private readonly allEntries: ReadonlyArray<CatalogLivestockEntry> =
    coreCatalog.byKind('livestock');

  readonly visibleEntries = computed<ReadonlyArray<CatalogLivestockEntry>>(() => {
    const f = this.filter();
    if (f === 'all') return this.allEntries;
    return this.allEntries.filter((e) => e.group === f);
  });

  readonly totalPages = computed<number>(() => {
    const n = this.visibleEntries().length;
    if (n === 0) return 1;
    return Math.ceil(n / this.pageSize());
  });

  /** Slice of `visibleEntries` for the current page. */
  readonly pageEntries = computed<ReadonlyArray<CatalogLivestockEntry>>(() => {
    const visible = this.visibleEntries();
    const start = (this.page() - 1) * this.pageSize();
    return visible.slice(start, start + this.pageSize());
  });

  // Inventory state is fed from the store via toSignal so OnPush refreshes.
  // `selectLivestock` returns `LivestockEntry[]`; keep nullable here so the
  // `initialValue: null` overload of `toSignal` lines up under
  // `exactOptionalPropertyTypes` (matches the layers-panel pattern).
  private readonly livestock$ = this.store.select(selectLivestock);
  private readonly livestockSignal = toSignal<LivestockEntry[] | null>(this.livestock$, {
    initialValue: null,
  });

  readonly inventoryRows = computed<ReadonlyArray<InventoryRow>>(() =>
    (this.livestockSignal() ?? []).map((entry): InventoryRow => {
      const catalog = coreCatalog.get(entry.ref) as CatalogLivestockEntry | null;
      const displayName =
        catalog?.name ?? `Unknown species (catalog: ${entry.ref.id})`;
      return { entry, catalog, displayName };
    }),
  );

  readonly inventoryCount = computed<number>(() => this.inventoryRows().length);

  /**
   * F11.4 — show the "Feed tank" button only when there's at least one
   * livestock entry to feed. Avoids dispatching pulses that the simulation
   * service would have to no-op on anyway (no entities → no FeedingSystem
   * targets), and keeps the inventory header uncluttered when empty.
   */
  readonly canFeed = computed<boolean>(() => this.inventoryRows().length > 0);

  // Stocking warnings (F7.2). Streamed from the store so the existing
  // selector memoization carries through; toSignal feeds the template via
  // a signal source so OnPush refreshes on update. `initialValue: null`
  // matches the livestock signal pattern under `exactOptionalPropertyTypes`.
  private readonly warnings$ = this.store.select(selectStockingWarnings);
  private readonly warningsSignal = toSignal<StockingWarning[] | null>(this.warnings$, {
    initialValue: null,
  });
  readonly warnings = computed<ReadonlyArray<StockingWarning>>(
    () => this.warningsSignal() ?? [],
  );

  /** Ids of currently-expanded warning rows. Local UI state — not persisted. */
  private readonly expandedWarningIds = signal<ReadonlySet<string>>(new Set());

  constructor() {
    // Hydrate collapsed state. Failures non-fatal.
    this.storage
      .get<boolean>(LIVESTOCK_TOOL_COLLAPSED_KEY)
      .then((stored) => {
        if (typeof stored === 'boolean') {
          this.collapsed.set(stored);
        }
      })
      .catch(() => {
        // Best-effort.
      });

    // Persist collapsed state on every change. Skip the effect's initial
    // synchronous pass so we don't immediately overwrite the hydrate.
    let firstRun = true;
    effect(() => {
      const value = this.collapsed();
      if (firstRun) {
        firstRun = false;
        return;
      }
      this.storage.set(LIVESTOCK_TOOL_COLLAPSED_KEY, value).catch(() => {
        // Best-effort.
      });
    });

    // Clamp page when the visible list shrinks (e.g. the pageSize signal
    // grows, or filter changes via a code path that bypasses
    // `onFilterChange`'s explicit reset). The signal-write inside the
    // effect needs `allowSignalWrites: true` — same intent as Angular's
    // documented "derived-state-with-feedback" pattern.
    effect(
      () => {
        const max = this.totalPages();
        if (this.page() > max) {
          this.page.set(max);
        }
      },
      { allowSignalWrites: true },
    );
  }

  tooltipFor(entry: CatalogLivestockEntry): string {
    return `${entry.name} — ${entry.group}, schooling min ${entry.schoolingMin}`;
  }

  // ── Header ────────────────────────────────────────────────────────────

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  // ── Filter + pager ────────────────────────────────────────────────────

  onFilterChange(next: GroupFilter): void {
    this.filter.set(next);
    // Reset paging on filter change so the user lands on page 1 of the new
    // (possibly much smaller) filtered list.
    this.page.set(1);
  }

  prevPage(): void {
    this.page.update((p) => Math.max(1, p - 1));
  }

  nextPage(): void {
    this.page.update((p) => Math.min(this.totalPages(), p + 1));
  }

  // ── Inventory dispatch handlers ───────────────────────────────────────

  onAdd(entry: CatalogLivestockEntry): void {
    const newEntry: LivestockEntry = {
      id: crypto.randomUUID(),
      ref: { catalog: entry.catalog, id: entry.id, version: entry.version },
      quantity: 1,
    };
    this.store.dispatch(
      SceneActions.dispatchCommand({ command: addLivestockEntry(newEntry) }),
    );
  }

  onIncrease(entry: LivestockEntry): void {
    this.store.dispatch(
      SceneActions.dispatchCommand({
        command: updateLivestockQuantity(entry.id, entry.quantity + 1),
      }),
    );
  }

  onDecrease(entry: LivestockEntry): void {
    // Quantity floor is 1. Clicking `−` at qty 1 must NOT dispatch a
    // rejected command — the underlying validator would return invalid /
    // we'd pollute the action stream with no-ops.
    if (entry.quantity <= 1) return;
    this.store.dispatch(
      SceneActions.dispatchCommand({
        command: updateLivestockQuantity(entry.id, entry.quantity - 1),
      }),
    );
  }

  onRemove(entry: LivestockEntry): void {
    this.store.dispatch(
      SceneActions.dispatchCommand({ command: removeLivestockEntry(entry.id) }),
    );
  }

  /**
   * F11.4 — fire a transient `feedTank` pulse. The
   * `LivestockSimulationService` subscribes to this action via
   * `@ngrx/effects` `Actions` and spawns food sprite ECS entities at the
   * water surface; FoodSpriteLifetimeSystem despawns them after ~30 s.
   *
   * No payload — let the service pick a deterministic random sprite count
   * in [3, 6] via `tickPrng`. The button is rendered only when
   * `canFeed()` is true, so we don't need a runtime guard here.
   */
  onFeedTank(): void {
    this.store.dispatch(LivestockPulseActions.feedTank({}));
  }

  // ── Stocking guidance (F7.2) ──────────────────────────────────────────

  isExpanded(warningId: string): boolean {
    return this.expandedWarningIds().has(warningId);
  }

  toggleExpanded(warningId: string): void {
    this.expandedWarningIds.update((set) => {
      const next = new Set(set);
      if (next.has(warningId)) {
        next.delete(warningId);
      } else {
        next.add(warningId);
      }
      return next;
    });
  }

  severityIcon(severity: StockingWarning['severity']): string {
    switch (severity) {
      case 'error':
        return '⚠';
      case 'warning':
        return '!';
      case 'info':
        return 'ⓘ';
    }
  }
}
