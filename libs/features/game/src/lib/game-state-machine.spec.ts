import {
  GameStateMachine,
  isLiveState,
  isTerminalState,
  reduceGameState,
  type GameState,
} from './game-state-machine';

describe('reduceGameState', () => {
  it('starts at objective and moves to playing on start', () => {
    expect(reduceGameState('objective', { type: 'start' })).toBe('playing');
  });

  it('pauses + resumes', () => {
    expect(reduceGameState('playing', { type: 'pause' })).toBe('paused');
    expect(reduceGameState('paused', { type: 'resume' })).toBe('playing');
  });

  it('wins / loses only from playing', () => {
    expect(reduceGameState('playing', { type: 'win' })).toBe('won');
    expect(reduceGameState('playing', { type: 'lose' })).toBe('lost');
    // A paused run cannot win/lose without resuming first.
    expect(reduceGameState('paused', { type: 'win' })).toBe('paused');
    expect(reduceGameState('paused', { type: 'lose' })).toBe('paused');
  });

  it('shows results from won/lost only', () => {
    expect(reduceGameState('won', { type: 'showResults' })).toBe('results');
    expect(reduceGameState('lost', { type: 'showResults' })).toBe('results');
    expect(reduceGameState('playing', { type: 'showResults' })).toBe('playing');
  });

  it('restarts from any terminal-ish state back to objective', () => {
    expect(reduceGameState('results', { type: 'restart' })).toBe('objective');
    expect(reduceGameState('won', { type: 'restart' })).toBe('objective');
    expect(reduceGameState('lost', { type: 'restart' })).toBe('objective');
    expect(reduceGameState('paused', { type: 'restart' })).toBe('objective');
  });

  it('treats illegal events as no-ops (never throws / bricks)', () => {
    expect(reduceGameState('objective', { type: 'pause' })).toBe('objective');
    expect(reduceGameState('objective', { type: 'resume' })).toBe('objective');
    expect(reduceGameState('results', { type: 'start' })).toBe('results');
    expect(reduceGameState('playing', { type: 'resume' })).toBe('playing');
    // restart from playing/objective is a no-op (not terminal).
    expect(reduceGameState('playing', { type: 'restart' })).toBe('playing');
    expect(reduceGameState('objective', { type: 'restart' })).toBe('objective');
  });

  it('quit is host-handled — no internal state change', () => {
    const states: GameState[] = ['objective', 'playing', 'paused', 'won', 'lost', 'results'];
    for (const s of states) {
      expect(reduceGameState(s, { type: 'quit' })).toBe(s);
    }
  });

  it('runs a full objective → playing → win → results → restart loop', () => {
    let s: GameState = 'objective';
    s = reduceGameState(s, { type: 'start' });
    expect(s).toBe('playing');
    s = reduceGameState(s, { type: 'win' });
    expect(s).toBe('won');
    s = reduceGameState(s, { type: 'showResults' });
    expect(s).toBe('results');
    s = reduceGameState(s, { type: 'restart' });
    expect(s).toBe('objective');
  });
});

describe('isLiveState / isTerminalState', () => {
  it('only playing is live', () => {
    expect(isLiveState('playing')).toBe(true);
    expect(isLiveState('paused')).toBe(false);
    expect(isLiveState('objective')).toBe(false);
    expect(isLiveState('won')).toBe(false);
  });

  it('won/lost/results are terminal', () => {
    expect(isTerminalState('won')).toBe(true);
    expect(isTerminalState('lost')).toBe(true);
    expect(isTerminalState('results')).toBe(true);
    expect(isTerminalState('playing')).toBe(false);
    expect(isTerminalState('paused')).toBe(false);
  });
});

describe('GameStateMachine', () => {
  it('defaults to objective', () => {
    expect(new GameStateMachine().state).toBe('objective');
  });

  it('dispatch returns + stores the resulting state', () => {
    const m = new GameStateMachine();
    expect(m.dispatch({ type: 'start' })).toBe('playing');
    expect(m.state).toBe('playing');
  });

  it('reset returns to objective', () => {
    const m = new GameStateMachine('won');
    m.reset();
    expect(m.state).toBe('objective');
  });
});
