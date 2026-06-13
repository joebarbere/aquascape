import { coreCatalog } from '@aquascape/domain/catalog';
import { setIdFactory } from '@aquascape/domain/scene-model';
import type { Store } from '@ngrx/store';

import {
  addRandomItem,
  addSpecies,
  buildRandomObject,
  doseNutrientOp,
  matchNutrient,
  matchSpecies,
} from './simulation-scene-ops';
import { createShowcaseScene } from './showcase-scene';

const LIVESTOCK_IDS = coreCatalog.byKind('livestock').map((e) => e.id);

describe('matchSpecies', () => {
  it('matches an exact catalog id', () => {
    expect(matchSpecies('livestock.fish.neon-tetra', LIVESTOCK_IDS)).toMatchObject({
      status: 'found',
      id: 'livestock.fish.neon-tetra',
    });
  });

  it('matches a trailing token', () => {
    expect(matchSpecies('neon-tetra', LIVESTOCK_IDS)).toMatchObject({
      status: 'found',
      id: 'livestock.fish.neon-tetra',
    });
  });

  it('matches a display-name substring', () => {
    expect(matchSpecies('angelfish', LIVESTOCK_IDS)).toMatchObject({ status: 'found' });
  });

  it('reports ambiguity with candidate names', () => {
    const m = matchSpecies('tetra', LIVESTOCK_IDS);
    expect(m.status).toBe('ambiguous');
    if (m.status === 'ambiguous') expect(m.candidates.length).toBeGreaterThan(1);
  });

  it('reports none for no match', () => {
    expect(matchSpecies('zzzznope', LIVESTOCK_IDS).status).toBe('none');
  });
});

describe('scene ops (object building)', () => {
  let n = 0;
  beforeEach(() => {
    n = 0;
    setIdFactory({ uuid: () => `ops-id-${n++}` });
  });
  afterEach(() => setIdFactory(undefined));

  it('builds a random rock / wood as hardscape', () => {
    expect(buildRandomObject('rock', createShowcaseScene())).toMatchObject({
      kind: 'hardscape',
      category: 'rock',
    });
    expect(buildRandomObject('wood', createShowcaseScene())).toMatchObject({
      kind: 'hardscape',
      category: 'wood',
    });
  });

  it('builds a random plant + decor', () => {
    expect(buildRandomObject('plant', createShowcaseScene())?.kind).toBe('plant');
    expect(buildRandomObject('decor', createShowcaseScene())?.kind).toBe('decor');
  });

  it('addRandomItem dispatches an AddObject command', () => {
    const dispatch = jest.fn();
    const store = { dispatch } as unknown as Store;
    const object = addRandomItem(store, createShowcaseScene(), 'decor');
    expect(object?.kind).toBe('decor');
    const last = dispatch.mock.calls.at(-1)?.[0];
    expect(last.command.kind).toBe('AddObject');
  });

  it('addSpecies dispatches an AddLivestockEntry command at the given quantity', () => {
    const dispatch = jest.fn();
    const store = { dispatch } as unknown as Store;
    addSpecies(store, 'livestock.fish.betta-splendens', 3, () => 'fixed-id');
    const command = dispatch.mock.calls[0][0].command;
    expect(command.kind).toBe('AddLivestockEntry');
    expect(command.entry).toMatchObject({
      ref: { id: 'livestock.fish.betta-splendens' },
      quantity: 3,
    });
  });
});

describe('matchNutrient', () => {
  it('fuzzy-resolves a nutrient by trailing token', () => {
    expect(matchNutrient('easy-green')).toMatchObject({
      status: 'found',
      id: 'nutrient.aio.easy-green',
    });
  });

  it('reports none for an unknown token', () => {
    expect(matchNutrient('zzzznope').status).toBe('none');
  });
});

describe('doseNutrientOp', () => {
  it('dispatches a DoseNutrient command with computed deltas for a disclosed product', () => {
    const dispatch = jest.fn();
    const store = { dispatch } as unknown as Store;
    // KNO3 discloses +4.84 ppm NO3 per 0.3 g; 0.6 g ⇒ +9.68 NO3.
    const entry = doseNutrientOp(
      store,
      createShowcaseScene(),
      'nutrient.macro.kno3',
      0.6,
      () => 'dose-id-0',
    );
    expect(entry?.id).toBe('nutrient.macro.kno3');
    const command = dispatch.mock.calls.at(-1)?.[0].command;
    expect(command.kind).toBe('DoseNutrient');
    expect(command.event).toMatchObject({
      id: 'dose-id-0',
      seq: 0,
      ref: { id: 'nutrient.macro.kno3' },
      amount: 0.6,
      unit: 'g',
      disclosed: true,
    });
    expect(command.event.deltas.no3).toBeCloseTo(9.68, 2);
  });

  it('omits deltas for a proprietary product but keeps affects', () => {
    const dispatch = jest.fn();
    const store = { dispatch } as unknown as Store;
    doseNutrientOp(store, createShowcaseScene(), 'nutrient.aio.easy-green', 2, () => 'dose-id-1');
    const event = dispatch.mock.calls.at(-1)?.[0].command.event;
    expect(event.disclosed).toBe(false);
    expect(event.deltas).toBeUndefined();
    expect(event.affects.length).toBeGreaterThan(0);
  });

  it('returns null + dispatches nothing for an unknown id', () => {
    const dispatch = jest.fn();
    const store = { dispatch } as unknown as Store;
    expect(doseNutrientOp(store, createShowcaseScene(), 'nope', 1, () => 'x')).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('returns null + dispatches nothing for a non-positive amount', () => {
    const dispatch = jest.fn();
    const store = { dispatch } as unknown as Store;
    expect(
      doseNutrientOp(store, createShowcaseScene(), 'nutrient.macro.kno3', 0, () => 'x'),
    ).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
