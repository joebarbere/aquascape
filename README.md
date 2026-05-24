# Aquascape

Open-source aquascaping design tool — Angular web SPA/PWA + Electron desktop, single Nx monorepo.

**Status:** Stage 0 complete + Stage 1 complete (F1.1 – F1.6 shipped). Both apps boot end-to-end: `apps/web` (Angular 18 standalone, ESBuild `application` builder) renders the tank — sized, styled, edited live via the sidebar — and exposes a New / Open / Save / Save As / Recent toolbar with Ctrl/Cmd shortcuts and an inline crash-recovery banner from the F1.5 autosave draft; `apps/desktop` (hand-rolled Electron 33 per [ADR-0001](./docs/decisions/0001-electron-tooling.md), `electron-builder` for packaging) loads that same web bundle behind the non-negotiable security posture (context isolation, sandbox, no `nodeIntegration`, no remote module, typed preload bridge, CSP enforced via HTTP header) and now routes file IO + native dialogs + key-value storage through a validated typed IPC contract. The `.aqua` v1 format lives in `@aquascape/domain/document` (AJV validator + `Migration` chain + ZIP container via `fflate`); **v1 is locked** — every future format change requires a `Migration` entry. The web platform capability-detects File System Access (Chromium) → `<input type=file>` + download fallback (Safari/Firefox), IndexedDB → in-memory, `<dialog>` → no-op stub. Stage 1 is closed; next up is Stage 2 (substrate). The 11-stage roadmap is in [`aquascape-development-plan.md`](./aquascape-development-plan.md) §4.

## Quick start

```bash
corepack enable                              # picks up the pinned pnpm
pnpm install

pnpm exec nx serve web                       # Angular dev server on http://localhost:4200
pnpm exec nx serve desktop                   # web dev-server + Electron in parallel
pnpm exec nx build desktop                   # builds web + main + preload → dist/apps/desktop/

pnpm exec nx graph                           # browse the dependency graph
pnpm exec nx run-many -t lint                # module-boundary lint over every project
pnpm exec nx run-many -t test                # full unit-test suite
pnpm exec nx test <project> --configuration=ci   # with coverage + 90% threshold gate
```

## What's here

Implemented so far:

- `apps/web/` — Angular 18 standalone shell, `OnPush`, `ResizeObserver`-driven redraw. Runtime `selectPlatform()` binds `platform-api` tokens to `platform-electron` (with the real IPC transport) under Electron, `platform-web` (capability-detected) in the browser. Three-row layout: `aquascape-editor-shell` toolbar + (sidebar | canvas) grid. Bootstrap kicks `DocumentEffects.bootstrap()` so the recent-files menu and the F1.5 recovery banner are primed from storage on first paint. Scene reads from the NgRx store via `selectScene`; the document feature is also wired in.
- `apps/desktop/` — Electron main + sandboxed preload + shared IPC contract, three-tsconfig layout. `buildWebPreferences()` is the security-flag source of truth (unit-tested literally, field-by-field). F1.4 expands the IPC channel set to `file.open` / `file.save` / `file.saveAs` / `dialog.confirm` / `dialog.alert` / `storage.get` / `storage.set` / `storage.remove` / `export.png` + the original `ping`. Main-process backends wire native `dialog.show{Open,Save}Dialog`, `fs.promises.{read,write}File`, and a `app.getPath('userData')`-rooted JSON KV store. Every payload is validated main-process side; offending values are never echoed back through error messages.
- `libs/domain/geometry/` — Vec2/3, Transform, AABB, hit-test, golden-ratio + thirds, snap helpers.
- `libs/domain/scene-model/` — `Scene`/`Layer`/`SceneObject` types + plain discriminated-union `Command` records + bounded immutable `History`. Commands: layer CRUD/reorder, object add/remove/move/reshape, composite, `SetTankDimensions` (with object position clamping + restore-on-undo envelope), and `SetTankStyle` (whole-style replacement with hex / gradient validation).
- `libs/domain/document/` — canonical `.aqua` v1 schema (`aqua-document.ts` + `schema/aqua-document.schema.json`), `validateAquaDocument` (AJV 2020 + `ajv-formats`, compiled once at module load), `Migration` chain (`runMigrations` + empty `AQUA_MIGRATIONS` baseline), ZIP container (`packAquaDocument`/`loadAquaDocument` via `fflate` — magic-sniffs `PK\x03\x04` so bare-JSON `.aqua` files also load), and `documentToScene`/`sceneToDocument` marshaling. The envelope shape carries unknown `extensions` + `livestock`/`equipment`/`renderHistory` verbatim so load → edit → save never drops what the editor doesn't model.
- `libs/rendering/renderer-api/` + `libs/rendering/renderer-2d/` — `SceneRenderer` interface + `Canvas2DRenderer`. Draws background (color / gradient / none; image stubbed for F6.3) → grid → tank outline → water tint → frame overlay. DPR-aware, idempotent, listener-clean on dispose. `hitTest` returns `null` until F3.3.
- `libs/platform/platform-api/` — framework-free interfaces + Angular `InjectionToken` sub-entry (`FileService` / `DialogService` / `StorageService` / `RenderExportService`).
- `libs/platform/platform-web/` — capability-detected bundles: `FileSystemAccessFileService` (Chromium) → `FallbackFileService` (Safari/Firefox; `<input type=file>` + `<a download>`), `IndexedDbStorageService` → `InMemoryStorageService`, `BrowserDialogService` (`<dialog>`) → `StubDialogService`. The factory accepts `{ forceInMemory: true }` for tests.
- `libs/platform/platform-electron/` — Service classes wrap an `ElectronTransport` seam. `createIpcTransport(bridge)` forwards every method to `window.aquascape.ipc.*` (F1.4); `createInMemoryTransport()` remains for tests. The renderer composition root passes the real bridge.
- `libs/state/` — two NgRx features. **scene**: generic `dispatchCommand` → effect → `applyCommandSucceeded({ scene, history })`, `commandRejected({ reason, message })`, undo/redo, metadata-only `setTankPresetRef`, plus `setScene` (resets history; used by Open / New / Recover). **document** (F1.6): identity + dirty tracking + recent files + autosave-draft surface. Effects own all platform IO (open / save / save-as / new / mark-dirty / autosave-debounced-3s / draft-recovery / discard / recent-files persist) and dispatch `SceneActions.setScene` alongside `DocumentActions.documentOpened` to keep both stores consistent without coupling. `bootstrap()` primes from `StorageService` on app start.
- `libs/features/tank-setup/` — Angular standalone component. Preset picker (ADA Mini-S / Mini-M / 60-P / 90-P / 120-P + standard US 10/20H/40B gallons), custom W×H×D form with cm/in/mm toggle (storage is integer mm; the toggle is display-only), aspect-ratio warning outside [0.3, 4.0], plus a styling subpanel: frame picker (Rimless / Black-rimmed / Braced labels mapped to the schema enum), water tint hex + presets, background tabs (None / Solid / Gradient / Image-disabled-for-F6.3). Angle is exposed in degrees in the UI and converted to radians on dispatch.
- `libs/features/editor-shell/` (F1.4) — Top toolbar: app title + doc title with `• ` dirty marker + opening/saving status pill, File buttons (New / Open / Save / Save As), Recent dropdown, an F1.5 inline crash-recovery banner (Recover / Discard), and an error banner. Document-level keyboard shortcuts (Ctrl/Cmd + N / O / S / Shift+S). Composed into `apps/web` above the canvas.
- `libs/testing/` — fast-check arbitraries (`arbAquaDocument` produces structurally-valid documents covering every schema branch) and the `document-round-trip.spec.ts` property suite that CI gates on.

Empty placeholders (stage-gated implementation):

- `libs/domain/{catalog, growth-sim}/` — Stages 2, 4.
- `libs/rendering/renderer-3d/` — Stage 10.
- `libs/features/{substrate-tool, hardscape-tool, planting-tool, layers-panel, templates, export, livestock-equipment}/` — Stages 2–7.
- `libs/ui/` — populated as the features that need it land.
- `apps/web-e2e/`, `apps/desktop-e2e/` — Playwright + Playwright-Electron specs from Stage 2 onward.

Shared infrastructure:

- `tools/` — workspace tooling: `scaffold-libs.cjs` (lib scaffolder), `validate-example.mjs` (thin AJV CLI that points at `libs/domain/document/src/schema/aqua-document.schema.json` for one-off contributor sanity checks; the authoritative gate is `nx test testing -t document-round-trip`).
- `docs/decisions/` — four foundational ADRs (Electron tooling, pnpm, Jest coverage, Nx Cloud deferral).
- `plans/` — per-feature implementation plans (one `F<X.Y>` file per feature, grouped by stage).
- `.claude/` — nine project sub-agent definitions (`scene-model-engineer`, `renderer-engineer`, `electron-platform-engineer`, `angular-feature-engineer`, etc.) plus team playbooks.
- `.github/workflows/` — PR workflow with three jobs: nx affected lint + test + build; a coverage gate that runs `domain` + `rendering` + `platform-{web,electron}` + `state` + every implemented `features-*` lib (currently `features-tank-setup`, `features-editor-shell`) with `--configuration=ci` so the per-lib 90% thresholds fire; and a `document-round-trip` job that runs `nx test testing -t document-round-trip` (canonical example + fast-check property over `arbAquaDocument`, through both JSON serialize and ZIP container). A main workflow re-runs everything across the ubuntu/macos/windows matrix.

## Architecture

See [`aquascape-development-plan.md`](./aquascape-development-plan.md) (the spec) and [`CLAUDE.md`](./CLAUDE.md) for the load-bearing decisions and the Stage 0 deliverables reference. Highlights:

- **One scene model, two renderers.** `domain/scene-model` is framework-free. `renderer-2d` ships now; `renderer-3d` (Three.js, Stage 10) drops in over the same `SceneRenderer` interface and the *same* canonical 3D coordinates already stored in `.aqua` documents. This is the abstraction the plan's payoff is bet on.
- **Every mutation is a `Command`** with `apply` / `invert`. Undo/redo, persistence, and future collaboration all build on this single primitive — the UI never mutates the scene directly.
- **One feature codebase, two apps.** Features depend on `platform-api` (interface) — never a concrete platform. `apps/web` injects `platform-web`; `apps/desktop` injects `platform-electron`. The same Angular feature libs power both shells.
- **Layering is mechanical.** Nx tags in every `project.json` + `@nx/enforce-module-boundaries` in `eslint.config.cjs` enforce plan §2.2. A `features/*` lib that tries to import `platform-electron` fails `nx lint`.

## Document format

The `.aqua` v1 format lives in [`libs/domain/document/`](./libs/domain/document/): canonical TypeScript types in [`src/aqua-document.ts`](./libs/domain/document/src/aqua-document.ts) and the JSON Schema mirror in [`src/schema/aqua-document.schema.json`](./libs/domain/document/src/schema/aqua-document.schema.json). The worked Iwagumi example at the repo root in [`example.aqua.json`](./example.aqua.json) is the canonical fixture for round-trip tests. The on-disk container is a ZIP (`document.json` + `assets/` + optional `thumbnail.png`); asset-free documents may ship as bare JSON with the `.aqua` extension — readers sniff for ZIP magic and accept both. **v1 is locked now that F1.3 has shipped**: any future format change requires a `Migration` entry in `AQUA_MIGRATIONS` and a fast-check round-trip test in `libs/testing` that exercises the new step.

## License

MIT.
