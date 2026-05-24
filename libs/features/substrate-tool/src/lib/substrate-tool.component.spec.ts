// SubstrateToolComponent tests. F2.2.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  SceneActions,
  defaultScene,
  selectSubstrateRegions,
} from '@aquascape/state';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import type { Action } from '@ngrx/store';

import { SubstrateToolComponent } from './substrate-tool.component';
import type { SubstrateRegion } from '@aquascape/domain/scene-model';

function regionFixture(overrides: Partial<SubstrateRegion> = {}): SubstrateRegion {
  return {
    id: 'r-1',
    material: { catalog: 'core', id: 'substrate.aquasoil.amazonia', version: 1 },
    fromX: 0,
    toX: 1,
    profile: [
      { x: 0, y: 30 },
      { x: 1, y: 30 },
    ],
    ...overrides,
  };
}

function configure(regions: readonly SubstrateRegion[] = []) {
  TestBed.configureTestingModule({
    imports: [SubstrateToolComponent],
    providers: [
      provideMockStore({
        initialState: { scene: { scene: defaultScene(), history: { past: [], future: [], limit: 200 } } },
        selectors: [{ selector: selectSubstrateRegions, value: regions as never }],
      }),
    ],
  });
  const fixture = TestBed.createComponent(SubstrateToolComponent);
  fixture.detectChanges();
  // Wrap dispatch in a spy so every test can inspect what was dispatched
  // without re-installing the spy each time.
  const getActions = watchDispatches(TestBed.inject(MockStore));
  return { fixture, getActions };
}

/**
 * Helper: wrap `store.dispatch` in a spy so tests can inspect dispatched
 * actions. Returns a getter that captures everything dispatched since the
 * spy was installed.
 */
function watchDispatches(store: MockStore): () => Action[] {
  const spy = jest.spyOn(store, 'dispatch');
  return () => spy.mock.calls.map((c) => c[0] as Action);
}

function byText(fixture: ComponentFixture<unknown>, text: string): HTMLButtonElement | null {
  const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
  for (const b of buttons) {
    if (b.textContent?.trim() === text) return b;
  }
  return null;
}

describe('SubstrateToolComponent', () => {
  it('renders the empty state when there are no regions', () => {
    const { fixture } = configure();
    const empty = fixture.nativeElement.querySelector('.substrate-tool__empty');
    expect(empty).not.toBeNull();
  });

  it('renders one card per region', () => {
    const { fixture } = configure([regionFixture({ id: 'a' }), regionFixture({ id: 'b' })]);
    const cards = fixture.nativeElement.querySelectorAll('.substrate-tool__region');
    expect(cards.length).toBe(2);
  });

  describe('Add region', () => {
    it('dispatches an AddSubstrateRegion command with the first catalog substrate', () => {
      const { fixture, getActions } = configure();
      byText(fixture, '+ Add region')!.click();
      const actions = getActions();
      expect(actions.length).toBe(1);
      const action = actions[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      expect(action.type).toBe('[Scene] Dispatch Command');
      const cmd = action.command;
      expect(cmd.kind).toBe('AddSubstrateRegion');
      if (cmd.kind !== 'AddSubstrateRegion') return;
      expect(cmd.region.material.catalog).toBe('core');
      expect(cmd.region.profile.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Remove region', () => {
    it('dispatches a RemoveSubstrateRegion command with the region id', () => {
      const { fixture, getActions } = configure([regionFixture({ id: 'r-1' })]);
      byText(fixture, 'Delete')!.click();
      const actions = getActions();
      expect(actions.length).toBeGreaterThan(0);
      const action = actions[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      expect(action.command.kind).toBe('RemoveSubstrateRegion');
    });
  });

  describe('Change material', () => {
    it('dispatches a SetSubstrateRegionMaterial command', () => {
      const { fixture, getActions } = configure([regionFixture()]);
      const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.value);
      const next = options.find((o) => o !== select.value);
      expect(next).toBeDefined();
      select.value = next!;
      select.dispatchEvent(new Event('change'));
      const actions = getActions();
      expect(actions.length).toBeGreaterThan(0);
      const action = actions[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      expect(action.command.kind).toBe('SetSubstrateRegionMaterial');
    });

    it('ignores a change to an unknown material id (defensive)', () => {
      const { fixture, getActions } = configure([regionFixture()]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      component.onChangeMaterial('r-1', 'not-an-id');
      expect(getActions()).toEqual([]);
    });
  });

  describe('Change extent', () => {
    it('clamps fromX into [0, 1] and dispatches SetSubstrateRegionExtent', () => {
      const { fixture, getActions } = configure([regionFixture({ fromX: 0.2, toX: 0.8, blend: 5 })]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      component.onExtentChange(regionFixture({ fromX: 0.2, toX: 0.8, blend: 5 }), 'fromX', 2);
      const action = getActions()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      expect(action.command.kind).toBe('SetSubstrateRegionExtent');
      if (action.command.kind !== 'SetSubstrateRegionExtent') return;
      expect(action.command.fromX).toBeLessThanOrEqual(1);
    });

    it('keeps fromX <= toX even when the user types fromX > toX', () => {
      const { fixture, getActions } = configure([regionFixture({ fromX: 0.2, toX: 0.5 })]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      component.onExtentChange(regionFixture({ fromX: 0.2, toX: 0.5 }), 'fromX', 0.9);
      const action = getActions()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      if (action.command.kind !== 'SetSubstrateRegionExtent') {
        throw new Error('expected SetSubstrateRegionExtent');
      }
      expect(action.command.fromX).toBeLessThanOrEqual(action.command.toX);
    });

    it('ignores non-finite numeric input', () => {
      const { fixture, getActions } = configure([regionFixture()]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      component.onExtentChange(regionFixture(), 'fromX', 'not-a-number');
      expect(getActions()).toEqual([]);
    });

    it('clamps the toX-edit upward when the user types toX < fromX', () => {
      const region = regionFixture({ fromX: 0.4, toX: 0.7 });
      const { getActions } = configure([region]);
      const component = TestBed.createComponent(SubstrateToolComponent).componentInstance;
      // Dragging toX below fromX: clamp toX UP to fromX (not down).
      component.onExtentChange(region, 'toX', 0.1);
      const action = getActions()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      if (action.command.kind !== 'SetSubstrateRegionExtent') {
        throw new Error('expected SetSubstrateRegionExtent');
      }
      expect(action.command.toX).toBeGreaterThanOrEqual(action.command.fromX);
    });

    it('clamps an extent value below 0 (left branch of clamp01)', () => {
      const region = regionFixture();
      const { getActions } = configure([region]);
      const component = TestBed.createComponent(SubstrateToolComponent).componentInstance;
      component.onExtentChange(region, 'fromX', -2);
      const action = getActions()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      if (action.command.kind !== 'SetSubstrateRegionExtent') {
        throw new Error('expected SetSubstrateRegionExtent');
      }
      expect(action.command.fromX).toBe(0);
    });

    it('updates blend via the field', () => {
      const { fixture, getActions } = configure([regionFixture()]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      component.onExtentChange(regionFixture(), 'blend', 20);
      const action = getActions()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      if (action.command.kind !== 'SetSubstrateRegionExtent') {
        throw new Error('expected SetSubstrateRegionExtent');
      }
      expect(action.command.blend).toBe(20);
    });
  });

  describe('Profile points', () => {
    it('Add point inserts a mid-point between the last two', () => {
      const { fixture, getActions } = configure([
        regionFixture({
          profile: [
            { x: 0, y: 10 },
            { x: 1, y: 30 },
          ],
        }),
      ]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      component.onAddPoint(
        regionFixture({
          profile: [
            { x: 0, y: 10 },
            { x: 1, y: 30 },
          ],
        }),
      );
      const action = getActions()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      if (action.command.kind !== 'SetSubstrateRegionProfile') {
        throw new Error('expected SetSubstrateRegionProfile');
      }
      expect(action.command.profile).toEqual([
        { x: 0, y: 10 },
        { x: 0.5, y: 20 },
        { x: 1, y: 30 },
      ]);
    });

    it('Remove point drops the entry at the index', () => {
      const region = regionFixture({
        profile: [
          { x: 0, y: 10 },
          { x: 0.5, y: 20 },
          { x: 1, y: 30 },
        ],
      });
      const { fixture, getActions } = configure([region]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      component.onRemovePoint(region, 1);
      const action = getActions()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      if (action.command.kind !== 'SetSubstrateRegionProfile') {
        throw new Error('expected SetSubstrateRegionProfile');
      }
      expect(action.command.profile).toEqual([
        { x: 0, y: 10 },
        { x: 1, y: 30 },
      ]);
    });

    it('Remove point refuses to drop below 2 points', () => {
      const region = regionFixture(); // 2 points
      const { fixture, getActions } = configure([region]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      component.onRemovePoint(region, 0);
      expect(getActions()).toEqual([]);
    });

    it('Point change clamps x into [0, 1] and re-sorts the profile by x', () => {
      const region = regionFixture({
        profile: [
          { x: 0, y: 10 },
          { x: 0.5, y: 20 },
          { x: 1, y: 30 },
        ],
      });
      const { fixture, getActions } = configure([region]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      // Move the middle point's x past the last one's.
      component.onPointChange(region, 1, 'x', 2);
      const action = getActions()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      if (action.command.kind !== 'SetSubstrateRegionProfile') {
        throw new Error('expected SetSubstrateRegionProfile');
      }
      // Clamped to 1 and re-sorted (so it lands at the end alongside the
      // existing 1).
      const xs = action.command.profile.map((p) => p.x);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]!);
      }
    });

    it('Point change Y clamps to non-negative', () => {
      const region = regionFixture();
      const { fixture, getActions } = configure([region]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      component.onPointChange(region, 0, 'y', -50);
      const action = getActions()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
      if (action.command.kind !== 'SetSubstrateRegionProfile') {
        throw new Error('expected SetSubstrateRegionProfile');
      }
      const first = action.command.profile[0]!;
      expect(first.y).toBeGreaterThanOrEqual(0);
    });

    it('Point change ignores non-finite input', () => {
      const region = regionFixture();
      const { fixture, getActions } = configure([region]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      component.onPointChange(region, 0, 'x', 'banana');
      expect(getActions()).toEqual([]);
    });

    it('Add point is a no-op when the region has fewer than 2 points (defensive)', () => {
      const region = regionFixture({ profile: [{ x: 0, y: 10 }] as never });
      const { fixture, getActions } = configure([region]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      component.onAddPoint(region);
      expect(getActions()).toEqual([]);
    });

    it('Point change is a no-op when the index is out of bounds', () => {
      const region = regionFixture();
      const { fixture, getActions } = configure([region]);
      const component = fixture.componentInstance as SubstrateToolComponent;
      component.onPointChange(region, 99, 'x', 0.5);
      expect(getActions()).toEqual([]);
    });
  });
});
