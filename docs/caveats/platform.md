# Platform caveats

**Load this when:** touching `libs/platform/*` (interface or implementations), `apps/desktop/src/main/`, or any IPC contract / dev-server orchestration.

- `platform-api` is interface-only. Angular `InjectionToken`s live in the `platform-api/angular` sub-entry (TS path alias `@aquascape/platform/platform-api/angular`) so the framework-free interface file never imports `@angular/core`.
- `FileSystemAccessFileService` (Chromium) keeps `FileSystemFileHandle`s in an in-memory map keyed by synthetic id, so `saveDocument({ id })` silently re-writes the user-chosen path. **`FallbackFileService` (Safari / Firefox) collapses Save into Save As** — the legacy `<input type=file>` + `<a download>` flow has no stable file handle. UIs detect via `selectHasFile` staying false.
- `IpcBridge` interface declared **locally** in `platform-electron/src/transport.ts`, not imported from `apps/desktop`, to avoid coupling the lib to the app's contract module.
- Main-process IPC validators **NEVER echo offending payload values back through error messages** (security rule).
- `apps/desktop` storage backend is a JSON-file KV at `app.getPath('userData')/aquascape-storage.json` (whole-file read on every `get`, all-or-nothing write — crash-safe at autosave scale). `dialog.show{Open,Save}Dialog` anchored via a `getWindow()` indirection so backends survive window create/close/reopen cycles.
- **Desktop serve has a race:** `nx serve desktop` spawns Electron and `nx serve web` in parallel without a readiness wait, so first launch shows `ERR_CONNECTION_REFUSED`. Either kill + relaunch via `nx run desktop:serve-electron` after the web server is up, or fix by sequencing in `apps/desktop/project.json`.
