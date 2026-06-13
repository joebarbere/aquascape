# Stage 16 — Game modes (`--mode game:<submode>`)

**Stage:** 16 — Game modes (playable mini-games in the tank).
**Owner:** `angular-feature-engineer` (game shell + HUD + input) + `electron-platform-engineer`
(mode CLI + menu) + `renderer-engineer` (fish-eye retarget) + domain-sim (`livestock-ecs`
player-control API).
**Status:** Not started.

## Goal

Turn the tank into a set of fish-eye, player-controlled mini-games launched as
`--mode game:<submode>` / `?mode=game:<submode>`: **survival**, **feeding**, **predator**, **cleaner**.

## Spec reference

ADR-0007 (game-mode CLI grammar). Builds on the launch-mode system (`apps/web/src/app/app-mode.ts`,
`apps/desktop/src/main/app-mode.ts`), the fish-eye camera (`three-3d-renderer.ts` ~`applyFishEyeCamera`),
the `Predator` tag + `FearSystem`, Stage 14 (food + health), Stage 13 F13.6 (algae), and Stage 15's
`SiphonTool` (reused by cleaner).

## Dependencies

**Requires:** Stage 14 (food + health/hunger) + Stage 13 (algae for cleaner) + Stage 15 (`SiphonTool`).
**Enables:** a gameplay surface that drives further engagement; reuses the whole sim stack.

## Substages

### F16.1 — Mode + player control (the shared shell)
- `AppMode` gains `` `game:${GameMode}` `` (`GameMode = 'survival'|'feeding'|'predator'|'cleaner'`);
  `parseAppMode`/`resolveAppMode` + the preload `VALID_MODES` gain a `game:`-prefix branch (⚑ ADR-0007);
  the desktop Mode menu gets a **Game** submenu.
- A **player entity** in the world: a new world API to mark one entity as player-controlled and inject
  its velocity **before `step()`** (bypassing the AI steering integrator) from keyboard/gamepad input.
  Determinism preserved by spawning the player deterministically and only the *input* being live.
- Retarget the **fish-eye camera** to the player entity (today it rides fish 0).
- A `GameModeService` + a **game HUD** (objective, score, the player's health/food bar reusing
  Stage 14's vitality surfacing) + a shared **game state machine** (objective → win/lose → results,
  pause/exit on Esc).

### F16.2 — Survival
Play a prey fish; existing `Predator`/`FearSystem` agents hunt you; reach cover (hardscape); health +
stamina from Stage 14. Win = survive N minutes; lose = caught.

### F16.3 — Feeding
Eat falling food (Stage 14 typed food); the food meter fills; over/under-eating affects score/health.

### F16.4 — Predator
Play a predator; hunt prey that flee via `FearSystem`; score by catches within a time limit.

### F16.5 — Cleaner
Wield cleaning tools (a new catalog `cleaning-tool` kind: scraper / brush / siphon — the **siphon
reuses Stage 15's `SiphonTool`**); clear algae (Stage 13 F13.6 types) off glass + hardscape; the
siphon removes waste (ties to Stage 13 chemistry). Score by tank cleanliness.

## Scope

**Out:** multiplayer; persistent scores/leaderboards (could be a later add); new fish archetypes for
gameplay (reuse existing).

## Acceptance criteria

- [ ] `--mode game:survival` (and the other three) launch into a fish-eye, player-controlled game;
      unknown sub-modes fall back to `normal` without crashing.
- [ ] Player input moves the player fish (camera follows); AI agents react (predators chase, prey flee).
- [ ] Each mode has a clear objective, win/lose, and score; Esc pauses/exits.
- [ ] Cleaner reuses Stage 15's `SiphonTool` (no fork) and clears Stage 13 algae types.

## Testing

- **Unit:** `parseAppMode`/`resolveAppMode` for `game:<submode>` (valid + invalid → normal); the game
  state machine; the player-input → velocity mapping.
- **Component/E2E (real-GPU loop):** launch each game sub-mode, drive input, assert the player moves +
  the objective/score HUD updates + a win/lose triggers.

## Notes

Player control is the one place that injects non-AI input into the deterministic world — keep it to a
single well-documented seam (set velocity before `step()`), and document it in
`docs/caveats/livestock-ecs.md` (the determinism boundary) + a new `docs/caveats/game-modes.md`. The
game shell likely warrants a new `libs/features/game/` lib (feature-scoped) rather than living in
`apps/web` if it grows.
