// Renderer-side launch-mode resolution.
//
// The same web bundle runs in three hosts: a browser tab, an installed PWA,
// and the Electron desktop shell. "Simulation mode" — the borderless-fullscreen
// showcase that loads a big populated scene in 3D with a HUD — can be
// requested two ways, checked in priority order:
//
//   1. The Electron shell's preload bridge: `window.aquascape.mode` is set
//      from the `aquascape --mode simulation` CLI flag (see
//      `apps/desktop/src/main/app-mode.ts`). This is the desktop path.
//   2. The `?mode=simulation` URL query param. Works in a plain browser, which
//      makes the showcase demo'able + e2e-testable without packaging the
//      desktop app. Also lets `nx serve web` preview it at
//      `http://localhost:4200/?mode=simulation`.
//
// Anything else resolves to `'normal'` — the full editor.

/**
 * The four playable game sub-modes (Stage 16 / ADR-0007), selected via the
 * `game:<submode>` colon grammar (`?mode=game:survival`). Mirrors the desktop
 * `GameMode`.
 */
export type GameMode = 'survival' | 'feeding' | 'predator' | 'cleaner';

/** Allowlist of game sub-modes (the bit after `game:`). */
export const GAME_MODES: readonly GameMode[] = ['survival', 'feeding', 'predator', 'cleaner'];

/** The launch profiles the renderer understands. Mirrors the desktop `AppMode`. */
export type AppMode = 'normal' | 'simulation' | `game:${GameMode}`;

const SINGLE_TOKEN_MODES: readonly AppMode[] = ['normal', 'simulation'];
const GAME_MODE_PREFIX = 'game:';

function isGameMode(value: string): value is GameMode {
  return (GAME_MODES as readonly string[]).includes(value);
}

/**
 * Validate a raw mode token (`window.aquascape.mode` or `?mode=`) against the
 * full grammar. Returns `null` for anything unrecognised — an unknown single
 * token, an unknown `game:<submode>`, or a bare `game:` — so the caller falls
 * back to `'normal'` without crashing (the ADR-0007 contract).
 */
function parseModeToken(value: string | null | undefined): AppMode | null {
  if (value == null) return null;
  if ((SINGLE_TOKEN_MODES as readonly string[]).includes(value)) {
    return value as AppMode;
  }
  if (value.startsWith(GAME_MODE_PREFIX)) {
    const sub = value.slice(GAME_MODE_PREFIX.length);
    if (isGameMode(sub)) return `game:${sub}`;
  }
  return null;
}

/** Type guard for the `game:<submode>` family. */
export function isGameAppMode(mode: AppMode): mode is `game:${GameMode}` {
  return mode.startsWith(GAME_MODE_PREFIX);
}

/** Extract the `<submode>` from a `game:<submode>` mode, or `null` otherwise. */
export function gameModeOf(mode: AppMode): GameMode | null {
  if (!isGameAppMode(mode)) return null;
  return mode.slice(GAME_MODE_PREFIX.length) as GameMode;
}

/**
 * Resolve the active launch mode. Pure w.r.t. its `globalRef` argument so it
 * can be unit-tested with a stub `window`.
 *
 * @param globalRef Defaults to `globalThis`; tests pass a fake.
 */
export function resolveAppMode(globalRef: typeof globalThis = globalThis): AppMode {
  const win = (globalRef as { window?: Window | undefined }).window;

  // 1. Electron CLI mode forwarded over the preload bridge.
  const bridgeMode = parseModeToken(win?.aquascape?.mode);
  if (bridgeMode !== null) return bridgeMode;

  // 2. `?mode=` query param (browser + e2e + dev-server preview).
  try {
    const search = win?.location?.search ?? '';
    const param = parseModeToken(new URLSearchParams(search).get('mode'));
    if (param !== null) return param;
  } catch {
    // A hostile / exotic `location` shape must never break boot — fall
    // through to the normal editor.
  }

  return 'normal';
}
