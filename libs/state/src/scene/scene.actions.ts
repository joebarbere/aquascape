// Scene-feature action group. F1.1 Phase B.
//
// Convention: actions in the **command pipeline** (`dispatchCommand`,
// `applyCommandSucceeded`, `commandRejected`) carry full `Scene` /
// `History` payloads — the effect does the work via `applyCommand` from
// `@aquascape/domain/scene-model` and the reducer just commits the result.
// Keeping the reducer pure-data-in/data-out lets us reuse the same store
// shape for replay, time-travel, and (later) collaboration.
//
// `setTankPresetRef` is a deliberate exception. Clearing or stamping
// `scene.tank.presetRef` is **metadata** — it does not change the structural
// `Scene` graph and does not need to participate in undo/redo (per Phase A
// of F1.1, the domain `SetTankDimensions` command intentionally leaves
// `presetRef` alone; the UI decides whether the new dimensions still match
// the preset). Routing it through the Command pipeline would force the
// scene-model to grow a metadata-only command kind for every such case;
// instead, the reducer mutates the field directly. Documented here so the
// next pair of eyes sees the call-site rationale.

import type { CatalogRef, Command, RejectReason, Scene } from '@aquascape/domain/scene-model';
import type { History } from '@aquascape/domain/scene-model';
import { createActionGroup, emptyProps, props } from '@ngrx/store';

/**
 * Action group for the `scene` feature.
 *
 * Source = "Scene" so devtools show actions as `[Scene] Dispatch Command`,
 * `[Scene] Apply Command Succeeded`, etc.
 */
export const SceneActions = createActionGroup({
  source: 'Scene',
  events: {
    /**
     * UI intent — dispatch any `Command` record from `@aquascape/domain/
     * scene-model`. The effect translates this into `applyCommand` + the
     * resolved success/failure action.
     */
    'Dispatch Command': props<{ command: Command }>(),

    /**
     * Effect → reducer: a command was applied successfully. Payload carries
     * both the new `Scene` and the updated `History` so the reducer can
     * commit them atomically.
     */
    'Apply Command Succeeded': props<{ scene: Scene; history: History }>(),

    /**
     * Effect → reducer (and UI): a command was rejected by `applyCommand`.
     * Reducer is a no-op for this; surface the typed reason + message to
     * the host UI (toast / inspector).
     */
    'Command Rejected': props<{ reason: RejectReason; message: string }>(),

    /**
     * UI intent — undo the most recent command. F1.1 wires the action +
     * reducer behaviour; the UI binding lands later (F1.6 + tool surface).
     */
    Undo: emptyProps(),

    /**
     * UI intent — redo the most recently undone command.
     */
    Redo: emptyProps(),

    /**
     * Metadata-only update to `scene.tank.presetRef`. NOT routed through
     * the Command pipeline — see the file-header comment for the rationale.
     * Pass `null` to clear (e.g. when the user types custom dimensions and
     * the previously-selected preset no longer applies).
     */
    'Set Tank Preset Ref': props<{ presetRef: CatalogRef | null }>(),
  },
});
