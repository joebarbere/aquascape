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

### Predator (F16.4) — the first mode with real RULES

`game:predator` is fully playable: the player IS the predator, prey flee, and
catching them scores. The rules layer is split by the layer-boundary rule:

- **PURE logic** (`libs/features/game/src/lib/predator-rules.ts`): `detectCatches`
  (which prey are within `catchRadiusMm` of the player), `evaluatePredatorOutcome`
  (reach `targetCatches` → `won`; clock hits `timeLimitSec` below target →
  `lost`; else ongoing), `predatorTimeRemainingSec`, + `DEFAULT_PREDATOR_PARAMS`
  (90 mm radius / 8 catches / 60 s). Framework-free, exhaustively unit-tested.
- **WORLD MUTATION + wiring** (`apps/web/src/app/game/predator-game.service.ts`):
  `PredatorGameService` reads the live snapshot each frame, runs `detectCatches`,
  **despawns** each caught prey (`world.despawn`), awards a point per catch, and
  dispatches `win`/`lose` on the first decided outcome (latched so it fires once).
  It rides the input loop's per-frame hook (`GameInputService.start(sink,
  frameHook)`) — the SAME beat as the input push, decoupled from `world.step`.

**The player becomes a predator by REUSING the existing `Predator` tag + the
`FearSystem` proximity path — no parallel fear/flee code.** The world seam is
`world.setPlayerPredator(true)` (adds `Predator` to the marked player; `false`
removes it). FearSystem already scans every `Predator`-tagged entity as a
roaming risk source (`predatorProximityRisk`), so tagging the player makes
nearby prey accumulate risk + flee with zero new logic. `clearPlayer()` strips
the tag from the departing player so a formerly-player fish doesn't keep scaring
prey once the game ends. `PredatorGameService.start` calls `setPlayerPredator(true)`;
`leaveGameMode` calls `predatorGame.stop()` then `world.clearPlayer()`.

### The catch/despawn determinism boundary (load-bearing)

A **catch is a non-deterministic GAME EVENT** — it's gated on the LIVE player
position, which comes from live input. So the despawn it triggers MUST stay OUT
of the replay-critical deterministic sim core, and it does:

- Catch detection + `world.despawn` run in `PredatorGameService.frame` (the app
  loop), **between** sim ticks — never inside `world.step()`, never in a system.
  It's the same class of out-of-tick entity mutation the editor's add/remove
  livestock already does; it is not part of the seeded tick stream.
- The loop only runs while an **active predator game** has a **live player**
  marked. A non-game world (no player, no `PredatorGameService` started) never
  instantiates the frame loop → no despawn → the **1000-tick byte-identical
  replay holds**. Proven by `player-seam.spec.ts` (no-player replay) +
  `predator-game.service.spec.ts` (a world with no rules running keeps every prey).

### Survival (F16.2) — flee predators, outlast the clock

`game:survival` is fully playable: the player is **prey** (NOT tagged
`Predator`), the existing predator agents hunt it via the existing `FearSystem`
proximity path (no parallel hunt code), and the objective is to outlast the
clock without being caught. Same split as predator:

- **PURE logic** (`libs/features/game/src/lib/survival-rules.ts`): `isCaught`
  (a predator inside `catchRadiusMm` → lose), `isThreatened` (a predator inside
  the wider `threatRadiusMm` → stamina drains), `stepStamina` (drain near a
  predator, recover when safe), `evaluateSurvivalOutcome` (lose on
  caught / health-0 / stamina-0; win on surviving `timeLimitSec`),
  `survivalScoreFor` (whole seconds survived) + `DEFAULT_SURVIVAL_PARAMS`
  (90 mm catch / 280 mm threat / 90 s). Framework-free, exhaustively tested.
- **WORLD READS + wiring** (`apps/web/src/app/game/survival-game.service.ts`):
  `SurvivalGameService` reads the live snapshot + queries the `Predator`-tagged
  entities each frame, steps a **game-local stamina** bar, pushes the player's
  REAL `HealthDrive.health` + fullness + stamina to the HUD, awards the
  seconds-survived score, and dispatches `win`/`lose` on the first decided
  outcome (latched). It **mutates nothing** in the world (only reads) — the
  lose/win is a state-machine transition, not a sim change.
- **Threat seeding (between ticks, app-layer):** if the loaded scene has no
  predators of its own, `start` **promotes** the `HUNTER_COUNT` (3) fish
  FARTHEST from the player to `Predator` (so they don't catch the player on
  frame 0). `stop` demotes exactly those eids, so a formerly-hunter fish doesn't
  keep scaring prey after the game and the world replays byte-identically again.
  This tag mutation runs OUTSIDE `world.step()`, gated on an active game.

### Feeding (F16.3) — eat falling food, fill the meter

`game:feeding` is fully playable: typed food (Stage 14 `FoodSprite`) falls from
the surface, the player eats it by proximity (the same between-ticks despawn
pattern as a predator catch), and the objective is to fill a **food meter** to a
target without **over-eating**.

- **PURE logic** (`libs/features/game/src/lib/feeding-rules.ts`): `detectEaten`
  (food within `eatRadiusMm` of the player), `applyBites` (each bite fills the
  meter + scores, OR — when the meter is already full — wastes the bite +
  PENALISES the score: gorging), `drainFill` (hunger creeps the meter back down
  over time), `evaluateFeedingOutcome` (win on reaching `targetFill`; lose on
  health-0 / clock-below-target) + `DEFAULT_FEEDING_PARAMS` (70 mm eat / 12 %
  per bite / 90 % target / 60 s). Framework-free, exhaustively tested.
- **WORLD MUTATION + wiring** (`apps/web/src/app/game/feeding-game.service.ts`):
  `FeedingGameService` periodically **drops** food (`world.spawnFoodSprite`
  every `DROP_INTERVAL_SEC`, capped at `MAX_LIVE_FOOD`), runs `detectEaten`,
  **despawns** each eaten sprite, folds the bites into the meter + score, pushes
  the player's REAL health + the GAME METER (not the fish's intrinsic hunger) to
  the HUD, and dispatches `win`/`lose` (latched). Drop columns come from a
  **service-local LCG** seeded to a fixed constant on `start` — NEVER
  `Math.random` / `Date.now`, and never read inside `world.step()` — so the
  drop pattern is reproducible per run and nothing leaks into the seeded tick
  stream. The food then sinks per its `FOOD_TYPE` kinematics via the sim's
  `foodSpriteKinematicSystem` (the service only places the drop).

### The HUD vitality bars are now REAL (F16.2/16.3)

The F16.1 placeholder vitality is replaced by `GameModeService.setVitality(health,
food, stamina)` (`isPlaceholder: false`, drops the "preview" badge). The per-mode
service reads the player's `HealthDrive.health` + `FeedingDrive.hunger` from the
world snapshot via `readPlayerVitals(world, eid)` (`game-activation.ts`) each
frame. Survival drives the **stamina** bar (a third meter the HUD shows only
when `vitality.stamina !== null`); feeding leaves stamina `null` and binds the
"Food" bar to its game meter. Predator (F16.4) still shows the placeholder (no
vitality wired) — that's fine, it's a hunt, not a vitality game.

### Cleaner (F16.5) — scrub algae, siphon waste, clean the tank

`game:cleaner` is fully playable — the LAST mode, so **Stage 16 is complete**
(all four modes playable). The player wields a `cleaning-tool` (scraper / brush /
siphon — the siphon REUSES Stage 15's renderer `SiphonTool`, no fork), scrubs
the Stage 13 F13.6 per-type algae off hardscape, and the gravel siphon lifts
settled waste (the Stage 13 chemistry tie-in). The objective is a CLEAN tank.
Same split as the other modes:

- **PURE logic** (`libs/features/game/src/lib/cleaner-rules.ts`):
  `surfacesInReach` (which hardscape surfaces are within the player's tool
  reach), `toolAlgaeTargets` (the tool's `targetAlgae` — but only when it can
  reach a glass/hardscape surface; a substrate-only siphon scrapes NO algae),
  `raspAmountPerType` (per-frame rasp = `effectiveness × dt`), `cleanlinessFraction`
  / `cleanlinessScore` (total algae → a `[0,1]` clean fraction → a 0–100 clean-%),
  `evaluateCleanerOutcome` (clean below `cleanTargetTotal` → `won`; clock →
  `lost`), `cleanerTimeRemainingSec`, + `DEFAULT_CLEANER_PARAMS` (120 mm reach /
  0.5 clean-target / 90 s / 0.04 waste-drain/s). Framework-free, exhaustively
  unit-tested. Imports `AlgaeType` (a string type) from `@aquascape/domain/water-sim`
  (type-only — `scope:feature` may depend on `scope:domain`).
- **WORLD MUTATION + wiring** (`apps/web/src/app/game/cleaner-game.service.ts`):
  `CleanerGameService` resolves the `cleaning-tool` catalog rows into a cycle
  list (scraper → brush → siphon), and each frame — while the player HOLDS the
  use button (the `primary` action, Space) — finds the hardscape surfaces near
  the player (`world.getHardscapeEntities`), rasps the active tool's targeted
  algae types off each (`world.raspAlgaeType`), and (for the siphon) nudges the
  live chemistry cleaner via the EXISTING `WaterChemistryService.applyWaterChange`
  dilution (the single dilution truth — no new waste-removal math). It then
  computes tank cleanliness (sum of `getAlgaeByType` across hardscape), pushes it
  to the HUD's "Food" bar (the bar IS the cleanliness meter, like feeding),
  awards the clean-% score, and dispatches `win`/`lose` (latched).

**Two new `livestock-ecs` world seams** back the cleaner (both reads / between-
ticks mutations — NEVER called inside `world.step()`, so determinism holds):
`world.getHardscapeEntities()` (snapshot the registered hardscape eids +
positions) and `world.raspAlgaeType(eid, type, amount)` (reduce one per-type
algae stock + re-derive the aggregate `algaeScore` in lock-step — mirrors the
FeedingSystem grazer rasp's bookkeeping, but driven by live player aim).

**Tool-select UX:** the player presses **`T`** (handled in `AppComponent.onGlobalKeydown`,
gated on `gameMode() === 'cleaner'`) to cycle scraper → brush → siphon → …. The
active tool's name + a hint render in a corner indicator (`.cleaner-tool-hud`,
`role="status"` / `aria-live="polite"`); the cleaner service exposes
`activeTool()` + `siphonActive()` signals the template + the siphon wiring read.

**The siphon nozzle (renderer imperative calls) stays in `AppComponent`, NOT
the service** (the service touches a concrete world + the game/chemistry
services, never the renderer — layer discipline). The `cleanerSiphonEffect`
(mirrors F15.2's `siphonActiveEffect`) flips `RenderOptions.siphonTool` on/off
when the player cycles to/away from the siphon (a signal read + `renderCurrent`).
The nozzle POSITION is pushed from the cleaner frame hook (`driveCleanerSiphon`
→ `setSiphonPosition` at the player's live world position) + the suction MODE
from `syncCleanerSiphon` (`setSiphonMode('out')` while active) — all event-path
calls from the input loop / key handler, **never inside the render effect**
(NG0600). `leaveGameMode` parks the nozzle (`setSiphonMode('idle')`) before the
cleaner stops.

#### Determinism boundary (cleaner)

Identical to predator's: a clean STROKE is a **non-deterministic GAME EVENT**
gated on the LIVE player position + tool + held button. The algae rasp
(`world.raspAlgaeType`) + the waste dilution run in `CleanerGameService.frame`,
BETWEEN sim ticks via the input loop's per-frame hook — never inside
`world.step()`, never in a system. The loop runs ONLY while an active cleaner
game has a live player marked; a non-game world (no player, no service started)
never instantiates it, so the 1000-tick byte-identical replay holds. Proven by
`cleaner-game.service.spec.ts` (a world with no rules running keeps every algae
stock) + the unchanged `domain-livestock-ecs` determinism suite.

The README "Game modes" line now reads all four modes playable (Stage 16 done).

### Determinism boundary (both new modes)

Identical to predator's: being-caught (survival) and an eat (feeding) are
**non-deterministic GAME EVENTS** gated on the LIVE player position. The
detection + any world mutation (feeding's despawn/drop; survival mutates
nothing) run in the per-mode service's `frame`, BETWEEN sim ticks via the input
loop's per-frame hook — never inside `world.step()`, never in a system. Each
loop runs ONLY while an active game has a live player marked; a non-game world
(no player, no service started) never instantiates it, so the 1000-tick
byte-identical replay holds. Proven by `survival-game.service.spec.ts` +
`feeding-game.service.spec.ts` (a world with no rules running keeps every entity
+ spawns no food).

### Tests + e2e

- `apps/web/src/app/game/game-activation.spec.ts` — pure helper (real world).
- `apps/web/src/app/game/game-input.service.spec.ts` — the FULL pipeline
  (synthetic `keydown` → velocity → a real `world.step()` moves a marked
  player); `step(nowMs)` drives frames without a real rAF.
- `app.component.spec.ts` — AppComponent wiring (HUD mounts, `forceMode`,
  Esc-exit, the Mode-menu game switch).
- `apps/web-e2e/src/game-mode.spec.ts` — boots `?mode=game:predator`, asserts
  3D fish-eye + a marked player, then a synthetic key moves the player's world
  position. F16.4 adds a second case: steer toward the nearest prey + poll
  `getGameScore()` (a new read-only debug-hook accessor, alongside
  `getGameState()`) until a catch lands. **Needs hardware/SwiftShader WebGL**
  (the world only ticks + the catch loop runs while the 3D canvas paints) — runs
  under `nx serve web` per the e2e caveat; it was NOT run in the authoring
  environment (no chromium binary provisioned there), so the equivalent coverage
  is the component + integration specs above (`predator-game.service.spec.ts`).
  Validate it on a box with a GPU / provisioned chromium.
- `apps/web/src/app/game/predator-game.service.spec.ts` — the FULL predator
  pipeline against a real world: a catch despawns a prey + increments the score,
  reaching the target dispatches `win`, the clock dispatches `lose`, and a
  non-game world keeps every prey (determinism boundary).
- `libs/features/game/src/lib/predator-rules.spec.ts` — the pure rule logic
  (catch detection, win/lose, countdown).
- `libs/features/game/src/lib/survival-rules.spec.ts` +
  `feeding-rules.spec.ts` + `cleaner-rules.spec.ts` — the pure rule logic for
  the three rule-bearing modes (caught/threat detection, stamina step, eat
  detection, bite scoring + over-eat penalty, meter drain, reach detection,
  tool→algae mapping, rasp amount, cleanliness scoring, win/lose, countdown).
- `apps/web/src/app/game/cleaner-game.service.spec.ts` — the FULL cleaner
  pipeline: a tool near a rock with the use button held rasps that surface's
  TARGETED algae + raises the clean score, a non-targeted type is untouched,
  the siphon dilutes the chemistry waste, cleaning below the target wins, the
  clock loses, the tool-select cycles + flips `siphonActive`, and a non-game
  world is untouched (determinism boundary).
- `libs/domain/livestock-ecs/src/lib/hardscape.spec.ts` — the two cleaner world
  seams (`getHardscapeEntities` snapshot, `raspAlgaeType` per-type reduce +
  aggregate re-derive + clamp + no-op guards).
- `apps/web/src/app/game/survival-game.service.spec.ts` — the FULL survival
  pipeline: a predator in the catch radius loses, surviving the clock wins,
  stamina drains under threat, real vitality is pushed to the HUD, hunters are
  promoted/demoted, and a non-game world is untouched (determinism boundary).
- `apps/web/src/app/game/feeding-game.service.spec.ts` — the FULL feeding
  pipeline: food near the player is despawned + the meter fills + scores,
  filling to target wins, food drops appear over time, real health + the meter
  reach the HUD, and a non-game world spawns/despawns no food.
- `apps/web-e2e/src/game-mode.spec.ts` adds a **survival** case (boots live, the
  survived-seconds score climbs to ≥ 2 while fleeing) + a **feeding** case
  (steer toward the nearest dropped food, poll until the score increments) + a
  **cleaner** case (the boot loop — advisory tier — boots into fish-eye with a
  live player loop; it does NOT assert cleaning progression, per the e2e caveat
  "assert mount/wiring, not simulation progression"). All need hardware/SwiftShader
  WebGL (the world only ticks while the 3D canvas paints); validated on a
  provisioned chromium here (all 4 game-mode boot tests green). **Game-mode
  tests wait on the 3D canvas `nth(1)` (the active one in fish-eye), not
  `.first()` — in game mode the 2D canvas is hidden from the start.**
- `libs/domain/livestock-ecs/src/lib/player-seam.spec.ts` — `setPlayerPredator`
  tags/untags + makes nearby prey accumulate fear risk (FearSystem reuse).

## CI

`features-game` is in the `pr.yml` coverage-gate selector (90 %
statements/functions/lines, 85 % branches in its `jest.config.ts`). The
`main.yml` matrix picks it up via `nx run-many`. Path alias
`@aquascape/features/game` is in `tsconfig.base.json`.
