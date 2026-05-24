// Selection effects tests. Stage 3 F3.3.

import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of } from 'rxjs';
import { take } from 'rxjs/operators';

import { defaultScene } from '../scene/default-scene';
import { SceneActions } from '../scene/scene.actions';
import { SelectionActions } from './selection.actions';
import { SelectionEffects } from './selection.effects';

describe('SelectionEffects.resetOnSceneReplace$', () => {
  it('emits selectionWasReset on every SceneActions.setScene', async () => {
    TestBed.configureTestingModule({
      providers: [
        SelectionEffects,
        provideMockActions(of(SceneActions.setScene({ scene: defaultScene() }))),
        provideMockStore({}),
      ],
    });
    const effects = TestBed.inject(SelectionEffects);
    const out = await firstValueFrom(effects.resetOnSceneReplace$.pipe(take(1)));
    expect(out).toEqual(SelectionActions.selectionWasReset());
  });
});
