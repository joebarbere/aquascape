// Scene effects. F1.1 Phase B.
//
// One effect: translate every `Dispatch Command` into either an
// `Apply Command Succeeded` (carrying the new scene + history) or a
// `Command Rejected` (carrying the typed reason). The History primitive's
// `push` is the canonical place to call `applyCommand` here — it returns the
// `(scene, history)` pair pre-paired so we don't risk drift between the two.
//
// `concatLatestFrom` is the NgRx-recommended way to read store state inside
// an effect; it lazily evaluates the inner selector only when the source
// action fires, which keeps the effect tree from over-subscribing to the
// store on init. Lives in `@ngrx/operators` as of NgRx v18.

import { Injectable, inject, isDevMode } from '@angular/core';
import { applyCommand } from '@aquascape/domain/scene-model';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { concatLatestFrom } from '@ngrx/operators';
import { Store } from '@ngrx/store';
import { map, tap } from 'rxjs/operators';

import { SceneActions } from './scene.actions';
import { selectSceneState } from './scene.selectors';

@Injectable()
export class SceneEffects {
  // `inject()` rather than constructor injection — works at class-field
  // initialization time (so we can declare `dispatchCommand$` as a
  // `readonly` field assigned via `createEffect`) and keeps the constructor
  // empty for cleaner coverage reporting. Effects are always instantiated
  // inside an Angular injection context (production via `provideEffects`;
  // tests via `TestBed`).
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);

  readonly dispatchCommand$ = createEffect(() =>
    this.actions$.pipe(
      ofType(SceneActions.dispatchCommand),
      concatLatestFrom(() => this.store.select(selectSceneState)),
      map(([{ command }, state]) => {
        const pushed = state.history.push(command, state.scene);
        if (pushed !== null) {
          return SceneActions.applyCommandSucceeded({
            scene: pushed.scene,
            history: pushed.history,
          });
        }
        // `push` returned null → applyCommand rejected. Re-run to learn
        // the typed reason; we don't accumulate the rejection in history.
        const result = applyCommand(state.scene, command);
        if (!result.ok) {
          return SceneActions.commandRejected({
            reason: result.reason,
            message: result.message,
          });
        }
        // Defensive fallback: if push said no but apply said yes, treat
        // it as an invariant violation. Surface as a rejection rather
        // than silently dropping the command.
        return SceneActions.commandRejected({
          reason: 'invalid',
          message: 'History.push returned null but applyCommand succeeded',
        });
      }),
    ),
  );

  /**
   * Dev-mode diagnostic: log every `commandRejected` so a "this button
   * doesn't do anything" symptom always shows up in the DevTools console.
   * Common cause is `reason: 'locked'` when the user's selection lives on
   * a layer whose lock toggle is on (UI now shows a "🔒 Layer locked"
   * pill in the inspector, but the log is still useful for keyboard /
   * programmatic dispatches and for any other reason value).
   *
   * Disabled in production builds — there is no UI for the user to
   * action a console message, and the typed `commandRejected` action is
   * already available to any future toast/snackbar layer.
   */
  readonly logRejections$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(SceneActions.commandRejected),
        tap((action) => {
          if (isDevMode()) {
            // eslint-disable-next-line no-console
            console.warn(
              `[scene] command rejected (reason=${action.reason}): ${action.message}`,
            );
          }
        }),
      ),
    { dispatch: false },
  );
}
