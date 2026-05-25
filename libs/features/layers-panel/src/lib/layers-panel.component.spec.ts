import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { SceneActions, defaultScene, selectScene } from '@aquascape/state';
import { asLayerId } from '@aquascape/domain/scene-model';
import type { Layer, Scene } from '@aquascape/domain/scene-model';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';

import { LAYERS_PANEL_COLLAPSED_KEY, LayersPanelComponent } from './layers-panel.component';

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

function makeLayer(id: string, name: string, overrides: Partial<Layer> = {}): Layer {
  return {
    id: asLayerId(id),
    name,
    opacity: 1,
    visible: true,
    locked: false,
    objects: [],
    ...overrides,
  };
}

function sceneWithLayers(layers: Layer[]): Scene {
  return { ...defaultScene(), layers };
}

function configure(scene: Scene, options: { storage?: FakeStorageService } = {}) {
  const storage = options.storage ?? new FakeStorageService();
  TestBed.configureTestingModule({
    imports: [LayersPanelComponent],
    providers: [
      provideMockStore({
        initialState: {
          scene: { scene, history: { past: [], future: [], limit: 200 } },
        },
        selectors: [{ selector: selectScene, value: scene }],
      }),
      { provide: STORAGE_SERVICE, useValue: storage },
    ],
  });
  const store = TestBed.inject(MockStore);
  const dispatchSpy = jest.spyOn(store, 'dispatch');
  const fixture = TestBed.createComponent(LayersPanelComponent);
  fixture.detectChanges();
  return {
    fixture,
    store,
    storage,
    dispatched: () => dispatchSpy.mock.calls.map((c) => c[0]),
  };
}

function rowAt(fixture: { nativeElement: HTMLElement }, displayIndex: number): HTMLLIElement {
  const rows = fixture.nativeElement.querySelectorAll('li.layer-row');
  return rows[displayIndex] as HTMLLIElement;
}

function btn(li: HTMLLIElement, ariaPrefix: string): HTMLButtonElement {
  return li.querySelector(`button[aria-label^="${ariaPrefix}"]`) as HTMLButtonElement;
}

describe('LayersPanelComponent — rendering', () => {
  it('renders an empty-state hint when the scene has no layers', () => {
    const { fixture } = configure(sceneWithLayers([]));
    expect(fixture.nativeElement.querySelector('.empty')?.textContent ?? '').toContain('No layers');
    expect(fixture.nativeElement.querySelectorAll('li.layer-row')).toHaveLength(0);
  });

  it('lists layers front-first (top of stack at the top of the panel)', () => {
    const scene = sceneWithLayers([makeLayer('a', 'Background'), makeLayer('b', 'Hardscape')]);
    const { fixture } = configure(scene);
    const rows = fixture.nativeElement.querySelectorAll('li.layer-row');
    expect(rows).toHaveLength(2);
    expect((rows[0]!.querySelector('input.name') as HTMLInputElement).value).toBe('Hardscape');
    expect((rows[1]!.querySelector('input.name') as HTMLInputElement).value).toBe('Background');
  });

  it('reflects hidden + locked state via CSS classes', () => {
    const scene = sceneWithLayers([makeLayer('a', 'L1', { locked: true, visible: false })]);
    const { fixture } = configure(scene);
    const row = rowAt(fixture, 0);
    expect(row.classList.contains('hidden')).toBe(true);
    expect(row.classList.contains('locked')).toBe(true);
  });
});

describe('LayersPanelComponent — actions', () => {
  it('Add layer dispatches AddLayer with an auto-generated "Layer N" name', () => {
    const scene = sceneWithLayers([makeLayer('a', 'Layer 1')]);
    const { fixture, dispatched } = configure(scene);
    (fixture.nativeElement.querySelector('button.add') as HTMLButtonElement).click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.command.kind).toBe('AddLayer');
    if (cmd.command.kind !== 'AddLayer') return;
    expect(cmd.command.layer.name).toBe('Layer 2');
  });

  it('Add layer picks the next free "Layer N" past gaps in the existing names', () => {
    const scene = sceneWithLayers([
      makeLayer('a', 'Layer 1'),
      makeLayer('b', 'Custom name'),
      makeLayer('c', 'Layer 3'),
    ]);
    const { fixture, dispatched } = configure(scene);
    (fixture.nativeElement.querySelector('button.add') as HTMLButtonElement).click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'AddLayer') throw new Error('expected AddLayer');
    expect(cmd.command.layer.name).toBe('Layer 4');
  });

  it('Visibility toggle dispatches SetLayerVisibility with the inverted value', () => {
    const scene = sceneWithLayers([makeLayer('a', 'L1', { visible: true })]);
    const { fixture, dispatched } = configure(scene);
    btn(rowAt(fixture, 0), 'Hide layer').click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'SetLayerVisibility') throw new Error('expected SetLayerVisibility');
    expect(cmd.command.visible).toBe(false);
  });

  it('Lock toggle dispatches SetLayerLocked with the inverted value', () => {
    const scene = sceneWithLayers([makeLayer('a', 'L1', { locked: false })]);
    const { fixture, dispatched } = configure(scene);
    btn(rowAt(fixture, 0), 'Lock layer').click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'SetLayerLocked') throw new Error('expected SetLayerLocked');
    expect(cmd.command.locked).toBe(true);
  });

  it('Rename via change event dispatches RenameLayer', () => {
    const scene = sceneWithLayers([makeLayer('a', 'L1')]);
    const { fixture, dispatched } = configure(scene);
    const input = rowAt(fixture, 0).querySelector('input.name') as HTMLInputElement;
    input.value = 'Background';
    input.dispatchEvent(new Event('change'));
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'RenameLayer') throw new Error('expected RenameLayer');
    expect(cmd.command.name).toBe('Background');
  });

  it('Rename ignores empty input and reverts the field to the canonical name', () => {
    const scene = sceneWithLayers([makeLayer('a', 'L1')]);
    const { fixture, dispatched } = configure(scene);
    const input = rowAt(fixture, 0).querySelector('input.name') as HTMLInputElement;
    input.value = '   ';
    input.dispatchEvent(new Event('change'));
    expect(dispatched()).toEqual([]);
    expect(input.value).toBe('L1');
  });

  it('Rename to the same name is a no-op (no dispatch)', () => {
    const scene = sceneWithLayers([makeLayer('a', 'L1')]);
    const { fixture, dispatched } = configure(scene);
    const input = rowAt(fixture, 0).querySelector('input.name') as HTMLInputElement;
    input.value = 'L1';
    input.dispatchEvent(new Event('change'));
    expect(dispatched()).toEqual([]);
  });

  it('Opacity slider dispatches SetLayerOpacity when the value changes', () => {
    const scene = sceneWithLayers([makeLayer('a', 'L1', { opacity: 1 })]);
    const { fixture, dispatched } = configure(scene);
    const slider = rowAt(fixture, 0).querySelector('input.opacity') as HTMLInputElement;
    slider.value = '0.5';
    slider.dispatchEvent(new Event('input'));
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'SetLayerOpacity') throw new Error('expected SetLayerOpacity');
    expect(cmd.command.opacity).toBeCloseTo(0.5);
  });

  it('Opacity input with a non-finite parse result is ignored (defensive guard)', () => {
    // <input type="range"> always reports a numeric string, but the component
    // guards against non-finite values for safety. Synthesise the event with
    // a NaN-producing target so the guard branch is covered.
    const scene = sceneWithLayers([makeLayer('a', 'L1', { opacity: 1 })]);
    const { fixture, dispatched } = configure(scene);
    const slider = rowAt(fixture, 0).querySelector('input.opacity') as HTMLInputElement;
    Object.defineProperty(slider, 'value', { get: () => 'not-a-number', configurable: true });
    slider.dispatchEvent(new Event('input'));
    expect(dispatched()).toEqual([]);
  });

  it('Opacity input that resolves to the same value is a no-op', () => {
    const scene = sceneWithLayers([makeLayer('a', 'L1', { opacity: 0.5 })]);
    const { fixture, dispatched } = configure(scene);
    const slider = rowAt(fixture, 0).querySelector('input.opacity') as HTMLInputElement;
    slider.value = '0.5';
    slider.dispatchEvent(new Event('input'));
    expect(dispatched()).toEqual([]);
  });

  it('Move up swaps the layer with its forward neighbour', () => {
    // Stack: [a (back), b (front)]. UI rows: b, a. Up on `a` (displayIndex 1,
    // indexInStack 0) swaps it with `b` (indexInStack 1) → new order [b, a].
    const scene = sceneWithLayers([makeLayer('a', 'A'), makeLayer('b', 'B')]);
    const { fixture, dispatched } = configure(scene);
    btn(rowAt(fixture, 1), 'Move layer up').click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'ReorderLayers') throw new Error('expected ReorderLayers');
    expect(cmd.command.order.map(String)).toEqual(['b', 'a']);
  });

  it('Move down swaps the layer with its backward neighbour', () => {
    const scene = sceneWithLayers([makeLayer('a', 'A'), makeLayer('b', 'B')]);
    const { fixture, dispatched } = configure(scene);
    // Down on `b` (displayIndex 0, indexInStack 1) → swap with `a` (0).
    btn(rowAt(fixture, 0), 'Move layer down').click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'ReorderLayers') throw new Error('expected ReorderLayers');
    expect(cmd.command.order.map(String)).toEqual(['b', 'a']);
  });

  it('Move up on the top layer is disabled', () => {
    const scene = sceneWithLayers([makeLayer('a', 'A'), makeLayer('b', 'B')]);
    const { fixture } = configure(scene);
    const upBtn = btn(rowAt(fixture, 0), 'Move layer up');
    expect(upBtn.disabled).toBe(true);
  });

  it('Move down on the bottom layer is disabled', () => {
    const scene = sceneWithLayers([makeLayer('a', 'A'), makeLayer('b', 'B')]);
    const { fixture } = configure(scene);
    const downBtn = btn(rowAt(fixture, 1), 'Move layer down');
    expect(downBtn.disabled).toBe(true);
  });

  it('Delete dispatches RemoveLayer', () => {
    const scene = sceneWithLayers([makeLayer('a', 'A'), makeLayer('b', 'B')]);
    const { fixture, dispatched } = configure(scene);
    btn(rowAt(fixture, 0), 'Delete layer').click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'RemoveLayer') throw new Error('expected RemoveLayer');
    expect(String(cmd.command.layerId)).toBe('b');
  });

  it('Delete is disabled when only one layer remains (never leave the scene with zero layers)', () => {
    const scene = sceneWithLayers([makeLayer('a', 'A')]);
    const { fixture } = configure(scene);
    const delBtn = btn(rowAt(fixture, 0), 'Delete layer');
    expect(delBtn.disabled).toBe(true);
  });

  it('Direct onRemove call is a no-op when only one layer remains (defensive guard)', () => {
    const scene = sceneWithLayers([makeLayer('a', 'A')]);
    const { fixture, dispatched } = configure(scene);
    fixture.componentInstance.onRemove(asLayerId('a'));
    expect(dispatched()).toEqual([]);
  });

  it('Direct swapNeighbour with out-of-range indices is a no-op (defensive guard)', () => {
    const scene = sceneWithLayers([makeLayer('a', 'A'), makeLayer('b', 'B')]);
    const { fixture, dispatched } = configure(scene);
    fixture.componentInstance.onMoveUp(99);
    fixture.componentInstance.onMoveDown(-1);
    expect(dispatched()).toEqual([]);
  });

  it('Add layer falls back to "Layer N" against a base of zero layers', () => {
    const { fixture, dispatched } = configure(sceneWithLayers([]));
    (fixture.nativeElement.querySelector('button.add') as HTMLButtonElement).click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'AddLayer') throw new Error('expected AddLayer');
    expect(cmd.command.layer.name).toBe('Layer 1');
  });

  it('Opacity input with null target is ignored (synthetic event without a target)', () => {
    const scene = sceneWithLayers([makeLayer('a', 'L1')]);
    const { fixture, dispatched } = configure(scene);
    fixture.componentInstance.onOpacity(scene.layers[0]!, new Event('input'));
    expect(dispatched()).toEqual([]);
  });

  it('Rename with null target is ignored (synthetic event without a target)', () => {
    const scene = sceneWithLayers([makeLayer('a', 'L1')]);
    const { fixture, dispatched } = configure(scene);
    fixture.componentInstance.onRename(scene.layers[0]!, new Event('change'));
    expect(dispatched()).toEqual([]);
  });
});

describe('LayersPanelComponent — collapsible header', () => {
  it('renders the header as a button with aria-expanded=true by default', () => {
    const { fixture } = configure(sceneWithLayers([makeLayer('a', 'L1')]));
    const toggle = fixture.nativeElement.querySelector('.panel-header__toggle') as HTMLButtonElement;
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('layers-panel-body');
  });

  it('shows the layer count in the header badge', () => {
    const { fixture } = configure(sceneWithLayers([makeLayer('a', 'A'), makeLayer('b', 'B')]));
    const count = fixture.nativeElement.querySelector('.panel-header__count');
    expect(count).not.toBeNull();
    expect(count!.textContent?.trim()).toBe('2');
  });

  it('clicking the header toggles the collapsed signal and hides the body', () => {
    const { fixture } = configure(sceneWithLayers([makeLayer('a', 'L1')]));
    const toggle = fixture.nativeElement.querySelector('.panel-header__toggle') as HTMLButtonElement;
    const body = fixture.nativeElement.querySelector('#layers-panel-body') as HTMLElement;
    expect(fixture.componentInstance.collapsed()).toBe(false);
    expect(body.hidden).toBe(false);
    toggle.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(true);
    expect(body.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('persists collapsed state to StorageService on toggle', async () => {
    const { fixture, storage } = configure(sceneWithLayers([makeLayer('a', 'L1')]));
    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    await flushPromises();
    expect(storage.data.get(LAYERS_PANEL_COLLAPSED_KEY)).toBe(true);
  });

  it('hydrates the collapsed signal from StorageService on init', async () => {
    const storage = new FakeStorageService();
    await storage.set(LAYERS_PANEL_COLLAPSED_KEY, true);
    const { fixture } = configure(sceneWithLayers([makeLayer('a', 'L1')]), { storage });
    await flushPromises();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(true);
  });
});
