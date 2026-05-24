// Selection feature actions. Stage 3 F3.3.
//
// Selection is **transient editor state** — not part of the on-disk document.
// It lives in its own NgRx feature so the document store doesn't grow a
// non-persisted slice, and so cross-feature selectors (handles render, the
// inspector toolbar) can subscribe to a single source of truth without
// reaching into apps/web component state.
//
// Semantics:
//   - `replaceSelection` swaps the current set wholesale (click on an object
//     without modifier).
//   - `toggleInSelection` adds-or-removes a single id (shift-click).
//   - `selectByMarquee` replaces with the marquee's hit list (drag-marquee
//     in empty space).
//   - `clearSelection` empties the set (Esc, click on empty canvas).
//   - `selectionWasReset` is dispatched alongside `SceneActions.setScene` /
//     New Document / Open Document so a selection from the previous document
//     doesn't leak into the new one. Same payload as `clearSelection`; the
//     separate action exists so a devtools trail makes the cause obvious.

import type { ObjectId } from '@aquascape/domain/scene-model';
import { createActionGroup, emptyProps, props } from '@ngrx/store';

export const SelectionActions = createActionGroup({
  source: 'Selection',
  events: {
    'Replace Selection': props<{ ids: readonly ObjectId[] }>(),
    'Toggle In Selection': props<{ id: ObjectId }>(),
    'Select By Marquee': props<{ ids: readonly ObjectId[] }>(),
    'Clear Selection': emptyProps(),
    /** Fired by the document-open / new-document flow. Reducer behaves like Clear. */
    'Selection Was Reset': emptyProps(),
  },
});
