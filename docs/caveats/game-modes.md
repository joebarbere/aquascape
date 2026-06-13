# Caveats: game modes (`--mode game:<submode>`)

**Load this when** touching the `game:<submode>` CLI grammar, the
`libs/features/game/` shell (state machine, HUD, input-intent layer,
`GameModeService`), the player-control seam in `livestock-ecs`, or the fish-eye
player retarget. Cross-load [`app-modes.md`](app-modes.md) (the `--mode`
machinery this extends) + [`livestock-ecs.md`](livestock-ecs.md) (the
determinism boundary the player seam crosses).

> Spec: ADR-0007 (`docs/decisions/0007-game-mode-cli-grammar.md`) +
> `plans/stage-16-game-modes.md`. F16.1 is the shared shell; the four playable
> games (16.2–16.5) build on it and are gated on Stages 14/15.

## The grammar is a branch of the existing `--mode` parse — not new plumbing

`game:<submode>` rides the SAME transport as `simulation` (ADR-0007 option A).
`AppMode` widens to `` 'normal' | 'simulation' | `game:${GameMode}` `` where
`GameMode = 'survival' | 'feeding' | 'predator' | 'cleaner'`. The colon grammar
is validated in FOUR places that must agree (the preload re-inlines because the
sandbox can't `require` siblings — same rule as `app-modes.md`):

1. `apps/desktop/src/main/app-mode.ts` — `parseAppMode` / `readForwardedMode`
   (`parseModeToken` does the `game:`-prefix branch; exports `isGameAppMode` /
   `gameModeOf` / `GAME_MODES`).
2. `apps/web/src/app/app-mode.ts` — `resolveAppMode` (same `parseModeToken`
   shape; same `isGameAppMode` / `gameModeOf` / `GAME_MODES` exports).
3. `apps/desktop/src/preload/preload.ts` — the inlined `parseModeToken` copy
   (in `readMode` + `onSetMode`).
4. The bridge type defs (`apps/desktop/src/preload/global.d.ts` +
   `apps/web/src/electron-bridge.d.ts`) widen `mode` + `onSetMode`.

**Unknown sub-mode → `'normal'`, never a crash.** `game:racing`, a bare
`game:`, `game` with no colon, and a wrong-case `game:SURVIVAL` all fall back to
`'normal'`. This is the ADR-0007 acceptance criterion — covered by the
`app-mode.spec.ts` cases in both apps.

## Game launches are kiosks (main owns Esc)

`apps/desktop/src/main/main.ts` `isKioskMode(mode)` groups `simulation` + every
`game:<submode>`: borderless fullscreen window, no auto-DevTools, fullscreen
toggled on menu switch, and **Esc owned by main** — a kiosk LAUNCH quits
(`app.quit()`), a menu-ENTERED game returns to the editor (`switchMode('normal')`).
Mirrors the demo-mode rule exactly. The desktop Mode menu gains a **Game**
submenu (`menu.ts`) with one radio item per sub-mode (`mode-game-<submode>`).
Don't trap Esc in the renderer for the quit/return outcome — the in-game pause
UI handles Esc-to-pause at the app layer, but the final quit/return is main's.

## The player-control seam (the ONE live-input boundary)

The seam lives in `@aquascape/domain/livestock-ecs` (the deterministic core),
NOT in `features/game` — see [`livestock-ecs.md`](livestock-ecs.md) →
"Player-control seam". In one sentence: `world.setPlayer(eid)` tags one fish
`Player`; `world.setPlayerVelocity(vx,vy,vz)` stores a live velocity that
`world.step()` writes onto the player's `Velocity` **before any system runs**;
`SteeringIntegrator` skips `Player`-tagged entities so AI forces never fight the
input; `KinematicSystem` + the AABB clamp then treat the player like any other
fish. A world with no player marked never touches the injection path → non-game
worlds replay byte-identically (1000-tick determinism holds).

**Input must stay outside the deterministic core.** The live velocity is the
only non-deterministic input. NEVER read `Date.now()` / `Math.random()` /
wall-clock inside the sim to drive the player — feed it as the explicit
per-tick `setPlayerVelocity` only.

## The input-intent layer (where gamepad plugs in later)

`features/game/src/lib/input-intent.ts` is the device abstraction. Features
consume an `InputIntent` (`move` vector + `actions` flags), never raw events or
`navigator.getGamepads()`. Two backends converge on the same `InputIntent`:

- **Keyboard** (F16.1): `keysToIntent(heldCodes)` — keyed by
  `KeyboardEvent.code` (layout-independent; WASD works on AZERTY).
- **Gamepad** (the separate "game-controller support" plan): maps W3C
  Standard-mapping axes/buttons (+ a non-standard fallback) into the SAME
  `InputIntent`. It plugs in at this seam — the state machine, HUD, and
  `intentToVelocity` are unchanged.

`intentToVelocity(intent, speedMmPerSec)` is the pure input → velocity mapping
(clamps diagonal magnitude to ≤ 1 so diagonals aren't faster than cardinals;
zero move = dead stop, no momentum in F16.1). The Angular `GameInputService`
(app layer — NOT a domain lib) will own the keyboard listener + the rAF gamepad
poll and feed raw state into these pure mappers.

## Fish-eye follows the player — reuses, doesn't fork

The fish-eye camera path in `renderer-3d/three-3d-renderer.ts`
(`applyFishEyeCamera`) is UNCHANGED except for WHICH snapshot index it reads:
`fishEyeFollowIndex(snap)` returns the index of `world.getPlayerEntity()` in
`snap.ids` when a player is marked, else 0 (the pre-F16.1 fish-0 behaviour, and
the fallback when the player isn't in the current snapshot). The doc→world
X-mirror + eye-offset math is reused verbatim.

## The game shell (`libs/features/game/`)

`scope:feature` lib. PURE logic (state machine, scoring, input-intent,
sub-mode descriptors) is framework-free + exhaustively tested; the Angular glue
(`GameModeService`, `GameHudComponent`) is the thin wrapper. The shell does NOT
own the keyboard listener, the rAF loop, or the ECS world — the app
(`apps/web`) wires raw input into `GameModeService.setIntent` each frame and
reads `playerVelocity` to push onto `LivestockWorld.setPlayerVelocity`. That
keeps `features/*` free of a concrete renderer/platform (layer-boundary rule).

- **State machine** (`game-state-machine.ts`): `objective → playing → paused →
  won/lost → results`; illegal events are no-ops (never throws). `quit` is
  host-handled (no internal state change) — the service observes it and runs
  the exit path.
- **Player vitality is a PLACEHOLDER** until Stage 14. `PlayerVitality.isPlaceholder`
  is always `true` in F16.1; the HUD shows a "preview" badge so the bar is never
  mistaken for real health. Don't wire real chemistry/health here — that's
  Stage 14, surfaced through this same bar later.

## In-app activation (F16.1b — `apps/web`)

The shell shipped in F16.1; **F16.1b wires it into `apps/web` so a
`game:<submode>` launch is actually playable**. The activation lives in
`AppComponent` and MIRRORS the simulation-mode machinery (see
[`app-modes.md`](app-modes.md)) — don't invent a second path:

- **`maybeActivateGameMode`** (in `ngOnInit`, alongside the simulation check)
  resolves `gameModeOf(resolveAppMode())` and, when non-null, calls
  `enterGameMode(sub)`. The runtime **Mode-menu** switch (`applyMode`) routes a
  `game:<submode>` push into the same `enterGameMode`; the old F16.1 no-op TODO
  is gone.
- **`enterGameMode(mode)`** does, in order: load `createShowcaseScene()`
  (reused, NOT forked — a populated deterministic tank is exactly the
  playground a game wants), `forceMode('fish-eye')`, `store.dispatch(setScene)`
  (which synchronously drives the `LivestockSimulationService` re-spawn, so
  `getWorld()` is populated immediately after), `pickPlayerEntity(world)` →
  `world.setPlayer(eid)`, `GameModeService.startGame(mode)` + `dispatch('start')`
  (straight to the live `playing` loop — the generic shell doesn't wait on the
  "Start" button), then `GameInputService.start(sink)`.
- **`leaveGameMode`** stops the input loop, `world.clearPlayer()` (so the world
  replays byte-identically again — the seam is gated on a marked player),
  clears `gameMode`, and dispatches `quit`. The loaded scene stays in the store.
- **Esc** mirrors the simulation rule exactly (`exitGameMode`): desktop bails
  (main owns quit/return); browser tries `window.close()` then falls back to
  `leaveGameMode`. The `.simulation-mode` chrome-hiding class is shared
  (`simulationMode() || gameMode() !== null`).

### The input loop is the ONE app-layer seam

`GameInputService` (`apps/web/src/app/game/game-input.service.ts`) owns the
keyboard listener (a live `Set<KeyboardEvent.code>`) + the rAF loop. **It must
stay in the app**, never a domain/feature lib (those are DOM-free). Each frame
(`step(nowMs)`, exposed for deterministic tests): `keysToIntent(held)` →
`GameModeService.setIntent` → read `playerVelocity` (zero unless live) → push
onto the world via the `sink` callback `(vx,vy,vz) => world.setPlayerVelocity` →
`GameModeService.tick(dt)`. **`setPlayerVelocity` only STORES** — `world.step()`
applies it at the top of the tick (see [`livestock-ecs.md`](livestock-ecs.md) →
"Player-control seam"), so the rAF rate (≈60 Hz) is decoupled from the sim step
(30 Hz). A `blur` listener clears held keys (no phantom held key on focus loss).
The gamepad backend plugs in at the SAME spot — build the `InputIntent` from
`navigator.getGamepads()` inside this rAF; the rest is unchanged.

### `pickPlayerEntity` is deterministic

`apps/web/src/app/game/game-activation.ts` — the player is snapshot index 0 (the
first-spawned fish; the service walks `scene.livestock` in document order). The
player ENTITY is deterministic; only the live INPUT velocity is not. An empty
world returns `NO_ENTITY_REF` and the caller skips `setPlayer` (so a no-livestock
scene is still a clean non-game world).

### Per-mode rules are still pending

F16.1b is the **generic** playable loop only — objective/score HUD + Esc-exit +
a player you can swim. The real win/lose evaluation, food-aiming, fear-coupling,
algae grazing (16.2–16.5) hook into the shared state machine + `GameModeService`
later. Stage 16 stays on the README TODO until those land.

### Tests + e2e

- `apps/web/src/app/game/game-activation.spec.ts` — pure helper (real world).
- `apps/web/src/app/game/game-input.service.spec.ts` — the FULL pipeline
  (synthetic `keydown` → velocity → a real `world.step()` moves a marked
  player); `step(nowMs)` drives frames without a real rAF.
- `app.component.spec.ts` — AppComponent wiring (HUD mounts, `forceMode`,
  Esc-exit, the Mode-menu game switch).
- `apps/web-e2e/src/game-mode.spec.ts` — boots `?mode=game:predator`, asserts
  3D fish-eye + a marked player, then a synthetic key moves the player's world
  position. **Needs hardware/SwiftShader WebGL** (the world only ticks while the
  3D canvas paints) — runs under `nx serve web` per the e2e caveat; it was NOT
  run in the authoring environment (no chromium binary provisioned there), so
  the equivalent coverage is the component + integration specs above. Validate
  it on a box with a GPU / provisioned chromium.

## CI

`features-game` is in the `pr.yml` coverage-gate selector (90 %
statements/functions/lines, 85 % branches in its `jest.config.ts`). The
`main.yml` matrix picks it up via `nx run-many`. Path alias
`@aquascape/features/game` is in `tsconfig.base.json`.
