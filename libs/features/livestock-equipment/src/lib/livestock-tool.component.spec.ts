import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { LivestockEntry as CatalogLivestockEntry } from '@aquascape/domain/catalog';
import type { LivestockEntry } from '@aquascape/domain/scene-model';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';
import type { StockingWarning } from '@aquascape/domain/stocking';
import { SceneActions, selectLivestock, selectStockingWarnings } from '@aquascape/state';

import {
  LIVESTOCK_TOOL_COLLAPSED_KEY,
  LIVESTOCK_TOOL_PAGE_SIZE,
  LivestockToolComponent,
} from './livestock-tool.component';

class FakeStorageService implements StorageService {
  readonly data = new Map<string, unknown>();
  get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.data.get(key) as T | undefined) ?? null);
  }
  set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * True when `a` appears earlier in document order than `b`. Avoids the
 * `compareDocumentPosition` bitwise-mask idiom (banned by lint) by
 * walking every descendant of the shared body element in document order
 * and comparing positions.
 */
function precedes(a: Element, b: Element): boolean {
  const root = a.ownerDocument?.body;
  if (!root) return false;
  const all = Array.from(root.querySelectorAll('*'));
  const ia = all.indexOf(a);
  const ib = all.indexOf(b);
  return ia !== -1 && ib !== -1 && ia < ib;
}

function configure(
  options: {
    storage?: FakeStorageService;
    livestock?: LivestockEntry[];
    warnings?: StockingWarning[];
  } = {},
) {
  const storage = options.storage ?? new FakeStorageService();
  const livestockValue = options.livestock ?? [];
  const warningsValue = options.warnings ?? [];
  TestBed.configureTestingModule({
    imports: [LivestockToolComponent],
    providers: [
      provideMockStore({
        // `selectLivestock` + `selectStockingWarnings` are always overridden —
        // provideMockStore selector overrides LEAK across
        // TestBed.resetTestingModule per the CLAUDE.md gotcha; every
        // configure() call must (re)set BOTH so a prior test's value doesn't
        // bleed in. The stocking selector chains off `selectScene` which
        // isn't set in this mock — overriding directly skips that branch.
        selectors: [
          { selector: selectLivestock, value: livestockValue },
          { selector: selectStockingWarnings, value: warningsValue },
        ],
      }),
      { provide: STORAGE_SERVICE, useValue: storage },
    ],
  });
  const store = TestBed.inject(MockStore);
  const dispatchSpy = jest.spyOn(store, 'dispatch');
  const fixture = TestBed.createComponent(LivestockToolComponent);
  fixture.detectChanges();
  return {
    fixture,
    store,
    storage,
    dispatched: () => dispatchSpy.mock.calls.map((c) => c[0]),
  };
}

describe('LivestockToolComponent — rendering + filter', () => {
  it('renders one tile per livestock catalog entry by default (capped at pageSize)', () => {
    const { fixture } = configure();
    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    const expected = Math.min(
      LIVESTOCK_TOOL_PAGE_SIZE,
      coreCatalog.byKind('livestock').length,
    );
    expect(tiles.length).toBe(expected);
  });

  it('filters tiles by group chip selection', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(100);
    fixture.detectChanges();

    const filterButtons = fixture.nativeElement.querySelectorAll('button.filter');
    // [All, Fish, Shrimp, Snails] — click "Fish"
    (filterButtons[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    const expectedFish = coreCatalog
      .byKind('livestock')
      .filter((e) => e.group === 'fish').length;
    expect(tiles.length).toBe(expectedFish);
  });

  it('filter change resets the pager back to page 1', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    component.page.set(2);
    fixture.detectChanges();
    expect(component.page()).toBe(2);

    const filterButtons = fixture.nativeElement.querySelectorAll('button.filter');
    (filterButtons[1] as HTMLButtonElement).click(); // Fish
    fixture.detectChanges();
    expect(component.page()).toBe(1);
    expect(component.filter()).toBe('fish');
  });

  it('renders a colour swatch on each tile from the catalog entry', () => {
    const { fixture } = configure();
    const swatches = fixture.nativeElement.querySelectorAll('.tile__swatch');
    expect(swatches.length).toBeGreaterThan(0);
    for (const sw of Array.from(swatches)) {
      // `background` is set inline from catalog entry's hex; just verify
      // *something* was applied.
      expect((sw as HTMLElement).style.background.length).toBeGreaterThan(0);
    }
  });

  it('does not show the browser empty-state when entries exist (default "all" filter)', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(100);
    fixture.detectChanges();
    // The browser empty-state lives BEFORE the inventory subheading; the
    // inventory empty-state lives AFTER. Scope the query to the part of
    // the body that precedes the subheading so the assertion only sees
    // browser-context empty messages.
    const body = fixture.nativeElement.querySelector('#livestock-tool-body') as HTMLElement;
    const subheading = body.querySelector('.livestock-tool__subheading');
    const emptyMessages = Array.from(body.querySelectorAll('.livestock-tool__empty'));
    const browserEmpty = emptyMessages.find((el) =>
      subheading ? precedes(el, subheading) : true,
    );
    expect(browserEmpty).toBeUndefined();
  });
});

describe('LivestockToolComponent — Add (browser → store)', () => {
  it('clicking a tile dispatches addLivestockEntry with a fresh uuid + quantity 1', () => {
    const { fixture, dispatched } = configure();
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLButtonElement;
    tile.click();
    fixture.detectChanges();

    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.type).toBe(SceneActions.dispatchCommand.type);
    expect(cmd.command.kind).toBe('AddLivestockEntry');
    if (cmd.command.kind !== 'AddLivestockEntry') return;

    const entry = cmd.command.entry;
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.quantity).toBe(1);
    expect(entry.ref.catalog).toBe('core');
    expect(entry.ref.version).toBeGreaterThanOrEqual(1);
    expect(typeof entry.ref.id).toBe('string');
  });

  it('two consecutive Adds mint distinct uuids', () => {
    const { fixture, dispatched } = configure();
    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    (tiles[0] as HTMLButtonElement).click();
    (tiles[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    const calls = dispatched() as Array<ReturnType<typeof SceneActions.dispatchCommand>>;
    expect(calls.length).toBe(2);
    const a = calls[0]!.command;
    const b = calls[1]!.command;
    if (a.kind !== 'AddLivestockEntry' || b.kind !== 'AddLivestockEntry') return;
    expect(a.entry.id).not.toBe(b.entry.id);
  });
});

describe('LivestockToolComponent — inventory list (store → render → dispatch)', () => {
  function firstLivestockCatalogEntry(): CatalogLivestockEntry {
    return coreCatalog.byKind('livestock')[0]!;
  }

  function mkEntry(
    overrides: Partial<LivestockEntry> = {},
    catalog: CatalogLivestockEntry = firstLivestockCatalogEntry(),
  ): LivestockEntry {
    return {
      id: 'entry-1',
      ref: { catalog: catalog.catalog, id: catalog.id, version: catalog.version },
      quantity: 2,
      ...overrides,
    };
  }

  it('renders one inventory row per livestock entry showing name + quantity', () => {
    const catalog = firstLivestockCatalogEntry();
    const entry = mkEntry({ quantity: 3 }, catalog);
    const { fixture } = configure({ livestock: [entry] });

    const rows = fixture.nativeElement.querySelectorAll('li.inv-row');
    expect(rows).toHaveLength(1);
    const row = rows[0] as HTMLElement;
    expect(row.querySelector('.inv-row__name')?.textContent ?? '').toContain(catalog.name);
    expect(row.querySelector('.qty-value')?.textContent ?? '').toContain('3');
  });

  it('renders the empty-state copy when the inventory is empty', () => {
    const { fixture } = configure({ livestock: [] });
    const empty = fixture.nativeElement.querySelector('.livestock-tool__empty');
    expect(empty?.textContent ?? '').toContain('No livestock yet.');
  });

  it('shows a graceful fallback name when the catalog entry is missing', () => {
    const entry: LivestockEntry = {
      id: 'entry-ghost',
      ref: { catalog: 'core', id: 'livestock.fish.no-such-species', version: 1 },
      quantity: 1,
    };
    const { fixture } = configure({ livestock: [entry] });
    const row = fixture.nativeElement.querySelector('li.inv-row');
    expect(row?.querySelector('.inv-row__name')?.textContent ?? '').toContain(
      'Unknown species',
    );
  });

  it('+ dispatches updateLivestockQuantity with quantity + 1', () => {
    const entry = mkEntry({ quantity: 2 });
    const { fixture, dispatched } = configure({ livestock: [entry] });
    const btn = fixture.nativeElement.querySelector(
      '.qty-btn[aria-label="Increase quantity"]',
    ) as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();

    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.command.kind).toBe('UpdateLivestockQuantity');
    if (cmd.command.kind !== 'UpdateLivestockQuantity') return;
    expect(cmd.command.entryId).toBe(entry.id);
    expect(cmd.command.quantity).toBe(3);
  });

  it('− at quantity 2 dispatches updateLivestockQuantity with quantity 1', () => {
    const entry = mkEntry({ quantity: 2 });
    const { fixture, dispatched } = configure({ livestock: [entry] });
    const btn = fixture.nativeElement.querySelector(
      '.qty-btn[aria-label="Decrease quantity"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    fixture.detectChanges();

    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.command.kind).toBe('UpdateLivestockQuantity');
    if (cmd.command.kind !== 'UpdateLivestockQuantity') return;
    expect(cmd.command.quantity).toBe(1);
  });

  it('− at quantity 1 dispatches NOTHING (button disabled + handler guard)', () => {
    const entry = mkEntry({ quantity: 1 });
    const { fixture, dispatched } = configure({ livestock: [entry] });
    const btn = fixture.nativeElement.querySelector(
      '.qty-btn[aria-label="Decrease quantity"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // Even if the disabled button were clicked programmatically, the handler
    // bails out — invoke it directly to assert the guard.
    fixture.componentInstance.onDecrease(entry);
    expect(dispatched().length).toBe(0);
  });

  it('× dispatches removeLivestockEntry with the entry id', () => {
    const entry = mkEntry();
    const { fixture, dispatched } = configure({ livestock: [entry] });
    const btn = fixture.nativeElement.querySelector('.inv-row__remove') as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();

    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.command.kind).toBe('RemoveLivestockEntry');
    if (cmd.command.kind !== 'RemoveLivestockEntry') return;
    expect(cmd.command.entryId).toBe(entry.id);
  });

  it('inventory list container has role="list" and rows have role="listitem"', () => {
    const entry = mkEntry();
    const { fixture } = configure({ livestock: [entry] });
    const list = fixture.nativeElement.querySelector('.livestock-tool__list');
    expect(list?.getAttribute('role')).toBe('list');
    const row = fixture.nativeElement.querySelector('li.inv-row');
    expect(row?.getAttribute('role')).toBe('listitem');
    // The row's aria-label exposes the species name as the accessible label.
    expect(row?.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('LivestockToolComponent — collapsible header', () => {
  it('renders the header as a button with aria-expanded=true by default', () => {
    const { fixture } = configure();
    const toggle = fixture.nativeElement.querySelector(
      '.panel-header__toggle',
    ) as HTMLButtonElement;
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('livestock-tool-body');
  });

  it('shows the inventory-count badge next to the title (0 by default)', () => {
    const { fixture } = configure();
    const count = fixture.nativeElement.querySelector('.panel-header__count');
    expect(count?.textContent?.trim()).toBe('0');
  });

  it('inventory-count badge reflects the number of livestock entries', () => {
    const catalog = coreCatalog.byKind('livestock')[0]!;
    const livestock: LivestockEntry[] = [
      {
        id: 'a',
        ref: { catalog: catalog.catalog, id: catalog.id, version: catalog.version },
        quantity: 1,
      },
      {
        id: 'b',
        ref: { catalog: catalog.catalog, id: catalog.id, version: catalog.version },
        quantity: 5,
      },
    ];
    const { fixture } = configure({ livestock });
    const count = fixture.nativeElement.querySelector('.panel-header__count');
    expect(count?.textContent?.trim()).toBe('2');
  });

  it('clicking the header toggles the collapsed signal and hides the body', () => {
    const { fixture } = configure();
    const toggle = fixture.nativeElement.querySelector(
      '.panel-header__toggle',
    ) as HTMLButtonElement;
    const body = fixture.nativeElement.querySelector('#livestock-tool-body') as HTMLElement;
    expect(fixture.componentInstance.collapsed()).toBe(false);
    expect(body.hidden).toBe(false);

    toggle.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.collapsed()).toBe(true);
    expect(body.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('hydrates the collapsed signal from StorageService on init', async () => {
    const storage = new FakeStorageService();
    await storage.set(LIVESTOCK_TOOL_COLLAPSED_KEY, true);
    const { fixture } = configure({ storage });
    await flushPromises();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(true);
  });

  it('ignores a non-boolean stored hydrate value (covers the type-guard else branch)', async () => {
    const storage = new FakeStorageService();
    // Stash a non-boolean (e.g. a stale string from a hypothetical schema
    // change) so the `typeof stored === 'boolean'` guard branches false.
    await storage.set(LIVESTOCK_TOOL_COLLAPSED_KEY, 'true' as unknown as boolean);
    const { fixture } = configure({ storage });
    await flushPromises();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(false);
  });

  it('swallows a hydrate-from-storage rejection (covers the .catch path)', async () => {
    const storage = new FakeStorageService();
    jest.spyOn(storage, 'get').mockRejectedValueOnce(new Error('boom'));
    const { fixture } = configure({ storage });
    await flushPromises();
    fixture.detectChanges();
    // Default `false` survives the failed hydrate.
    expect(fixture.componentInstance.collapsed()).toBe(false);
  });

  it('does NOT write to storage on the synchronous first-run effect (firstRun guard)', async () => {
    const storage = new FakeStorageService();
    const setSpy = jest.spyOn(storage, 'set');
    configure({ storage });
    await flushPromises();
    // The initial dependency-registering pass of the persist `effect()`
    // must NOT touch storage — otherwise the seeded `false` would race the
    // async hydrate-from-storage and lose a stored `true`.
    expect(setSpy).not.toHaveBeenCalledWith(LIVESTOCK_TOOL_COLLAPSED_KEY, false);
  });

  it('persists collapsed state to StorageService on toggle (after the first-run guard)', async () => {
    const { fixture, storage } = configure();
    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    await flushPromises();
    expect(storage.data.get(LIVESTOCK_TOOL_COLLAPSED_KEY)).toBe(true);

    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    await flushPromises();
    expect(storage.data.get(LIVESTOCK_TOOL_COLLAPSED_KEY)).toBe(false);
  });
});

describe('LivestockToolComponent — pager', () => {
  it('hides the pager when total entries fit on one page', () => {
    const { fixture } = configure();
    fixture.componentInstance.pageSize.set(coreCatalog.byKind('livestock').length + 10);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pager')).toBeNull();
  });

  it('shows the pager when visibleEntries > pageSize', () => {
    const { fixture } = configure();
    fixture.componentInstance.pageSize.set(2);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pager')).not.toBeNull();
    const totalLivestock = coreCatalog.byKind('livestock').length;
    expect(fixture.componentInstance.totalPages()).toBe(Math.ceil(totalLivestock / 2));
    expect(fixture.nativeElement.querySelectorAll('.tile').length).toBe(2);
  });

  it('next + prev navigate within bounds and toggle disabled state', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    fixture.detectChanges();

    let prev = fixture.nativeElement.querySelector(
      '[data-testid="livestock-pager-prev"]',
    ) as HTMLButtonElement;
    let next = fixture.nativeElement.querySelector(
      '[data-testid="livestock-pager-next"]',
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    next.click();
    fixture.detectChanges();
    expect(component.page()).toBe(2);

    const lastPage = component.totalPages();
    while (component.page() < lastPage) {
      next = fixture.nativeElement.querySelector(
        '[data-testid="livestock-pager-next"]',
      ) as HTMLButtonElement;
      next.click();
      fixture.detectChanges();
    }
    next = fixture.nativeElement.querySelector(
      '[data-testid="livestock-pager-next"]',
    ) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    prev = fixture.nativeElement.querySelector(
      '[data-testid="livestock-pager-prev"]',
    ) as HTMLButtonElement;
    prev.click();
    fixture.detectChanges();
    expect(component.page()).toBe(lastPage - 1);
  });

  it('prevPage + nextPage are bounds-safe when called directly', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    fixture.detectChanges();
    component.prevPage();
    expect(component.page()).toBe(1);
    const lastPage = component.totalPages();
    for (let i = 1; i < lastPage; i++) component.nextPage();
    expect(component.page()).toBe(lastPage);
    component.nextPage();
    expect(component.page()).toBe(lastPage);
  });

  it('clamps the page when the visible list shrinks below the current page', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    fixture.detectChanges();
    // Drive the page to the last page first, then shrink the visible list
    // by poking the filter signal DIRECTLY (skipping onFilterChange so its
    // page.set(1) doesn't fire — that lets the clamp `effect()` actually
    // exercise its "page > max" → page.set(max) branch).
    const lastPage = component.totalPages();
    component.page.set(lastPage);
    component.filter.set('shrimp'); // only 2 shrimp → 1 page at pageSize=2
    fixture.detectChanges();
    expect(component.page()).toBe(component.totalPages());
    expect(component.page()).toBeLessThan(lastPage);
  });

  // ── Stocking guidance (F7.2) ──────────────────────────────────────────

  describe('stocking guidance section', () => {
    function makeWarning(
      overrides: Partial<StockingWarning> = {},
    ): StockingWarning {
      return {
        id: 'w1',
        severity: 'warning',
        code: 'schooling-below-minimum',
        message: 'Schooling below minimum',
        explanation: 'These fish school in groups; the catalog recommends at least 6.',
        relatedEntryIds: ['e1'],
        ...overrides,
      };
    }

    it('renders nothing when there are no warnings', () => {
      const { fixture } = configure({ warnings: [] });
      const section = fixture.nativeElement.querySelector('.livestock-tool__warnings');
      expect(section).toBeNull();
      // The subheading should also not be present in this branch — the
      // browser subheading "Inventory" is the only one.
      const headings = Array.from(
        fixture.nativeElement.querySelectorAll('.livestock-tool__subheading'),
      ).map((el) => (el as HTMLElement).textContent ?? '');
      expect(headings).not.toContain('Stocking guidance');
    });

    it('renders one row per warning with the message', () => {
      const warnings: StockingWarning[] = [
        makeWarning({ id: 'w1', message: 'Tank near capacity' }),
        makeWarning({ id: 'w2', message: 'Temperament mismatch' }),
      ];
      const { fixture } = configure({ warnings });
      const rows = fixture.nativeElement.querySelectorAll('.warning');
      expect(rows.length).toBe(2);
      expect((rows[0] as HTMLElement).textContent ?? '').toContain('Tank near capacity');
      expect((rows[1] as HTMLElement).textContent ?? '').toContain('Temperament mismatch');
    });

    it('applies the severity-specific CSS class and ARIA role', () => {
      const warnings: StockingWarning[] = [
        makeWarning({
          id: 'e1',
          severity: 'error',
          code: 'temperature-incompatible',
          message: 'Temperature ranges do not overlap',
        }),
        makeWarning({ id: 'w1', severity: 'warning', message: 'Warning text' }),
        makeWarning({ id: 'i1', severity: 'info', message: 'Info text' }),
      ];
      const { fixture } = configure({ warnings });
      const rows = fixture.nativeElement.querySelectorAll('.warning');
      expect((rows[0] as HTMLElement).classList).toContain('warning--error');
      expect((rows[0] as HTMLElement).getAttribute('role')).toBe('alert');
      expect((rows[1] as HTMLElement).classList).toContain('warning--warning');
      expect((rows[1] as HTMLElement).getAttribute('role')).toBe('status');
      expect((rows[2] as HTMLElement).classList).toContain('warning--info');
      expect((rows[2] as HTMLElement).getAttribute('role')).toBe('status');
    });

    it('expands and collapses the explanation on toggle', () => {
      const warnings: StockingWarning[] = [
        makeWarning({ id: 'w1', explanation: 'Detailed rationale here.' }),
      ];
      const { fixture } = configure({ warnings });
      const component = fixture.componentInstance;

      // Collapsed by default — explanation not in the DOM.
      expect(fixture.nativeElement.querySelector('.warning__explanation')).toBeNull();
      expect(component.isExpanded('w1')).toBe(false);

      // Click toggle button.
      const toggle = fixture.nativeElement.querySelector(
        '.warning__toggle',
      ) as HTMLButtonElement;
      toggle.click();
      fixture.detectChanges();

      const explanation = fixture.nativeElement.querySelector(
        '.warning__explanation',
      ) as HTMLElement;
      expect(explanation).not.toBeNull();
      expect(explanation.textContent ?? '').toContain('Detailed rationale here.');
      expect(component.isExpanded('w1')).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.getAttribute('aria-controls')).toBe('warning-w1-explanation');
      expect(explanation.id).toBe('warning-w1-explanation');

      // Click again to collapse.
      toggle.click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.warning__explanation')).toBeNull();
      expect(component.isExpanded('w1')).toBe(false);
    });

    it('expanding one warning leaves siblings collapsed', () => {
      const warnings: StockingWarning[] = [
        makeWarning({ id: 'a' }),
        makeWarning({ id: 'b' }),
      ];
      const { fixture } = configure({ warnings });
      const component = fixture.componentInstance;
      const toggles = fixture.nativeElement.querySelectorAll(
        '.warning__toggle',
      ) as NodeListOf<HTMLButtonElement>;
      toggles[0].click();
      fixture.detectChanges();
      expect(component.isExpanded('a')).toBe(true);
      expect(component.isExpanded('b')).toBe(false);
    });

    it('severityIcon() returns a distinct glyph per severity', () => {
      const { fixture } = configure();
      const c = fixture.componentInstance;
      const icons = new Set([
        c.severityIcon('error'),
        c.severityIcon('warning'),
        c.severityIcon('info'),
      ]);
      expect(icons.size).toBe(3);
    });
  });

  it('totalPages() returns 1 when the visible list is empty (n === 0 branch)', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    // Override the entries source via the existing public allEntries field
    // is overkill; instead shrink visibleEntries through a filter that
    // would match no group by stuffing the filter signal with an unreal
    // value. The filter type is GroupFilter | unknown — cast through any
    // for the sole purpose of forcing the "no entries match" computed.
    component.filter.set('__none__' as unknown as 'fish');
    fixture.detectChanges();
    expect(component.visibleEntries().length).toBe(0);
    expect(component.totalPages()).toBe(1);
    // Browser empty-state surfaces.
    const body = fixture.nativeElement.querySelector('#livestock-tool-body') as HTMLElement;
    const subheading = body.querySelector('.livestock-tool__subheading');
    const messages = Array.from(body.querySelectorAll('.livestock-tool__empty'));
    const browserEmpty = messages.find((el) =>
      subheading ? precedes(el, subheading) : true,
    );
    expect(browserEmpty?.textContent ?? '').toContain('No species match the filter.');
  });
});
