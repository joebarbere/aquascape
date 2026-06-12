// DecorDragService tests. Mirrors the hardscape-drag.service spec.

import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

import { coreCatalog } from '@aquascape/domain/catalog';

import { DecorDragService } from './decor-drag.service';

const sample = coreCatalog.byKind('decor')[0]!;

describe('DecorDragService', () => {
  let svc: DecorDragService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(DecorDragService);
  });

  it('starts as idle (active() === null)', () => {
    expect(svc.active()).toBeNull();
  });

  it('start() stores the entry + cursor position', () => {
    svc.start(sample, 100, 200);
    expect(svc.active()).toEqual({ entry: sample, clientX: 100, clientY: 200 });
  });

  it('update() refreshes the cursor without losing the entry', () => {
    svc.start(sample, 100, 200);
    svc.update(150, 250);
    expect(svc.active()).toEqual({ entry: sample, clientX: 150, clientY: 250 });
  });

  it('update() is a no-op when not currently dragging', () => {
    svc.update(99, 99);
    expect(svc.active()).toBeNull();
  });

  it('cancel() clears the active state without emitting drop', () => {
    svc.start(sample, 10, 10);
    let dropCount = 0;
    const sub = svc.dropped$.subscribe(() => {
      dropCount += 1;
    });
    svc.cancel();
    expect(svc.active()).toBeNull();
    expect(dropCount).toBe(0);
    sub.unsubscribe();
  });

  it('drop() emits the drop event with the final cursor coords', async () => {
    svc.start(sample, 10, 10);
    const dropped = firstValueFrom(svc.dropped$.pipe(take(1)));
    svc.drop(40, 70);
    const event = await dropped;
    expect(event.entry).toBe(sample);
    expect(event.clientX).toBe(40);
    expect(event.clientY).toBe(70);
    expect(svc.active()).toBeNull();
  });

  it('drop() is a no-op when not dragging (no spurious event)', () => {
    let dropCount = 0;
    const sub = svc.dropped$.subscribe(() => {
      dropCount += 1;
    });
    svc.drop(0, 0);
    expect(dropCount).toBe(0);
    sub.unsubscribe();
  });
});
