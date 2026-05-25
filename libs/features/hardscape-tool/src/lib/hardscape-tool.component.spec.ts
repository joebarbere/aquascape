// HardscapeToolComponent tests. Stage 3 F3.1 / F3.2.

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

import { HardscapeDragService } from './hardscape-drag.service';
import {
  HARDSCAPE_TOOL_COLLAPSED_KEY,
  HARDSCAPE_TOOL_PAGE_SIZE,
  HardscapeToolComponent,
} from './hardscape-tool.component';

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
    imports: [HardscapeToolComponent],
    providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
  });
  const fixture = TestBed.createComponent(HardscapeToolComponent);
  fixture.detectChanges();
  return { fixture, dragService: TestBed.inject(HardscapeDragService), storage };
}

/** Wait for two microtask flushes so storage.get() + the resulting set() resolve. */
async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('HardscapeToolComponent', () => {
  it('renders one tile per hardscape entry on the first page (default filter)', () => {
    const { fixture } = configure();
    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    // First page caps at HARDSCAPE_TOOL_PAGE_SIZE; total tiles equals catalog length if smaller.
    const expected = Math.min(HARDSCAPE_TOOL_PAGE_SIZE, coreCatalog.byKind('hardscape').length);
    expect(tiles.length).toBe(expected);
  });

  it('renders an SVG silhouette polygon per visible tile', () => {
    const { fixture } = configure();
    const polys = fixture.nativeElement.querySelectorAll('polygon');
    expect(polys.length).toBe(fixture.nativeElement.querySelectorAll('.tile').length);
  });

  it('filters by category when the user clicks a filter chip', () => {
    const { fixture } = configure();
    const rockFilter = Array.from(
      fixture.nativeElement.querySelectorAll('.filter') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Rock')!;
    rockFilter.click();
    fixture.detectChanges();
    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    const rockCount = coreCatalog.byKind('hardscape').filter((e) => e.category === 'rock').length;
    expect(tiles.length).toBe(Math.min(HARDSCAPE_TOOL_PAGE_SIZE, rockCount));
  });

  it('shows the empty-state message when no entries match the filter', () => {
    const { fixture } = configure();
    // 'other' has no entries in the bundled core catalog.
    (fixture.componentInstance.filter as unknown as { set: (v: string) => void }).set('other');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.hardscape-tool__empty')).not.toBeNull();
  });

  it('pointerdown on a tile starts a drag in the service', () => {
    const { fixture, dragService } = configure();
    const tile = fixture.nativeElement.querySelector('.tile') as HTMLElement;
    expect(dragService.active()).toBeNull();
    tile.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 5, clientY: 6 }),
    );
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

describe('HardscapeToolComponent — collapsible header', () => {
  it('renders the header as a button with aria-expanded=true by default', () => {
    const { fixture } = configure();
    const toggle = fixture.nativeElement.querySelector('.panel-header__toggle') as HTMLButtonElement;
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('hardscape-tool-body');
  });

  it('shows the panel total-count badge next to the title', () => {
    const { fixture } = configure();
    const count = fixture.nativeElement.querySelector('.panel-header__count');
    expect(count).not.toBeNull();
    expect(count!.textContent?.trim()).toBe(String(coreCatalog.byKind('hardscape').length));
  });

  it('clicking the header toggles the collapsed signal and hides the body', () => {
    const { fixture } = configure();
    const toggle = fixture.nativeElement.querySelector('.panel-header__toggle') as HTMLButtonElement;
    const body = fixture.nativeElement.querySelector('#hardscape-tool-body') as HTMLElement;
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
    expect(storage.data.get(HARDSCAPE_TOOL_COLLAPSED_KEY)).toBe(true);
    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    await flushPromises();
    expect(storage.data.get(HARDSCAPE_TOOL_COLLAPSED_KEY)).toBe(false);
  });

  it('hydrates the collapsed signal from StorageService on init', async () => {
    const storage = new FakeStorageService();
    await storage.set(HARDSCAPE_TOOL_COLLAPSED_KEY, true);
    const { fixture } = configure({ storage });
    await flushPromises();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(true);
  });
});

describe('HardscapeToolComponent — pager', () => {
  it('hides the pager when total entries ≤ page size', () => {
    const { fixture } = configure();
    // Inflate pageSize past the full catalog so everything fits on page 1.
    fixture.componentInstance.pageSize.set(coreCatalog.byKind('hardscape').length + 10);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pager')).toBeNull();
  });

  it('shows the pager when visibleEntries() > pageSize (shrink pageSize for the test)', () => {
    const { fixture } = configure();
    const totalEntries = coreCatalog.byKind('hardscape').length;
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
      '[data-testid="hardscape-pager-prev"]',
    ) as HTMLButtonElement;
    let next = fixture.nativeElement.querySelector(
      '[data-testid="hardscape-pager-next"]',
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(true); // page 1 → prev disabled
    expect(next.disabled).toBe(false);

    next.click();
    fixture.detectChanges();
    expect(component.page()).toBe(2);
    prev = fixture.nativeElement.querySelector(
      '[data-testid="hardscape-pager-prev"]',
    ) as HTMLButtonElement;
    next = fixture.nativeElement.querySelector(
      '[data-testid="hardscape-pager-next"]',
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(false);

    // Walk to the last page without hardcoding page count.
    const lastPage = component.totalPages();
    while (component.page() < lastPage) {
      next = fixture.nativeElement.querySelector(
        '[data-testid="hardscape-pager-next"]',
      ) as HTMLButtonElement;
      next.click();
      fixture.detectChanges();
    }
    expect(component.page()).toBe(lastPage);
    next = fixture.nativeElement.querySelector(
      '[data-testid="hardscape-pager-next"]',
    ) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    prev = fixture.nativeElement.querySelector(
      '[data-testid="hardscape-pager-prev"]',
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
    component.onFilterChange('rock');
    expect(component.page()).toBe(1);
    expect(component.filter()).toBe('rock');
  });

  it('clicking a filter chip resets page back to 1', () => {
    const { fixture } = configure();
    fixture.componentInstance.pageSize.set(2);
    fixture.componentInstance.page.set(2);
    const rockFilter = Array.from(
      fixture.nativeElement.querySelectorAll('.filter') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Rock')!;
    rockFilter.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.page()).toBe(1);
  });

  it('clamps the page when the visible list shrinks below the current page', () => {
    const { fixture } = configure();
    const component = fixture.componentInstance;
    component.pageSize.set(2);
    fixture.detectChanges();
    component.page.set(component.totalPages()); // last page
    // Switch to 'rock' which has fewer entries → totalPages drops; the effect
    // should clamp the current page down to the new max.
    component.onFilterChange('rock');
    fixture.detectChanges();
    expect(component.page()).toBeLessThanOrEqual(component.totalPages());
  });
});
