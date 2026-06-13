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

## CI

`features-game` is in the `pr.yml` coverage-gate selector (90 %
statements/functions/lines, 85 % branches in its `jest.config.ts`). The
`main.yml` matrix picks it up via `nx run-many`. Path alias
`@aquascape/features/game` is in `tsconfig.base.json`.
