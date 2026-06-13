import { MODE_ARG_PREFIX, parseAppMode, readForwardedMode } from './app-mode';

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
});
