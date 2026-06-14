import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { setIdFactory } from '@aquascape/domain/scene-model';
import { DayNightService } from '@aquascape/features/editor-shell';
import { SceneActions } from '@aquascape/state';

import { SimulationControlsComponent } from './simulation-controls.component';
import { createShowcaseScene } from './showcase-scene';
import { WaterChemistryService } from '../water-chemistry.service';

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
  const waterChemistry = { applyWaterChange: jest.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideMockStore(),
      { provide: DayNightService, useValue: dayNight },
      { provide: WaterChemistryService, useValue: waterChemistry },
    ],
  });
  const store = TestBed.inject(MockStore);
  const dispatch = jest.spyOn(store, 'dispatch');
  const fixture = TestBed.createComponent(SimulationControlsComponent);
  fixture.componentInstance.scene = createShowcaseScene();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, dispatch, dayNight, waterChemistry };
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

  it('changeWater dilutes the live runtime (F13.5b)', () => {
    const { cmp, waterChemistry } = setup();
    cmp.changeWater(0.25);
    expect(waterChemistry.applyWaterChange).toHaveBeenCalledWith(0.25);
    expect(cmp.wcStatus()).toContain('25%');
  });

  it('changeWater dispatches the undoable WaterChange command when the tank tracks chemistry', () => {
    const { cmp, dispatch, waterChemistry } = setup();
    const base = createShowcaseScene();
    cmp.scene = {
      ...base,
      tank: {
        ...base.tank,
        waterChemistry: {
          chemistry: {
            ammonia: 1,
            nitrite: 0,
            nitrate: 40,
            ph: 7,
            aobColony: 5,
            nobColony: 5,
            ageWeeks: 8,
            engineVersion: 1,
          },
          cycle: 'cycled',
        },
      },
    };
    cmp.changeWater(0.5);
    expect(lastCommand(dispatch)).toMatchObject({ kind: 'WaterChange', fractionReplaced: 0.5 });
    expect(waterChemistry.applyWaterChange).toHaveBeenCalledWith(0.5);
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

  describe('Dose group', () => {
    it('renders a nutrient picker with category filter + accessible swatch', () => {
      const { fixture } = setup();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.textContent).toContain('Dose nutrient');
      const pick = root.querySelector('select[aria-label="Nutrient to dose"]');
      expect(pick?.querySelectorAll('option').length).toBeGreaterThan(0);
      expect(root.querySelector('select[aria-label="Filter nutrients by category"]')).toBeTruthy();
      // The swatch is decorative (aria-hidden) so it doesn't pollute the a11y tree.
      expect(root.querySelector('.sim-controls__swatch')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('dose dispatches a DoseNutrient command for the selected nutrient', () => {
      const { cmp, dispatch } = setup();
      cmp.onDoseSelect('nutrient.aio.easy-green');
      cmp.onDoseAmount('2');
      cmp.dose();
      const command = lastCommand(dispatch);
      expect(command?.kind).toBe('DoseNutrient');
      const event = (command as { event: { ref: { id: string }; amount: number } }).event;
      expect(event.ref.id).toBe('nutrient.aio.easy-green');
      expect(event.amount).toBe(2);
    });

    it('selecting a nutrient defaults the amount to its representative dose', () => {
      const { cmp } = setup();
      cmp.onDoseSelect('nutrient.macro.kno3');
      expect(cmp.doseAmount()).toBe(0.3);
    });

    it('filtering by category narrows the picker + re-snaps the selection', () => {
      const { cmp } = setup();
      cmp.onDoseFilter('macro-salt');
      expect(cmp.filteredNutrients().every((o) => o.category === 'macro-salt')).toBe(true);
      expect(cmp.selectedNutrient()?.category).toBe('macro-salt');
    });

    it('a non-positive amount reports an error instead of dosing', () => {
      const { cmp, dispatch } = setup();
      cmp.onDoseAmount('0');
      cmp.dose();
      expect(lastCommand(dispatch)).toBeNull();
      expect(cmp.doseStatus()).toContain('positive');
    });

    it('surfaces a confirmation status after a successful dose', () => {
      const { cmp } = setup();
      cmp.onDoseSelect('nutrient.aio.easy-green');
      cmp.dose();
      expect(cmp.doseStatus()).toContain('recorded only');
    });
  });
});
