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

/**
 * The four playable game sub-modes (Stage 16 / ADR-0007). Selected via the
 * `game:<submode>` colon grammar — `--mode game:survival` etc.
 */
export type GameMode = 'survival' | 'feeding' | 'predator' | 'cleaner';

/** Allowlist of game sub-modes (the bit after `game:`). */
export const GAME_MODES: readonly GameMode[] = ['survival', 'feeding', 'predator', 'cleaner'];

/** The launch profiles the desktop shell understands. */
export type AppMode = 'normal' | 'simulation' | `game:${GameMode}`;

/** The string handed to the renderer over `additionalArguments`. */
export const MODE_ARG_PREFIX = '--aquascape-mode=';

const SINGLE_TOKEN_MODES: readonly AppMode[] = ['normal', 'simulation'];

/** The `game:` prefix the colon grammar uses (ADR-0007). */
const GAME_MODE_PREFIX = 'game:';

function isGameMode(value: string): value is GameMode {
  return (GAME_MODES as readonly string[]).includes(value);
}

/**
 * Validate a raw mode token against the full grammar:
 *   - the single-token modes (`normal` / `simulation`), or
 *   - the colon grammar `game:<submode>` with `<submode>` on the allowlist.
 *
 * An unknown single token, an unknown game sub-mode, or a bare `game:`
 * returns `null` — the caller then falls back to `'normal'`, never crashing.
 */
function parseModeToken(value: string): AppMode | null {
  if ((SINGLE_TOKEN_MODES as readonly string[]).includes(value)) {
    return value as AppMode;
  }
  if (value.startsWith(GAME_MODE_PREFIX)) {
    const sub = value.slice(GAME_MODE_PREFIX.length);
    if (isGameMode(sub)) return `game:${sub}`;
  }
  return null;
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
      if (next !== undefined) {
        const parsed = parseModeToken(next);
        if (parsed !== null) return parsed;
      }
      continue;
    }
    if (arg.startsWith('--mode=')) {
      const parsed = parseModeToken(arg.slice('--mode='.length));
      if (parsed !== null) return parsed;
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
      const parsed = parseModeToken(arg.slice(MODE_ARG_PREFIX.length));
      if (parsed !== null) return parsed;
    }
  }
  return 'normal';
}

/**
 * Type guard for the `game:<submode>` family. Lets `main.ts` branch the
 * window profile (a game launch is a fish-eye kiosk, like the demo) without
 * re-parsing the colon grammar.
 */
export function isGameAppMode(mode: AppMode): mode is `game:${GameMode}` {
  return mode.startsWith(GAME_MODE_PREFIX);
}

/** Extract the `<submode>` from a `game:<submode>` mode, or `null` otherwise. */
export function gameModeOf(mode: AppMode): GameMode | null {
  if (!isGameAppMode(mode)) return null;
  return mode.slice(GAME_MODE_PREFIX.length) as GameMode;
}
