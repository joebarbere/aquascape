import { coreCatalog } from '@aquascape/domain/catalog';
import { setIdFactory } from '@aquascape/domain/scene-model';
import type { Store } from '@ngrx/store';

import { addRandomItem, addSpecies, buildRandomObject, matchSpecies } from './simulation-scene-ops';
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
