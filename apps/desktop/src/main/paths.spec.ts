// Path-math sanity checks. The compiled main lives at
// `dist/apps/desktop/main/src/main/main.js` (see `paths.ts` for why the
// `src/` nesting exists). The web build lands at
// `dist/apps/web/browser/index.html`. The relative climb has to be right or
// the packaged app loads a blank screen.

import * as path from 'node:path';

import { resolveIndexPath, resolvePreloadPath } from './paths';

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
