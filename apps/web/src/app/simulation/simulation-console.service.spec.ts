import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { setIdFactory } from '@aquascape/domain/scene-model';
import { DayNightService } from '@aquascape/features/editor-shell';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import { SceneActions, selectScene } from '@aquascape/state';

import { SimulationConsoleService } from './simulation-console.service';
import { SimulationUiService } from './simulation-ui.service';
import { createShowcaseScene } from './showcase-scene';
import { WaterChemistryService } from '../water-chemistry.service';

interface AnyAction {
  type: string;
  command?: { kind: string; [k: string]: unknown };
  scene?: unknown;
}

function memStorage(): StorageService {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string) => Promise.resolve((store.get(key) ?? null) as T | null),
    set: <T>(key: string, value: T) => {
      store.set(key, value);
      return Promise.resolve();
    },
    remove: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
}

function setup() {
  const dayNight = { phase: signal(0.5), setPhase: jest.fn(), setMode: jest.fn() };
  // Mock the live chemistry service — a fixed live() readout + a spy dilution.
  const waterChemistry = {
    live: () => ({
      state: { ammonia: 2, nitrite: 0.5, nitrate: 60, ph: 7.0 },
      cycle: 'cycling',
      ticks: 0,
    }),
    applyWaterChange: jest.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideMockStore(),
      { provide: DayNightService, useValue: dayNight },
      { provide: STORAGE_SERVICE, useValue: memStorage() },
      { provide: WaterChemistryService, useValue: waterChemistry },
      SimulationUiService,
      SimulationConsoleService,
    ],
  });
  const store = TestBed.inject(MockStore);
  store.overrideSelector(selectScene, createShowcaseScene());
  const dispatch = jest.spyOn(store, 'dispatch');
  const svc = TestBed.inject(SimulationConsoleService);
  const ui = TestBed.inject(SimulationUiService);
  return { svc, store, dispatch, dayNight, ui, waterChemistry };
}

function lastCommand(
  dispatch: jest.SpyInstance,
): { kind: string; [k: string]: unknown } | undefined {
  return dispatch.mock.calls
    .map((c) => c[0] as AnyAction)
    .filter((a) => a.type === SceneActions.dispatchCommand.type && a.command)
    .map((a) => a.command!)
    .at(-1);
}

const text = (lines: { text: string }[]) => lines.map((l) => l.text).join('\n');

describe('SimulationConsoleService.execute', () => {
  let nid = 0;
  beforeEach(() => {
    nid = 0;
    setIdFactory({ uuid: () => `console-id-${nid++}` });
  });
  afterEach(() => setIdFactory(undefined));

  it('lists commands for help', async () => {
    const { svc } = setup();
    const out = await svc.execute('help');
    expect(out[0].text).toContain('Commands');
    expect(text(out)).toContain('fish');
    expect(text(out)).toContain('sim');
  });

  it('reports an unknown command', async () => {
    const { svc } = setup();
    const out = await svc.execute('frobnicate');
    expect(out[0].kind).toBe('err');
    expect(out[0].text).toContain('Unknown command');
  });

  it('hud hide info updates the UI service', async () => {
    const { svc, ui } = setup();
    await svc.execute('hud hide info');
    expect(ui.infoVisible()).toBe(false);
  });

  it('hud hide/show actions toggles the action HUD', async () => {
    const { svc, ui } = setup();
    expect(ui.actionsVisible()).toBe(true);
    const hidden = await svc.execute('hud hide actions');
    expect(ui.actionsVisible()).toBe(false);
    expect(hidden[0].kind).toBe('out');
    expect(hidden[0].text).toContain('actions');
    await svc.execute('hud show actions');
    expect(ui.actionsVisible()).toBe(true);
  });

  it('light night drives the day/night service to phase 0', async () => {
    const { svc, dayNight } = setup();
    await svc.execute('light night');
    expect(dayNight.setMode).toHaveBeenCalledWith('manual');
    expect(dayNight.setPhase).toHaveBeenCalledWith(0);
  });

  it('water sets + clears the level', async () => {
    const { svc, dispatch } = setup();
    await svc.execute('water 300');
    expect(lastCommand(dispatch)).toEqual({ kind: 'SetWaterLevel', waterLevelMm: 300 });
    await svc.execute('water auto');
    expect(lastCommand(dispatch)).toEqual({ kind: 'SetWaterLevel', waterLevelMm: null });
  });

  it('water test prints the kit readout with bands', async () => {
    const { svc } = setup();
    const lines = text(await svc.execute('water test'));
    expect(lines).toContain('cycle: cycling');
    expect(lines).toContain('Ammonia');
    expect(lines).toContain('Nitrate');
    // The mocked live ammonia (2) + nitrate (60) read as danger.
    expect(lines).toContain('[danger]');
  });

  it('water change dilutes the live runtime (showcase has no chemistry → no command)', async () => {
    const { svc, dispatch, waterChemistry } = setup();
    await svc.execute('water change 50');
    expect(waterChemistry.applyWaterChange).toHaveBeenCalledWith(0.5);
    // The showcase scene carries no waterChemistry → the persisted command is
    // skipped (it would reject 'invalid'); only the live dilution runs.
    expect(lastCommand(dispatch)?.kind).not.toBe('WaterChange');
  });

  it('water change defaults to 25% and rejects out-of-range', async () => {
    const { svc, waterChemistry } = setup();
    await svc.execute('water change');
    expect(waterChemistry.applyWaterChange).toHaveBeenLastCalledWith(0.25);
    const errLines = await svc.execute('water change 200');
    expect(errLines[0].kind).toBe('err');
  });

  it('Tab-completes the water subverbs (change / test)', () => {
    const { svc } = setup();
    expect(svc.completeArgs('water', ['ch'])).toEqual(['change']);
    expect(svc.completeArgs('water', ['te'])).toEqual(['test']);
    expect(svc.completeArgs('water', [''])).toEqual(['auto', 'test', 'change']);
  });

  it('fish list / add / remove / set', async () => {
    const { svc, dispatch } = setup();
    expect(text(await svc.execute('fish list'))).toContain('Neon Tetra');
    await svc.execute('fish add betta 3');
    expect(lastCommand(dispatch)?.kind).toBe('AddLivestockEntry');
    await svc.execute('fish remove neon');
    expect(lastCommand(dispatch)?.kind).toBe('RemoveLivestockEntry');
    await svc.execute('fish set cardinal 50');
    expect(lastCommand(dispatch)).toMatchObject({ kind: 'UpdateLivestockQuantity', quantity: 50 });
  });

  it('item add rock adds a hardscape object', async () => {
    const { svc, dispatch } = setup();
    await svc.execute('item add rock');
    expect(lastCommand(dispatch)?.kind).toBe('AddObject');
  });

  it('reset reloads the showcase scene', async () => {
    const { svc, dispatch } = setup();
    await svc.execute('reset');
    const setScene = dispatch.mock.calls
      .map((c) => c[0] as AnyAction)
      .find((a) => a.type === SceneActions.setScene.type);
    expect(setScene?.scene).toBeDefined();
  });

  it('reports ambiguous species', async () => {
    const { svc } = setup();
    const out = await svc.execute('fish add tetra');
    expect(out[0].kind).toBe('err');
    expect(out[0].text).toContain('ambiguous');
  });

  it('sim save → list → load round-trips a named scene', async () => {
    const { svc, dispatch } = setup();
    // The built-in demo simulation is always listed.
    expect(text(await svc.execute('sim list'))).toContain('demo (built-in)');

    expect(text(await svc.execute('sim save reef tank'))).toContain('saved "reef tank"');
    expect(text(await svc.execute('sim list'))).toContain('reef tank');

    const loaded = await svc.execute('sim load reef tank');
    expect(text(loaded)).toContain('loaded "reef tank"');
    const setScene = dispatch.mock.calls
      .map((c) => c[0] as AnyAction)
      .find((a) => a.type === SceneActions.setScene.type);
    expect(setScene?.scene).toBeDefined();
  });

  it('sim load demo loads the built-in showcase', async () => {
    const { svc, dispatch } = setup();
    const out = await svc.execute('sim load demo');
    expect(text(out)).toContain('loaded "demo"');
    expect(
      dispatch.mock.calls
        .map((c) => c[0] as AnyAction)
        .some((a) => a.type === SceneActions.setScene.type),
    ).toBe(true);
  });

  it('sim load of an unknown name errors', async () => {
    const { svc } = setup();
    const out = await svc.execute('sim load nope');
    expect(out[0].kind).toBe('err');
    expect(out[0].text).toContain('no simulation named');
  });

  it('sim save/delete refuse the reserved "demo" name', async () => {
    const { svc } = setup();
    expect((await svc.execute('sim save demo'))[0].kind).toBe('err');
    expect((await svc.execute('sim delete demo'))[0].kind).toBe('err');
  });

  it('sim delete removes a saved simulation', async () => {
    const { svc } = setup();
    await svc.execute('sim save temp');
    expect(text(await svc.execute('sim delete temp'))).toContain('deleted "temp"');
    expect(text(await svc.execute('sim list'))).not.toContain('temp');
  });

  it('complete returns command-name completions', () => {
    const { svc } = setup();
    expect(svc.complete('f')).toContain('fish');
    expect(svc.complete('s')).toEqual(expect.arrayContaining(['sim']));
    expect(svc.complete('d')).toContain('dose');
  });

  describe('dose', () => {
    it('dose list lists nutrients', async () => {
      const { svc } = setup();
      const out = await svc.execute('dose list');
      expect(out[0].text).toContain('nutrients:');
      expect(text(out)).toContain('Easy Green');
    });

    it('dose <fuzzy product> dispatches DoseNutrient', async () => {
      const { svc, dispatch } = setup();
      const out = await svc.execute('dose easy-green');
      const command = lastCommand(dispatch);
      expect(command?.kind).toBe('DoseNutrient');
      expect((command as { event: { ref: { id: string } } }).event.ref.id).toBe(
        'nutrient.aio.easy-green',
      );
      expect(text(out)).toContain('dosed');
    });

    it('dose <product> <amount> doses the given amount', async () => {
      const { svc, dispatch } = setup();
      await svc.execute('dose kno3 0.6');
      const event = (lastCommand(dispatch) as { event: { amount: number } }).event;
      expect(event.amount).toBe(0.6);
    });

    it('dose <product> accepts a unit suffix', async () => {
      const { svc, dispatch } = setup();
      await svc.execute('dose easy-green 2ml');
      const event = (lastCommand(dispatch) as { event: { amount: number; unit: string } }).event;
      expect(event.amount).toBe(2);
      expect(event.unit).toBe('ml');
    });

    it('dose rejects an unknown product', async () => {
      const { svc, dispatch } = setup();
      const out = await svc.execute('dose nope-nutrient');
      expect(out[0].kind).toBe('err');
      expect(out[0].text).toContain('no nutrient matches');
      expect(lastCommand(dispatch)).toBeUndefined();
    });

    it('dose rejects a non-positive amount', async () => {
      const { svc, dispatch } = setup();
      const out = await svc.execute('dose easy-green 0');
      expect(out[0].kind).toBe('err');
      expect(lastCommand(dispatch)).toBeUndefined();
    });

    it('dose rejects a malformed amount', async () => {
      const { svc } = setup();
      const out = await svc.execute('dose easy-green abc');
      expect(out[0].kind).toBe('err');
    });

    it('completeArgs Tab-completes nutrient ids/names + list', () => {
      const { svc } = setup();
      expect(svc.completeArgs('dose', ['li'])).toContain('list');
      expect(svc.completeArgs('dose', ['nutrient.aio'])).toEqual(
        expect.arrayContaining(['nutrient.aio.easy-green']),
      );
      // Other commands don't argument-complete.
      expect(svc.completeArgs('fish', ['ne'])).toEqual([]);
    });
  });
});
