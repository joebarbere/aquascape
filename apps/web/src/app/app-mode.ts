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

/** The launch profiles the renderer understands. Mirrors the desktop `AppMode`. */
export type AppMode = 'normal' | 'simulation';

const VALID_MODES: readonly AppMode[] = ['normal', 'simulation'];

function isAppMode(value: string | null | undefined): value is AppMode {
  return value != null && (VALID_MODES as readonly string[]).includes(value);
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
  const bridgeMode = win?.aquascape?.mode;
  if (isAppMode(bridgeMode)) return bridgeMode;

  // 2. `?mode=` query param (browser + e2e + dev-server preview).
  try {
    const search = win?.location?.search ?? '';
    const param = new URLSearchParams(search).get('mode');
    if (isAppMode(param)) return param;
  } catch {
    // A hostile / exotic `location` shape must never break boot — fall
    // through to the normal editor.
  }

  return 'normal';
}
