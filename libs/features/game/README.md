# @aquascape/features/game

The shared game-mode shell (Stage 16 F16.1) — the keystone the four playable
mini-games (survival / feeding / predator / cleaner, 16.2–16.5) build on.

## What's here

- **Pure game logic** (framework-free, exhaustively unit-tested):
  - `game-state-machine.ts` — the run lifecycle FSM (objective → playing →
    paused → won/lost → results). Illegal events are no-ops, never throws.
  - `scoring.ts` — a clamped score + elapsed-time accumulator.
  - `input-intent.ts` — the **input-intent layer**: a device-independent
    `InputIntent` (move vector + action flags) plus a keyboard backend
    (`keysToIntent`) and the `intentToVelocity` mapping. A future **gamepad**
    backend (the separate "game-controller support" plan) plugs in by producing
    the same `InputIntent` — the shell never sees `navigator.getGamepads()`.
  - `game-modes.ts` — per-sub-mode descriptors (objective text, player speed).
- **Angular glue:**
  - `GameModeService` — owns the state machine + score + intent + a Stage-14
    placeholder vitality, surfaced as signals. Derives `playerVelocity` (frozen
    unless the run is live).
  - `GameHudComponent` (`<aquascape-game-hud>`) — objective + score + a
    health/food bar (clearly marked **preview** until Stage 14) + the
    state-driven briefing / pause / win-lose / results dialogs. Keyboard +
    ARIA accessible.

## The player-control seam

The ECS seam (mark a player entity + inject its velocity before `step()`)
lives in `@aquascape/domain/livestock-ecs` (`world.setPlayer` /
`setPlayerVelocity`), NOT here — it's the deterministic core. This lib produces
the velocity from input; the app pushes it onto the world each frame. See
`docs/caveats/game-modes.md` + `docs/caveats/livestock-ecs.md`.
