# `apps/desktop`

Electron desktop shell for Aquascape. Loads the `apps/web` Angular bundle in a sandboxed renderer with a hardened security posture (plan §3). **Tags:** `scope:app`, `type:app`, `platform:electron`.

## Layout

```
apps/desktop/
├── project.json
├── tsconfig.json            # solution-style; references main/preload/spec
├── tsconfig.main.json       # node target, types: ['node']
├── tsconfig.preload.json    # node + DOM lib
├── tsconfig.spec.json       # jest
└── src/
    ├── main/                # Electron main process (Node)
    │   ├── main.ts          # entry — creates BrowserWindow, installs CSP, registers IPC
    │   ├── web-preferences.ts  # pure builder for the secure webPreferences
    │   ├── csp.ts           # pinned Content-Security-Policy string
    │   ├── paths.ts         # resolveIndexPath / resolvePreloadPath
    │   └── ipc-handlers.ts  # validators + registrar for ipcMain.handle
    ├── preload/             # sandboxed preload context
    │   ├── preload.ts       # contextBridge.exposeInMainWorld('aquascape', { ipc })
    │   ├── build-bridge.ts  # pure factory, wraps ipcRenderer.invoke per channel
    │   └── global.d.ts      # ambient typing for window.aquascape
    └── shared/              # cross-process types
        └── ipc-contract.ts  # typed IPC channel registry (single source of truth)
```

Three TypeScript projects with different `lib`/`types`:

- `tsconfig.main.json` — `lib: ['ES2022']`, `types: ['node']` (Node runtime, no DOM).
- `tsconfig.preload.json` — `lib: ['ES2022', 'DOM']`, `types: []` (sandboxed renderer context).
- `tsconfig.spec.json` — `lib: ['ES2022', 'DOM']`, `types: ['jest', 'node']` (jsdom-free, just node + jest).

## Security posture (non-negotiable — plan §3)

`buildWebPreferences()` (in `src/main/web-preferences.ts`) is the pure source of truth. The companion test `web-preferences.spec.ts` pins every flag literally — any drift fails CI.

| Flag                         | Value   | Why                                                  |
| ---------------------------- | ------- | ---------------------------------------------------- |
| `contextIsolation`           | `true`  | Renderer cannot reach into the preload's scope.      |
| `sandbox`                    | `true`  | Renderer runs in an OS sandbox.                      |
| `nodeIntegration`            | `false` | No Node.js in the renderer.                          |
| `nodeIntegrationInWorker`    | `false` | Same for Web Workers.                                |
| `nodeIntegrationInSubFrames` | `false` | Same for child frames.                               |
| `webSecurity`                | `true`  | Same-origin policy + mixed-content protections.      |
| (no `enableRemoteModule`)    | —       | The `remote` module is deprecated/unsafe — never on. |

CSP is enforced **both** via the meta tag in `apps/web/src/index.html` (the baseline) and via a `Content-Security-Policy` HTTP header installed by the main process (`src/main/csp.ts`). The header composes additional `file:` allowances on top of the baseline; together they forbid `unsafe-eval` everywhere and forbid `unsafe-inline` in `script-src`.

Navigation is locked down: `will-navigate` blocks any non-`file:` and non-dev-server URL, and `setWindowOpenHandler` returns `{ action: 'deny' }` (external http(s) URLs are routed to `shell.openExternal` instead).

## Typed IPC bridge

The renderer's only path to native APIs is `window.aquascape.ipc`, exposed by the preload via `contextBridge.exposeInMainWorld`. The full channel registry lives in `src/shared/ipc-contract.ts`:

```ts
export interface IpcContract {
  ping(payload: { ts: number }): Promise<{ pong: true; receivedAt: number }>;
}
```

Stage 0 ships exactly one channel — `ping` — to prove the bridge works end-to-end. Every handler in `src/main/ipc-handlers.ts` validates its input (the renderer is untrusted code per plan §3). F1.4+ adds real file-IO / dialog / storage / export channels against the same registry.

To add a channel:

1. Extend `IpcContract` in `src/shared/ipc-contract.ts` and append the channel name to `IPC_CHANNELS`.
2. Add a validator + handler body in `src/main/ipc-handlers.ts`, and register it in `registerIpcHandlers`.
3. Add the wrapper to `buildBridge` in `src/preload/build-bridge.ts`.
4. Drive the round-trip from a unit test (no need to spawn Electron — the existing FakeIpcMain pattern in `build-bridge.spec.ts` is the template).

## Commands

```bash
# Run everything CI runs:
pnpm exec nx lint desktop
pnpm exec nx test desktop --configuration=ci
pnpm exec nx build desktop                    # builds web bundle + main + preload

# Dev:
pnpm exec nx serve desktop                    # starts nx serve web AND electron, in parallel
# or, if you prefer to control them independently:
pnpm exec nx serve web                        # in one shell
pnpm exec nx run desktop:serve-electron       # in another shell

# After a build, you can also launch Electron directly:
./node_modules/.bin/electron dist/apps/desktop/main/src/main/main.js
```

The `serve` target launches `nx serve web` and Electron in parallel via `nx:run-commands`. If Electron starts before the dev server is up it will fail to load and you can press Ctrl+R to reload, or use the `serve-electron` flow which waits for you to start the web server first.

`DEV_SERVER_URL` controls which URL Electron loads in development. When `app.isPackaged` is `false` and `DEV_SERVER_URL` is unset, Electron falls back to the built `dist/apps/web/browser/index.html`.

## Build output layout

```
dist/apps/desktop/
├── main/
│   └── src/
│       ├── main/main.js              ← Electron entry
│       └── shared/ipc-contract.js
└── preload/
    └── src/
        ├── preload/preload.js
        └── shared/ipc-contract.js
```

The `src/` nesting under each output is an `@nx/js:tsc` artefact (the executor computes a `rootDir` of `src/` because the TS project spans multiple sub-trees). The runtime path math in `src/main/paths.ts` accounts for this — its companion test pins the exact relative climbs.

## Composition root

The Electron shell does NOT have its own Angular renderer entry. It loads the `apps/web` bundle, which detects Electron at runtime via `typeof window.aquascape !== 'undefined'` and binds `platform-api` tokens to `platform-electron` instead of `platform-web`. See `apps/web/src/select-platform.ts`.

This means the `scope:app` for `apps/web` legitimately depends on both `scope:platform-web` and `scope:platform-electron` — allowed by the module-boundary rules in `eslint.config.cjs`.

## Out of scope (this stage)

- Real IPC channels for file IO — F1.4.
- Native menus, accelerators — incremental.
- Code signing, installer packaging — F6.4 (`electron-builder` is already in devDependencies).
- Auto-updater — post-v1.
- Playwright-Electron e2e harness — Stage 1 follow-up; the existing `apps/desktop-e2e/` scaffold is intentionally left empty for now.
