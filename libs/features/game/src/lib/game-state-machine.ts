// Shared game state machine (Stage 16 F16.1).
//
// PURE + framework-free — the four game sub-modes (16.2–16.5) all drive their
// run lifecycle through this one FSM, so win/lose/results flow is consistent
// and unit-testable without a renderer or Angular. The Angular `GameModeService`
// owns an instance and surfaces its state through signals; the HUD reads them.
//
// States:
//   objective  — pre-game briefing (the objective is shown; nothing ticks yet).
//   playing    — the sim is running + the player has control.
//   paused     — playing, suspended (Esc). The sim is frozen; resume returns.
//   won / lost — terminal-ish; the run finished. Showing the result.
//   results    — the results screen (score summary). Restart → objective.
//
// Transitions are explicit `GameEvent`s; an illegal event in a given state is
// a no-op (returns the same state), never a throw — a stray input must never
// brick the game.

/** The lifecycle states a game run moves through. */
export type GameState = 'objective' | 'playing' | 'paused' | 'won' | 'lost' | 'results';

/** Events that drive `GameState` transitions. */
export type GameEvent =
  /** Leave the objective briefing → start playing. */
  | { readonly type: 'start' }
  /** Esc / menu while playing → pause. */
  | { readonly type: 'pause' }
  /** Resume from pause → playing. */
  | { readonly type: 'resume' }
  /** Objective met → win. */
  | { readonly type: 'win' }
  /** Fail condition → lose. */
  | { readonly type: 'lose' }
  /** From won/lost → the results screen. */
  | { readonly type: 'showResults' }
  /** From results (or any terminal state) → back to the objective briefing. */
  | { readonly type: 'restart' }
  /** Quit the game entirely — the host (app) tears down / exits the mode. */
  | { readonly type: 'quit' };

/** True while the sim should tick + the player has control. */
export function isLiveState(state: GameState): boolean {
  return state === 'playing';
}

/** True for the terminal result-ish states (run is over). */
export function isTerminalState(state: GameState): boolean {
  return state === 'won' || state === 'lost' || state === 'results';
}

/**
 * The pure transition function. Given the current state + an event, return the
 * next state. Illegal combinations return the current state unchanged (no-op).
 * `quit` is special — it's handled by the host (it tears down the mode), so
 * the FSM treats it as a no-op on its own state; the service observes the
 * event and calls the exit path.
 */
export function reduceGameState(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'start':
      return state === 'objective' ? 'playing' : state;
    case 'pause':
      return state === 'playing' ? 'paused' : state;
    case 'resume':
      return state === 'paused' ? 'playing' : state;
    case 'win':
      // Only an active run can be won. Pausing first then winning is allowed
      // (a timer can elapse while paused in some modes — but we keep it strict:
      // only `playing` → `won`). A paused run must resume before it can win.
      return state === 'playing' ? 'won' : state;
    case 'lose':
      return state === 'playing' ? 'lost' : state;
    case 'showResults':
      return state === 'won' || state === 'lost' ? 'results' : state;
    case 'restart':
      // Any terminal-ish state can restart back to the objective briefing.
      return isTerminalState(state) || state === 'paused' ? 'objective' : state;
    case 'quit':
      // Host-handled; no internal state change.
      return state;
    default: {
      // Exhaustiveness guard — a new event type without a case is a compile
      // error here.
      const _never: never = event;
      void _never;
      return state;
    }
  }
}

/**
 * A small mutable wrapper around the pure reducer for the Angular service.
 * Keeps the current state + a typed `dispatch`. Framework-free so it can be
 * unit-tested directly; the service wraps it in a signal.
 */
export class GameStateMachine {
  private current: GameState;

  constructor(initial: GameState = 'objective') {
    this.current = initial;
  }

  get state(): GameState {
    return this.current;
  }

  /** Apply an event; returns the resulting state. */
  dispatch(event: GameEvent): GameState {
    this.current = reduceGameState(this.current, event);
    return this.current;
  }

  /** Reset to the objective briefing (a fresh run). */
  reset(): void {
    this.current = 'objective';
  }
}
