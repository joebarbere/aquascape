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

import { HardscapeDragService } from './hardscape-drag.service';
import { HardscapeToolComponent } from './hardscape-tool.component';

function configure() {
  TestBed.configureTestingModule({ imports: [HardscapeToolComponent] });
  const fixture = TestBed.createComponent(HardscapeToolComponent);
  fixture.detectChanges();
  return { fixture, dragService: TestBed.inject(HardscapeDragService) };
}

describe('HardscapeToolComponent', () => {
  it('renders one tile per hardscape entry (all, default filter)', () => {
    const { fixture } = configure();
    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    expect(tiles.length).toBe(coreCatalog.byKind('hardscape').length);
  });

  it('renders an SVG silhouette polygon per tile', () => {
    const { fixture } = configure();
    const polys = fixture.nativeElement.querySelectorAll('polygon');
    expect(polys.length).toBe(coreCatalog.byKind('hardscape').length);
  });

  it('filters by category when the user clicks a filter chip', () => {
    const { fixture } = configure();
    const rockFilter = Array.from(
      fixture.nativeElement.querySelectorAll('.filter') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Rock')!;
    rockFilter.click();
    fixture.detectChanges();
    const tiles = fixture.nativeElement.querySelectorAll('.tile');
    expect(tiles.length).toBe(
      coreCatalog.byKind('hardscape').filter((e) => e.category === 'rock').length,
    );
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
