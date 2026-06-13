import { resolveAppMode } from './app-mode';

/** Build a fake `globalThis` carrying just the bits `resolveAppMode` reads. */
function fakeGlobal(opts: { bridgeMode?: string; search?: string }): typeof globalThis {
  const win: Partial<Window> = {};
  if (opts.bridgeMode !== undefined) {
    (win as { aquascape?: unknown }).aquascape = { ipc: {}, mode: opts.bridgeMode };
  }
  if (opts.search !== undefined) {
    (win as { location?: unknown }).location = { search: opts.search };
  }
  return { window: win } as unknown as typeof globalThis;
}

describe('resolveAppMode', () => {
  it('defaults to normal with no bridge mode and no query param', () => {
    expect(resolveAppMode(fakeGlobal({}))).toBe('normal');
  });

  it('reads demo from the Electron preload bridge', () => {
    expect(resolveAppMode(fakeGlobal({ bridgeMode: 'simulation' }))).toBe('simulation');
  });

  it('reads demo from the ?mode=simulation query param', () => {
    expect(resolveAppMode(fakeGlobal({ search: '?mode=simulation' }))).toBe('simulation');
  });

  it('reads demo from a query param amongst others', () => {
    expect(resolveAppMode(fakeGlobal({ search: '?debug=1&mode=simulation&x=2' }))).toBe(
      'simulation',
    );
  });

  it('prefers the bridge mode over the query param', () => {
    expect(resolveAppMode(fakeGlobal({ bridgeMode: 'normal', search: '?mode=simulation' }))).toBe(
      'normal',
    );
  });

  it('ignores an unknown bridge mode and falls through to the query param', () => {
    expect(resolveAppMode(fakeGlobal({ bridgeMode: 'kiosk', search: '?mode=simulation' }))).toBe(
      'simulation',
    );
  });

  it('ignores an unknown query mode', () => {
    expect(resolveAppMode(fakeGlobal({ search: '?mode=banana' }))).toBe('normal');
  });

  it('is safe when window is absent (SSR / test shell)', () => {
    expect(resolveAppMode({} as unknown as typeof globalThis)).toBe('normal');
  });
});
