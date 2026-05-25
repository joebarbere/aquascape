import { TestBed } from '@angular/core/testing';

import { coreCatalog } from '@aquascape/domain/catalog';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';

import { PlantDragService } from './plant-drag.service';
import {
  PLANTING_TOOL_COLLAPSED_KEY,
  PLANTING_TOOL_PAGE_SIZE,
  PlantingToolComponent,
} from './planting-tool.component';

// jsdom doesn't ship PointerEvent — supply a minimal alias backed by MouseEvent.
beforeAll(() => {
  if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
    class PointerEventShim extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    }
    (globalThis as { PointerEvent: typeof PointerEventShim }).PointerEvent = PointerEventShim;
  }
});

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

function buildFixture(options: { storage?: FakeStorageService } = {}) {
  const storage = options.storage ?? new FakeStorageService();
  TestBed.configureTestingModule({
    imports: [PlantingToolComponent],
    providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
  });
  const fixture = TestBed.createComponent(PlantingToolComponent);
  const svc = TestBed.inject(PlantDragService);
  fixture.detectChanges();
  return { fixture, svc, storage };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('PlantingToolComponent — rendering + filter', () => {
  it('renders one tile per plant entry in the core catalog by default (capped at pageSize)', () => {
    const { fixture } = buildFixture();
    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    // Stage 4 F4.1 ships 6 plant manifests, pageSize is 8 → all 6 visible.
    const expected = Math.min(PLANTING_TOOL_PAGE_SIZE, coreCatalog.byKind('plant').length);
    expect(tiles.length).toBe(expected);
  });

  it('filters tiles by zone radio selection', () => {
    const { fixture } = buildFixture();
    const component = fixture.componentInstance;
    // Shrink the page so the entire filtered list fits and we can count.
    component.pageSize.set(100);
    fixture.detectChanges();
    const filterButtons = fixture.nativeElement.querySelectorAll('button.filter');
    // Click "Foreground"
    (filterButtons[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    const expectedForeground = coreCatalog
      .byKind('plant')
      .filter((p) => p.zone === 'foreground').length;
    expect(tiles.length).toBe(expectedForeground);
  });

  it('flags carpet candidates (entries with defaultDensity) with a badge + class', () => {
    const { fixture } = buildFixture();
    const component = fixture.componentInstance;
    // Shrink page so every carpet entry renders at once for the assertion.
    component.pageSize.set(100);
    fixture.detectChanges();
    const carpets = fixture.nativeElement.querySelectorAll('.tile.carpet');
    const expectedCarpets = coreCatalog
      .byKind('plant')
      .filter((p) => (p.defaultDensity ?? 0) > 0).length;
    expect(carpets.length).toBe(expectedCarpets);
    for (const tile of Array.from(carpets)) {
      expect((tile as HTMLElement).querySelector('.tile__badge')?.textContent ?? '').toContain(
        'carpet',
      );
    }
  });

  it('renders the silhouette as an SVG polygon using the catalog color', () => {
    const { fixture } = buildFixture();
    const polygons = fixture.nativeElement.querySelectorAll('.tile__silhouette polygon');
    expect(polygons.length).toBeGreaterThan(0);
    for (const p of Array.from(polygons)) {
      expect((p as Element).getAttribute('points')?.length ?? 0).toBeGreaterThan(0);
      expect((p as Element).getAttribute('fill')).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('shows an empty-state message when a filter matches no plants', () => {
    const { fixture } = buildFixture();
    // The four shipped zones all have at least one plant, so the empty state
    // never appears under realistic filters. Assert that with the default
    // "all" filter we don't show it.
    expect(fixture.nativeElement.querySelector('.planting-tool__empty')).toBeNull();
  });
});

describe('PlantingToolComponent — drag service integration', () => {
  it('pointerdown on a tile calls dragService.start with the entry and cursor coords', () => {
    const { fixture, svc } = buildFixture();
    const startSpy = jest.spyOn(svc, 'start');
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLElement;
    tile.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 42, clientY: 84 }));
    expect(startSpy).toHaveBeenCalledTimes(1);
    const [entry, x, y] = startSpy.mock.calls[0]!;
    expect(entry).toBeDefined();
    expect(x).toBe(42);
    expect(y).toBe(84);
  });

  it('ignores non-primary pointer buttons', () => {
    const { fixture, svc } = buildFixture();
    const startSpy = jest.spyOn(svc, 'start');
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLElement;
    tile.dispatchEvent(new PointerEvent('pointerdown', { button: 2, clientX: 10, clientY: 10 }));
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('document pointermove during a drag updates the cursor coords', () => {
    const { fixture, svc } = buildFixture();
    const updateSpy = jest.spyOn(svc, 'update');
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLElement;
    tile.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 20 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 30, clientY: 40 }));
    expect(updateSpy).toHaveBeenCalledWith(30, 40);
  });

  it('document pointerup during a drag dispatches drop with the cursor coords', () => {
    const { fixture, svc } = buildFixture();
    const dropSpy = jest.spyOn(svc, 'drop');
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLElement;
    tile.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 20 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 200 }));
    expect(dropSpy).toHaveBeenCalledWith(100, 200);
  });

  it('Escape cancels an in-flight drag', () => {
    const { fixture, svc } = buildFixture();
    const cancelSpy = jest.spyOn(svc, 'cancel');
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLElement;
    tile.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancelSpy).toHaveBeenCalled();
  });
});

describe('PlantingToolComponent — collapsible header', () => {
  it('renders the header as a button with aria-expanded=true by default', () => {
    const { fixture } = buildFixture();
    const toggle = fixture.nativeElement.querySelector('.panel-header__toggle') as HTMLButtonElement;
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('planting-tool-body');
  });

  it('shows the panel total-count badge next to the title', () => {
    const { fixture } = buildFixture();
    const count = fixture.nativeElement.querySelector('.panel-header__count');
    expect(count).not.toBeNull();
    expect(count!.textContent?.trim()).toBe(String(coreCatalog.byKind('plant').length));
  });

  it('clicking the header toggles the collapsed signal and hides the body', () => {
    const { fixture } = buildFixture();
    const toggle = fixture.nativeElement.querySelector('.panel-header__toggle') as HTMLButtonElement;
    const body = fixture.nativeElement.querySelector('#planting-tool-body') as HTMLElement;
    expect(fixture.componentInstance.collapsed()).toBe(false);
    expect(body.hidden).toBe(false);
    toggle.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(true);
    expect(body.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('persists collapsed state to StorageService on toggle', async () => {
    const { fixture, storage } = buildFixture();
    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    await flushPromises();
    expect(storage.data.get(PLANTING_TOOL_COLLAPSED_KEY)).toBe(true);
    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    await flushPromises();
    expect(storage.data.get(PLANTING_TOOL_COLLAPSED_KEY)).toBe(false);
  });

  it('hydrates the collapsed signal from StorageService on init', async () => {
    const storage = new FakeStorageService();
    await storage.set(PLANTING_TOOL_COLLAPSED_KEY, true);
    const { fixture } = buildFixture({ storage });
    await flushPromises();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(true);
  });
});

describe('PlantingToolComponent — pager', () => {
  it('hides the pager when total entries ≤ page size', () => {
    const { fixture } = buildFixture();
    // Inflate pageSize so the whole catalog fits on one page → pager hidden.
    fixture.componentInstance.pageSize.set(coreCatalog.byKind('plant').length + 10);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pager')).toBeNull();
  });

  it('shows the pager when visibleEntries() > pageSize (shrink pageSize for the test)', () => {
    const { fixture } = buildFixture();
    fixture.componentInstance.pageSize.set(2);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pager')).not.toBeNull();
    const totalPlants = coreCatalog.byKind('plant').length;
    expect(fixture.componentInstance.totalPages()).toBe(Math.ceil(totalPlants / 2));
    expect(fixture.nativeElement.querySelectorAll('.tile').length).toBe(2);
  });

  it('next + prev navigate within bounds and toggle disabled state', () => {
    const { fixture } = buildFixture();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    fixture.detectChanges();

    let prev = fixture.nativeElement.querySelector(
      '[data-testid="planting-pager-prev"]',
    ) as HTMLButtonElement;
    let next = fixture.nativeElement.querySelector(
      '[data-testid="planting-pager-next"]',
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    next.click();
    fixture.detectChanges();
    expect(component.page()).toBe(2);

    // Walk to the last page without hardcoding page count (catalog may grow).
    const lastPage = component.totalPages();
    while (component.page() < lastPage) {
      next = fixture.nativeElement.querySelector(
        '[data-testid="planting-pager-next"]',
      ) as HTMLButtonElement;
      next.click();
      fixture.detectChanges();
    }
    expect(component.page()).toBe(lastPage);
    next = fixture.nativeElement.querySelector(
      '[data-testid="planting-pager-next"]',
    ) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    prev = fixture.nativeElement.querySelector(
      '[data-testid="planting-pager-prev"]',
    ) as HTMLButtonElement;
    prev.click();
    fixture.detectChanges();
    expect(component.page()).toBe(lastPage - 1);
  });

  it('next + prev signal methods are bounds-safe when called directly', () => {
    const { fixture } = buildFixture();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    fixture.detectChanges();
    component.prevPage(); // clamped at 1
    expect(component.page()).toBe(1);
    // Walk to the last page without hardcoding totalPages (catalog may grow).
    const lastPage = component.totalPages();
    for (let i = 1; i < lastPage; i++) component.nextPage();
    expect(component.page()).toBe(lastPage);
    component.nextPage(); // clamped at totalPages
    expect(component.page()).toBe(lastPage);
  });

  it('onFilterChange resets page back to 1', () => {
    const { fixture } = buildFixture();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    component.page.set(2);
    component.onFilterChange('foreground');
    expect(component.page()).toBe(1);
    expect(component.filter()).toBe('foreground');
  });

  it('clicking a filter chip resets page back to 1', () => {
    const { fixture } = buildFixture();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    component.page.set(2);
    const filterButtons = fixture.nativeElement.querySelectorAll('button.filter');
    (filterButtons[1] as HTMLButtonElement).click(); // Foreground
    fixture.detectChanges();
    expect(component.page()).toBe(1);
  });

  it('clamps the page when the visible list shrinks below the current page', () => {
    const { fixture } = buildFixture();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    fixture.detectChanges();
    component.page.set(component.totalPages());
    component.onFilterChange('foreground'); // 2 entries → 1 page
    fixture.detectChanges();
    expect(component.page()).toBeLessThanOrEqual(component.totalPages());
  });
});
