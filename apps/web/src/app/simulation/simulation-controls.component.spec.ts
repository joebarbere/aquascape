import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { setIdFactory } from '@aquascape/domain/scene-model';
import { DayNightService } from '@aquascape/features/editor-shell';
import { SceneActions } from '@aquascape/state';

import { SimulationControlsComponent } from './simulation-controls.component';
import { createShowcaseScene } from './showcase-scene';

interface AnyAction {
  type: string;
  command?: { kind: string; [k: string]: unknown };
  scene?: unknown;
}

function setup() {
  const dayNight = {
    phase: signal(0.5),
    setPhase: jest.fn(),
    setMode: jest.fn(),
  };
  TestBed.configureTestingModule({
    providers: [provideMockStore(), { provide: DayNightService, useValue: dayNight }],
  });
  const store = TestBed.inject(MockStore);
  const dispatch = jest.spyOn(store, 'dispatch');
  const fixture = TestBed.createComponent(SimulationControlsComponent);
  fixture.componentInstance.scene = createShowcaseScene();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, dispatch, dayNight };
}

/** Last `dispatchCommand` payload, or null. */
function lastCommand(dispatch: jest.SpyInstance): { kind: string; [k: string]: unknown } | null {
  const cmds = dispatch.mock.calls
    .map((c) => c[0] as AnyAction)
    .filter((a) => a.type === SceneActions.dispatchCommand.type && a.command)
    .map((a) => a.command!);
  return cmds.length > 0 ? cmds[cmds.length - 1] : null;
}

describe('SimulationControlsComponent', () => {
  // jsdom here lacks crypto.randomUUID (present in browsers / Electron), which
  // the default id factory uses when minting object ids. Swap in a
  // deterministic counter for the test, restore after.
  let idCounter = 0;
  beforeEach(() => {
    idCounter = 0;
    setIdFactory({ uuid: () => `demo-test-id-${idCounter++}` });
  });
  afterEach(() => {
    setIdFactory(undefined);
  });

  it('renders a row per livestock entry + a species picker', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const scene = createShowcaseScene();
    expect(root.querySelectorAll('.sim-controls__row').length).toBe((scene.livestock ?? []).length);
    expect(root.querySelector('select')?.querySelectorAll('option').length).toBeGreaterThan(0);
    expect(root.textContent).toContain('Neon Tetra');
  });

  it('steps a species quantity up via the +/− buttons', () => {
    const { cmp, dispatch } = setup();
    const first = cmp.livestockRows()[0];
    cmp.stepQuantity(first, 1);
    expect(lastCommand(dispatch)).toMatchObject({
      kind: 'UpdateLivestockQuantity',
      entryId: first.id,
      quantity: first.quantity + 1,
    });
  });

  it('removes the entry when stepping below 1', () => {
    const { cmp, dispatch } = setup();
    const row = { id: 'demo-ls-x', name: 'X', quantity: 1 };
    cmp.stepQuantity(row, -1);
    expect(lastCommand(dispatch)).toEqual({ kind: 'RemoveLivestockEntry', entryId: 'demo-ls-x' });
  });

  it('adds a species as a new livestock entry', () => {
    const { cmp, dispatch } = setup();
    cmp.addSpecies('livestock.fish.betta-splendens');
    const command = lastCommand(dispatch);
    expect(command?.kind).toBe('AddLivestockEntry');
    expect((command as { entry: { ref: { id: string }; quantity: number } }).entry.ref.id).toBe(
      'livestock.fish.betta-splendens',
    );
  });

  it('adds a random rock as a hardscape object', () => {
    const { cmp, dispatch } = setup();
    cmp.addItem('rock');
    const command = lastCommand(dispatch);
    expect(command?.kind).toBe('AddObject');
    const object = (command as { object: { kind: string; category?: string } }).object;
    expect(object.kind).toBe('hardscape');
    expect(object.category).toBe('rock');
  });

  it('adds a random plant object', () => {
    const { cmp, dispatch } = setup();
    cmp.addItem('plant');
    const object = (lastCommand(dispatch) as { object: { kind: string } }).object;
    expect(object.kind).toBe('plant');
  });

  it('dispatches a water-level command from the slider', () => {
    const { cmp, dispatch } = setup();
    cmp.onWater({ target: { value: '300' } } as unknown as Event);
    expect(lastCommand(dispatch)).toEqual({ kind: 'SetWaterLevel', waterLevelMm: 300 });
  });

  it('drives the day/night service from the lighting slider', () => {
    const { cmp, dayNight } = setup();
    cmp.onPhase({ target: { value: '0.8' } } as unknown as Event);
    expect(dayNight.setMode).toHaveBeenCalledWith('manual');
    expect(dayNight.setPhase).toHaveBeenCalledWith(0.8);
  });

  it('reset reloads the showcase scene', () => {
    const { cmp, dispatch } = setup();
    cmp.reset();
    const setScene = dispatch.mock.calls
      .map((c) => c[0] as AnyAction)
      .find((a) => a.type === SceneActions.setScene.type);
    expect(setScene?.scene).toBeDefined();
  });
});
