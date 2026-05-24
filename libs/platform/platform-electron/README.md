# `@aquascape/platform/platform-electron`

Electron-process implementation of `@aquascape/platform/platform-api`. **Stage 0 ships in-memory stubs** that run entirely in the renderer process. F0.6 scaffolds the typed preload bridge; F1.4 wires real IPC channels per feature; this lib's public surface does not change between those steps.

- **Tags:** `scope:platform-electron`.
- **Boundary rule:** may depend only on `scope:domain`, `scope:platform-api`, and itself. Features cannot import this lib; only `apps/*` may.

## Surface

`createElectronPlatform(transport?): Platform` is the entry point app
composition roots call at boot. The optional `transport` argument is the seam
F1.4 will use to swap the in-memory bodies for IPC calls into the main
process — the wrapper service classes (`ElectronFileService`,
`ElectronDialogService`, `ElectronStorageService`,
`ElectronRenderExportService`) stay unchanged.

## Why the transport seam

The plan's Stage 0 says "stubs are structured to be replaced by IPC calls in
F1.4". Concretely, `ElectronTransport` is the only thing that talks to "the
backend". In Stage 0 the default `createInMemoryTransport()` services every
method in-process; in F1.4 we'll ship an `createIpcTransport()` whose methods
forward to `window.aquascape.ipc.*` channels exposed by the typed preload
bridge. The services on top never learn about IPC.

## Stub behaviour

- Mirrors `platform-web` so feature code that targets the abstraction behaves
  identically across both platforms in dev.
- **DialogService.confirm** returns `true` by default — same caveat as
  `platform-web`.
- **StorageService** deep-clones via `structuredClone` to mirror what an
  IPC-serialized store would do.
- Each `createElectronPlatform()` call produces an isolated transport so test
  state does not leak across cases.

## Security posture

This lib runs in the renderer. It never imports Electron, Node, or anything
that would compromise the renderer sandbox (`contextIsolation: true`,
`sandbox: true`, `nodeIntegration: false`). When F1.4 replaces the in-memory
transport with `window.aquascape.ipc.*`, the renderer's only path to native
capability remains the typed preload bridge.
