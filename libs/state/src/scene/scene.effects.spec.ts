// Scene effects tests.
//
// Uses the official NgRx testing surface: `provideMockActions` from
// `@ngrx/effects/testing` and `provideMockStore` from `@ngrx/store/testing`.
// We seed the Actions stream with the input action and assert on the
// effect's emitted output. This is the established pattern and side-steps
// the field-init ordering / Subject-buffering tangle of a hand-rolled
// stub.

import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { take, toArray } from 'rxjs/operators';

import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { createHistory, setTankDimensions } from '@aquascape/domain/scene-model';

import { defaultScene } from './default-scene';
import { SceneActions } from './scene.actions';
import { SceneEffects } from './scene.effects';
import { selectSceneState } from './scene.selectors';

function configure(actionsSource: Parameters<typeof provideMockActions>[0]) {
  TestBed.configureTestingModule({
    providers: [
      SceneEffects,
      provideMockActions(actionsSource),
      provideMockStore({
        selectors: [
          {
            selector: selectSceneState,
            value: { scene: defaultScene(), history: createHistory() },
          },
        ],
      }),
    ],
  });
  return TestBed.inject(SceneEffects);
}

describe('SceneEffects.dispatchCommand$', () => {
  it('emits applyCommandSucceeded when applyCommand accepts the command', async () => {
    const command = setTankDimensions({ width: 800, height: 400, depth: 400 });
    const effects = configure(of(SceneActions.dispatchCommand({ command })));

    const result = await firstValueFrom(effects.dispatchCommand$.pipe(take(1)));
    expect(result.type).toBe('[Scene] Apply Command Succeeded');
    const succeeded = result as ReturnType<
      typeof SceneActions.applyCommandSucceeded
    >;
    expect(succeeded.scene.tank.width).toBe(800);
    expect(succeeded.history.past.length).toBe(1);
  });

  it('emits commandRejected when applyCommand rejects the command', async () => {
    // Negative width → applyCommand returns { ok: false, reason: 'invalid', ... }.
    const command = setTankDimensions({ width: -5, height: 400, depth: 400 });
    const effects = configure(of(SceneActions.dispatchCommand({ command })));

    const result = await firstValueFrom(effects.dispatchCommand$.pipe(take(1)));
    expect(result.type).toBe('[Scene] Command Rejected');
    const rejected = result as ReturnType<typeof SceneActions.commandRejected>;
    expect(rejected.reason).toBe('invalid');
    expect(rejected.message).toMatch(/SetTankDimensions/);
  });

  it('emits one resolved action per dispatchCommand', async () => {
    const a = setTankDimensions({ width: 800, height: 400, depth: 400 });
    const b = setTankDimensions({ width: 900, height: 450, depth: 450 });
    const effects = configure(
      of(
        SceneActions.dispatchCommand({ command: a }),
        SceneActions.dispatchCommand({ command: b }),
      ),
    );
    // Force the store to return the same `defaultScene` initial state each
    // time so both dispatches resolve independently. `MockStore`'s default
    // behaviour with our seeded selector value already does this.
    const store = TestBed.inject(MockStore);
    void store;

    const out = await firstValueFrom(
      effects.dispatchCommand$.pipe(take(2), toArray()),
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('[Scene] Apply Command Succeeded');
    expect(out[1]?.type).toBe('[Scene] Apply Command Succeeded');
  });

  it('defensive fallback: surfaces invariant violation if push fails but apply succeeds', async () => {
    // We can't realistically trigger this in production — push and apply
    // either both succeed or both fail for a given (scene, command) — but
    // the fallback branch exists. Drive it by stubbing the store selector
    // to a state whose `history.push` returns null while `applyCommand`
    // returns ok.
    const scene = defaultScene();
    const fakeHistory = {
      ...createHistory(),
      push: () => null,
    } as never;
    const effects = configure(
      of(
        SceneActions.dispatchCommand({
          command: setTankDimensions({ width: 800, height: 400, depth: 400 }),
        }),
      ),
    );
    const store = TestBed.inject(MockStore);
    store.overrideSelector(selectSceneState, { scene, history: fakeHistory });
    store.refreshState();

    const result = await firstValueFrom(effects.dispatchCommand$.pipe(take(1)));
    expect(result.type).toBe('[Scene] Command Rejected');
    const rejected = result as ReturnType<typeof SceneActions.commandRejected>;
    expect(rejected.reason).toBe('invalid');
    expect(rejected.message).toMatch(/History\.push returned null/);
  });
});
