# Caveats: app launch modes

**Load this when** touching the `--mode` CLI flag, the showcase demo scene/HUDs, the `~` developer console, the borderless-fullscreen window, or the renderer-side mode resolution. For the `game:<submode>` family specifically, load [`game-modes.md`](game-modes.md) too.

> User + author guide (launching, HUDs, full CLI command reference):
> [`docs/guides/simulation-mode.md`](../guides/simulation-mode.md). This file is the gotchas.

## What "modes" are

A launch profile selected at startup. Today there are: `'normal'` (the
full editor — the default), `'simulation'` (the borderless-fullscreen
showcase; its built-in scene is the `demo` simulation), and the
`` `game:${GameMode}` `` family (Stage 16 / ADR-0007 — `game:survival`,
`game:feeding`, `game:predator`, `game:cleaner`). The mode flows **main
process → preload → renderer**, and the renderer also
honours a `?mode=` URL query param so the showcase / games work in a plain
browser / e2e / `nx serve web` without packaging the desktop app.

**The `game:<submode>` colon grammar is a branch of this same single-token
parse — NOT new plumbing.** `parseModeToken` (in both `app-mode.ts` copies +
the inlined preload copy) validates the `game:` prefix + the sub-mode
allowlist; an unknown sub-mode falls back to `'normal'` (never crashes — the
existing contract). A `game:<submode>` launch is a **kiosk** like
`simulation` (`isKioskMode` in `main.ts` groups them): borderless fullscreen,
main owns Esc, the Mode menu gains a **Game** submenu. The exhaustive details
(the four parse sites, the player seam, the input-intent layer, the fish-eye
retarget) live in [`game-modes.md`](game-modes.md).

```
aquascape --mode simulation            apps/desktop/src/main/app-mode.ts   parseAppMode()
   → BrowserWindow {frame:false, fullscreen:true}   main.ts createMainWindow(mode)
   → webPreferences.additionalArguments ['--aquascape-mode=simulation']
   → preload reads process.argv → window.aquascape.mode = 'simulation'
   → renderer resolveAppMode()   apps/web/src/app/app-mode.ts
   → AppComponent.maybeActivateSimulationMode(): load scene + forceMode('3d') + HUD
```

## Load-bearing gotchas

- **The Electron→renderer transport is `additionalArguments`, NOT a new IPC
  channel.** Sandboxed preloads can't `require` sibling modules but they DO
  get `additionalArguments` appended to their own `process.argv`. The mode
  grammar (`MODE_ARG_PREFIX`, `readForwardedMode`) lives in
  `apps/desktop/src/main/app-mode.ts` and is unit-tested; the preload
  **re-inlines** the same parse because it can't import that module. If you
  change the token, change it in both places.

- **`buildWebPreferences` stays pure + exactly asserted.** `web-preferences.spec.ts`
  uses `toEqual` on the full object — do NOT add `additionalArguments` (or any
  key) to it. The forwarding is merged at the `createMainWindow` call site
  instead, so the security-posture surface is unchanged.

- **The "Mode" application menu switches modes at runtime.** `main.ts` builds
  a full menu (`menu.ts` `buildMenuTemplate` — standard roles PLUS a Mode
  submenu of `Normal Editor` / `Simulation` radio items) and replaces the
  default. Picking one calls `switchMode`, which pushes the new mode to the
  renderer over the `app.mode.set` channel (`webContents.send`) and toggles
  `setFullScreen`. The preload exposes a NARROW `onSetMode(cb)` subscription
  (validated mode string only, never raw `ipcRenderer` / the event); the
  renderer's `AppComponent.subscribeToModeMenu` wires it to
  `enterSimulationMode` / `leaveSimulationToEditor`. Two consequences to know:
  - `appMode` (launch) vs `currentMode` (live) are distinct in `main.ts`. The
    **frame can't change after window creation**, so a menu-entered simulation is
    fullscreen-but-framed, not borderless like the `--mode simulation` launch.
  - On Linux/Windows a borderless (`--mode simulation`) window shows **no menu bar**,
    so the Mode menu is only reachable there when launched normal (or always,
    on macOS, where the menu bar is the OS bar). That's fine — the kiosk launch
    uses Esc, the framed launch uses the menu.

- **Simulation mode forces the 3D view via `ViewModeService.forceMode`, which pins
  the mode against the async storage hydration.** A plain `setMode('3d')`
  would lose a race: the persisted last-used-view read can resolve _after_
  activation and clobber it back to 2D. `forceMode` sets a `hydrationLocked`
  flag the hydration `.then` checks. Per-instance, so a normal launch is
  unaffected.

- **Simulation activation runs in `AppComponent.ngOnInit`, before `ngAfterViewInit`
  wires the store subscription.** That ordering guarantees the scene is in the
  store and the mode is `'3d'` by the time the first render fires, so the
  populated scene paints straight into the 3D canvas. Don't move it later.

- **DevTools never auto-opens in simulation mode.** `main.ts` auto-opens detached
  DevTools for unpackaged dev builds, but the `createMainWindow` guard is
  `!app.isPackaged && mode !== 'simulation'` — the showcase is a clean presentation,
  so a DevTools window would break it. Debug a simulation build on demand with
  `--remote-debugging-port`. (Caveat for that: closing a CDP-connected
  `browser.close()` quits the app on Linux via `window-all-closed`, so attach
  read-only and disconnect without closing if you don't want to kill it.)

- **Editor chrome hiding is global CSS, not component state.** `AppComponent`
  adds `.simulation-mode` to `.app-shell`; the rules that collapse the grid to a
  single canvas column and `display:none` the toolbar / panels / handles /
  floating controls live in `apps/web/src/styles.css` (global — they cross the
  encapsulation boundary deliberately). The HUD itself is a normal
  `:host`-positioned component.

- **The control HUD (top-left) mutates the LIVE scene through the real NgRx +
  Command pipeline — and both HUDs bind to the live store scene.**
  `SimulationControlsComponent` dispatches `SceneActions.dispatchCommand(...)` with
  the same command factories the editor uses (`setWaterLevel`,
  `addLivestockEntry` / `updateLivestockQuantity` / `removeLivestockEntry`,
  `addObject` / `addLayer`) plus `DayNightService.setPhase` for lighting, so the
  3D renderer + the livestock sim react exactly as in the editor (add a fish →
  the sim re-spawns). For the read-only spec HUD to reflect those edits,
  `simulationScene` is kept in sync with the store: the AppComponent store
  subscription (which runs outside Angular's zone) does
  `if (simulationMode()) ngZone.run(() => simulationScene.set(scene))`. Object-id minting
  uses `newObjectId()` (`crypto.randomUUID` — present in browsers/Electron);
  unit tests swap a deterministic factory via `setIdFactory` because jsdom
  lacks it.

- **The `~` console toggle lives in AppComponent, not the console component.**
  A `document:keydown` HostListener matches `event.code === 'Backquote'`
  (layout-independent for the physical key) + simulation mode, `preventDefault`s it
  (so the key never types a backtick), and calls `SimulationUiService.toggleConsole`.
  It must be outside the console component so it works while the console is
  CLOSED. The console component is **always mounted in simulation mode** (a CSS class
  slides it in/out) so its log + input history survive open/close. **Focus on
  open uses `setTimeout(0)`, not a microtask** — the `.console--open` class
  (which flips `visibility: hidden → visible`) has to be applied by change
  detection first, or `.focus()` no-ops on the still-hidden field.

- **Esc precedence in simulation mode: console → active tool → exit.**
  `AppComponent.onEscape` closes the console first if it's open, THEN cancels an
  active husbandry tool (`SimulationActionService.active()` → `reset()`, Stage
  15), THEN runs the simulation-exit logic. Don't reorder — a user mid-feed
  expects Esc to drop the tool, not quit; a user with the console open expects
  Esc to close it.

- **Stage 15 — the bottom-center action HUD is a distinct surface
  (`actionsVisible`).** `aquascape-simulation-actions` is pinned bottom-center
  (the four corners are taken: info top-right, controls top-left, vitality
  left-middle, console bottom-left). It's gated by
  `SimulationUiService.actionsVisible` (default `true`, included in `setHud('all')`
  / `toggleHud('all')` / `resetLayout`) and the `hud … actions` console verb.
  The HUD owns NO scene/tool state — the active-tool state machine (idle →
  tool-selected → sub-step) lives in `SimulationActionService`; the feed picker
  writes the chosen `food` id there, and the **canvas pointer handlers in
  AppComponent** (NOT the HUD component, NOT a render effect — NG0600) read it to
  drop typed food at `raycastTankPoint(pixel, { plane: 'floor' })`. The feeding
  listeners (`pointermove`/`pointerleave`/`click` on the 3D canvas) are installed
  on `enterSimulationMode` and torn down on leave/destroy; they run outside the
  Angular zone and re-enter via `ngZone.run` for the marker signal write + the
  `spawnFood` drop. The `SimulationInteractionRenderer` is the concrete
  `Three3DRenderer` (resolved by duck-typing `raycastTankPoint` off
  `SCENE_RENDERER_3D` — a 2D-only test stub yields `null` and the drop no-ops).

- **Stage 15 F15.2 — the water-change tool is a guided 4-step flow on the same
  state machine.** Selecting `water-change` opens straight into the `params`
  sub-step (no `tool-selected` hop, unlike feed): `params` (replacement form) →
  `place-siphon` → `siphon-out` → `siphon-in`. The flow's effects (dispatching
  the undoable `WaterChange` + `SetWaterLevel` commands AND driving the live
  `WaterChemistryService.applyWaterChange`) live in a separate
  `WaterChangeService`, NOT the HUD component — both paths reuse the one
  `applyWaterChange` dilution helper. The OUT/IN volume → dilution-fraction +
  new-water-level mapping is the pure `water-change-flow` helper (no
  re-implemented dilution math); `WaterChangeService` captures the pre-drain
  level so IN restores it exactly. The shared `SiphonTool` mounts only while
  `SimulationActionService.siphonActive()` is true: a `siphonActiveEffect`
  re-renders so `renderCurrent` flips `RenderOptions.siphonTool`, and a separate
  `siphonModeEffect` pushes `setSiphonMode(out|in|idle)` — both effects make
  renderer imperative calls but NEVER write a signal (NG0600 only bans
  signal-writes in reactive contexts; a renderer method call is fine). The
  nozzle is dragged via dedicated 3D-canvas `pointerdown/move/up` listeners
  (installed on sim enter, torn down on leave) that raycast to the **water**
  plane and call `setSiphonPosition`. On tool exit / Esc / leave: park the
  nozzle (`setSiphonMode('idle')`), tear down the listeners, and
  `WaterChangeService.clear()` the pending OUT capture.

- **Saved simulations persist via the platform `StorageService`; `execute` is
  async.** `sim save/load/list/delete` snapshot the live scene under a name
  into one `aquascape.simulations` record (IndexedDB on web, on-disk JSON on
  Electron — survives restarts) through `SimulationStoreService`. Because storage is
  async, `ConsoleCommand.run` may return a `Promise<ConsoleLine[]>` and
  `SimulationConsoleService.execute` is `async` — the component echoes the input
  synchronously and appends the output when it resolves. The saved value is the
  full `Scene` (plain serializable data), so `sim load` is just
  `SceneActions.setScene`. Names may contain spaces (remaining tokens are
  joined).

- **Console commands mutate through the same pipeline as everything else.**
  `SimulationConsoleService` dispatches `SceneActions.dispatchCommand(...)` (the
  scene-model command factories), drives `DayNightService`, and toggles
  `SimulationUiService` — no special-cased mutation path. Item-add + species helpers
  are shared with the control HUD in `simulation-scene-ops.ts` (single source). The
  service reads the live scene via `store.selectSignal(selectScene)` — note
  `MockStore.overrideSelector` DOES feed `selectSignal` in tests (NgRx 18).

- **Dosing (the Dose HUD group + `dose` verb) is recorded-only.** Both surfaces
  go through `doseNutrientOp(store, scene, id, amount, makeId, unit?)` in
  `simulation-scene-ops.ts`, which resolves the catalog `NutrientEntry`
  (structurally a `ResolvedNutrient`), calls the scene-model `doseNutrient(...)`
  factory, assigns `seq` via `nextDoseSeq(scene)`, and dispatches `DoseNutrient`.
  **No water chemistry is applied** — the command appends a `DoseEvent` to
  `scene.doseLog` (deferred pending `domain/water-sim` / Stage 13). The `dose`
  verb's amount token may carry a unit suffix (`2ml`, `0.6g`) and Tab-completes
  over nutrient ids/names via `SimulationConsoleService.completeArgs('dose', …)`
  — the console component's `autocomplete()` delegates past-the-first-token Tab
  presses there (only `dose` argument-completes today).

- **`noUncheckedIndexedAccess` is on for the web BUILD but lenient under Jest.**
  Array/record index access in the console + ops (`tokens[0]`, `hits[0]`,
  `PHASE_WORDS[token]`, history) is `T | undefined` — guard it (`const x =
arr[0]; if (x !== undefined) …` or `?? ''`). Specs can pass while
  `nx build web` fails; build before you call it done.

- **The HUD clock ticks itself (self-contained), formatted by the pure
  `formatClock`.** The `SimulationHudComponent` owns a once-a-second `setInterval`
  (started in `ngOnInit`, cleared in `ngOnDestroy`) that writes a `now` signal;
  the interval runs outside Angular's zone with the per-second write wrapped in
  `ngZone.run` (same pattern as the perf sampler) so OnPush refreshes without
  per-second global CD. `formatClock` is locale-independent (explicit
  weekday/month tables, no `toLocaleString`) so it's deterministic to test.
  Component tests use `jest.useFakeTimers()` + `setSystemTime` to pin the clock
  and stop the interval leaking a real handle.

- **The HUD's live perf strip is sampled by `SimulationPerfService`, NOT the dev
  hook.** `window.__aquascape_debug__` is gated behind `isDevMode()` and absent
  in production, so the perf strip (FPS / frame time / entity + bubble counts)
  reads the world directly via `LivestockSimulationService.getWorld()`
  (`snapshot(0).entityCount`, `getBubbleParticleCount()`). The rAF frame
  counter runs OUTSIDE Angular's zone; only the twice-a-second publish
  re-enters via `ngZone.run` so the OnPush HUD updates without a per-frame CD
  tick. `AppComponent` calls `start()` on demo enter and `stop()` on demo
  leave (+ destroy), so the loop costs nothing in the normal editor. The HUD
  stays presentational — it takes `metrics` as an input; the host owns the
  service. FPS arithmetic is the pure, unit-tested `frameStats()`.

- **The showcase scene is deterministic.** `createShowcaseScene()` uses stable
  string ids + a seeded `mulberry32`, so two boots produce a byte-identical
  scene. That keeps the livestock sim's `scene.seed`-derived spawn
  reproducible. Don't introduce `crypto`/`Math.random` into it.

- **Esc behavior depends on HOW you entered demo, and main owns it on the
  desktop.** `main.ts`'s `before-input-event` handler (attached to every
  window, gated on `currentMode === 'demo'`):
  - **Launched as the kiosk (`--mode simulation`):** `app.quit()` — there's nothing
    to return to. `app.quit()` (not `win.close()`) so it fully exits on every
    platform, incl. macOS.
  - **Entered simulation via the Mode menu:** `switchMode('normal')` — back to the
    editor + exit fullscreen. You came from an editing session, so you return
    to it.
    The renderer's `exitSimulationMode` therefore **bails entirely under Electron**
    (main owns the outcome; touching the view here would race/flash). In a
    browser tab there's no main process, so:
  - **Browser tab:** a page can't force-close a tab the user navigated to.
    `AppComponent.exitSimulationMode` tries `window.close()` (works for
    script-opened / kiosk windows) and, when the browser refuses, falls back
    to revealing the editor (drops `.simulation-mode` + the HUD) so the user isn't
    trapped — the showcase scene stays loaded, so they land in the editor
    looking at it.
  - The renderer detects Electron via the preload bridge (`window.aquascape`)
    and bails WITHOUT touching the view, so the desktop quit doesn't flash the
    editor for a frame first. `onEscape` checks `simulationMode()` before the
    selection-clear / drag-cancel branches (it's the dominant intent in demo
    mode).

- **The showcase stocks ~108 livestock** (four mid-water schooling shoals) in
  a 1500×600×600 mm tank — comfortably under the F11.6 perf bench's n=200
  budget. If you grow it back toward 200+, re-check the livestock-ecs tick
  budget (`docs/caveats/livestock-ecs.md`).

- **HTML comments inside the `AppComponent` template must not contain
  backticks.** The template is a backtick-delimited JS template literal; a
  stray `` ` `` in a comment closes it and the file fails to parse with a
  cryptic "Invalid left-hand side expression in postfix operation". (Learned
  the hard way wiring the HUD comment.)

## Trying it

- Browser / dev server: `http://localhost:4200/?mode=simulation` (or
  `?mode=game:predator` for a playable game — see [`game-modes.md`](game-modes.md)).
- Desktop: `aquascape --mode simulation` (packaged) or, in dev, append `--mode simulation`
  to the electron invocation (`electron dist/apps/desktop/main/src/main/main.js --mode simulation`).
  Swap for `--mode game:<submode>` to launch a game kiosk.
