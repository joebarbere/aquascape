# State management (NgRx)

> **Load this when:** you want to understand how UI events become scene
> mutations, how documents open/save/autosave, and how selection works.
> Source: [`libs/state/`](../../libs/state/).
> Gotchas: [`docs/caveats/state-ngrx.md`](../caveats/state-ngrx.md).

The store is the seam between the Angular UI and the framework-free domain
layer. Three slices, each with a narrow job:

| Slice | Owns | Notable |
| --- | --- | --- |
| `state/scene` | the live `Scene` + undo/redo `History` | the generic command pipeline |
| `state/document` | file identity, dirty flag, recent files, autosave draft | all platform IO lives in its effects |
| `state/selection` | `{ ids: ObjectId[] }` | transient editor state, never persisted |

## The command pipeline

Every feature dispatches the same generic action. There is exactly one
place where `applyCommand` is called:

```mermaid
flowchart LR
    C[any feature component] -->|"dispatchCommand({ command })"| FX[scene effect]
    FX --> AC["applyCommand(scene, command)<br/>(domain/scene-model)"]
    AC -->|ok| OK["applyCommandSucceeded({ scene, history })"]
    AC -->|rejected| KO["commandRejected({ reason, message })"]
    OK --> RED[scene reducer → new state]
    KO --> BAN[editor-shell error banner]
    RED --> SEL["selectors<br/>selectScene · selectStockingWarnings · …"]
    SEL --> C
```

- **Undo/redo** are actions on the same slice, replaying inverse commands
  from `History`.
- **`setScene`** (Open / New / Recover) replaces the scene wholesale and
  resets history — deliberately not a command.
- **Derived state lives in selectors** — e.g. `selectStockingWarnings`
  runs the `domain/stocking` rules engine over the live scene + bundled
  catalog; components never re-derive it.

## Document lifecycle effects

`state/document` effects own *all* platform IO through the `platform-api`
tokens (so the same effects run in the browser and in Electron):

```mermaid
flowchart TD
    subgraph actions
        OPEN[openDocument]
        SAVE[save / saveAs]
        NEW[newDocument]
        REC[recoverDraft]
    end
    subgraph effects ["document effects (the only platform IO)"]
        FS["FileService<br/>(open / write .aqua)"]
        ST["StorageService<br/>(recent files · autosave draft)"]
    end
    OPEN --> FS --> BOTH["dispatch BOTH<br/>SceneActions.setScene +<br/>DocumentActions.documentOpened"]
    SAVE --> FS
    NEW --> BOTH
    REC --> BOTH2["setScene + documentOpened + markDirty<br/>(recovered docs are presumed unsaved)"]
    DIRTY["any applyCommandSucceeded"] -->|"debounce 3 s<br/>(AUTOSAVE_DEBOUNCE_MS token, 0 in tests)"| ST
```

The **cross-store dispatch** pattern is deliberate: opening a file emits
both `setScene` and `documentOpened` so the scene and document reducers
stay decoupled but land consistently. A `resetOnSceneReplace$` effect in
the selection slice observes `setScene` and clears the selection so a new
document never carries stale ids.

**Autosave / crash recovery:** drafts persist as a versioned payload at
`aquascape.autosaveDraft`, cleared on any successful save.
`DocumentEffects.bootstrap()` runs once from the composition root to prime
recent files and detect a crash draft — which surfaces as the recovery
banner in the toolbar.

## Conventions

- Reducers preserve object identity on no-op transitions (e.g.
  `clearSelection` on an already-empty set) so `OnPush` components don't
  redraw spuriously.
- Components select; effects do IO; reducers stay pure. If a component
  needs data that isn't a selector yet, add the selector.
- Testing uses `provideMockStore` — but beware: selector overrides leak
  across `TestBed.resetTestingModule()`; set every selector value in every
  test (see the caveat file).
