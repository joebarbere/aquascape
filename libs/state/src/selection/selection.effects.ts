// Selection effects. Stage 3 F3.3.
//
// One effect: reset the selection set when the scene is replaced wholesale
// (Open Document, New Document, Recover Draft). The document store
// dispatches `SceneActions.setScene` for all three; the selection effect
// observes it and emits `selectionWasReset` so the reducer clears.

import { Injectable, inject } from '@angular/core';
import { SceneActions } from '../scene/scene.actions';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { map } from 'rxjs/operators';

import { SelectionActions } from './selection.actions';

@Injectable()
export class SelectionEffects {
  private readonly actions$ = inject(Actions);

  readonly resetOnSceneReplace$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SceneActions.setScene),
      map(() => SelectionActions.selectionWasReset()),
    ),
  );
}
