import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { EquipmentEntry as CatalogEquipmentEntry } from '@aquascape/domain/catalog';
import type { EquipmentEntry } from '@aquascape/domain/scene-model';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';
import { SceneActions, selectEquipment } from '@aquascape/state';

import {
  EQUIPMENT_TOOL_COLLAPSED_KEY,
  EQUIPMENT_TOOL_PAGE_SIZE,
  EquipmentToolComponent,
} from './equipment-tool.component';

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
 * `compareDocumentPosition` bitwise-mask idiom (banned by lint) by walking
 * every descendant of the shared body element in document order and
 * comparing positions. Mirrors livestock-tool spec's helper.
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
    equipment?: EquipmentEntry[];
  } = {},
) {
  const storage = options.storage ?? new FakeStorageService();
  const equipmentValue = options.equipment ?? [];
  TestBed.configureTestingModule({
    imports: [EquipmentToolComponent],
    providers: [
      provideMockStore({
        // `selectEquipment` is always overridden — provideMockStore selector
        // overrides LEAK across TestBed.resetTestingModule per the CLAUDE.md
        // gotcha; every configure() call must (re)set the value so a prior
        // test's value doesn't bleed in.
        selectors: [{ selector: selectEquipment, value: equipmentValue }],
      }),
      { provide: STORAGE_SERVICE, useValue: storage },
    ],
  });
  const store = TestBed.inject(MockStore);
  const dispatchSpy = jest.spyOn(store, 'dispatch');
  const fixture = TestBed.createComponent(EquipmentToolComponent);
  fixture.detectChanges();
  return {
    fixture,
    store,
    storage,
    dispatched: () => dispatchSpy.mock.calls.map((c) => c[0]),
  };
}

function firstEquipmentCatalogEntry(): CatalogEquipmentEntry {
  return coreCatalog.byKind('equipment')[0]!;
}

/** Find the first catalog entry that has a `defaultSettings` record. */
function firstWithDefaults(): CatalogEquipmentEntry {
  const found = coreCatalog
    .byKind('equipment')
    .find((e) => e.defaultSettings !== undefined);
  if (found === undefined) {
    throw new Error(
      'spec invariant: at least one equipment catalog entry must have defaultSettings',
    );
  }
  return found;
}

/** Find the first catalog entry that has NO `defaultSettings`. */
function firstWithoutDefaults(): CatalogEquipmentEntry | null {
  return (
    coreCatalog.byKind('equipment').find((e) => e.defaultSettings === undefined) ??
    null
  );
}

describe('EquipmentToolComponent — rendering + filter', () => {
  it('renders one tile per equipment catalog entry by default (capped at pageSize)', () => {
    const { fixture } = configure();
    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    const expected = Math.min(
      EQUIPMENT_TOOL_PAGE_SIZE,
      coreCatalog.byKind('equipment').length,
    );
    expect(tiles.length).toBe(expected);
  });

  it('filters tiles by category chip selection', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(100);
    fixture.detectChanges();

    const filterButtons = fixture.nativeElement.querySelectorAll('button.filter');
    // [All, Filter, Heater, Light, CO2] — click "Filter"
    (filterButtons[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    const expectedFilters = coreCatalog
      .byKind('equipment')
      .filter((e) => e.category === 'filter').length;
    expect(tiles.length).toBe(expectedFilters);
  });

  it('filter change resets the pager back to page 1', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    component.page.set(2);
    fixture.detectChanges();
    expect(component.page()).toBe(2);

    const filterButtons = fixture.nativeElement.querySelectorAll('button.filter');
    (filterButtons[1] as HTMLButtonElement).click(); // Filter
    fixture.detectChanges();
    expect(component.page()).toBe(1);
    expect(component.filter()).toBe('filter');
  });

  it('renders a colour swatch on each tile from the catalog entry', () => {
    const { fixture } = configure();
    const swatches = fixture.nativeElement.querySelectorAll('.tile__swatch');
    expect(swatches.length).toBeGreaterThan(0);
    for (const sw of Array.from(swatches)) {
      expect((sw as HTMLElement).style.background.length).toBeGreaterThan(0);
    }
  });

  it('does not show the browser empty-state when entries exist (default "all" filter)', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(100);
    fixture.detectChanges();
    const body = fixture.nativeElement.querySelector('#equipment-tool-body') as HTMLElement;
    const subheading = body.querySelector('.equipment-tool__subheading');
    const emptyMessages = Array.from(body.querySelectorAll('.equipment-tool__empty'));
    const browserEmpty = emptyMessages.find((el) =>
      subheading ? precedes(el, subheading) : true,
    );
    expect(browserEmpty).toBeUndefined();
  });

  it('tooltipFor omits the wattage segment when undefined', () => {
    const { fixture } = configure();
    const c = fixture.componentInstance;
    const withWatts: CatalogEquipmentEntry = {
      ...firstEquipmentCatalogEntry(),
      wattage: 42,
    };
    expect(c.tooltipFor(withWatts)).toContain('42W');
    const noEntry = { ...firstEquipmentCatalogEntry() } as CatalogEquipmentEntry;
    delete (noEntry as { wattage?: number }).wattage;
    expect(c.tooltipFor(noEntry)).not.toContain('W');
  });
});

describe('EquipmentToolComponent — Add (browser → store)', () => {
  it('clicking a tile dispatches addEquipmentEntry with a fresh uuid', () => {
    const { fixture, dispatched } = configure();
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLButtonElement;
    tile.click();
    fixture.detectChanges();

    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.type).toBe(SceneActions.dispatchCommand.type);
    expect(cmd.command.kind).toBe('AddEquipmentEntry');
    if (cmd.command.kind !== 'AddEquipmentEntry') return;

    const entry = cmd.command.entry;
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.ref.catalog).toBe('core');
    expect(entry.ref.version).toBeGreaterThanOrEqual(1);
    expect(typeof entry.ref.id).toBe('string');
  });

  it('Add populates settings from catalog defaultSettings — and the settings is a SHALLOW CLONE', () => {
    const catalogEntry = firstWithDefaults();
    const { fixture, dispatched } = configure();
    const component = fixture.componentInstance;

    // Drive directly via the public handler so we know exactly which catalog
    // entry was added (avoids depending on the DOM order of the grid).
    component.onAdd(catalogEntry);
    fixture.detectChanges();

    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'AddEquipmentEntry') {
      throw new Error('expected AddEquipmentEntry');
    }
    const entry = cmd.command.entry;
    // Same key set + same values as the catalog defaults.
    expect(entry.settings).toBeDefined();
    expect(entry.settings).toEqual(catalogEntry.defaultSettings);
    // But NOT the same reference — mutating the inventory's settings later
    // must NOT corrupt the catalog entry shared by other inventory rows.
    expect(entry.settings).not.toBe(catalogEntry.defaultSettings);
  });

  it('Add dispatches WITHOUT a settings key when catalog has no defaultSettings', () => {
    const noDefaults = firstWithoutDefaults();
    if (noDefaults === null) {
      // If every shipped catalog entry has defaults, the spread-trick branch
      // is still reachable via a synthetic entry. Build one inline.
      const synthetic: CatalogEquipmentEntry = {
        ...firstEquipmentCatalogEntry(),
      } as CatalogEquipmentEntry;
      delete (synthetic as { defaultSettings?: unknown }).defaultSettings;
      const { fixture, dispatched } = configure();
      fixture.componentInstance.onAdd(synthetic);
      const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      if (cmd.command.kind !== 'AddEquipmentEntry') {
        throw new Error('expected AddEquipmentEntry');
      }
      expect('settings' in cmd.command.entry).toBe(false);
      return;
    }
    const { fixture, dispatched } = configure();
    fixture.componentInstance.onAdd(noDefaults);
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'AddEquipmentEntry') {
      throw new Error('expected AddEquipmentEntry');
    }
    expect('settings' in cmd.command.entry).toBe(false);
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
    if (a.kind !== 'AddEquipmentEntry' || b.kind !== 'AddEquipmentEntry') return;
    expect(a.entry.id).not.toBe(b.entry.id);
  });
});

describe('EquipmentToolComponent — inventory list (store → render → dispatch)', () => {
  function mkEntry(
    overrides: Partial<EquipmentEntry> = {},
    catalog: CatalogEquipmentEntry = firstEquipmentCatalogEntry(),
  ): EquipmentEntry {
    return {
      id: 'entry-1',
      ref: { catalog: catalog.catalog, id: catalog.id, version: catalog.version },
      ...overrides,
    };
  }

  it('renders one inventory row per equipment entry showing name + category badge', () => {
    const catalog = firstEquipmentCatalogEntry();
    const entry = mkEntry({}, catalog);
    const { fixture } = configure({ equipment: [entry] });

    const rows = fixture.nativeElement.querySelectorAll('li.inv-row');
    expect(rows).toHaveLength(1);
    const row = rows[0] as HTMLElement;
    expect(row.querySelector('.inv-row__name')?.textContent ?? '').toContain(catalog.name);
    const badge = row.querySelector('.inv-row__badge');
    expect(badge).not.toBeNull();
    expect((badge?.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('renders the empty-state copy when the inventory is empty', () => {
    const { fixture } = configure({ equipment: [] });
    const empty = fixture.nativeElement.querySelector('.equipment-tool__empty');
    expect(empty?.textContent ?? '').toContain('No equipment yet.');
  });

  it('shows a graceful fallback name + omits the category badge when the catalog entry is missing', () => {
    const entry: EquipmentEntry = {
      id: 'entry-ghost',
      ref: { catalog: 'core', id: 'equipment.filter.no-such-thing', version: 1 },
    };
    const { fixture } = configure({ equipment: [entry] });
    const row = fixture.nativeElement.querySelector('li.inv-row') as HTMLElement;
    expect(row.querySelector('.inv-row__name')?.textContent ?? '').toContain(
      'Unknown equipment',
    );
    // Fallback swatch colour applied because catalog?.color was null.
    const swatch = row.querySelector('.inv-row__swatch') as HTMLElement;
    expect(swatch.style.background.length).toBeGreaterThan(0);
    // Category badge omitted (empty categoryLabel).
    expect(row.querySelector('.inv-row__badge')).toBeNull();
  });

  it('× dispatches removeEquipmentEntry with the entry id', () => {
    const entry = mkEntry();
    const { fixture, dispatched } = configure({ equipment: [entry] });
    const btn = fixture.nativeElement.querySelector('.inv-row__remove') as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();

    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.command.kind).toBe('RemoveEquipmentEntry');
    if (cmd.command.kind !== 'RemoveEquipmentEntry') return;
    expect(cmd.command.entryId).toBe(entry.id);
  });

  it('inventory list container has role="list" and rows have role="listitem"', () => {
    const entry = mkEntry();
    const { fixture } = configure({ equipment: [entry] });
    const list = fixture.nativeElement.querySelector('.equipment-tool__list');
    expect(list?.getAttribute('role')).toBe('list');
    const row = fixture.nativeElement.querySelector('li.inv-row');
    expect(row?.getAttribute('role')).toBe('listitem');
    expect(row?.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('EquipmentToolComponent — note input', () => {
  function mkEntry(
    overrides: Partial<EquipmentEntry> = {},
    catalog: CatalogEquipmentEntry = firstEquipmentCatalogEntry(),
  ): EquipmentEntry {
    return {
      id: 'entry-1',
      ref: { catalog: catalog.catalog, id: catalog.id, version: catalog.version },
      ...overrides,
    };
  }

  function noteInput(fixture: { nativeElement: HTMLElement }): HTMLInputElement {
    return fixture.nativeElement.querySelector('.inv-row__note') as HTMLInputElement;
  }

  it('initial value reflects entry.note when present', () => {
    const entry = mkEntry({ note: 'installed 2024' });
    const { fixture } = configure({ equipment: [entry] });
    const input = noteInput(fixture);
    expect(input.value).toBe('installed 2024');
  });

  it('initial value is empty string when entry has no note', () => {
    const entry = mkEntry();
    const { fixture } = configure({ equipment: [entry] });
    const input = noteInput(fixture);
    expect(input.value).toBe('');
  });

  it('editing + blur with a NEW value dispatches setEquipmentNote(id, trimmed)', () => {
    const entry = mkEntry();
    const { fixture, dispatched } = configure({ equipment: [entry] });
    const input = noteInput(fixture);
    input.value = '  new note  ';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.command.kind).toBe('SetEquipmentNote');
    if (cmd.command.kind !== 'SetEquipmentNote') return;
    expect(cmd.command.entryId).toBe(entry.id);
    expect(cmd.command.note).toBe('new note');
  });

  it('editing + blur with EMPTY trimmed value dispatches setEquipmentNote(id, null)', () => {
    const entry = mkEntry({ note: 'old note' });
    const { fixture, dispatched } = configure({ equipment: [entry] });
    const input = noteInput(fixture);
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.command.kind).toBe('SetEquipmentNote');
    if (cmd.command.kind !== 'SetEquipmentNote') return;
    expect(cmd.command.note).toBeNull();
  });

  it('editing + blur with the SAME value as current entry dispatches NOTHING', () => {
    const entry = mkEntry({ note: 'same' });
    const { fixture, dispatched } = configure({ equipment: [entry] });
    const input = noteInput(fixture);
    input.value = 'same';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(dispatched().length).toBe(0);
  });

  it('blur WITHOUT any prior input is a no-op (user never typed)', () => {
    const entry = mkEntry({ note: 'unchanged' });
    const { fixture, dispatched } = configure({ equipment: [entry] });
    const input = noteInput(fixture);
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(dispatched().length).toBe(0);
  });

  it('input is aria-labelled with the display name', () => {
    const catalog = firstEquipmentCatalogEntry();
    const entry = mkEntry({}, catalog);
    const { fixture } = configure({ equipment: [entry] });
    const input = noteInput(fixture);
    expect(input.getAttribute('aria-label')).toBe(`Note for ${catalog.name}`);
  });
});

describe('EquipmentToolComponent — settings toggle (read-only)', () => {
  function mkEntry(
    overrides: Partial<EquipmentEntry> = {},
    catalog: CatalogEquipmentEntry = firstEquipmentCatalogEntry(),
  ): EquipmentEntry {
    return {
      id: 'entry-1',
      ref: { catalog: catalog.catalog, id: catalog.id, version: catalog.version },
      ...overrides,
    };
  }

  it('renders the toggle when entry.settings is defined; hidden when undefined', () => {
    const withSettings = mkEntry({ settings: { flowPct: 80 } });
    const { fixture: fa } = configure({ equipment: [withSettings] });
    expect(fa.nativeElement.querySelector('.inv-row__settings-toggle')).not.toBeNull();

    TestBed.resetTestingModule();
    const withoutSettings = mkEntry();
    const { fixture: fb } = configure({ equipment: [withoutSettings] });
    expect(fb.nativeElement.querySelector('.inv-row__settings-toggle')).toBeNull();
  });

  it('clicking the toggle expands a <dl> with key/value pairs from entry.settings', () => {
    const entry = mkEntry({ settings: { flowPct: 80, quiet: true } });
    const { fixture } = configure({ equipment: [entry] });
    const c = fixture.componentInstance;

    // Collapsed by default — dl not in the DOM.
    expect(fixture.nativeElement.querySelector('.inv-row__settings')).toBeNull();
    expect(c.isSettingsExpanded(entry.id)).toBe(false);

    const toggle = fixture.nativeElement.querySelector(
      '.inv-row__settings-toggle',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    const dl = fixture.nativeElement.querySelector('.inv-row__settings') as HTMLElement;
    expect(dl).not.toBeNull();
    expect(dl.id).toBe(`settings-${entry.id}`);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(`settings-${entry.id}`);
    expect(c.isSettingsExpanded(entry.id)).toBe(true);

    const keys = Array.from(dl.querySelectorAll('.inv-row__settings-key')).map(
      (el) => (el as HTMLElement).textContent ?? '',
    );
    const vals = Array.from(dl.querySelectorAll('.inv-row__settings-value')).map(
      (el) => (el as HTMLElement).textContent ?? '',
    );
    expect(keys).toEqual(['flowPct', 'quiet']);
    // Numbers render via String(); booleans render as 'on' / 'off'.
    expect(vals).toEqual(['80', 'on']);

    // Click again to collapse.
    toggle.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.inv-row__settings')).toBeNull();
    expect(c.isSettingsExpanded(entry.id)).toBe(false);
  });

  it('expanding one row leaves siblings collapsed', () => {
    const a = mkEntry({ id: 'a', settings: { x: 1 } });
    const b = mkEntry({ id: 'b', settings: { y: 2 } });
    const { fixture } = configure({ equipment: [a, b] });
    const c = fixture.componentInstance;
    const toggles = fixture.nativeElement.querySelectorAll(
      '.inv-row__settings-toggle',
    ) as NodeListOf<HTMLButtonElement>;
    toggles[0].click();
    fixture.detectChanges();
    expect(c.isSettingsExpanded('a')).toBe(true);
    expect(c.isSettingsExpanded('b')).toBe(false);
  });

  it('formats boolean false as "off"', () => {
    const entry = mkEntry({ settings: { quiet: false } });
    const { fixture } = configure({ equipment: [entry] });
    fixture.componentInstance.toggleSettings(entry.id);
    fixture.detectChanges();
    const val = fixture.nativeElement.querySelector('.inv-row__settings-value') as HTMLElement;
    expect((val.textContent ?? '').trim()).toBe('off');
  });
});

describe('EquipmentToolComponent — collapsible header', () => {
  it('renders the header as a button with aria-expanded=true by default', () => {
    const { fixture } = configure();
    const toggle = fixture.nativeElement.querySelector(
      '.panel-header__toggle',
    ) as HTMLButtonElement;
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('equipment-tool-body');
  });

  it('shows the inventory-count badge next to the title (0 by default)', () => {
    const { fixture } = configure();
    const count = fixture.nativeElement.querySelector('.panel-header__count');
    expect(count?.textContent?.trim()).toBe('0');
  });

  it('inventory-count badge reflects the number of equipment entries', () => {
    const catalog = firstEquipmentCatalogEntry();
    const equipment: EquipmentEntry[] = [
      { id: 'a', ref: { catalog: catalog.catalog, id: catalog.id, version: catalog.version } },
      { id: 'b', ref: { catalog: catalog.catalog, id: catalog.id, version: catalog.version } },
    ];
    const { fixture } = configure({ equipment });
    const count = fixture.nativeElement.querySelector('.panel-header__count');
    expect(count?.textContent?.trim()).toBe('2');
  });

  it('clicking the header toggles the collapsed signal and hides the body', () => {
    const { fixture } = configure();
    const toggle = fixture.nativeElement.querySelector(
      '.panel-header__toggle',
    ) as HTMLButtonElement;
    const body = fixture.nativeElement.querySelector('#equipment-tool-body') as HTMLElement;
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
    await storage.set(EQUIPMENT_TOOL_COLLAPSED_KEY, true);
    const { fixture } = configure({ storage });
    await flushPromises();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(true);
  });

  it('ignores a non-boolean stored hydrate value', async () => {
    const storage = new FakeStorageService();
    await storage.set(EQUIPMENT_TOOL_COLLAPSED_KEY, 'true' as unknown as boolean);
    const { fixture } = configure({ storage });
    await flushPromises();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(false);
  });

  it('swallows a hydrate-from-storage rejection', async () => {
    const storage = new FakeStorageService();
    jest.spyOn(storage, 'get').mockRejectedValueOnce(new Error('boom'));
    const { fixture } = configure({ storage });
    await flushPromises();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(false);
  });

  it('does NOT write to storage on the synchronous first-run effect (firstRun guard)', async () => {
    const storage = new FakeStorageService();
    const setSpy = jest.spyOn(storage, 'set');
    configure({ storage });
    await flushPromises();
    expect(setSpy).not.toHaveBeenCalledWith(EQUIPMENT_TOOL_COLLAPSED_KEY, false);
  });

  it('persists collapsed state to StorageService on toggle (after the first-run guard)', async () => {
    const { fixture, storage } = configure();
    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    await flushPromises();
    expect(storage.data.get(EQUIPMENT_TOOL_COLLAPSED_KEY)).toBe(true);

    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    await flushPromises();
    expect(storage.data.get(EQUIPMENT_TOOL_COLLAPSED_KEY)).toBe(false);
  });
});

describe('EquipmentToolComponent — pager', () => {
  it('hides the pager when total entries fit on one page', () => {
    const { fixture } = configure();
    fixture.componentInstance.pageSize.set(coreCatalog.byKind('equipment').length + 10);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pager')).toBeNull();
  });

  it('shows the pager when visibleEntries > pageSize', () => {
    const { fixture } = configure();
    fixture.componentInstance.pageSize.set(2);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pager')).not.toBeNull();
    const total = coreCatalog.byKind('equipment').length;
    expect(fixture.componentInstance.totalPages()).toBe(Math.ceil(total / 2));
    expect(fixture.nativeElement.querySelectorAll('.tile').length).toBe(2);
  });

  it('next + prev navigate within bounds and toggle disabled state', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    fixture.detectChanges();

    let prev = fixture.nativeElement.querySelector(
      '[data-testid="equipment-pager-prev"]',
    ) as HTMLButtonElement;
    let next = fixture.nativeElement.querySelector(
      '[data-testid="equipment-pager-next"]',
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    next.click();
    fixture.detectChanges();
    expect(component.page()).toBe(2);

    const lastPage = component.totalPages();
    while (component.page() < lastPage) {
      next = fixture.nativeElement.querySelector(
        '[data-testid="equipment-pager-next"]',
      ) as HTMLButtonElement;
      next.click();
      fixture.detectChanges();
    }
    next = fixture.nativeElement.querySelector(
      '[data-testid="equipment-pager-next"]',
    ) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    prev = fixture.nativeElement.querySelector(
      '[data-testid="equipment-pager-prev"]',
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
    const lastPage = component.totalPages();
    component.page.set(lastPage);
    // Pick a category with at most 1 page at pageSize=2 — co2 is small.
    component.filter.set('co2');
    fixture.detectChanges();
    expect(component.page()).toBe(component.totalPages());
    expect(component.page()).toBeLessThan(lastPage);
  });

  it('totalPages() returns 1 when the visible list is empty (n === 0 branch)', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    // Force a filter that matches nothing.
    component.filter.set('__none__' as unknown as 'filter');
    fixture.detectChanges();
    expect(component.visibleEntries().length).toBe(0);
    expect(component.totalPages()).toBe(1);
    const body = fixture.nativeElement.querySelector('#equipment-tool-body') as HTMLElement;
    const subheading = body.querySelector('.equipment-tool__subheading');
    const messages = Array.from(body.querySelectorAll('.equipment-tool__empty'));
    const browserEmpty = messages.find((el) =>
      subheading ? precedes(el, subheading) : true,
    );
    expect(browserEmpty?.textContent ?? '').toContain('No equipment matches the filter.');
  });
});
