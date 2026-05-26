// Equipment inventory side panel. Stage 7 F7.3.
//
// Sibling of `LivestockToolComponent` in the same lib: equipment is "stock
// the tank" planning concern that rides on top of the spatial scene model.
// Pattern mirrors livestock-tool exactly except for the equipment-specific
// fields (category badge, note input, read-only settings <dl>).
//
// Two stacked sections inside one collapsible panel:
//
//   1. Browser — paginated tile grid of `coreCatalog.byKind('equipment')`
//      filtered by category chip (all / filter / heater / light / co2).
//      Click a tile to dispatch `addEquipmentEntry({ id, ref, settings })`,
//      where `settings` is a SHALLOW CLONE of the catalog entry's
//      `defaultSettings` so subsequent edits don't mutate catalog data.
//
//   2. Inventory list — current `selectEquipment()` results as rows with
//      swatch + name + category badge + inline note input + Settings toggle
//      (read-only <dl>) + remove `×`. Notes save on blur; identical-value
//      blurs are no-ops to keep the action stream clean.
//
// **No settings EDITOR in v1.** Settings are catalog-default-populated and
// read-only. `updateEquipmentSettings` exists for future iteration.

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
import type { EquipmentEntry as CatalogEquipmentEntry } from '@aquascape/domain/catalog';
import {
  addEquipmentEntry,
  removeEquipmentEntry,
  setEquipmentNote,
} from '@aquascape/domain/scene-model';
import type { EquipmentEntry } from '@aquascape/domain/scene-model';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';
import { SceneActions, selectEquipment } from '@aquascape/state';

type CategoryFilter = 'all' | 'filter' | 'heater' | 'light' | 'co2';

/** Default page size for the browser tile grid. Matches livestock-tool. */
export const EQUIPMENT_TOOL_PAGE_SIZE = 8;

/** StorageService key for the collapsed-state flag. */
export const EQUIPMENT_TOOL_COLLAPSED_KEY = 'aquascape.ui.collapsed.equipment-tool';

/** Row record used by the inventory list — joins the scene entry to its catalog data. */
interface InventoryRow {
  entry: EquipmentEntry;
  /** Catalog entry resolved from `entry.ref`, or null when the manifest is missing. */
  catalog: CatalogEquipmentEntry | null;
  /** Display name shown in the row + the row's accessible label. */
  displayName: string;
  /** Category label for the badge. Title-cased; empty when catalog missing. */
  categoryLabel: string;
  /** `null` → no settings on the entry, hide the toggle entirely. */
  settingsEntries: ReadonlyArray<readonly [string, string]> | null;
}

@Component({
  selector: 'aquascape-equipment-tool',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <section class="equipment-tool" aria-labelledby="equipment-tool-heading">
      <header class="panel-header">
        <button
          type="button"
          class="panel-header__toggle"
          [attr.aria-expanded]="!collapsed()"
          aria-controls="equipment-tool-body"
          (click)="toggleCollapsed()"
        >
          <span
            class="panel-header__chevron"
            [class.panel-header__chevron--open]="!collapsed()"
            aria-hidden="true"
            >›</span
          >
          <h2 id="equipment-tool-heading" class="panel-header__title">Equipment</h2>
          <span class="panel-header__count" aria-label="entries">{{ inventoryCount() }}</span>
        </button>
      </header>

      <div id="equipment-tool-body" class="equipment-tool__body" [hidden]="collapsed()">
        <!-- ── Browser ─────────────────────────────────────────────────── -->
        <div class="equipment-tool__filters" role="radiogroup" aria-label="Category filter">
          @for (c of categories; track c.value) {
            <button
              type="button"
              class="filter"
              role="radio"
              [class.active]="filter() === c.value"
              [attr.aria-checked]="filter() === c.value"
              (click)="onFilterChange(c.value)"
            >
              {{ c.label }}
            </button>
          }
        </div>

        <div class="equipment-tool__grid">
          @for (entry of pageEntries(); track entry.id) {
            <button
              type="button"
              class="tile"
              [attr.aria-label]="'Add ' + entry.name + ' to equipment'"
              [title]="tooltipFor(entry)"
              (click)="onAdd(entry)"
            >
              <span
                class="tile__swatch"
                [style.background]="entry.color"
                aria-hidden="true"
              ></span>
              <span class="tile__name">{{ entry.name }}</span>
              <span class="tile__category" aria-hidden="true">{{ entry.category }}</span>
            </button>
          }
        </div>

        @if (visibleEntries().length === 0) {
          <p class="equipment-tool__empty">No equipment matches the filter.</p>
        }

        @if (totalPages() > 1) {
          <nav class="pager" aria-label="Equipment pages">
            <button
              type="button"
              class="pager__btn"
              data-testid="equipment-pager-prev"
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
              data-testid="equipment-pager-next"
              [disabled]="page() >= totalPages()"
              (click)="nextPage()"
              aria-label="Next page"
            >
              Next »
            </button>
          </nav>
        }

        <!-- ── Inventory list ──────────────────────────────────────────── -->
        <h3 class="equipment-tool__subheading">Inventory</h3>
        @if (inventoryRows().length === 0) {
          <p class="equipment-tool__empty">
            No equipment yet. Pick gear above to start planning.
          </p>
        } @else {
          <ul class="equipment-tool__list" role="list">
            @for (row of inventoryRows(); track row.entry.id) {
              <li class="inv-row" role="listitem" [attr.aria-label]="row.displayName">
                <div class="inv-row__head">
                  <span
                    class="inv-row__swatch"
                    [style.background]="row.catalog?.color ?? '#888'"
                    aria-hidden="true"
                  ></span>
                  <span class="inv-row__name">{{ row.displayName }}</span>
                  @if (row.categoryLabel.length > 0) {
                    <span class="inv-row__badge" aria-hidden="true">
                      {{ row.categoryLabel }}
                    </span>
                  }
                  <button
                    type="button"
                    class="inv-row__remove"
                    [attr.aria-label]="
                      'Remove ' + row.displayName + ' from equipment list'
                    "
                    (click)="onRemove(row.entry)"
                  >
                    ×
                  </button>
                </div>

                <input
                  type="text"
                  class="inv-row__note"
                  placeholder="Note (e.g. installed Jan 2026)"
                  [attr.aria-label]="'Note for ' + row.displayName"
                  [value]="noteFor(row.entry)"
                  (input)="onNoteInput(row.entry.id, $event)"
                  (blur)="onNoteBlur(row.entry)"
                />

                @if (row.settingsEntries !== null) {
                  <button
                    type="button"
                    class="inv-row__settings-toggle"
                    [attr.aria-expanded]="isSettingsExpanded(row.entry.id)"
                    [attr.aria-controls]="'settings-' + row.entry.id"
                    (click)="toggleSettings(row.entry.id)"
                  >
                    <span
                      class="inv-row__settings-chevron"
                      [class.inv-row__settings-chevron--open]="
                        isSettingsExpanded(row.entry.id)
                      "
                      aria-hidden="true"
                      >▾</span
                    >
                    Settings
                  </button>
                  @if (isSettingsExpanded(row.entry.id)) {
                    <dl class="inv-row__settings" [id]="'settings-' + row.entry.id">
                      @for (pair of row.settingsEntries; track pair[0]) {
                        <dt class="inv-row__settings-key">{{ pair[0] }}</dt>
                        <dd class="inv-row__settings-value">{{ pair[1] }}</dd>
                      }
                    </dl>
                  }
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
      .equipment-tool__filters {
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
      .equipment-tool__grid {
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
      .tile__category {
        margin-top: 2px;
        font-size: 10px;
        color: var(--text-muted, #777);
        text-transform: capitalize;
      }
      .equipment-tool__empty {
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
      .equipment-tool__subheading {
        margin: 12px 0 6px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-muted, #555);
      }
      .equipment-tool__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .inv-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: 4px;
        background: var(--surface-2, #fff);
      }
      .inv-row__head {
        display: flex;
        align-items: center;
        gap: 6px;
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
      .inv-row__badge {
        font-size: 10px;
        text-transform: uppercase;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--surface, #f1f1f3);
        color: var(--text-muted, #555);
        letter-spacing: 0.04em;
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
      .inv-row__note {
        width: 100%;
        padding: 4px 6px;
        background: transparent;
        color: inherit;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: 3px;
        font: inherit;
        font-size: 12px;
        box-sizing: border-box;
      }
      .inv-row__note:focus-visible {
        outline: 1px solid var(--accent, #20232a);
        outline-offset: -1px;
      }
      .inv-row__settings-toggle {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: transparent;
        color: var(--text-muted, #555);
        border: none;
        cursor: pointer;
        font: inherit;
        font-size: 11px;
        padding: 2px 4px;
      }
      .inv-row__settings-toggle:hover,
      .inv-row__settings-toggle:focus-visible {
        background: var(--surface-hover, #f0f0f0);
        outline: none;
        border-radius: 3px;
      }
      .inv-row__settings-chevron {
        display: inline-block;
        font-size: 10px;
        line-height: 1;
        transition: transform 0.15s ease;
        transform: rotate(-90deg);
      }
      .inv-row__settings-chevron--open {
        transform: rotate(0deg);
      }
      @media (prefers-reduced-motion: reduce) {
        .inv-row__settings-chevron {
          transition: none;
        }
      }
      .inv-row__settings {
        margin: 0;
        padding: 4px 6px;
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 2px 8px;
        font-size: 11px;
        background: var(--surface, #f1f1f3);
        border-radius: 3px;
      }
      .inv-row__settings-key {
        margin: 0;
        color: var(--text-muted, #555);
        font-variant-numeric: tabular-nums;
      }
      .inv-row__settings-value {
        margin: 0;
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class EquipmentToolComponent {
  private readonly store = inject(Store);
  private readonly storage = inject<StorageService>(STORAGE_SERVICE);

  readonly categories: ReadonlyArray<{ value: CategoryFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'filter', label: 'Filter' },
    { value: 'heater', label: 'Heater' },
    { value: 'light', label: 'Light' },
    { value: 'co2', label: 'CO2' },
  ];

  readonly filter = signal<CategoryFilter>('all');

  /** Collapsed-panel state. Hydrated from StorageService on construct. */
  readonly collapsed = signal<boolean>(false);

  /** 1-indexed current page. Resets to 1 on filter change. */
  readonly page = signal<number>(1);

  /**
   * Page size as a writable signal so tests can shrink it without standing
   * up a synthetic catalog. Initialised to the public constant.
   */
  readonly pageSize = signal<number>(EQUIPMENT_TOOL_PAGE_SIZE);

  /**
   * Per-row local note edits keyed by entry id. Holding edits in a signal
   * (rather than a Map field) keeps OnPush happy when the user types — the
   * input's `[value]` binding re-renders on every keystroke without losing
   * focus, since we ONLY mutate the entry the user is editing.
   *
   * Cleared on dispatch so the next read returns the freshly-stored
   * `entry.note` rather than the stale draft.
   */
  private readonly noteDrafts = signal<ReadonlyMap<string, string>>(new Map());

  /** Ids of currently-expanded settings <dl> rows. Local UI state — not persisted. */
  private readonly expandedSettingsIds = signal<ReadonlySet<string>>(new Set());

  private readonly allEntries: ReadonlyArray<CatalogEquipmentEntry> =
    coreCatalog.byKind('equipment');

  readonly visibleEntries = computed<ReadonlyArray<CatalogEquipmentEntry>>(() => {
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
  readonly pageEntries = computed<ReadonlyArray<CatalogEquipmentEntry>>(() => {
    const visible = this.visibleEntries();
    const start = (this.page() - 1) * this.pageSize();
    return visible.slice(start, start + this.pageSize());
  });

  // Inventory state is fed from the store via toSignal so OnPush refreshes.
  // `selectEquipment` returns `EquipmentEntry[]`; keep nullable here so the
  // `initialValue: null` overload of `toSignal` lines up under
  // `exactOptionalPropertyTypes` (matches livestock-tool's pattern).
  private readonly equipment$ = this.store.select(selectEquipment);
  private readonly equipmentSignal = toSignal<EquipmentEntry[] | null>(this.equipment$, {
    initialValue: null,
  });

  readonly inventoryRows = computed<ReadonlyArray<InventoryRow>>(() =>
    (this.equipmentSignal() ?? []).map((entry): InventoryRow => {
      const catalog = coreCatalog.get(entry.ref) as CatalogEquipmentEntry | null;
      const displayName =
        catalog?.name ?? `Unknown equipment (catalog: ${entry.ref.id})`;
      const categoryLabel =
        catalog === null ? '' : titleCaseCategory(catalog.category);
      const settingsEntries =
        entry.settings === undefined
          ? null
          : (Object.entries(entry.settings).map(
              ([k, v]) => [k, formatSettingsValue(v)] as const,
            ) as ReadonlyArray<readonly [string, string]>);
      return { entry, catalog, displayName, categoryLabel, settingsEntries };
    }),
  );

  readonly inventoryCount = computed<number>(() => this.inventoryRows().length);

  constructor() {
    // Hydrate collapsed state. Failures non-fatal.
    this.storage
      .get<boolean>(EQUIPMENT_TOOL_COLLAPSED_KEY)
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
      this.storage.set(EQUIPMENT_TOOL_COLLAPSED_KEY, value).catch(() => {
        // Best-effort.
      });
    });

    // Clamp page when the visible list shrinks. Same intent + rationale as
    // livestock-tool's matching effect (`allowSignalWrites: true` for the
    // documented derived-state-with-feedback pattern).
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

  tooltipFor(entry: CatalogEquipmentEntry): string {
    if (entry.wattage === undefined) {
      return `${entry.name} — ${entry.category}`;
    }
    return `${entry.name} — ${entry.category}, ${entry.wattage}W`;
  }

  // ── Header ────────────────────────────────────────────────────────────

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  // ── Filter + pager ────────────────────────────────────────────────────

  onFilterChange(next: CategoryFilter): void {
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

  onAdd(entry: CatalogEquipmentEntry): void {
    // SHALLOW-CLONE defaultSettings so the inventory's `settings` becomes a
    // NEW object — subsequent edits via `updateEquipmentSettings` must NOT
    // mutate the catalog entry that other instances also reference.
    // `exactOptionalPropertyTypes` rejects passing `undefined` to the
    // optional `settings` field: use the spread-trick to omit the key when
    // there's no catalog default.
    const newEntry: EquipmentEntry = {
      id: crypto.randomUUID(),
      ref: { catalog: entry.catalog, id: entry.id, version: entry.version },
      ...(entry.defaultSettings !== undefined
        ? { settings: { ...entry.defaultSettings } }
        : {}),
    };
    this.store.dispatch(
      SceneActions.dispatchCommand({ command: addEquipmentEntry(newEntry) }),
    );
  }

  onRemove(entry: EquipmentEntry): void {
    this.store.dispatch(
      SceneActions.dispatchCommand({ command: removeEquipmentEntry(entry.id) }),
    );
  }

  // ── Note input (per-row local edit, save on blur) ─────────────────────

  /**
   * Current display value for the note input. Reads the local draft if the
   * user has typed in this row, otherwise the stored entry note. Empty
   * string when neither.
   */
  noteFor(entry: EquipmentEntry): string {
    const drafts = this.noteDrafts();
    const draft = drafts.get(entry.id);
    if (draft !== undefined) return draft;
    return entry.note ?? '';
  }

  onNoteInput(entryId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.noteDrafts.update((drafts) => {
      const next = new Map(drafts);
      next.set(entryId, value);
      return next;
    });
  }

  onNoteBlur(entry: EquipmentEntry): void {
    const drafts = this.noteDrafts();
    const draft = drafts.get(entry.id);
    if (draft === undefined) return; // user never typed in this row
    const trimmed = draft.trim();
    const current = entry.note ?? '';
    // No-op guard: same trimmed value as current → no dispatch.
    if (trimmed === current) {
      // Still clear the draft so a future re-edit reads fresh from the entry.
      this.clearDraft(entry.id);
      return;
    }
    // Empty trimmed value → clear via `null` (command rejects `''`).
    const next = trimmed.length === 0 ? null : trimmed;
    this.store.dispatch(
      SceneActions.dispatchCommand({ command: setEquipmentNote(entry.id, next) }),
    );
    this.clearDraft(entry.id);
  }

  private clearDraft(entryId: string): void {
    this.noteDrafts.update((drafts) => {
      if (!drafts.has(entryId)) return drafts;
      const next = new Map(drafts);
      next.delete(entryId);
      return next;
    });
  }

  // ── Settings expand/collapse (read-only display) ──────────────────────

  isSettingsExpanded(entryId: string): boolean {
    return this.expandedSettingsIds().has(entryId);
  }

  toggleSettings(entryId: string): void {
    this.expandedSettingsIds.update((set) => {
      const next = new Set(set);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }
}

function titleCaseCategory(c: 'filter' | 'heater' | 'light' | 'co2'): string {
  if (c === 'co2') return 'CO2';
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function formatSettingsValue(value: number | string | boolean): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return String(value);
}
