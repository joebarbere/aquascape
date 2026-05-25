# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**Stages 0–4 + Stage 4.x UX polish + Stage 5 F5.3 (composition overlays) + Stage 5.x viewport zoom + Stage 5.x wall background + canvas-sizing fix all complete.** Both apps boot and round-trip a document end-to-end: pick a tank from 36 presets (ADA / UNS / Waterbox / US standard), style it, sculpt substrate, drag hardscape (19) + plants (28) from paginated palettes, click-drag bodies / scale handles / rotate dots / shift-marquee, mirror / duplicate / delete / reorder / group via floating inspector + keyboard, manage layers from the right rail, scrub the time slider to preview growth weeks 0–52, **flip golden-ratio / thirds / focal-point overlays on for precision framing**, save, reopen — identical. UX polish: per-panel accordion collapse, resizable + collapsible side panes, responsive layout (< 768 px drawer overlays, 768–1199 px default-collapses rail, ≥ 1200 px full), geometric-A monogram favicon. The `.aqua` v1 format lives in `@aquascape/domain/document`; catalog in `@aquascape/domain/catalog` (`substrate` × 6 + `hardscape` × 19 + `plant` × 28). **v1 is locked** — every future format change needs a `Migration` entry. **Next:** Stage 5 F5.1 + F5.2 (template library + save-as-template) then F5.4 (snap to grid / guides / objects), then Stage 6 (composite-onto-photo).

Planning artifacts (all in repo root or `libs/domain/document/src/`): `aquascape-development-plan.md` (the spec — 11-stage roadmap), `aqua-document.ts`, `aqua-document.schema.json`, `example.aqua.json` (canonical fixture for `document-round-trip.spec.ts`). Foundational ADRs (Electron tooling, pnpm, Jest coverage, Nx Cloud deferral) in `docs/decisions/0001–0004`.

## What this project is

Open-source aquascaping design tool. Hobbyists pick a tank, sculpt substrate, place hardscape, plant flora in layers, preview the result. Ships as **both** an Angular web SPA/PWA and an Electron desktop app from one Nx monorepo; the desktop build is fully offline-capable.

Differentiators vs. Scape It / MyAquariumBuilder / Aquasketcher: deterministic plant **growth simulation** over time (Stage 4 — shipped), composite layouts onto real tank photos (Stage 6), dual **local + hosted** AI render providers behind one interface (Stage 9), **Three.js 3D renderer** consuming the same document as the 2D renderer (Stage 10).

## Architecture — the load-bearing decisions

Non-negotiable without re-opening the plan.

### Layer boundaries (enforced via Nx `@nx/enforce-module-boundaries`)

- `domain/*` libs are **framework-free**: no Angular, no DOM, no Electron, no NgRx. Pure TypeScript only. This is what makes the 3D renderer and headless tooling drop in later. `domain/*` depends only on other `domain/*`.
- `rendering/*` depends only on `domain/scene-model` + `domain/geometry`.
- `features/*` may depend on `domain/*`, `rendering/*`, `ui`, `state`, `platform-api` (interface, never a concrete platform).
- `apps/*` compose `features/*`, `ui`, `state`, and inject a concrete `platform-web` or `platform-electron`.

### The scene model is the heart of the app

`domain/scene-model`: `Scene` → ordered `Layer`s → `SceneObject`s (hardscape / plant / substrate). **Every mutation is a `Command`** with `apply` / `invert`. Undo/redo, persistence, and future collaboration build on this single primitive. UI events become NgRx actions which produce Commands which apply to the Scene — the UI **never** mutates the scene directly.

### One scene model, two renderers

```ts
interface SceneRenderer {
  attach(surface: RenderSurface): void;
  render(scene: Scene, viewport: Viewport): void;
  hitTest(point: Vec2, scene: Scene): HitResult | null;
  dispose(): void;
}
```

`renderer-2d` (canvas) ships now. `renderer-3d` (Three.js / WebGL, Stage 10) drops in over the **same** interface and the **same** canonical 3D coordinates already stored in `.aqua` documents. Features depend on `renderer-api`, never a concrete renderer.

### Platform abstraction

`platform-api` defines `FileService`, `DialogService`, `StorageService`, `RenderExportService`. `platform-web` binds to File System Access API + IndexedDB. `platform-electron` binds to IPC into the main process. Features only ever see the interface — that's why one set of feature libs powers both apps.

### The `.aqua` document format

`aqua-document.ts` is the **single source of truth**; `aqua-document.schema.json` mirrors it for AJV runtime validation. **Both must be updated together.** Format rules:

- **Canonical units = millimetres** (integers preferred). cm/in are display-only.
- **Canonical coordinates** = one right-handed 3D space, origin at the tank's front-bottom-left interior corner (+x right, +y up, +z back). 2D projects along −z; 3D consumes the same coordinates — that's the mechanism that lets Stage 10 add 3D without changing the document.
- **Catalog by reference**: objects carry `CatalogRef` (`catalog` + `id` + `version`), never inlined catalog data.
- **Plain serializable data**: no class instances, no functions. `JSON.parse(JSON.stringify(doc))` must be lossless.
- **Versioned + migratable**: `schemaVersion` drives a pure, total `Migration` chain. Readers run migrations up to their supported version before use.
- **Forward-compatible**: an `extensions` bag + optional per-object fields mean older readers preserve unknown data rather than dropping it.
- **Container**: on-disk `.aqua` is a ZIP (`document.json` + `assets/` + optional `thumbnail.png`). Asset-free docs may be bare JSON with the `.aqua` extension; readers sniff for ZIP magic and accept both.
- **Reproducibility**: a document-level `seed` makes scatter planting, growth jitter, and AI renders deterministic.

### Electron security posture

Context isolation **on**, sandbox **on**, no `nodeIntegration` in renderer, all native access through a typed preload bridge, validated IPC, CSP enforced. Hosted AI provider keys live in OS secure storage / Electron main only — they must never reach the renderer process or get serialized into a document.

## Definition of Done

Typed public API · unit tests · at least one component or e2e test through the UI · docs entry · accessible (keyboard + ARIA) interaction · **`README.md` + `CLAUDE.md` updated in the same PR**. Domain libs target ≥ 90 % coverage; pure logic (geometry, growth-sim, commands, document migrations) is exhaustively tested.

## Keep documentation in sync with the code

Treat documentation drift like a failing test. After a feature lands, refresh both files — either bundled into the feature's last commit, or as a trailing `docs:` commit.

- **README.md** carries: status line, "Implemented so far" bullets (move stubs out of "Empty placeholders" when bodies land), document-format additions, shared infrastructure (`tools/`, ADRs, CI selectors), quick-start commands, license, project pitch.
- **CLAUDE.md** carries: status line + the *next* concrete thing, load-bearing **caveats / gotchas** (not "what shipped" — that's the README's job), invariants and policies (lock-guard, schema lockstep, radians-vs-degrees), default constants + reasoning, cross-cutting build prerequisites that bite when adding new libs, Stage-N-stub flags. Do NOT enumerate empty-placeholder stubs.

## Load-bearing caveats and gotchas

Organized by topic. These are the things that bite future contributors; the codebase tells you what shipped.

### Document format

- **v1 is locked.** Every change needs: (a) prepended `{ from: N, to: N+1, migrate }` in `AQUA_MIGRATIONS` (`libs/domain/document/src/migrations.ts`), (b) `CURRENT_SCHEMA_VERSION` bumped, (c) previous example preserved as round-trip fixture, (d) fast-check property test in `libs/testing` covering the new step. `nx test testing -t document-round-trip` is REQUIRED on main.
- `aqua-document.ts` + `aqua-document.schema.json` + `example.aqua.json` + in-memory mirror in `libs/domain/scene-model/src/types.ts` must be updated **together**. `node tools/validate-example.mjs` is the one-line contributor sanity check.
- **`arbFiniteNumber` folds `-0` → `0`** because `JSON.stringify(-0) === "0"` but `Object.is(-0, 0) === false` and Jest's `toEqual` distinguishes them. A raw `fc.double` producing `-0` breaks the format invariant.
- **Loader preflight order:** container unwrap → JSON.parse → if `schemaVersion` missing/non-number, run validator FIRST (so the user sees `schema-invalid` not a confusing `missing-migration` 0 → 1) → `runMigrations` → `validateAquaDocument`.
- **Marshaling preserves unknown extensions.** `documentToScene` / `sceneToDocument` carry the envelope (`meta` + optional `livestock` / `equipment` / `renderHistory` / `extensions`) verbatim. Don't drop what you don't understand.

### Scene model + commands

- **Commands are plain discriminated-union records** (not classes), dispatched through free `applyCommand` / `invertCommand`. Chosen for trivial JSON round-trips + inspectability.
- **Lock-guard policy:** locked layers reject *object-level* commands via `CommandResult` (`{ ok: false, reason: 'locked' | 'not-found' | 'invalid', message }`). Layer-metadata commands (rename / opacity / visibility / locked) and global ops (`SetTankDimensions` / `SetTankStyle`) are NOT blocked.
- `MoveObject` carries absolute world position. `ReorderLayers` takes a full id-permutation.
- `SetTankDimensions` validates against 100–10 000 mm, clamps every object's `transform.position` into the new interior AABB. **Nothing is deleted**, even when an object's centre lands on a face. Invert carries `inverse: { previousDimensions, restoredPositions }`; apply **short-circuits the clamp when `restoredPositions` is present** (this is how shrink-and-undo restores originals).
- `SetTankStyle` is whole-style replacement, `structuredClone`-cloned on store, always-on validation (hex regex + sorted-stops + finite angle + image `AssetRef` shape). Substrate `SetSubstrateRegionProfile` follows the same wholesale-replace pattern.
- `MirrorObject` is **self-inverse** (no captured state; apply twice = identity). `Duplicate` isn't a new command — the inspector composes `AddObject` of a `JSON.parse(JSON.stringify())`-cloned object with a fresh id + 20 mm offset.
- `SetObjectGroupId({ objectIds, groupId: null })` REMOVES the property entirely. The schema's `additionalProperties: false` won't accept literal `null`; "ungrouped" must round-trip as "no field present". When `inverse.previousGroupIds` is present, per-object restoration takes precedence over the uniform `groupId`.
- **History is bounded immutable** (default 200). `setScene({ scene })` replaces wholesale and resets history — deliberately NOT a Command (you don't undo opening a file). Used by Open / New / Recover.
- **`setTankPresetRef`** is a metadata-only side-edit that bypasses the Command pipeline.

### Geometry

- `composeTransform` / `invertTransform` round-trip via TRS↔matrix and are **exact only for uniform scale**. Non-uniform scale combined with rotation loses information; `flipX` / `flipY` are absorbed into negative scale.
- `sampleCatmullRom` is **centripetal** (`alpha = 0.5`), not uniform — uniform produces cusps + loops on clustered points.
- `seededHash01` must NOT `& 0xffffffff` after `>>> 0` — bitwise AND coerces uint32 back to signed int32 and breaks the `[0, 1)` guarantee. Property test catches it.

### Renderer-2d

- **Canvas sizing is asymmetric: backing buffer only.** `syncCanvasSize` writes `canvas.width` and `canvas.height` (integer DPR-scaled pixels for the backing store) but DOES NOT write `canvas.style.width` / `.style.height`. The host stylesheet (`apps/web/src/app/app.component.ts`'s `.scene-canvas { width: 100%; height: 100%; }`) owns the CSS box; the renderer only owns the bitmap. Writing inline CSS pins the canvas at whatever interim dimensions it had on first `attach`, before async-hydrated sidebar/rail widths and the recovery banner have settled — the ResizeObserver then reads back the renderer's own frozen value and the tank stays painted at the top of an oversized canvas-host (visible as "tank pushed up" in screenshots). Regression test is `does NOT write inline canvas.style.width / .height` in the renderer spec.
- **Paint order:** **wall background (Stage 5.x — view-only, first so the tank's own background covers it inside the tank rect)** → background (tank `style.background`, painted INSIDE the tank rect only) → grid → tank outline → substrate (Catmull-Rom silhouette + deterministic grain noise, `seed XOR fnv32(region.id)`) → water tint (inside tank, `globalAlpha = 0.25`) → frame overlay (8 mm rim for `'framed'`, +10 mm centre brace for `'braced'`) → hardscape silhouettes → plant silhouettes → **composition overlays (F5.3, golden ratio / thirds / focal points — view-only, between content and handles so handles stay readable)** → selection handles (drawn LAST).
- **F5.3 overlays are on `render` only, NOT on `hitTest`** — they are non-interactive decoration. When `overlayOptions` is omitted, or when every flag is false, the overlay pass is a true no-op (single early return, zero canvas state change). Each enabled overlay wraps its paint in its own `save`/`restore` so style state never leaks into selection-handle paint. Coords are tank-interior-relative (`(0, 0)` to `(tank.width, tank.height)` in world mm) — the world transform already in place from `render()` projects them the same way as scene content. Line widths and dash lengths are scaled by `1 / zoom` so they look identical at every zoom.
- **Hit-test handle-beats-body:** when `selection` is supplied, handle hit-test runs FIRST. A click on a corner-handle square inside the silhouette returns `'scaleNE'`, not the body. Without `selection`, handles aren't painted and aren't hit-tested.
- **Selection handles for single-specimen plants only.** Scatter patches don't get bbox handles — "scale a brush" isn't the right gesture.
- **Grain noise skipped on regions < 20 mm wide** (sub-pixel speckle = flicker on resize).
- **Branch coverage lowered to 85 %** here (statement / line / function gates stay 90 %) — selection-handle paths + many small defensive guards aren't naturally exercised from unit tests.

### Growth-sim (`domain/growth-sim`)

- `plantScale` curve: logistic, `progress = 1 - exp(-DECAY × age / W)` with `DECAY = -ln(1 - GROWTH_CURVE_TARGET) ≈ 4.605` so a plant reaches `0.99 × (1 - sizeAtZero)` at `age = weeksToMature`. **Vigor > 1 legitimately renders > 1× catalog size — by design.** Defensive guards: negative ages → 0, non-finite `sizeAtZero` → 0, `weeksToMature ≤ 0` → falls back to 1.
- `scatterInPolygon` Mulberry32 PRNG sub-streams (jitter, rotation) are **stable regardless of cell index** — load-bearing for documents reloading identically across machines.

### State (NgRx)

- Generic `dispatchCommand` effect → `applyCommand` → either `applyCommandSucceeded({ scene, history })` or `commandRejected({ reason, message })`.
- Selection reducer **preserves identity on no-op state changes** (e.g. `clearSelection` on empty set) so `OnPush` components don't redraw spuriously.
- Cross-store dispatch: opening / recovering a file emits BOTH `SceneActions.setScene` AND `DocumentActions.documentOpened` — two reducers stay decoupled but land consistently. A `resetOnSceneReplace$` effect observes `setScene` and clears selection.
- Autosave debounced via the `AUTOSAVE_DEBOUNCE_MS` injection token (3000 ms prod, 0 in tests). Persisted as a versioned `{ version: 1, document, fileId, name, savedAt }` payload at `aquascape.autosaveDraft`; cleared on any successful save.
- `DocumentEffects.bootstrap()` is called once from the composition root after `bootstrapApplication` to prime recent files + crash draft from storage. Recover dispatches `setScene` + `documentOpened` + `markDirty` (recovered docs are presumed unsaved).
- **NgRx selector overrides via `provideMockStore({ selectors: [...] })` LEAK across `TestBed.resetTestingModule()` calls.** Specs that override `selectScene` to `null` in one test will silently corrupt subsequent tests. Configure helpers must include the desired selector value in EVERY test.

### Platform

- `platform-api` is interface-only. Angular `InjectionToken`s live in the `platform-api/angular` sub-entry (TS path alias `@aquascape/platform/platform-api/angular`) so the framework-free interface file never imports `@angular/core`.
- `FileSystemAccessFileService` (Chromium) keeps `FileSystemFileHandle`s in an in-memory map keyed by synthetic id, so `saveDocument({ id })` silently re-writes the user-chosen path. **`FallbackFileService` (Safari / Firefox) collapses Save into Save As** — the legacy `<input type=file>` + `<a download>` flow has no stable file handle. UIs detect via `selectHasFile` staying false.
- `IpcBridge` interface declared **locally** in `platform-electron/src/transport.ts`, not imported from `apps/desktop`, to avoid coupling the lib to the app's contract module.
- Main-process IPC validators **NEVER echo offending payload values back through error messages** (security rule).
- `apps/desktop` storage backend is a JSON-file KV at `app.getPath('userData')/aquascape-storage.json` (whole-file read on every `get`, all-or-nothing write — crash-safe at autosave scale). `dialog.show{Open,Save}Dialog` anchored via a `getWindow()` indirection so backends survive window create/close/reopen cycles.
- **Desktop serve has a race:** `nx serve desktop` spawns Electron and `nx serve web` in parallel without a readiness wait, so first launch shows `ERR_CONNECTION_REFUSED`. Either kill + relaunch via `nx run desktop:serve-electron` after the web server is up, or fix by sequencing in `apps/desktop/project.json`.

### App shell (`apps/web`)

- **Drag state machine** on the canvas: `move` / `scale` / `rotate` / `marquee` / null. Intermediate `pointermove` updates LOCAL state only — the renderer is handed a `previewScene` with the dragged object's transform replaced via `applyMoveDrag` / `applyScaleDrag` / `applyRotateDrag`. **One command per gesture** fires on `pointerup` (`MoveObject` for translate, `ReshapeObject` for scale + rotate). Esc cancels with no dispatch.
- **Scale model** (v1): uniform centre-anchored, `new = original × (cursor dist from centre) / (start dist from centre)`, with `MIN_SCALE_RATIO = 0.01` floor. Standard "opposite-corner-stays-fixed" model is a future improvement.
- **Marquee selection criterion** is **centre-in-rect** (Sketch-style). Figma's partial-overlap variant is a future option.
- **Implicit carpet brush:** plants with catalog `defaultDensity > 0` produce a 16-sided regular polygon scatter patch (`SCATTER_PATCH_RADIUS_MM = 60`) centred on the cursor, seeded from `scene.seed`. Freehand brush UI is deferred.
- The `effect()` watching `PreviewTimeService` has a `previewTimeFirstRun` flag so its initial dependency-registering invocation doesn't double-call `attach` against the test mock.
- **Selection inspector disabled bindings must read from signal sources (`toSignal` or `signal()`), NOT plain RxJS fields** — `OnPush` doesn't re-run bindings on raw subscription updates. Signal sources feed the template; plain fields feed synchronous action handlers.
- Selection inspector keyboard shortcuts (Del / Cmd+D / Cmd+G / `[` / `]`) **ignore events whose target is INPUT/TEXTAREA/SELECT** so users can type in numeric inputs without triggering delete.
- **Per-panel collapse:** every panel owns its own `collapsed = signal<boolean>(false)` and persists under `aquascape.ui.collapsed.<panel>`. The `effect()` that writes to storage uses a **`firstRun` guard** to skip the synchronous initial pass — without it, the hydrate-from-storage path races and loses a `true` to the seeded `false`.
- **Palette pager is local component signals** (not NgRx; paging is ephemeral). Filter-change → page-reset uses an explicit `onFilterChange()` handler, NOT an `effect()` — an effect reading filter + writing page trips Angular's cycle warning. A separate clamp `effect()` runs to handle the "filter shrinks the list" case.
- **Shell layout helpers** in `apps/web/src/app/shell-layout.ts` (pure, framework-free, 100 % covered): `clampPanelWidth`, `resolveBreakpoint`, `boundsFor`, `SHELL_STORAGE_KEYS`.
- **Why global CSS for shell layout, not component CSS:** the rules would push `app.component.ts`'s attached styles past Angular's `anyComponentStyle` 4 kB error budget. They live in `apps/web/src/styles.css` (targeting `aquascape-root` + descendants); the component file holds only canvas-host overlays.
- **CSS vars `--sidebar-width` / `--rail-width` written directly on pointermove** (not signal-driven `ngStyle`). Signal commits only on pointerup. Same model as canvas drag.
- **`shellHydrated` gate** prevents storage echo on cold boot — without it, the synchronous initial signal-set fires `persistWidth` before the async hydrate resolves.
- **Breakpoint defaults are one-time-only.** Tablet-default rail-collapse only fires when no preference is persisted. Any explicit preference (`true` OR `false`) wins forever. `recomputeBreakpoint` re-clamps current widths against new bounds but **never overwrites the persisted preference**.
- **Storage key namespaces:** `aquascape.ui.collapsed.<panel>` (per-panel accordion — `tank-setup`, `substrate-tool`, `hardscape-tool`, `planting-tool`, `layers-panel`, `composition-overlays`, `wall-background`), `aquascape.ui.shell.{sidebarWidth, railWidth, sidebarCollapsed, railCollapsed}` (layout), `aquascape.ui.overlays.{goldenRatio, thirds, focalPoints}` (F5.3 composition overlays — each flag persisted independently, defaults false), `aquascape.ui.wall.{enabled, color, widthMm, heightMm}` (Stage 5.x wall background — defaults off / `#2a2d35` / 1200 × 600 mm). `aquascape.autosaveDraft` for crash recovery.
- **F5.3 overlay state is view-only.** It lives in `OverlayOptionsService` (root-provided, `features/editor-shell`), never in `Scene` / `.aqua`. The architecture makes this a compile-time guarantee — `documentToScene`/`sceneToDocument` have no overlay slot to read or write. The renderer call site in `apps/web` pipes `overlayOptions.overlays()` into `renderer.render(..., overlayOptions)`; a small `effect()` mirrors `previewTimeEffect` and re-renders whenever any flag flips.
- **Wall background is view-only too.** Same pattern: `WallBackgroundService` (root-provided, `features/editor-shell`) holds `enabled` / `color` / `widthMm` / `heightMm` signals, persisted under `aquascape.ui.wall.{enabled,color,widthMm,heightMm}` (defaults: off, `#2a2d35`, 1200 × 600 mm, clamped to `MIN_WALL_DIM_MM = 100` / `MAX_WALL_DIM_MM = 10000`). NOT serialised into `.aqua` — the wall is a per-user preference until the broader "customise the room" scope lands (then the schema can promote it). The renderer paints `WallBackground` FIRST in world-mm space (right after the canvas clear, before `drawBackground`) so the tank's own `style.background` fill covers the wall inside the tank rect — the wall reads as a real surface visible only outside the tank silhouette, which is exactly how a front-view projection of a real room looks. Re-render via the same `effect()` pattern as overlays + zoom.
- **Viewport zoom is user state composed on top of fit-to-window.** `ViewportService` (root-provided, `features/editor-shell`) holds two nullable signals: `userZoomMult: number | null` (multiplier over fit; null = fit) and `userPan: Vec2 | null` (world-mm offset from tank centre; null = centred). `apps/web/src/app/zoom-math.ts` — wait, lives in editor-shell — `libs/features/editor-shell/src/lib/zoom-math.ts` — provides pure helpers: `composeViewport`, `cursorToWorld`, `panForCursorAnchor` (cursor-anchored zoom: keeps the world point under the cursor fixed across a zoom change), `wheelDeltaToZoomFactor`. `composeViewport(defaultViewport, userZoomMult, userPan)` returns the final viewport the renderer paints. Limits: `ZOOM_MULT_MIN = 0.1`, `ZOOM_MULT_MAX = 10`, `ZOOM_STEP_MULT = 1.25` per +/- click. `Fit` button calls `viewport.reset()` which clears both overrides. Wheel zoom is bound non-passively in `installWheelZoomListener` so `preventDefault()` actually stops page scroll; only Cmd/Ctrl + wheel zooms (plain wheel is a no-op so page scroll is preserved). The wheel handler runs in `runOutsideAngular` and `ngZone.run`s only the final `setZoomAndPan` so we don't trigger change detection per wheel tick.
- **Resize separators** are `role="separator"` + `aria-orientation="vertical"` + `aria-valuenow/min/max`. Arrow-Left/Right (±16 px), Home/End jump to bounds. **Arrow direction on the right rail is inverted** so both handles "feel" the same (toward-canvas always shrinks).

### Catalog

- **Invalid entries are surfaced, never silently dropped** (Plan §3). Duplicate `(catalog, id)` pairs become warnings, first-seen wins.
- **No fabricated tank presets.** `tank-presets.ts` documents every source. The four UNS sizes (9S, 45F, 75L, 120L) that don't exist in any verifiable source are **explicitly skipped, not invented** — same rule for the ADA Mini-S US/EU discrepancy (we follow ADA-NA spec) and the "5 gal cube" vendor variance.
- **Catalog growth is data-only.** Drop new JSON manifests into `libs/domain/catalog/src/data/<kind>/`, extend `core-catalog.ts` imports. The loader picks them up at module-import time. The schema's `oneOf` makes adding new `kind`s additive.

### Build / test prerequisites

- **Every buildable lib needs a `package.json` with `"name": "@aquascape/..."`** matching its tsconfig path alias, or `@nx/js:tsc` cross-lib builds break with `TS6059: not under 'rootDir'` for transitive consumers.
- **Angular feature libs additionally need:** `jest-preset-angular` config + `tsconfig.json` with `experimentalDecorators: true` + `angularCompilerOptions` + `test-setup.ts` calling `setupZoneTestEnv()`. `layers-panel` and `planting-tool` test setups also polyfill `crypto.randomUUID` (jsdom 20 ships `crypto` without it; `newLayerId()` / `newObjectId()` call it).
- **Per-lib coverage gates** default to 90 % across statement / branch / function / line in `libs/domain/*`, `libs/rendering/renderer-2d`, `libs/platform/platform-{web,electron}`, `libs/state`, every implemented `libs/features/*`. **Branch exceptions** with a comment in each `jest.config.ts`: `rendering-renderer-2d` + `features-hardscape-tool` at 85 %; `features-editor-shell` + `features-layers-panel` + `features-planting-tool` at 80 %.
- **CSS budget warnings (not blocking).** Accordion CSS pushed `layers-panel` (2.13 kB), `substrate-tool` (2.69 kB), `planting-tool` (2.75 kB), and pre-existing `tank-setup` (3.79 kB) over the 2 kB `anyComponentStyle` warning. Production builds succeed; all under the 4 kB error budget.
- **Electron icon pipeline lives in `tools/build-icons.mjs`.** Source of truth: `apps/web/src/favicon.svg`. Run `pnpm icons` to regenerate `apps/desktop/src/assets/icon.{png,ico,icns}` — the PNG (1024 × 1024), the multi-size Windows ICO (16…256), and the macOS ICNS bundle (16…1024 incl. @2x retinas, built via Apple's `iconutil` so the output is bit-identical to Xcode's). All three are committed to git; the build-main `assets` glob (`icon.{png,ico,icns}`) copies them into `dist/apps/desktop/main/assets/` for runtime use by `BrowserWindow({ icon })` (Windows-ICO / Linux-PNG / macOS-ICNS via `resolvePlatformIconPath`) and `app.dock.setIcon(ICNS)`. **ICNS regeneration requires macOS** — `iconutil` is shipped with macOS only; on Linux/Windows the script warns and skips the ICNS step, trusting the committed binary. Production packaging (Stage 8+) will embed the same ICNS in the `.app` bundle's `Contents/Resources/` via electron-builder or equivalent — no further icon work needed there.
- **Icon-grid padding.** The `favicon.svg` viewBox is `-8 -8 80 80` (NOT `0 0 64 64`); the visible 64-unit tile occupies the centre 80 % of the canvas with ~10 % transparent padding on each side. Without this, dock-rasterised icons render ≈ 25 % larger than their neighbours because macOS doesn't apply its own inset. Internal coordinates (rect at 0,0→64,64, A at (10,54)→(32,8)→(54,54)) are unchanged; only the canvas grew.
- **App name + version display.** `apps/desktop/src/main/main.ts` calls `app.setName('Aquascape')` *synchronously* before `app.whenReady()` so `app.getPath('userData')` resolves to `~/Library/Application Support/Aquascape/`. **After** the storage-path is cached (`const storagePath = path.join(app.getPath('userData'), 'aquascape-storage.json')` handed to `createStorageBackend` as a constant thunk), the name is re-set to `Aquascape ${version}` — `(dev)` for unpackaged runs, `app.getVersion()` for packaged builds. The cache step is load-bearing: `app.getPath('userData')` resolves lazily from the current `app.getName()` each call, so re-naming for the dock display would otherwise move the storage file between writes. **On macOS, JS `app.setName()` does NOT update the dock-hover tooltip / menu-bar app name** — those come from `CFBundleName` in the launched `.app` bundle's `Info.plist`, which macOS reads before our JS runs. To make the dock hover show "Aquascape (dev)" instead of "Electron", `tools/build-dev-bundle.sh` (run via `pnpm dev-bundle`, automatically by `pnpm restart:desktop`) clones `node_modules/electron/dist/Electron.app` into `apps/desktop/.dev-bundle/Aquascape (dev).app`, patches `CFBundleName` + `CFBundleDisplayName` via `PlistBuddy`, and swaps `Contents/Resources/electron.icns` for our ICNS. The restart script then launches the cloned bundle's binary directly (`open --args` would detach the process; we want it foreground for Ctrl-C teardown). Per-clone, gitignored (`apps/desktop/.dev-bundle/`); APFS copy-on-write makes the bulk clone near-instant. Linux + Windows fall back to plain `electron`. Production packaging (Stage 8+) sets `CFBundleName` via the packager and the dev bundle becomes unnecessary.
- **userData path migration (one-time).** Pre-name-fix dev runs wrote autosave drafts + recent-files to `~/Library/Application Support/Electron/aquascape-storage.json`. After the fix the storage moves to `~/Library/Application Support/Aquascape/aquascape-storage.json` — existing dev data is stranded at the old path. Acceptable one-time loss for the dev-only environment; if a user reports missing recent files after pulling the change, the fix is to move `aquascape-storage.json` from the `Electron/` to the `Aquascape/` directory.

## Development commands

Package manager: **pnpm**, pinned via `package.json#packageManager`. Node version pinned via `.nvmrc`.

```bash
corepack enable                  # one-time
pnpm install

pnpm exec nx graph               # browse the project graph
pnpm exec nx show projects       # list every project Nx knows
pnpm exec nx affected -t lint test build   # what CI runs on every PR
pnpm exec nx run-many -t lint    # full lint sweep (incl. module boundaries)
pnpm exec nx test <project>                          # one project's tests
pnpm exec nx test <project> --configuration=ci      # + coverage + threshold gate
pnpm exec nx build <project>     # build one project
pnpm format                      # nx format:write

pnpm exec nx serve web                       # Angular dev server on http://localhost:4200
pnpm exec nx build web                       # → dist/apps/web/browser/index.html
pnpm exec nx serve desktop                   # web dev-server + Electron (see race caveat above)
pnpm exec nx run desktop:serve-electron      # Electron only (assumes nx serve web is already up)
pnpm exec nx build desktop                   # → dist/apps/desktop/{main,preload}/
```

CI workflows in `.github/workflows/`:

- `pr.yml` — `nx affected -t lint test build` + the explicit coverage-gate job (runs `--configuration=ci` across `tag:scope:domain,scope:rendering,scope:platform-web,scope:platform-electron,scope:state` + each implemented `features-*` lib by name) + the `document-round-trip` job (`nx test testing -t document-round-trip`). Linux only. When a new feature lib lands, add it to the workflow selector.
- `main.yml` — full `nx run-many` across the ubuntu / macos / windows matrix.

The `document-round-trip` job is REQUIRED on main — a format/loader regression fails the PR.

## Working with the planning artifacts

- Treat `aquascape-development-plan.md` as the spec. If a request conflicts with it, surface the conflict instead of silently deviating.
- When changing the document format: follow the v1-locked checklist under "Load-bearing caveats — Document format" above.
- The stage roadmap is sequenced deliberately. Stages 0–4 are the critical path to v1.0 (shipped). Stages 5–6 round out v1.x. Stages 7–10 are parallelizable once the scene model + platform abstraction stabilize.

## Claude Code workflow for this repo

Nine project-level sub-agents in `.claude/agents/` (one per architectural area: `aqua-document-guardian`, `scene-model-engineer`, `renderer-engineer`, `nx-workspace-engineer`, `angular-feature-engineer`, `electron-platform-engineer`, `catalog-engineer`, `growth-sim-engineer`, `test-engineer`). Each encodes the load-bearing constraints from the plan for its slice and pushes back rather than silently violating them. Invoke with `Task(subagent_type=<name>, …)`.

Agent teams are enabled via `.claude/settings.json` (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`); the reproducible artifact is the kickoff prompt in `.claude/team-playbooks/`.

**Default to sub-agents.** Reach for a team only when 3+ specialist areas must negotiate a fresh contract at the same time (Stage 4 planting+growth, Stage 9 AI render providers, Stage 10 3D-renderer adoption).
