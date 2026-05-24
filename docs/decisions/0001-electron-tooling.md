# ADR 0001 — Electron tooling: `nx-electron` vs hand-rolled

**Status:** Accepted (finalized in F0.6) — hand-rolled with `electron-builder`.
**Date:** Stage 0, F0.1 (scaffold); confirmed Stage 0, F0.6 (app shells).

## Context

`apps/desktop` is an Electron app that loads the Angular `apps/web` build. F0.1 (this scaffold) defers the choice between using the community plugin `nx-electron` and a hand-rolled Electron project. F0.6 owns the final decision and must implement the choice.

## Options

**A. `nx-electron`** — community plugin, provides generators + executors for `build`, `serve`, `package`, `make`. Pros: less wiring, integrates with Nx affected graph out of the box. Cons: third-party plugin lifecycle risk; harder to deviate from its conventions; lags behind Nx major versions.

**B. Hand-rolled** — `@nx/js` project for the main + preload, `electron-builder` (or `electron-forge`) for packaging via a `targets.package` executor wrapping the CLI. Pros: full control, no plugin dependency, fewer abstractions to debug. Cons: more wiring; we own the packaging matrix.

## Recommendation (subject to F0.6 confirmation)

**Hand-rolled (B)**, with `electron-builder` for packaging. The Electron surface in this project is small (main process boot, typed preload bridge, IPC channels for `platform-electron`), so the plugin's value is modest, and the security posture (context isolation, sandbox, no `nodeIntegration`, CSP) is opinionated enough that we'd be working around the plugin's defaults anyway.

## Consequences

- `apps/desktop/project.json` builds the main and preload via two `@nx/js:tsc` targets (`build-main`, `build-preload`) composed by a top-level `build` that also `dependsOn` `web:build` so the renderer bundle is produced first.
- `electron` and `electron-builder` are pinned in workspace devDependencies (`electron@^33`, `electron-builder@^25`); no `nx-electron` plugin.
- Packaging (`make` / `pack` targets, code-signing, notarization) is deferred to F6.4 — `electron-builder` is already installed but unused at this stage.
- Dev workflow uses `DEV_SERVER_URL=http://localhost:4200 electron <main.js>` to point the renderer at the Angular dev server. Production builds load the packaged `dist/apps/web/browser/index.html` over `file://`.

## Revisit

Re-evaluate at end of Stage 6 (export & sharing) once we know the real packaging surface — auto-update, code signing, notarization — and have data on `electron-builder` friction.
