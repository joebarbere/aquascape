// App-mode CLI parsing — the desktop shell's `--mode` flag.
//
// Modes select a launch profile for the window + renderer. The default
// `'normal'` mode is the full editor. `'simulation'` is the borderless-fullscreen
// showcase: the main process opens a frameless fullscreen window and the
// renderer (apps/web) loads a richly-populated scene in the 3D view with a
// HUD. See `docs/caveats/app-modes.md`.
//
// This module is PURE (no `electron` import) so the flag grammar can be
// unit-tested without booting Electron — same split discipline as
// `web-preferences.ts` / `csp.ts`. The wiring that consumes the parsed mode
// lives in `main.ts`.

/** The launch profiles the desktop shell understands. */
export type AppMode = 'normal' | 'simulation';

/** The string handed to the renderer over `additionalArguments`. */
export const MODE_ARG_PREFIX = '--aquascape-mode=';

const VALID_MODES: readonly AppMode[] = ['normal', 'simulation'];

function isAppMode(value: string): value is AppMode {
  return (VALID_MODES as readonly string[]).includes(value);
}

/**
 * Parse the launch mode from a raw `process.argv`-style array.
 *
 * Accepts both `--mode simulation` (space-separated) and `--mode=simulation`
 * (equals-joined) forms. Unknown / missing / malformed values fall back to
 * `'normal'` — an unrecognised mode must never brick the launch, it just
 * means "open the normal editor". The scan is order-independent and ignores
 * the leading `node` / electron-binary / entry-script argv entries because
 * it only ever matches the explicit `--mode` token.
 *
 * @param argv Typically `process.argv`. Defaults to it for convenience.
 */
export function parseAppMode(argv: readonly string[] = process.argv): AppMode {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--mode') {
      const next = argv[i + 1];
      if (next !== undefined && isAppMode(next)) return next;
      continue;
    }
    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (isAppMode(value)) return value;
    }
  }
  return 'normal';
}

/**
 * Read the mode the main process forwarded to a sandboxed preload via
 * `webPreferences.additionalArguments`. The preload sees those strings on
 * its own `process.argv`; we look for the `--aquascape-mode=<mode>` token.
 *
 * Kept here (not inlined in the preload) only as the canonical grammar — the
 * preload itself inlines the parse because the sandbox can't `require`
 * sibling modules (see `preload.ts`).
 */
export function readForwardedMode(argv: readonly string[] = process.argv): AppMode {
  for (const arg of argv) {
    if (arg.startsWith(MODE_ARG_PREFIX)) {
      const value = arg.slice(MODE_ARG_PREFIX.length);
      if (isAppMode(value)) return value;
    }
  }
  return 'normal';
}
