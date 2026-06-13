// Public API for @aquascape/features/game.
//
// The shared game-mode shell (Stage 16 F16.1): the framework-free game logic
// (state machine, scoring, input-intent → velocity mapping, per-sub-mode
// descriptors) plus the Angular glue (`GameModeService`) and the game HUD.
//
// The four playable games (16.2–16.5) build on this shell. The player-control
// SEAM itself (mark an entity, inject velocity before `step()`) lives in
// `@aquascape/domain/livestock-ecs` — see `world.setPlayer` / `setPlayerVelocity`
// and `docs/caveats/game-modes.md`.

// ─── Game sub-mode metadata ──────────────────────────────────────────────
export {
  GAME_MODES,
  describeGameMode,
  isGameMode,
  type GameMode,
  type GameModeDescriptor,
} from './lib/game-modes';

// ─── State machine (pure) ────────────────────────────────────────────────
export {
  GameStateMachine,
  isLiveState,
  isTerminalState,
  reduceGameState,
  type GameEvent,
  type GameState,
} from './lib/game-state-machine';

// ─── Scoring (pure) ──────────────────────────────────────────────────────
export {
  INITIAL_SCORE,
  awardPoints,
  tickElapsed,
  type ScoreState,
} from './lib/scoring';

// ─── Input-intent layer (pure; gamepad backend plugs in here later) ──────
export {
  DEFAULT_KEY_BINDINGS,
  NEUTRAL_INTENT,
  NO_CONTROLS_HELD,
  heldControlsToIntent,
  intentToVelocity,
  keysToHeldControls,
  keysToIntent,
  type HeldControls,
  type InputIntent,
} from './lib/input-intent';

// ─── Angular glue ────────────────────────────────────────────────────────
export { GameModeService, type PlayerVitality } from './lib/game-mode.service';
export { GameHudComponent } from './lib/game-hud.component';
