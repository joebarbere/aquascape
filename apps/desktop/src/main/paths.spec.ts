// Path-math sanity checks. The compiled main lives at
// `dist/apps/desktop/main/src/main/main.js` (see `paths.ts` for why the
// `src/` nesting exists). The web build lands at
// `dist/apps/web/browser/index.html`. The relative climb has to be right or
// the packaged app loads a blank screen.

import * as path from 'node:path';

import {
  resolveIconPath,
  resolveIndexPath,
  resolvePlatformIconPath,
  resolvePreloadPath,
} from './paths';

const MAIN_DIR = path.join('/abs', 'dist', 'apps', 'desktop', 'main', 'src', 'main');

describe('resolveIndexPath', () => {
  it('resolves to dist/apps/web/browser/index.html from the runtime main dir', () => {
    expect(resolveIndexPath(MAIN_DIR)).toBe(
      path.join('/abs', 'dist', 'apps', 'web', 'browser', 'index.html'),
    );
  });

  it('produces a normalised path (no stray ".." segments left over)', () => {
    expect(resolveIndexPath(MAIN_DIR)).not.toContain('..');
  });
});

describe('resolvePreloadPath', () => {
  it('resolves to dist/apps/desktop/preload/src/preload/preload.js', () => {
    expect(resolvePreloadPath(MAIN_DIR)).toBe(
      path.join('/abs', 'dist', 'apps', 'desktop', 'preload', 'src', 'preload', 'preload.js'),
    );
  });

  it('produces a normalised path', () => {
    expect(resolvePreloadPath(MAIN_DIR)).not.toContain('..');
  });
});

describe('resolveIconPath', () => {
  it('defaults to dist/apps/desktop/main/assets/icon.png (alongside main.js)', () => {
    expect(resolveIconPath(MAIN_DIR)).toBe(
      path.join('/abs', 'dist', 'apps', 'desktop', 'main', 'assets', 'icon.png'),
    );
  });

  it('honours the explicit "png" kind', () => {
    expect(resolveIconPath(MAIN_DIR, 'png')).toBe(
      path.join('/abs', 'dist', 'apps', 'desktop', 'main', 'assets', 'icon.png'),
    );
  });

  it('resolves the Windows .ico path', () => {
    expect(resolveIconPath(MAIN_DIR, 'ico')).toBe(
      path.join('/abs', 'dist', 'apps', 'desktop', 'main', 'assets', 'icon.ico'),
    );
  });

  it('resolves the macOS .icns path', () => {
    expect(resolveIconPath(MAIN_DIR, 'icns')).toBe(
      path.join('/abs', 'dist', 'apps', 'desktop', 'main', 'assets', 'icon.icns'),
    );
  });

  it('produces a normalised path', () => {
    expect(resolveIconPath(MAIN_DIR)).not.toContain('..');
  });
});

describe('resolvePlatformIconPath', () => {
  it('selects ICNS on darwin', () => {
    expect(resolvePlatformIconPath(MAIN_DIR, 'darwin')).toBe(
      path.join('/abs', 'dist', 'apps', 'desktop', 'main', 'assets', 'icon.icns'),
    );
  });

  it('selects ICO on win32', () => {
    expect(resolvePlatformIconPath(MAIN_DIR, 'win32')).toBe(
      path.join('/abs', 'dist', 'apps', 'desktop', 'main', 'assets', 'icon.ico'),
    );
  });

  it('falls back to PNG on linux', () => {
    expect(resolvePlatformIconPath(MAIN_DIR, 'linux')).toBe(
      path.join('/abs', 'dist', 'apps', 'desktop', 'main', 'assets', 'icon.png'),
    );
  });

  it('falls back to PNG on unknown platforms', () => {
    expect(resolvePlatformIconPath(MAIN_DIR, 'freebsd' as NodeJS.Platform)).toBe(
      path.join('/abs', 'dist', 'apps', 'desktop', 'main', 'assets', 'icon.png'),
    );
  });
});
