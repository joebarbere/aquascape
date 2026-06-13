# ADR 0007 — Game-mode CLI grammar: `--mode game:<submode>`

**Status:** Accepted (planning).
**Date:** Stage 16, F16.1.

## Context

Stage 16 adds playable mini-games inside the tank (survival / feeding / predator / cleaner),
launched like the existing launch modes. The launch-mode system today is a single-token enum:
`AppMode = 'normal' | 'simulation'`, resolved from the Electron preload bridge → the `?mode=` query
param → default (`apps/web/src/app/app-mode.ts`, `apps/desktop/src/main/app-mode.ts`). We need to
express a *family* of game modes with a *sub-mode* selection.

## Options

**A. Colon sub-mode: `--mode game:<submode>`** (`?mode=game:survival`). One token; `AppMode` becomes
`'normal' | 'simulation' | \`game:${GameMode}\``; the existing single-token parser/resolver gains one
`game:`-prefix branch. No new CLI flag, no new bridge field.

**B. Flat per-mode: `--mode survival`, `--mode predator`, …** Each gameplay mode is its own top-level
mode. — Loses the `game` grouping; the renderer/HUD must re-derive "is this a game mode?" from a set;
pollutes the top-level enum with four siblings.

**C. Two tokens: `--mode game --game <submode>`.** — Closest to a natural-language phrasing, but needs
a *second* value threaded through main → `additionalArguments` → preload → `window.aquascape` → the
renderer, doubling the transport surface for no real gain.

## Recommendation

**Option A — `game:<submode>`.** Confirmed with the maintainer. It slots into the existing
single-token transport with the least new surface, keeps `game` as a first-class family (easy
`mode.startsWith('game:')` checks), and reads cleanly as both a CLI flag and a URL param.

## Consequences

- `AppMode` extends to `` `game:${GameMode}` `` where `GameMode = 'survival' | 'feeding' | 'predator' | 'cleaner'`.
- `parseAppMode`/`resolveAppMode` + the preload `VALID_MODES` validation gain a `game:`-prefix branch
  (validate the sub-mode against the allowlist; unknown → `'normal'`, never crash — the existing
  fallback contract). Both the desktop parser and the inlined preload copy must agree (per the
  `app-modes.md` caveat that the preload re-inlines the grammar).
- The runtime "Mode" application menu (`apps/desktop/src/main/menu.ts`) gains a **Game** submenu with a
  radio item per sub-mode (alongside Normal / Simulation).
- The bridge type (`apps/desktop/src/preload/global.d.ts` + `apps/web/src/electron-bridge.d.ts`) widens
  `mode?: 'normal' | 'simulation' | \`game:${GameMode}\``.

## Revisit

If a game mode ever needs structured options beyond a single sub-mode token (difficulty, seed, level),
revisit toward a small query-string-style payload (`game:survival?difficulty=hard`) parsed once at the
boundary — still one token, still one transport.
