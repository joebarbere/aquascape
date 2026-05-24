import { firstValueFrom } from 'rxjs';
import { take, toArray } from 'rxjs/operators';

import { PlantDragService } from './plant-drag.service';

const fakeEntry = {
  catalog: 'core',
  id: 'plant.test',
  version: 1,
  name: 'Test plant',
  kind: 'plant' as const,
  zone: 'foreground' as const,
  lighting: 'medium' as const,
  co2: 'low' as const,
  difficulty: 'easy' as const,
  color: '#3a8050',
  naturalSize: { width: 40, height: 60, depth: 40 },
  silhouette: [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 0, y: 1 },
  ],
  growth: { weeksToMature: 6, sizeAtZero: 0.3 },
} as const;

describe('PlantDragService', () => {
  it('start() sets the active snapshot', () => {
    const svc = new PlantDragService();
    svc.start(fakeEntry, 10, 20);
    expect(svc.active()).toEqual({ entry: fakeEntry, clientX: 10, clientY: 20 });
  });

  it('update() rewrites the cursor coordinates but keeps the entry', () => {
    const svc = new PlantDragService();
    svc.start(fakeEntry, 10, 20);
    svc.update(50, 60);
    expect(svc.active()).toEqual({ entry: fakeEntry, clientX: 50, clientY: 60 });
  });

  it('update() before start is a no-op (no in-flight drag)', () => {
    const svc = new PlantDragService();
    svc.update(50, 60);
    expect(svc.active()).toBeNull();
  });

  it('cancel() clears the active snapshot', () => {
    const svc = new PlantDragService();
    svc.start(fakeEntry, 10, 20);
    svc.cancel();
    expect(svc.active()).toBeNull();
  });

  it('drop() emits a single dropped$ event and clears active', async () => {
    const svc = new PlantDragService();
    const eventsPromise = firstValueFrom(svc.dropped$.pipe(take(1), toArray()));
    svc.start(fakeEntry, 0, 0);
    svc.drop(100, 200);
    expect(svc.active()).toBeNull();
    expect(await eventsPromise).toEqual([{ entry: fakeEntry, clientX: 100, clientY: 200 }]);
  });

  it('drop() with no in-flight drag is a no-op (no emission)', () => {
    const svc = new PlantDragService();
    let emitted = 0;
    svc.dropped$.subscribe(() => emitted++);
    svc.drop(0, 0);
    expect(emitted).toBe(0);
  });
});
