// Unit tests for the runtime platform selector.
//
// We can't manipulate the real `window.aquascape` cleanly across test cases
// (jsdom keeps a single window), so each test passes a synthetic
// `globalThis`-shaped object to `selectPlatform`. This exercises the same
// detection branch the runtime takes.

import type { ElectronTransport } from '@aquascape/platform/platform-electron';

import { selectPlatform } from './select-platform';

function fakeGlobal(window?: Partial<Window>): typeof globalThis {
  return { window } as unknown as typeof globalThis;
}

describe('selectPlatform', () => {
  it('returns the web platform when there is no window', () => {
    const platform = selectPlatform(fakeGlobal(undefined));
    // The web platform's in-memory file service returns null on open until a save has happened.
    return platform.fileService.openDocument().then((result) => {
      expect(result).toBeNull();
    });
  });

  it('returns the web platform when window.aquascape is undefined', () => {
    const platform = selectPlatform(fakeGlobal({} as Window));
    expect(platform).toBeDefined();
    expect(typeof platform.fileService.openDocument).toBe('function');
  });

  it('returns the electron platform when window.aquascape.ipc is present', () => {
    const fakeIpc = {} as unknown as ElectronTransport;
    const win = { aquascape: { ipc: fakeIpc } } as unknown as Window;
    const platform = selectPlatform(fakeGlobal(win));

    expect(platform).toBeDefined();
    expect(typeof platform.fileService.openDocument).toBe('function');
    expect(typeof platform.dialogService.confirm).toBe('function');
    expect(typeof platform.storageService.get).toBe('function');
    expect(typeof platform.renderExportService.exportPng).toBe('function');
  });

  it('returns the web platform when window.aquascape exists but has no ipc property', () => {
    const win = { aquascape: {} } as unknown as Window;
    const platform = selectPlatform(fakeGlobal(win));
    expect(platform).toBeDefined();
  });
});
