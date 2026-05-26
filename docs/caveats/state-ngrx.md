# State (NgRx) caveats

**Load this when:** touching `libs/state/` — actions, reducers, effects, selectors, autosave, recovery, or writing component specs that use `provideMockStore`.

- Generic `dispatchCommand` effect → `applyCommand` → either `applyCommandSucceeded({ scene, history })` or `commandRejected({ reason, message })`.
- Selection reducer **preserves identity on no-op state changes** (e.g. `clearSelection` on empty set) so `OnPush` components don't redraw spuriously.
- Cross-store dispatch: opening / recovering a file emits BOTH `SceneActions.setScene` AND `DocumentActions.documentOpened` — two reducers stay decoupled but land consistently. A `resetOnSceneReplace$` effect observes `setScene` and clears selection.
- Autosave debounced via the `AUTOSAVE_DEBOUNCE_MS` injection token (3000 ms prod, 0 in tests). Persisted as a versioned `{ version: 1, document, fileId, name, savedAt }` payload at `aquascape.autosaveDraft`; cleared on any successful save.
- `DocumentEffects.bootstrap()` is called once from the composition root after `bootstrapApplication` to prime recent files + crash draft from storage. Recover dispatches `setScene` + `documentOpened` + `markDirty` (recovered docs are presumed unsaved).
- **NgRx selector overrides via `provideMockStore({ selectors: [...] })` LEAK across `TestBed.resetTestingModule()` calls.** Specs that override `selectScene` to `null` in one test will silently corrupt subsequent tests. Configure helpers must include the desired selector value in EVERY test.
