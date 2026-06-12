// DecorationsToolComponent tests. Mirrors the hardscape-tool spec style.

import { TestBed } from '@angular/core/testing';

// jsdom doesn't ship PointerEvent natively; polyfill it as a MouseEvent
// subclass with the fields the component reads (button, clientX, clientY).
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  (globalThis as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

import { coreCatalog } from '@aquascape/domain/catalog';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';

import { DecorDragService } from './decor-drag.service';
import {
  DECORATIONS_TOOL_COLLAPSED_KEY,
  DECORATIONS_TOOL_PAGE_SIZE,
  DecorationsToolComponent,
} from './decorations-tool.component';

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

function configure(options: { storage?: FakeStorageService } = {}) {
  const storage = options.storage ?? new FakeStorageService();
  TestBed.configureTestingModule({
    imports: [DecorationsToolComponent],
    providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
  });
  const fixture = TestBed.createComponent(DecorationsToolComponent);
  fixture.detectChanges();
  return { fixture, dragService: TestBed.inject(DecorDragService), storage };
}

/** Wait for two microtask flushes so storage.get() + the resulting set() resolve. */
async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DecorationsToolComponent', () => {
  it('the core catalog ships ten decor entries for the panel', () => {
    expect(coreCatalog.byKind('decor').length).toBe(10);
  });

  it('renders one tile per decor entry on the first page (default filter)', () => {
    const { fixture } = configure();
    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    // First page caps at DECORATIONS_TOOL_PAGE_SIZE; total tiles equals catalog length if smaller.
    const expected = Math.min(DECORATIONS_TOOL_PAGE_SIZE, coreCatalog.byKind('decor').length);
    expect(tiles.length).toBe(expected);
  });

  it('renders an SVG silhouette polygon per visible tile', () => {
    const { fixture } = configure();
    const polys = fixture.nativeElement.querySelectorAll('polygon');
    expect(polys.length).toBe(fixture.nativeElement.querySelectorAll('.tile').length);
  });

  it('fills each silhouette polygon with the entry color', () => {
    const { fixture } = configure();
    const first = coreCatalog.byKind('decor')[0]!;
    const poly = fixture.nativeElement.querySelector('polygon') as SVGPolygonElement;
    expect(poly.getAttribute('fill')).toBe(first.color);
  });

  it('shows All / Wreck / Ruin / Bones / Structure filter chips', () => {
    const { fixture } = configure();
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.filter') as NodeListOf<HTMLButtonElement>,
    ).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['All', 'Wreck', 'Ruin', 'Bones', 'Structure']);
  });

  it('filters by category when the user clicks a filter chip', () => {
    const { fixture } = configure();
    const wreckFilter = Array.from(
      fixture.nativeElement.querySelectorAll('.filter') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Wreck')!;
    wreckFilter.click();
    fixture.detectChanges();
    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    const wreckCount = coreCatalog.byKind('decor').filter((e) => e.category === 'wreck').length;
    expect(wreckCount).toBeGreaterThan(0);
    expect(tiles.length).toBe(Math.min(DECORATIONS_TOOL_PAGE_SIZE, wreckCount));
  });

  it('every category chip has aria-checked synced to the active filter', () => {
    const { fixture } = configure();
    const chips = Array.from(
      fixture.nativeElement.querySelectorAll('.filter') as NodeListOf<HTMLButtonElement>,
    );
    expect(chips.map((c) => c.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    chips[2]!.click(); // 'Ruin'
    fixture.detectChanges();
    const after = Array.from(
      fixture.nativeElement.querySelectorAll('.filter') as NodeListOf<HTMLButtonElement>,
    );
    expect(after[2]!.getAttribute('aria-checked')).toBe('true');
    expect(after[0]!.getAttribute('aria-checked')).toBe('false');
  });

  it('shows the empty-state message when no entries match the filter', () => {
    const { fixture } = configure();
    // Force an impossible filter value directly — the bundled core catalog
    // covers every category, so we drive the signal to a synthetic value.
    (fixture.componentInstance.filter as unknown as { set: (v: string) => void }).set(
      'no-such-category',
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.decorations-tool__empty')).not.toBeNull();
  });

  it('tiles carry an accessible drag label', () => {
    const { fixture } = configure();
    const first = coreCatalog.byKind('decor')[0]!;
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLButtonElement;
    expect(tile.getAttribute('aria-label')).toBe(`Drag ${first.name} onto the canvas`);
    expect(tile.tagName).toBe('BUTTON');
  });

  it('pointerdown on a tile starts a drag in the service', () => {
    const { fixture, dragService } = configure();
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLElement;
    expect(dragService.active()).toBeNull();
    tile.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 5, clientY: 6 }));
    expect(dragService.active()).not.toBeNull();
    expect(dragService.active()?.clientX).toBe(5);
  });

  it('pointermove on the document updates the drag cursor', () => {
    const { fixture, dragService } = configure();
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLElement;
    tile.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 1, clientY: 1 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 30 }));
    expect(dragService.active()?.clientX).toBe(20);
    expect(dragService.active()?.clientY).toBe(30);
  });

  it('pointerup on the document drops and emits via dropped$', () => {
    const { fixture, dragService } = configure();
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLElement;
    const drops: number[] = [];
    const sub = dragService.dropped$.subscribe((e) => drops.push(e.clientX));
    tile.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 1, clientY: 1 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 88, clientY: 99 }));
    expect(drops).toEqual([88]);
    expect(dragService.active()).toBeNull();
    sub.unsubscribe();
  });

  it('Escape cancels an in-flight drag', () => {
    const { fixture, dragService } = configure();
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLElement;
    tile.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 1, clientY: 1 }));
    expect(dragService.active()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dragService.active()).toBeNull();
  });

  it('ignores secondary mouse buttons on pointerdown', () => {
    const { fixture, dragService } = configure();
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLElement;
    tile.dispatchEvent(new PointerEvent('pointerdown', { button: 2, clientX: 1, clientY: 1 }));
    expect(dragService.active()).toBeNull();
  });
});

describe('DecorationsToolComponent — collapsible header', () => {
  it('renders the header as a button with aria-expanded=true by default', () => {
    const { fixture } = configure();
    const toggle = fixture.nativeElement.querySelector('.panel-header__toggle') as HTMLButtonElement;
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('decorations-tool-body');
  });

  it('shows the panel total-count badge next to the title', () => {
    const { fixture } = configure();
    const count = fixture.nativeElement.querySelector('.panel-header__count');
    expect(count).not.toBeNull();
    expect(count!.textContent?.trim()).toBe(String(coreCatalog.byKind('decor').length));
  });

  it('clicking the header toggles the collapsed signal and hides the body', () => {
    const { fixture } = configure();
    const toggle = fixture.nativeElement.querySelector('.panel-header__toggle') as HTMLButtonElement;
    const body = fixture.nativeElement.querySelector('#decorations-tool-body') as HTMLElement;
    expect(fixture.componentInstance.collapsed()).toBe(false);
    expect(body.hidden).toBe(false);
    toggle.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(true);
    expect(body.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('persists collapsed state to StorageService on toggle', async () => {
    const { fixture, storage } = configure();
    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    await flushPromises();
    expect(storage.data.get(DECORATIONS_TOOL_COLLAPSED_KEY)).toBe(true);
    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    await flushPromises();
    expect(storage.data.get(DECORATIONS_TOOL_COLLAPSED_KEY)).toBe(false);
  });

  it('hydrates the collapsed signal from StorageService on init', async () => {
    const storage = new FakeStorageService();
    await storage.set(DECORATIONS_TOOL_COLLAPSED_KEY, true);
    const { fixture } = configure({ storage });
    await flushPromises();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(true);
  });
});

describe('DecorationsToolComponent — pager', () => {
  it('hides the pager when total entries ≤ page size', () => {
    const { fixture } = configure();
    // Inflate pageSize past the full catalog so everything fits on page 1.
    fixture.componentInstance.pageSize.set(coreCatalog.byKind('decor').length + 10);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pager')).toBeNull();
  });

  it('shows the pager when visibleEntries() > pageSize (shrink pageSize for the test)', () => {
    const { fixture } = configure();
    const totalEntries = coreCatalog.byKind('decor').length;
    // Shrink the pageSize to force multi-page output.
    fixture.componentInstance.pageSize.set(2);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pager')).not.toBeNull();
    expect(fixture.componentInstance.totalPages()).toBe(Math.ceil(totalEntries / 2));
    expect(fixture.nativeElement.querySelectorAll('.tile').length).toBe(2);
  });

  it('next + prev navigate within bounds and toggle disabled state', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    fixture.detectChanges();

    let prev = fixture.nativeElement.querySelector(
      '[data-testid="decorations-pager-prev"]',
    ) as HTMLButtonElement;
    let next = fixture.nativeElement.querySelector(
      '[data-testid="decorations-pager-next"]',
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(true); // page 1 → prev disabled
    expect(next.disabled).toBe(false);

    next.click();
    fixture.detectChanges();
    expect(component.page()).toBe(2);
    prev = fixture.nativeElement.querySelector(
      '[data-testid="decorations-pager-prev"]',
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(false);

    // Walk to the last page without hardcoding page count.
    const lastPage = component.totalPages();
    while (component.page() < lastPage) {
      next = fixture.nativeElement.querySelector(
        '[data-testid="decorations-pager-next"]',
      ) as HTMLButtonElement;
      next.click();
      fixture.detectChanges();
    }
    expect(component.page()).toBe(lastPage);
    next = fixture.nativeElement.querySelector(
      '[data-testid="decorations-pager-next"]',
    ) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    prev = fixture.nativeElement.querySelector(
      '[data-testid="decorations-pager-prev"]',
    ) as HTMLButtonElement;
    prev.click();
    fixture.detectChanges();
    expect(component.page()).toBe(lastPage - 1);
  });

  it('next + prev signal methods are bounds-safe even when called directly', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    fixture.detectChanges();
    expect(component.page()).toBe(1);
    component.prevPage(); // clamped at 1
    expect(component.page()).toBe(1);
    component.nextPage();
    expect(component.page()).toBe(2);
    const lastPage = component.totalPages();
    while (component.page() < lastPage) component.nextPage();
    expect(component.page()).toBe(lastPage);
    component.nextPage(); // clamped at totalPages
    expect(component.page()).toBe(lastPage);
  });

  it('onFilterChange resets page back to 1', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    component.page.set(2);
    component.onFilterChange('wreck');
    expect(component.page()).toBe(1);
    expect(component.filter()).toBe('wreck');
  });

  it('clicking a filter chip resets page back to 1', () => {
    const { fixture } = configure();
    fixture.componentInstance.pageSize.set(2);
    fixture.componentInstance.page.set(2);
    const wreckFilter = Array.from(
      fixture.nativeElement.querySelectorAll('.filter') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Wreck')!;
    wreckFilter.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.page()).toBe(1);
  });

  it('clamps the page when the visible list shrinks below the current page', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    fixture.detectChanges();
    component.page.set(component.totalPages()); // last page
    // Switch to 'wreck' which has fewer entries → totalPages drops; the
    // effect should clamp the current page down to the new max.
    component.onFilterChange('wreck');
    fixture.detectChanges();
    expect(component.page()).toBeLessThanOrEqual(component.totalPages());
  });
});
