# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**Stage 0 is complete + Stage 1 is complete (F1.1 – F1.6 shipped).** Both apps boot and round-trip a document end-to-end. `apps/web` (Angular 18 standalone, ESBuild `application` builder) renders the tank — sized, styled (frame / water tint / background incl. gradients), re-rendered live as the user drives the sidebar — via `renderer-2d`, with a top toolbar (`features/editor-shell`) exposing New / Open / Save / Save As / Recent + Ctrl/Cmd shortcuts and an inline crash-recovery banner from the F1.5 autosave. `apps/desktop` (hand-rolled Electron 33 with `electron-builder` for packaging, per ADR-0001) loads the same web bundle behind the non-negotiable security posture (contextIsolation, sandbox, no nodeIntegration, no remote, typed preload bridge, CSP) and routes the renderer's `platform-api` calls through a validated IPC contract (`file.open` / `file.save` / `file.saveAs` / `dialog.confirm` / `dialog.alert` / `storage.{get,set,remove}` / `export.png`). The `.aqua` v1 format is a real library — `@aquascape/domain/document` — with AJV validator, `Migration` chain scaffold, and ZIP container via `fflate`; **v1 is locked**, so every future format change requires a `Migration` entry. Two NgRx feature stores (`scene` + `document`) and capability-detected web + IPC-backed Electron platform implementations complete the Stage 1 deliverables (see "Stage 0 + Stage 1 deliverables" below). Stage 2 (substrate) is next.

Planning artifacts:

- `aquascape-development-plan.md` (repo root) — master plan: vision, architecture, 11-stage roadmap, quality gates, traceability matrix. This is the spec.
- `libs/domain/document/src/aqua-document.ts` — canonical TypeScript definition of the `.aqua` v1 document format. Framework-free.
- `libs/domain/document/src/schema/aqua-document.schema.json` — JSON Schema (Draft 2020-12) mirror of `aqua-document.ts`, used by `validateAquaDocument` at runtime.
- `example.aqua.json` (repo root) — worked Iwagumi document, kept at root for discoverability; the canonical fixture used by `document-round-trip.spec.ts`.

Architecture decisions made during F0.1 / F0.7 are recorded under `docs/decisions/` (ADRs 0001 – 0004): Electron tooling, pnpm, Jest coverage, Nx Cloud deferral.

## What this project is

Aquascape is an open-source aquascaping design tool — hobbyists pick a tank, sculpt substrate, place hardscape (rocks/driftwood), plant flora in layers, and preview the result. It ships as **both** an Angular web SPA/PWA and an Electron desktop app from a single Nx monorepo, with the desktop build being fully offline-capable.

The differentiated capabilities (vs. the tools it consolidates: Scape It, MyAquariumBuilder, Aquasketcher) are:

- Deterministic plant **growth simulation** over time (Stage 4).
- Composite layouts onto real tank photos (Stage 6).
- Dual **local + hosted** AI render providers behind one interface (Stage 9).
- **Three.js 3D renderer** consuming the same document as the 2D renderer (Stage 10).

## Architecture — the load-bearing decisions

These are non-negotiable without re-opening the plan. They drive every other choice.

### Layer boundaries (enforced via Nx `@nx/enforce-module-boundaries`)

- `domain/*` libs are **framework-free**: no Angular, no DOM, no Electron, no NgRx. Pure TypeScript only. This is what makes the 3D renderer and headless tooling drop in later.
- `domain/*` depends only on other `domain/*`.
- `rendering/*` depends only on `domain/scene-model` + `domain/geometry`.
- `features/*` may depend on `domain/*`, `rendering/*`, `ui`, `state`, `platform-api` (the interface, never a concrete platform).
- `apps/*` compose `features/*`, `ui`, `state`, and inject a concrete `platform-web` or `platform-electron`.

### The scene model is the heart of the app

Live in `domain/scene-model`. `Scene` → ordered `Layer`s → `SceneObject`s (hardscape / plant / substrate). **Every mutation is a `Command`** with `apply` / `invert`. Undo/redo, persistence, and future collaboration all build on this single primitive. UI events become NgRx actions which produce Commands which apply to the Scene — the UI never mutates the scene directly.

### One scene model, two renderers

```ts
interface SceneRenderer {
  attach(surface: RenderSurface): void;
  render(scene: Scene, viewport: Viewport): void;
  hitTest(point: Vec2, scene: Scene): HitResult | null;
  dispose(): void;
}
```

`renderer-2d` (canvas) ships first. `renderer-3d` (Three.js / WebGL) ships at Stage 10 over the **same** interface and the **same** canonical 3D coordinates already stored in `.aqua` documents. Features depend on `renderer-api`, never a concrete renderer.

### Platform abstraction

`platform-api` defines `FileService`, `DialogService`, `StorageService`, `RenderExportService`. `platform-web` binds to File System Access API + IndexedDB. `platform-electron` binds to IPC into the main process. Features only ever see the interface, which is why one set of feature libs powers both apps.

### The `.aqua` document format

`aqua-document.ts` is the **single source of truth**; `aqua-document.schema.json` mirrors it for runtime validation. Both must be updated together. Rules baked into the format:

- **Canonical units = millimetres** (integers preferred). cm/in are display-only, so round-trips are exact.
- **Canonical coordinates** = a single right-handed 3D space with origin at the tank's front-bottom-left interior corner (+x right, +y up, +z back). The 2D renderer projects along −z. **3D consumes identical coordinates** — this is the concrete mechanism that lets Stage 10 add 3D without changing the document.
- **Catalog by reference**: objects carry `CatalogRef` (`catalog` + `id` + `version`), never inlined catalog data.
- **Plain serializable data only**: no class instances, no functions. `JSON.parse(JSON.stringify(doc))` must be lossless.
- **Versioned + migratable**: `schemaVersion` drives a pure, total `Migration` chain. Readers run migrations up to their supported version before use.
- **Forward-compatible**: an `extensions` bag + optional per-object fields mean older readers preserve unknown data rather than dropping it.
- **Container**: the on-disk `.aqua` file is a ZIP containing `document.json`, `assets/`, and optional `thumbnail.png`. Asset-free documents may be bare JSON with the `.aqua` extension; readers sniff for ZIP magic and accept both.
- **Reproducibility**: a document-level `seed` makes scatter planting, growth jitter, and AI renders deterministic.

### Electron security posture

Context isolation **on**, sandbox **on**, no `nodeIntegration` in renderer, all native access through a typed preload bridge, validated IPC, CSP enforced. Hosted AI provider keys live in OS secure storage / Electron main only — they must never reach the renderer process or get serialized into a document.

## Definition of Done (every feature, per the plan)

Typed public API · unit tests · at least one component or e2e test through the UI · docs entry · accessible (keyboard + ARIA) interaction · **`README.md` + `CLAUDE.md` updated** (see "Keep documentation in sync with the code" below). Domain libs target ≥90% coverage; pure logic (geometry, growth-sim, commands, document migrations) is exhaustively tested.

## Keep documentation in sync with the code

`README.md` (the front door for drive-by readers) and `CLAUDE.md` (load-bearing context for Claude / future contributors) **must stay current as features land**. After a feature is built and committed, update both files in the same PR — either bundled into the feature's last commit, or as a trailing `docs:` commit (`docs: refresh README + CLAUDE.md for F<X.Y>`) when the feature work was split across multiple commits. Treat documentation drift like a failing test: a feature isn't done until the docs match the code.

What to refresh where:

**`README.md` (visible to anyone browsing the repo):**

- The **Status** line at the top — reflect what's shipped vs. in flight (e.g. "Stage 0 complete + Stage 1 in progress (F1.1 + F1.2 shipped)") and what comes next.
- **What's here** — move libs/apps from "Empty placeholders" to "Implemented so far" when they get bodies. Expand each implemented bullet with the actual capabilities (commands shipped, components rendered, services bound).
- **Document format** — note schema additions, when v1 locks (F1.3), whether the example was updated.
- **Shared infrastructure** bullets — new `tools/` entries, new ADRs, new CI selectors.

**`CLAUDE.md` (load-bearing context Claude reads on every session):**

- The **Repository state** opener — one-sentence update mirroring the README's status line, plus the specific next thing in the roadmap.
- **Stage deliverables** — add a new `### Stage N so far` subsection when starting a new stage; extend it as each feature lands. Document the **load-bearing decisions**, not what the code does: invert envelope shapes, lock-guard policies, command-shape choices, schema-vs-UI conventions (e.g. radians-in-document vs degrees-in-UI), default constants and their reasoning.
- **Development commands** — any new `nx serve <app>` / `nx build <app>` / per-target invocations.
- **Working with the planning artifacts** — update the rules when the document format's lifecycle shifts (e.g. when F1.3 locks v1, change "additive changes are cheap" to "every change requires a Migration entry").
- **CI coverage gate paragraph** — update the selectors when a new lib gets a 90% threshold or a new feature lib enters the gate.

**Belongs in `CLAUDE.md` but NOT `README.md`:** caveats and gotchas (TRS round-trip is only exact for uniform scale; `restoredPositions` short-circuits the clamp on undo; CSP currently allows `'unsafe-inline'` styles); cross-cutting build prerequisites that bite when adding new libs (the `@aquascape/...` `package.json` name requirement); Stage-N-stub flags (which behaviour is a stand-in vs. final).

**Belongs in `README.md` but NOT `CLAUDE.md`:** quick-start commands a new contributor types in their first minute; license + project pitch; empty-placeholder roster (CLAUDE.md doesn't need to enumerate stubs).

## Stage 0 + Stage 1 deliverables (what's actually in each lib)

### Stage 0 (foundation)

- `libs/domain/geometry/` — Vec2/Vec3/Transform pure ops, AABB + hit-test primitives, golden-ratio + thirds helpers, snap helpers, `project2D`. **Caveat:** `composeTransform`/`invertTransform` go through a TRS↔matrix round-trip; they are exact for uniform scale only — non-uniform scale combined with rotation will lose information (`flipX`/`flipY` are also absorbed into negative scale during composition). Documented in the lib's README and pinned by property tests.
- `libs/domain/scene-model/` — `Scene`/`Layer`/`SceneObject` types aligned to `aqua-document.ts`. **Commands are plain discriminated-union records** (not classes), with free `applyCommand`/`invertCommand` dispatch — chosen for trivial JSON round-trips and inspectability. Locked layers reject *object-level* commands via a typed `CommandResult` (`{ ok: false, reason: 'locked' | 'not-found' | 'invalid', message }`); layer-metadata commands (rename/opacity/visibility/locked) are NOT blocked by the lock. `MoveObject` carries absolute world position; `ReorderLayers` takes a full id-permutation. Bounded immutable `History` (default 200). Stage 1 added `SetTankDimensions` and `SetTankStyle` — see below.
- `libs/rendering/renderer-api/` — types only: `SceneRenderer`, `RenderSurface`, `Viewport`, `HitResult`. DOM-typed `canvas: HTMLCanvasElement` is OK here; the `framework:none` tag forbids Angular/Electron/NgRx, not lib.dom.
- `libs/rendering/renderer-2d/` — `Canvas2DRenderer`. Stage 0 ships the tank rect + 10 mm/50 mm grid; Stage 1 added background / water tint / frame styling — see below. DPR-aware, idempotent, listener-clean on dispose. Tests use a hand-rolled op-recording canvas (not jsdom canvas); a real-pixel snapshot is deliberately deferred to F6.1 where pixel correctness is the deliverable. `hitTest` returns `null` until F3.3.
- `libs/platform/platform-api/` — interface-only library. Angular `InjectionToken`s live in the `platform-api/angular` sub-entry (TS path alias `@aquascape/platform/platform-api/angular` → `libs/platform/platform-api/src/angular/index.ts`) so the framework-free interface file never imports `@angular/core`.
- `libs/platform/platform-web/` — in-memory stubs of all four services. `openDocument` returns the most-recently-saved doc (deviation from spec, refined to enable dev round-trips); `dialog.confirm` returns `true` by default. F1.4 replaces with File System Access + IndexedDB.
- `libs/platform/platform-electron/` — same stubs, but factored through an `ElectronTransport` seam so F1.4 can replace `createInMemoryTransport()` with `createIpcTransport(window.aquascape.ipc)` without touching the service classes.
- `apps/web/` — Angular 18 standalone bootstrap, `OnPush` everywhere, `ResizeObserver` driving redraw. Composition root in `src/main.ts` calls `selectPlatform()` (runtime-detects Electron via `window.aquascape.ipc`), provides the four `platform-api` tokens, and (Stage 1) wires `provideStore`/`provideEffects`/`provideSceneStore`/`provideStoreDevtools`. `AppComponent` reads `selectScene` from the store and re-renders on every change.
- `apps/desktop/` — three-tsconfig layout (`tsconfig.main.json` / `tsconfig.preload.json` / `tsconfig.spec.json`). `src/main/main.ts` boots Electron with `buildWebPreferences()` (the security-flag source of truth, unit-tested), installs CSP via `session.defaultSession.webRequest.onHeadersReceived`, and registers IPC handlers via `registerIpcHandlers`. `src/preload/preload.ts` exposes a typed `IpcContract` via `contextBridge.exposeInMainWorld('aquascape', { ipc })`. The `ping` channel is the Stage 0 handshake; F1.4 adds real file/dialog/storage channels. Path layout under `dist/` is encoded in `src/main/paths.ts` with companion tests.

### Stage 1 so far

- `libs/domain/document/` (F1.3) is now real:
  - **Single source of truth.** `aqua-document.ts` + `schema/aqua-document.schema.json` moved out of the repo root into this lib. The validator imports the JSON via `resolveJsonModule` so the compiled output is self-contained (no fs reads in renderer / browser). The schema is also copied as an `assets` entry in `project.json` so `dist/` has it both at `src/schema/` and at the dist root — redundant but harmless.
  - **`validateAquaDocument(input: unknown): ValidationResult`** — AJV 2020 + `ajv-formats`, compiled once at module load, returns `{ ok: true } | { ok: false, errors: ValidationError[] }` with structured JSON-pointer paths.
  - **`Migration` chain.** `runMigrations(doc, migrations, targetVersion)` walks `from`→`from+1` steps in order. Rejects downgrades (`unsupported-future-version`), gaps (`missing-migration`), and migrations whose `to` isn't `from + 1` or whose output's `schemaVersion` doesn't equal `to` (`invalid-step`). `AQUA_MIGRATIONS` is `Object.freeze([])` (v1 baseline). When v2 ships, **prepend** a `{ from: 1, to: 2, migrate }` entry.
  - **Container.** `packAquaContainer(json, { assets?, thumbnail? })` and `readAquaContainer(bytes)` via `fflate` (zero-dep, pure-JS, sync, runs in node + browser + Electron renderer). `isZipContainer(bytes)` sniffs `PK\x03\x04`; bare-JSON `.aqua` files are accepted on read. Asset paths must start with `assets/` — enforced at pack time (authoring bugs fail loud).
  - **Loader.** `loadAquaDocument(input: Uint8Array | string)` returns a discriminated `LoadResult` (never throws). Order: container unwrap → JSON.parse → preflight (if `schemaVersion` is missing/non-number, run validator first to surface clean `schema-invalid` errors instead of a confusing `missing-migration` 0 → 1) → `runMigrations` → `validateAquaDocument`.
  - **Marshaling.** `documentToScene(doc) → { scene, envelope }` and `sceneToDocument(scene, envelope) → AquaDocument`. The envelope carries `meta` + optional `livestock` / `equipment` / `renderHistory` / `extensions` verbatim so load → edit → save preserves unknown extensions ("don't drop what you don't understand"). `meta.seed` is overwritten from `scene.seed` on save; `schemaVersion` is bumped to `CURRENT_SCHEMA_VERSION`.
  - **Round-trip gate.** `libs/testing/src/document-round-trip.spec.ts` is the CI contract test (`pnpm exec nx test testing -t document-round-trip`). Three layered properties: canonical fixture round-trips through serialize → load and through ZIP pack → load; fast-check `arbAquaDocument` round-trips through both forms; `JSON.parse(JSON.stringify(doc))` is lossless (the format invariant). The arbitrary covers every background `kind`, every scene-object `kind`, optionals on/off, multi-region substrate, livestock + equipment + render history + extensions.
  - **Caveat (load-bearing).** `arbFiniteNumber` folds `-0` → `0` because `JSON.stringify(-0) === "0"` but `Object.is(-0, 0) === false` and Jest's `toEqual` distinguishes them — a raw `fc.double` producing `-0` would break the format invariant. The fast-check property test caught this; no real document writes `-0`.
- `libs/domain/scene-model/` adds two structural commands (lock guard bypassed — these are global ops, not object-level):
  - `SetTankDimensions({ width, height, depth })` validates against the domain floor (100–10 000 mm), updates the tank, and clamps every object's `transform.position` inside the new interior AABB. **Nothing is deleted** — an object whose centre lands on a face stays in the scene. Invert carries an `inverse: { previousDimensions, restoredPositions }` envelope so shrink-and-undo restores objects to their original positions; apply short-circuits the clamp when `restoredPositions` is present.
  - `SetTankStyle({ style })` is whole-style replacement (not patches), `structuredClone`-cloned on store, with always-on validation (hex regex + sorted-stops + finite angle + image `AssetRef` shape). Invert carries `inverse: { previousStyle }`. F1.2 also added the **`gradient` background variant** to the document — `{ kind: 'gradient'; angle: number (radians); stops: Array<{ at: number; color: HexColor }> }`, schema-guaranteed `length >= 2` and sorted — in lockstep across `aqua-document.ts`, `aqua-document.schema.json`, `example.aqua.json`, and the in-memory mirror. No `Migration` was added because F1.3 has not shipped yet; once F1.3 locks v1, any further changes need a Migration entry.
- `libs/rendering/renderer-2d/` now paints the full style: background (color / gradient / `'none'` defaults to `#fafafa` / image stubbed for F6.3) over the canvas → grid → tank outline → water tint (inside the tank, wrapped in `globalAlpha = 0.25`) → frame overlay (8 mm rim bands for `'framed'`, plus a 10 mm centre brace for `'braced'`; default frame color `#222`). Gradient endpoints project onto the canvas bounding box so end stops reach the visible edges at any angle.
- `libs/state/scene/` — generic `dispatchCommand({ command })` flows every editor mutation through the effect → `applyCommand` → either `applyCommandSucceeded({ scene, history })` (reducer commits the pair) or `commandRejected({ reason, message })`. `setTankPresetRef({ presetRef })` is a **metadata-only side-edit** that bypasses the Command pipeline. F1.6 added `setScene({ scene })` which **replaces the scene wholesale and resets history** — used by Open / New / Recover; deliberately not a Command (you don't "undo opening a file"). `provideSceneStore()` composes the feature.
- `libs/state/document/` (F1.6) — second NgRx feature. State: `{ fileId, name, isDirty, envelope, recentFiles, status, lastError, pendingDraft, lastAutosavedAt, lastSavedAt }`. Effects own ALL platform IO so the reducer stays data-in/data-out. Cross-store dispatch: when opening or recovering a file the effect emits BOTH `SceneActions.setScene({ scene })` AND `DocumentActions.documentOpened({ fileId, name, envelope })` — the two reducers stay decoupled but land consistently. **Autosave** (F1.5) is triggered by `markDirty`, debounced via the `AUTOSAVE_DEBOUNCE_MS` injection token (3000 ms in prod, 0 in tests) so the timer resets on the user's latest edit and never fires when nothing changed; persisted as a versioned `{ version: 1, document, fileId, name, savedAt }` payload at `aquascape.autosaveDraft`. **Crash recovery** (F1.5) lives in `DocumentEffects.bootstrap()`, called once from the composition root after `bootstrapApplication`; it reads recent files + any draft from storage and dispatches `recentFilesLoaded` / `draftDiscovered`. Recover dispatches `setScene` + `documentOpened` + `markDirty` (recovered docs are presumed unsaved). On any successful save, the draft slot is cleared. UUID fallback: `crypto.randomUUID()` with a `Math.random` fallback for jsdom test envs that lack it (`mintFreshEnvelope` → `newUuid`).
- `libs/platform/platform-web/` — capability-detected at `createWebPlatform()` time. `FileSystemAccessFileService` (Chromium) keeps `FileSystemFileHandle`s in an in-memory map keyed by synthetic id so `saveDocument({ id })` can silently re-write the user-chosen path (the killer feature over `<input type=file>`). `FallbackFileService` (Safari/Firefox) **collapses Save into Save As** because the legacy `<input type=file>` + `<a download>` flow has no concept of a stable file handle — UIs should detect this via `selectHasFile` staying false after a fallback save. `IndexedDbStorageService` is a thin wrapper over IDB (single `aquascape` db, single `kv` store, version 1). `BrowserDialogService` uses a real `<dialog>` element. Tests pass `{ forceInMemory: true }` to short-circuit detection.
- `libs/platform/platform-electron/` — Service classes wrap an `ElectronTransport`. `createIpcTransport(bridge)` forwards every method to `window.aquascape.ipc.*` (F1.4). The `IpcBridge` interface is declared **locally in `transport.ts`** (not imported from `apps/desktop`) to avoid coupling the lib to the app's contract module. `apps/web` composition root sniffs `window.aquascape.ipc`, builds the IPC transport, and feeds it to `createElectronPlatform()`.
- `apps/desktop` (F1.4) — IPC channel set expanded from the F0.6 `ping`-only baseline to: `file.open` / `file.save` / `file.saveAs` / `dialog.confirm` / `dialog.alert` / `storage.{get,set,remove}` / `export.png`. Main-process handlers split deps along feature lines (`file` / `dialog` / `storage` / `export` `Backend` interfaces) so tests drive every branch without `electron`/`fs`. **Backends** (`backends.ts`): `dialog.show{Open,Save}Dialog` anchored to the active `BrowserWindow` (via a `getWindow()` indirection so backends survive window create/close/reopen cycles), `fs.promises.{read,write}File` (read slices into a fresh `Uint8Array` so `Buffer` doesn't leak to renderer), and a JSON-file KV store at `app.getPath('userData')/aquascape-storage.json` (whole-file read on every `get`, all-or-nothing write — crash-safe at autosave scale). Validators NEVER echo offending payload values back through error messages (security rule).
- `libs/features/tank-setup/` — Angular standalone component, `OnPush`, ReactiveForms. Preset picker (ADA Mini-S / Mini-M / 60-P / 90-P / 120-P + standard US 10/20H/40B gallons from `tank-presets.ts`; TODO references F2.4 catalog migration), custom W×H×D form with cm/in/mm toggle (storage is always integer mm; the toggle is display-only and persisted via `StorageService`), aspect-ratio warning outside [0.3, 4.0]. Styling subpanel: frame radiogroup with friendlier UI labels (Rimless / Black-rimmed / Braced) mapped to the schema enum, water tint hex + presets, background tabs (None / Solid / Gradient / Image-disabled-pending-F6.3). Gradient angle is exposed in **degrees** in the UI and converted to **radians** on dispatch (radians is the document convention, matching `Transform.rotation`). Color input uses native `<input type="color">` + a free-text hex field that accepts `#RGB` / `#RRGGBB` / `#RRGGBBAA` (the alpha form is the only path for tints) — no color-picker library.
- `libs/features/editor-shell/` (F1.4) — Top toolbar above the canvas, `OnPush`. Renders the app/doc title (`• ` prefix when dirty) + opening/saving status pill, File buttons (New / Open / Save / Save As), a Recent dropdown driven by `selectRecentFiles`, the F1.5 inline recovery banner (Recover / Discard, fired from `selectPendingDraft`), and an error banner from `selectLastError`. Keyboard shortcuts bound at the document level via `@HostListener` (Ctrl/Cmd + N / O / S / Shift+S). All actions are dispatched into the document store — the component never touches platform services directly.

### Lib build prerequisite (load-bearing)

Every buildable lib needs a `package.json` with `"name": "@aquascape/..."` matching its tsconfig path alias, or `@nx/js:tsc` cross-lib builds break with `TS6059: not under 'rootDir'` for transitive consumers. This is now in place for every implemented lib; remember it when scaffolding new ones in later stages.

## Development commands

Package manager: **pnpm**, pinned via `package.json#packageManager` (`corepack enable` will pick it up). Node version pinned via `.nvmrc`.

Bootstrap:

```bash
corepack enable                  # one-time, picks up the pinned pnpm version
pnpm install                     # install workspace dependencies
```

Daily loop:

```bash
pnpm exec nx graph               # browse the project graph (verifies layout from §2.1)
pnpm exec nx show projects       # list every project Nx knows about
pnpm exec nx affected -t lint test build  # what CI runs on every PR
pnpm exec nx run-many -t lint    # lint everything (includes module-boundary check)
pnpm exec nx test <project>      # run one project's tests
pnpm exec nx test <project> --configuration=ci  # with coverage + threshold
pnpm exec nx build <project>     # build one project
pnpm format                      # nx format:write
pnpm format:check                # nx format:check
```

App shells (F0.6):

```bash
pnpm exec nx serve web                       # Angular dev server on http://localhost:4200
pnpm exec nx build web                       # production build → dist/apps/web/browser/index.html
pnpm exec nx serve desktop                   # web dev-server + Electron in parallel
pnpm exec nx run desktop:serve-electron      # Electron only (assumes nx serve web is already up)
pnpm exec nx build desktop                   # builds web + main + preload → dist/apps/desktop/{main,preload}/
```

The web shell renders the tank + grid via `@aquascape/rendering/renderer-2d`, reads `selectScene` from the NgRx store, and hosts the `<aquascape-tank-setup>` sidebar. `apps/web/src/select-platform.ts` runtime-detects the Electron preload bridge (`window.aquascape.ipc`) and binds the `platform-api` tokens to `platform-electron` under Electron, `platform-web` in the browser. Feature libs in `libs/features/*` are composed into the shell, not coded inline.

The `lint` target enforces the `@nx/enforce-module-boundaries` rule defined in `eslint.config.cjs` — every layering violation from plan §2.2 fails CI at the `lint` step. Per-lib `coverageThreshold: 90%` is set in `libs/domain/*`, `libs/rendering/renderer-2d`, `libs/platform/platform-{web,electron}`, `libs/state`, and every implemented `libs/features/*` lib's `jest.config.ts`. `nx.json` `targetDefaults.test.configurations.ci` adds `--coverage --ci` to the inferred jest target so `pnpm exec nx test <lib> --configuration=ci` actually collects coverage and the per-lib threshold fires. The `.github/workflows/pr.yml` `coverage` job runs the gate explicitly across `tag:scope:domain,scope:rendering,scope:platform-web,scope:platform-electron,scope:state` + each implemented feature lib by name (currently `features-tank-setup`, `features-editor-shell` — add new feature libs to the workflow selector as their bodies land), so threshold regressions on unaffected libs still fail the PR.

CI workflows in `.github/workflows/` mirror this exactly:

- `pr.yml` — PR workflow: `nx affected -t lint test build` + coverage gate + `document-round-trip` (real, `nx test testing -t document-round-trip`). Linux only.
- `main.yml` — push to main: full `nx run-many` across the `ubuntu-latest` / `macos-latest` / `windows-latest` matrix.

The **`document-round-trip` job** runs `pnpm exec nx test testing -t document-round-trip` — the F1.3 fast-check property suite in `libs/testing/src/document-round-trip.spec.ts`. Three layered properties: canonical fixture round-trips through serialize → load and ZIP pack → load; `arbAquaDocument` round-trips through both forms; `JSON.parse(JSON.stringify(doc))` is lossless. The job is REQUIRED on main; a format/loader regression fails the PR.

## Working with the planning artifacts

- Treat `aquascape-development-plan.md` as the spec. If a request conflicts with it, surface the conflict instead of silently deviating.
- When changing the document format, change `libs/domain/document/src/aqua-document.ts` and `libs/domain/document/src/schema/aqua-document.schema.json` **together**, re-validate `example.aqua.json` against the schema (`node tools/validate-example.mjs`), and update the in-memory mirror in `libs/domain/scene-model/src/types.ts`. **v1 is locked** (F1.3 shipped). Every change requires (a) a new `{ from: N, to: N+1, migrate }` entry prepended to `AQUA_MIGRATIONS` in `libs/domain/document/src/migrations.ts`, (b) `CURRENT_SCHEMA_VERSION` bumped, (c) the previous version's example preserved as a round-trip fixture, and (d) a fast-check property test in `libs/testing` covering the new migration step. The `nx test testing -t document-round-trip` job is REQUIRED on main.
- The stage roadmap is sequenced deliberately: Stages 0–4 are the critical path to a useful v1.0. Stages 5–6 round out v1.x. Stages 7–10 are parallelizable value-adds once the scene model and platform abstraction have stabilized.

## Claude Code workflow for this repo

This repo ships nine project-level sub-agents in `.claude/agents/` (one per architectural area: `aqua-document-guardian`, `scene-model-engineer`, `renderer-engineer`, `nx-workspace-engineer`, `angular-feature-engineer`, `electron-platform-engineer`, `catalog-engineer`, `growth-sim-engineer`, `test-engineer`). Each one encodes the load-bearing constraints from the plan for its slice of the codebase and pushes back rather than silently violating them. Invoke with `Task(subagent_type=<name>, …)`.

Agent teams are enabled via `.claude/settings.json` (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Per the Claude Code docs, teams are runtime-only — they can't be defined declaratively in the repo. The reproducible artifact is the **kickoff prompt** in `.claude/team-playbooks/`. Paste the relevant playbook into an interactive session to spawn a team.

**Default to sub-agents.** Reach for a team only when 3+ specialist areas must negotiate a fresh contract at the same time (Stage 4 planting+growth, Stage 9 AI render providers, Stage 10 3D-renderer adoption). For Stage 0 in particular, sub-agents are the recommended pattern — see [`.claude/team-playbooks/stage-0-kickoff.md`](.claude/team-playbooks/stage-0-kickoff.md) for the reasoning.
