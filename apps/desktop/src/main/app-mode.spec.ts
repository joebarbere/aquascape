import {
  GAME_MODES,
  MODE_ARG_PREFIX,
  gameModeOf,
  isGameAppMode,
  parseAppMode,
  readForwardedMode,
} from './app-mode';

describe('parseAppMode', () => {
  const PREFIX = ['/usr/bin/electron', '/app/main.js'];

  it('defaults to normal with no flag', () => {
    expect(parseAppMode([...PREFIX])).toBe('normal');
  });

  it('parses the space-separated form `--mode simulation`', () => {
    expect(parseAppMode([...PREFIX, '--mode', 'simulation'])).toBe('simulation');
  });

  it('parses the equals-joined form `--mode=simulation`', () => {
    expect(parseAppMode([...PREFIX, '--mode=simulation'])).toBe('simulation');
  });

  it('parses an explicit `--mode normal`', () => {
    expect(parseAppMode([...PREFIX, '--mode', 'normal'])).toBe('normal');
  });

  it('falls back to normal for an unknown mode value', () => {
    expect(parseAppMode([...PREFIX, '--mode', 'kiosk'])).toBe('normal');
    expect(parseAppMode([...PREFIX, '--mode=banana'])).toBe('normal');
  });

  it('falls back to normal when `--mode` is the last token with no value', () => {
    expect(parseAppMode([...PREFIX, '--mode'])).toBe('normal');
  });

  it('is order-independent — other flags around it do not matter', () => {
    expect(parseAppMode([...PREFIX, '--inspect', '--mode', 'simulation', '--foo'])).toBe(
      'simulation',
    );
  });

  it('ignores a bare `--mode` and uses a later well-formed flag', () => {
    expect(parseAppMode([...PREFIX, '--mode', '--mode=simulation'])).toBe('simulation');
  });

  // ── Stage 16 / ADR-0007 — the `game:<submode>` colon grammar ──────────
  it.each(GAME_MODES)('parses the space-separated `--mode game:%s`', (sub) => {
    expect(parseAppMode([...PREFIX, '--mode', `game:${sub}`])).toBe(`game:${sub}`);
  });

  it.each(GAME_MODES)('parses the equals-joined `--mode=game:%s`', (sub) => {
    expect(parseAppMode([...PREFIX, `--mode=game:${sub}`])).toBe(`game:${sub}`);
  });

  it('falls back to normal for an unknown game sub-mode (never crashes)', () => {
    expect(parseAppMode([...PREFIX, '--mode', 'game:racing'])).toBe('normal');
    expect(parseAppMode([...PREFIX, '--mode=game:'])).toBe('normal');
    expect(parseAppMode([...PREFIX, '--mode=game'])).toBe('normal');
    expect(parseAppMode([...PREFIX, '--mode=game:SURVIVAL'])).toBe('normal');
  });
});

describe('readForwardedMode', () => {
  it('reads the forwarded mode token the preload receives', () => {
    expect(readForwardedMode(['electron', `${MODE_ARG_PREFIX}simulation`])).toBe('simulation');
  });

  it('defaults to normal when the token is absent', () => {
    expect(readForwardedMode(['electron', '--something-else'])).toBe('normal');
  });

  it('defaults to normal for a malformed forwarded value', () => {
    expect(readForwardedMode(['electron', `${MODE_ARG_PREFIX}nope`])).toBe('normal');
  });

  it.each(GAME_MODES)('forwards a valid `game:%s` token', (sub) => {
    expect(readForwardedMode(['electron', `${MODE_ARG_PREFIX}game:${sub}`])).toBe(`game:${sub}`);
  });

  it('defaults to normal for a malformed forwarded game token', () => {
    expect(readForwardedMode(['electron', `${MODE_ARG_PREFIX}game:racing`])).toBe('normal');
  });
});

describe('isGameAppMode / gameModeOf', () => {
  it.each(GAME_MODES)('recognises game:%s', (sub) => {
    expect(isGameAppMode(`game:${sub}`)).toBe(true);
    expect(gameModeOf(`game:${sub}`)).toBe(sub);
  });

  it('rejects the single-token modes', () => {
    expect(isGameAppMode('normal')).toBe(false);
    expect(isGameAppMode('simulation')).toBe(false);
    expect(gameModeOf('normal')).toBeNull();
    expect(gameModeOf('simulation')).toBeNull();
  });
});
