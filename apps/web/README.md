# `apps/web`

Angular web application (SPA / PWA). **Tags:** `scope:app`, `platform:web`.

Stage 0 / F0.6 status: the shell boots, hosts a full-window canvas, and
renders an empty tank via `@aquascape/rendering/renderer-2d`. The
composition root binds `platform-api` tokens to the `platform-web`
in-memory stubs.

## Purpose

`apps/web` is one of the two app shells that compose every feature lib into
a runnable product (the other is `apps/desktop`, the Electron build). The
shell is intentionally **thin**:

- Bootstrap Angular with the standalone-component bootstrap (`bootstrapApplication`).
- Wire `platform-api` tokens to the concrete `platform-web` services.
- Host a single root component (`AppComponent`) that owns a `<canvas>` and
  drives a `SceneRenderer` against the default scene.
- Re-render on `ResizeObserver` callbacks.

All UI features, NgRx state, menus, tool palettes, etc. belong in `libs/`,
not here. The shell composes them.

## Running

```bash
pnpm exec nx serve web     # dev server on http://localhost:4200
pnpm exec nx build web     # production build → dist/apps/web/
pnpm exec nx lint web      # ESLint + module-boundary checks
pnpm exec nx test web      # jest (jest-preset-angular + jsdom)
```

## Layering

Allowed deps: `scope:domain`, `scope:rendering`, `scope:feature`, `scope:ui`,
`scope:state`, `scope:platform-api`, `scope:platform-web`,
`scope:platform-electron`, `scope:testing`. **`apps/web` never imports
`platform-electron`** — that's the desktop shell's job.

## Stage 0 limitations

- Stub in-memory platform services (real File System Access + IndexedDB land
  in F1.4).
- No tool palette / menus / panels (Stage 1+).
- No PWA manifest / service worker yet (F6.4).
- CSP currently includes `'unsafe-inline'` on `style-src` because Angular
  emits component styles inline by default; revisit in F6.4.
