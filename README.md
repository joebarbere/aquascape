<div align="center">

<img src="apps/web/src/favicon.svg" width="120" alt="Aquascape brand mark" />

# Aquascape

**Open-source aquascaping design tool — for the web, for the desktop, for free.**

[![main CI](https://github.com/joebarbere/aquascape/actions/workflows/main.yml/badge.svg)](https://github.com/joebarbere/aquascape/actions/workflows/main.yml)
[![PR CI](https://github.com/joebarbere/aquascape/actions/workflows/pr.yml/badge.svg)](https://github.com/joebarbere/aquascape/actions/workflows/pr.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![Status: Stages 0–7 + 10 + F11.1–F11.4 complete](https://img.shields.io/badge/status-stages%200--7%20%2B%2010%20%2B%20F11.1--F11.4-brightgreen.svg)](#status--roadmap)
[![Platform: Web + Electron](https://img.shields.io/badge/platform-web%20%2B%20electron-informational.svg)](#platforms)

</div>

---

## What is this?

Aquascape is a design tool for planted-aquarium hobbyists. Pick a tank, sculpt the substrate, place rocks and driftwood, plant flora in layers, plan livestock and equipment — preview the result, save it, share it. Ships as **both** an Angular web SPA/PWA and an Electron desktop app from one Nx monorepo; the desktop build is fully offline-capable.

### Why another aquascaping tool?

The hobbyist tools that exist today either focus on layout (Scape It, Aquasketcher) or on stocking calculators (MyAquariumBuilder / AqAdvisor). Aquascape combines both into a single document and adds capabilities none of them ship:

- 🌱 **Deterministic plant-growth simulation** — scrub a time slider to preview weeks 0–52 of growth
- 📸 **Composite onto a real tank photo** — design against the actual shelf the tank will live on
- 🤖 **Local + hosted AI render** behind one interface — coming in Stage 9
- 🧊 **3D renderer** that consumes the same document — shipped in Stage 10 (read-only); animated water + plants + fish land in Stage 11
- 💾 **Lossless `.aqua` document format** with a locked v1 schema + migration chain
- 🆓 **Truly open-source**, MIT-licensed, no telemetry, no cloud lock-in

---

## Features

### 🐠 Design your tank

- **36 tank presets** spanning ADA Cube Garden (Mini-S → 150-P), UNS (5N → 120U), Waterbox (Clear Mini 10/16/30 + Cube 20), and US standard sizes (5 gal cube → 90 gal)
- Custom dimensions (mm / cm / inches — storage is integer mm; toggle is display-only)
- Aspect-ratio guardrail flags unusual ratios
- **Frame styles:** rimless / black-rimmed / braced
- **Water tint** picker + presets
- **Tank background:** solid colour or gradient (image backgrounds are planned)

### 🏞 Substrate sculpting

- Multi-region substrate with smooth blends along the tank floor
- Per-region material (6 core substrates — ADA Aqua Soil Amazonia, Tropica Aquasoil, silica sand, white aragonite, black pea gravel, Seachem Flourite)
- Profile curve editor — add/remove/edit elevation points along the front-back axis
- Renderer paints a Catmull-Rom silhouette with deterministic grain noise per-region

### 🪨 Hardscape & 🌿 plants

- **19 hardscape entries** — rocks (Seiryu × 2, Ohko Dragon, Frodo, Pagoda Yamaya, Black Lava, Texas Holey, Elephant Skin, Petrified Wood, Polar Ice, Iota, Snow Mountain) + wood (Spiderwood, Manzanita, Malaysian, Mopani, Cholla, Bonsai, Redmoor)
- **28 plant entries** across foreground carpets, midground, background — each with a normalized silhouette, growth params, and optional carpet-brush density
- Paginated palette browsers with filter chips
- Pointer drag-and-drop onto the canvas

### 🎯 Precision editing

- **Click-drag** to move; **drag corner handles** to scale; **drag the rotate dot** to rotate
- **Shift-marquee** for multi-select (Sketch-style centre-in-rect)
- **Floating selection inspector** — Mirror H/V, Duplicate, Z-up/down, Delete
- **Keyboard shortcuts** — Del, Cmd+D, Cmd+G (group), `[` / `]` (z-order)
- **Snap-to-everything** — grid / guides / objects, with magenta alignment lines while dragging
- **Drag readouts** — `X, Y mm` for move, `% × %` for scale, `°` for rotate
- **Composition overlays** — golden ratio + rule of thirds + focal-point markers (view-only)
- **Time slider** — scrub weeks 0–52 to preview plant growth (deterministic)

### 🐟 Livestock & equipment planning (Stage 7)

- **8 livestock species** — neon tetra, betta, pygmy cory, apistogramma cacatuoides + cherry shrimp + crystal red shrimp + nerite snail + ramshorn snail
- **12 equipment entries** — Eheim Pro 4+ / Fluval 207 / AquaClear 50 / sponge filters, Fluval E300 / Eheim Jager 200 / Cobalt Neo-Therm 100 heaters, Twinstar 600S / Chihiros WRGB II Pro 60 / Fluval Plant 3.0 lights, Co2Art SE + ADA Pollen Glass CO2
- **Stocking guidance** — six rule-based, explainable warnings: bioload vs. tank litres, temperature/pH range intersections, peaceful+aggressive temperament clash, schooling-below-minimum, fin-nipper presence
- **Inline note editing** on each equipment row
- All edits flow through the undo/redo Command pipeline

### 💾 Save, share, export

- Lossless `.aqua` v1 document format (ZIP container with embedded assets, falls back to bare JSON)
- Crash-recovery autosave debounced every 3 s
- Recent-files menu
- **Image export** — PNG / JPEG at 1080p / 2K / 4K
- **Setup-sheet export** — Markdown / JSON combining tank dimensions, water volume, plants, hardscape, livestock per-species stats, equipment per-item stats, and the live stocking-warnings list

### 🎨 UX polish

- **Per-panel accordion collapse** with state persisted to local storage
- **Resizable, collapsible sidebars** — drag the separator to size each pane
- **Responsive layout** — sidebar drawers below 768 px, auto-collapse right rail at tablet width
- **Cursor-anchored Cmd/Ctrl + wheel zoom** (10 %–1000 % of fit-to-window)
- **Photo backdrop** — composite your design onto a photo of the real tank's location
- **Wall background** — a configurable surface behind the tank for room-context visualisation
- **Geometric-A brand mark** rendered at every dock / favicon / install size

### 🧊 3D view (read-only)

- **One-click toggle** between 2D and 3D in the editor toolbar — segmented `2D | 3D` control, or `Cmd/Ctrl+Shift+3` keyboard shortcut
- Three.js / WebGL renderer reads the **same** `.aqua` document — every change you make in 2D shows up immediately in 3D
- **Orbit camera controls** — drag to rotate around the tank, wheel to zoom, two-finger drag to pan
- Glass tank with frame styling (rimless / framed / braced), substrate extruded from your profile, hardscape + plants rendered as 3D silhouettes with vigour-scaled growth
- Ambient + directional lighting; the time slider works in 3D too (scrub plant growth over weeks)
- **Read-only in Stage 10** — editing happens in 2D; flip to 3D to visualise. The ambient-scene polish (animated water surface, dynamic lighting / day-night cycle, swaying plants) plus fish behaviours all land in Stage 11 — see [`plans/stage-11-animated-livestock.md`](./plans/stage-11-animated-livestock.md)
- **F11.1 shipped:** each livestock entry in the document becomes N visible fish in the 3D view, deterministically spawned from `scene.seed`. Six procedural archetypes (slim-tetra / deep-bodied / barb / cory-cylinder / eel / hatchet-wedge) wiggle in place via a carangiform tail-beat vertex shader; species → archetype mapping reads the catalog group.
- **F11.2 shipped:** the fish now swim — Couzin three-zone schooling (ZOR / ZOO / ZOA with blind cone), Reynolds 1987 weighted separation / alignment / cohesion forces, vertical-band stratification (hatchetfish hug the surface, tetras roam mid-water, cories scoot along the substrate), turn-rate-clamped steering integrator. Catalog manifest `schemaVersion: 3` adds an optional `LivestockEntry.behavior` block so manifest authors can override per-species params one field at a time on top of the per-group presets.
- **F11.3 shipped:** territoriality + nipping + fear. Cichlids defend caves (bourgeois owner-wins chase with fatigue decay), tiger barbs nip long-finned slow-swimming victims (suppressed once their conspecific group hits threshold), startled fish flip into REFUGE mode and dart to the nearest hardscape with `coverScore > 0`. Hardscape gains an optional `coverScore` (loader defaults from category — wood 0.6 / rock 0.4); livestock behaviour gains optional `territory` / `nipping` / required `fear` params. Priority arbitration: Fear → Nip → Territory → Schooling, mode-gated via `BehaviorMode`.
- **F11.4 shipped:** feeding + grazing + curiosity/glass-surfing. Otocinclus graze algae off rocks (algae score decays under rasping + regrows ~17 min to full), hatchetfish + tetras + cories find food sprites at the right Y-band for their feeding category, shrimp + snails detrivore-wander the substrate; bold species curiously dart at the front pane on a Poisson trigger. A "Feed tank" button in the Livestock tool drops 3–6 food sprites just below the waterline (transient — sprites auto-despawn after 30s). Food sprites render as camera-facing billboards via a 7th InstancedMesh in the livestock renderer.

### 📦 Templates

- Four built-in starter templates — **Iwagumi** / **Dutch** / **Jungle** / **Beginner**
- Save your own as a personal template (capped at 32 entries)
- "New from template" mints a fresh untitled scene from the chosen layout

---

## Platforms

| Platform | Bundle | Status |
| --- | --- | --- |
| **Web (Angular SPA + PWA)** | Installable via browser "Install Aquascape" prompt; offline-capable via `@angular/service-worker` | ✅ Shipped |
| **Desktop (Electron)** | macOS DMG (arm64 + x64), Windows NSIS (x64), Linux AppImage (x64) | ✅ Shipped (unsigned) |

> **Note on the macOS installer:** code signing is OFF for the current open-source build. Gatekeeper requires right-click → Open the first time (or `xattr -d com.apple.quarantine Aquascape.app`). Production distribution will need an Apple Developer ID + Windows EV certificate.

---

## Quick start

```bash
corepack enable                              # one-time, picks up the pinned pnpm
pnpm install

pnpm exec nx serve web                       # → http://localhost:4200
pnpm exec nx serve desktop                   # web dev-server + Electron, in parallel
pnpm exec nx build desktop                   # → dist/apps/desktop/{main,preload}/
pnpm package:desktop                         # → dist/apps/desktop/installers/

pnpm exec nx graph                           # browse the dependency graph
pnpm exec nx run-many -t test                # full unit-test suite
pnpm exec nx test <project> --configuration=ci  # with coverage + threshold gate
pnpm exec nx run-many -t lint                # module-boundary lint over every project
pnpm exec playwright install chromium        # one-time, ~150 MB — Playwright browser binaries
pnpm exec nx run web-e2e:e2e                 # boots `nx serve web` + runs real-browser specs
```

---

## Status & Roadmap

The roadmap lives in [`aquascape-development-plan.md`](./aquascape-development-plan.md) §4 (Stages 0–10) and is extended by two planned stages in [`plans/`](./plans/).

| Stage | Theme | Status |
| --- | --- | --- |
| 0 | Foundation & walking skeleton | ✅ |
| 1 | Tank setup & document lifecycle | ✅ |
| 2 | Substrate tool | ✅ |
| 3 | Hardscape tool | ✅ |
| 4 | Layers, planting, growth simulation | ✅ |
| 5 | Templates, snapping, composition overlays | ✅ |
| 6 | Image export, layout summary, photo backdrop, PWA install, packaged installers | ✅ |
| 7 | Livestock & equipment + stocking guidance + setup sheet | ✅ |
| 8 | Community gallery (browse + remix shared layouts) — see [`plans/stage-8-community-gallery/`](./plans/stage-8-community-gallery/) | 📐 Planned |
| 9 | AI photorealistic render (local + hosted) — see [`plans/stage-9-ai-render/`](./plans/stage-9-ai-render/) | 📐 Planned |
| 10 | 3D renderer (Three.js / WebGL — read-only) | ✅ |
| 11 F11.1 | Animated-livestock foundation — ECS world + six procedural fish archetypes wiggling in place. See [`plans/stage-11-animated-livestock.md`](./plans/stage-11-animated-livestock.md). | ✅ |
| 11 F11.2 | Schooling + vertical stratification — Couzin three-zone schooling, depth bands, turn-rate-clamped steering; catalog manifest schemaVersion 2 → 3 to host the optional `behavior` block. | ✅ |
| 11 F11.3 | Territoriality + fin-nipping + hiding/timid — bourgeois owner-wins cave defense with fatigue, group-threshold-suppressed nipping, fear-driven REFUGE mode + nearest-cover refuge. Catalog `HardscapeEntry.coverScore?` + livestock `behavior.{territory,nipping,fear}`. | ✅ |
| 11 F11.4 | Feeding + grazing + curiosity — hunger drive, six FeedingCategory branches (surface/midwater/substrate/algae-grazer/plant-eater/detritivore), algae score on hardscape (decays under rasping, regrows over sim-time), boldness-gated Poisson glass-surfing, transient food sprites from a "Feed tank" UI button. | ✅ |
| 11 F11.5–F11.7 | Flow field + hardscape SDF + bubbles (F11.5), per-species presets + perf budget (F11.6), ambient polish — water surface, day-night, plant sway (F11.7). [Research bibliography](./docs/research/stage-11-livestock-subsystem.md). | 📐 Planned |
| 12 | Release pipeline — `pnpm release <version>`, electron-builder installers, GitHub Releases. Version scheme + first-release tag are an open decision (tracked inside the plan + a forthcoming ADR-0005); the script ships scheme-agnostic. See [`plans/stage-12-release-pipeline.md`](./plans/stage-12-release-pipeline.md). | 📐 Planned |

---

## Architecture (the load-bearing decisions)

See [`CLAUDE.md`](./CLAUDE.md) for the full set of invariants and the catalog of caveats. Highlights:

- **One scene model, two renderers.** `domain/scene-model` is framework-free. `renderer-2d` ships now; `renderer-3d` (Three.js, Stage 10) drops in over the same `SceneRenderer` interface and the _same_ canonical 3D coordinates already stored in `.aqua` documents. This is the abstraction the plan's payoff is bet on.
- **Every mutation is a `Command`** with `apply` / `invert`. Undo/redo, persistence, and future collaboration all build on this single primitive — the UI never mutates the scene directly.
- **One feature codebase, two apps.** Features depend on `platform-api` (interface) — never a concrete platform. `apps/web` injects `platform-web`; `apps/desktop` injects `platform-electron`. The same Angular feature libs power both shells.
- **Layering is mechanical.** Nx tags in every `project.json` + `@nx/enforce-module-boundaries` enforce plan §2.2. A `features/*` lib that tries to import `platform-electron` fails `nx lint`.

### The `.aqua` document format

The v1 format lives in [`libs/domain/document/`](./libs/domain/document/): canonical TypeScript types in [`src/aqua-document.ts`](./libs/domain/document/src/aqua-document.ts) and the JSON Schema mirror in [`src/schema/aqua-document.schema.json`](./libs/domain/document/src/schema/aqua-document.schema.json). The worked Iwagumi example at the repo root in [`example.aqua.json`](./example.aqua.json) is the canonical fixture for round-trip tests. The on-disk container is a ZIP (`document.json` + `assets/` + optional `thumbnail.png`); asset-free documents may ship as bare JSON with the `.aqua` extension — readers sniff for ZIP magic and accept both. **v1 is locked**: any future format change requires a `Migration` entry in `AQUA_MIGRATIONS` and a fast-check round-trip test in `libs/testing` that exercises the new step.

---

## Project layout

```
apps/
  web/             Angular SPA/PWA — the browser app
  desktop/         Electron main + preload — the desktop app
libs/
  domain/          Framework-free pure logic
    catalog/       Substrates, hardscape, plants, livestock, equipment data
    document/      `.aqua` v1 schema, validator, migrations, marshal
    fish-anatomy/  Six procedural fish archetype geometry generators (Stage 11 F11.1)
    geometry/      Vec2/3, transforms, hit-test, snap helpers
    growth-sim/    Deterministic plant-growth math
    livestock-behaviors/  Schooling/Depth/Animation param types + per-group presets + resolveBehavior (Stage 11 F11.2)
    livestock-ecs/ bitECS world + Perception/Schooling/Depth/SteeringIntegrator/Kinematic/Animation systems + ParamStore (Stage 11 F11.1+F11.2)
    scene-model/   Scene/Layer/Object types + Command pipeline + history
    stocking/      Stocking-guidance rules engine (F7.2)
  rendering/
    renderer-api/  The `SceneRenderer` interface contract
    renderer-2d/   Canvas2D implementation (editing surface)
    renderer-3d/   Three.js implementation (read-only 3D view, Stage 10)
    livestock-renderer-3d/  InstancedMesh-per-archetype + carangiform shader (Stage 11 F11.1)
  features/        Angular feature libs (one per tool / panel)
  platform/        platform-api interface + platform-web + platform-electron
  state/           NgRx scene / document / selection slices
  ui/              Shared presentational components (populated as features need it)
  testing/         fast-check arbitraries + the round-trip property suite
tools/             Workspace tooling (scaffold, icons, packaging, validators)
docs/
  decisions/       Architectural Decision Records (ADRs)
  caveats/         Area-specific load-bearing gotchas (load by topic)
```

<details>
<summary><strong>Detailed implementation notes per lib</strong> (click to expand)</summary>

The libs below all ship today. Empty placeholders: `libs/ui/`, `apps/desktop-e2e/`.

#### Domain (framework-free pure logic)

- `libs/domain/geometry/` — Vec2/3, Transform, AABB, hit-test, golden-ratio + thirds, snap helpers. Adds `sampleCatmullRom(points, samples)` (centripetal Catmull-Rom — interpolates through every control point, no cusps on clustered points) and `seededHash01(seed, ...keys)` (deterministic uint32 → `[0, 1)`, used by the substrate renderer's grain noise).
- `libs/domain/scene-model/` — `Scene`/`Layer`/`SceneObject` types + plain discriminated-union `Command` records + bounded immutable `History`. Commands: layer CRUD/reorder, object add/remove/move/reshape, composite, `SetTankDimensions` (with object position clamping + restore-on-undo envelope), `SetTankStyle` (whole-style replacement with hex / gradient validation), substrate region CRUD + profile, livestock add/remove/quantity, equipment add/remove/note/settings. All invertible; UI dispatches one command per commit cycle so undo/redo matches user expectations.
- `libs/domain/document/` — canonical `.aqua` v1 schema (`aqua-document.ts` + `schema/aqua-document.schema.json`), `validateAquaDocument` (AJV 2020 + `ajv-formats`, compiled once at module load), `Migration` chain (`runMigrations` + empty `AQUA_MIGRATIONS` baseline), ZIP container (`packAquaDocument`/`loadAquaDocument` via `fflate` — magic-sniffs `PK\x03\x04` so bare-JSON `.aqua` files also load), and `documentToScene`/`sceneToDocument` marshaling. Livestock + equipment live on `Scene` so commands operate on them; `renderHistory` + `extensions` ride the envelope verbatim so load → edit → save never drops what the editor doesn't model.
- `libs/domain/catalog/` — content catalog. Type-agnostic `CatalogEntry` discriminated union over `substrate`/`hardscape`/`plant`/`livestock`/`equipment` under a single JSON Schema `oneOf`. `validateCatalogEntry` (AJV), `loadCatalog(entries)` returning `{ catalog, errors, warnings }` (invalid entries surfaced — never silently dropped; duplicate `(catalog, id)` pairs reported as warnings, first one wins), and a bundled `coreCatalog` constant built from per-entry JSON manifests at `src/data/<kind>/*.json`.
- `libs/domain/growth-sim/` (F4.4) — deterministic plant growth math. `plantScale({weeksToMature, sizeAtZero}, {ageWeeks, vigor}, previewAgeWeeks?)` returns a scale multiplier via a logistic approach to maturity. `scatterInPolygon(polygon, density, seed)` produces a deterministic stratified-grid + Mulberry32 jitter point list; given the same inputs across machines and runs, identical output.
- `libs/domain/stocking/` (Stage 7 F7.2) — pure rules engine over livestock-equipped scenes. `evaluateStocking(scene, catalog)` returns a deterministic `StockingWarning[]` (`severity: 'info' | 'warning' | 'error'`, `code`, `message`, `explanation`, `relatedEntryIds`). Six independent rules: bioload vs. tank litres (weighted body-cm heuristic, tiers info/warning/error at 1.0 / 1.5 / 2.5 cm-per-L); temperature range intersection; pH range intersection; peaceful + aggressive temperament clash; per-species `quantity < schoolingMin`; fin-nipper present with a long-finned target (currently betta only — `LONG_FINNED_CATALOG_IDS` is the exported allow-list to extend cheaply).

#### Rendering

- `libs/rendering/renderer-api/` + `libs/rendering/renderer-2d/` — `SceneRenderer` interface + `Canvas2DRenderer`. Paint order: **backdrop photo** → **wall background** → tank background → grid → tank outline → **substrate** → water tint → frame overlay → **hardscape silhouettes** → **plants** → **composition overlays** → **snap alignment guides** → **selection handles**. `hitTest` is fully wired with handle-beats-body when a selection is supplied. F5.3 overlays accept an `OverlayOptions` parameter on `render()` only (not `hitTest` — they are non-interactive); the call is a true no-op when omitted or when every flag is false. Idempotent, DPR-aware, listener-clean on dispose.
- `libs/rendering/renderer-3d/` (Stage 10) — `Three3DRenderer` implements the same `SceneRenderer` interface against Three.js + WebGL. Per-element scene builders (`tank-mesh.ts` for the glass box + frame styling, `substrate-mesh.ts` extruding the profile, `hardscape-mesh.ts` + `plant-mesh.ts` extruding the catalog silhouettes, `lighting.ts` for ambient + directional, `camera.ts` for the framed perspective view). OrbitControls binds to the canvas for orbit / zoom / pan. `hitTest` returns `null` (read-only — no selection or editing in 3D). `Viewport` is 2D-only and the 3D renderer ignores it; OrbitControls is the camera source of truth. Idempotent + leak-safe — the rebuild path disposes prior geometries + materials before swapping.

#### Platform

- `libs/platform/platform-api/` — framework-free interfaces + Angular `InjectionToken` sub-entry (`FileService` / `DialogService` / `StorageService` / `RenderExportService`).
- `libs/platform/platform-web/` — capability-detected bundles: `FileSystemAccessFileService` (Chromium) → `FallbackFileService` (Safari/Firefox; `<input type=file>` + `<a download>`), `IndexedDbStorageService` → `InMemoryStorageService`, `BrowserDialogService` (`<dialog>`) → `StubDialogService`, `BrowserDownloadRenderExportService` (`<a download>` + Blob URL).
- `libs/platform/platform-electron/` — service classes wrapping an `ElectronTransport` seam. `createIpcTransport(bridge)` forwards every method to `window.aquascape.ipc.*`; `createInMemoryTransport()` for tests.

#### State (NgRx)

- `libs/state/scene/` — generic `dispatchCommand` → effect → `applyCommandSucceeded({ scene, history })`, `commandRejected({ reason, message })`, undo/redo, metadata-only `setTankPresetRef`, plus `setScene` (resets history; used by Open / New / Recover). Selectors include `selectStockingWarnings` (runs the F7.2 rules engine over the live scene + bundled catalog).
- `libs/state/document/` — identity + dirty tracking + recent files + autosave-draft surface. Effects own all platform IO (open / save / save-as / new / mark-dirty / autosave-debounced-3s / draft-recovery / discard / recent-files persist) and dispatch `SceneActions.setScene` alongside `DocumentActions.documentOpened` to keep both stores consistent without coupling.
- `libs/state/selection/` — `{ ids: ObjectId[] }` transient editor state. A side effect observes `SceneActions.setScene` and clears the selection so opening a new document doesn't carry stale ids forward.

#### Apps

- `apps/web/` — Angular 18 standalone shell, `OnPush`, `ResizeObserver`-driven redraw. Runtime `selectPlatform()` binds `platform-api` tokens to `platform-electron` (with the real IPC transport) under Electron, `platform-web` (capability-detected) in the browser. Three-row layout: `aquascape-editor-shell` toolbar + (sidebar | canvas | rail) grid driven by CSS variables `--sidebar-width` / `--rail-width`. Pure layout helpers live in `apps/web/src/app/shell-layout.ts` (100% covered). Below 768 px the side panels become slide-in drawer overlays; between 768–1199 px the right rail default-collapses; ≥ 1200 px is the full layout.
- `apps/desktop/` — Electron main + sandboxed preload + shared IPC contract. `buildWebPreferences()` is the security-flag source of truth (unit-tested literally, field-by-field). Main-process backends wire native `dialog.show{Open,Save}Dialog`, `fs.promises.{read,write}File`, and a `app.getPath('userData')`-rooted JSON KV store. Every payload is validated main-process side; offending values are never echoed back through error messages.

#### Feature libs

- `libs/features/tank-setup/` — preset picker (36 entries across ADA / UNS / Waterbox / standard sizes) + custom W×H×D form + frame/water-tint/background styling subpanel.
- `libs/features/substrate-tool/` (F2.2) — side-panel numeric editor for substrate regions (material, fromX/toX/blend, profile-point list with insert-midpoint).
- `libs/features/hardscape-tool/` (F3.1 + F3.2) — side-panel hardscape browser with category filter, paginated tile grid, pointer-drag onto canvas via `HardscapeDragService`.
- `libs/features/planting-tool/` (F4.1 + F4.5) — side-panel plant browser mirroring hardscape, zone filter, paginated tiles, carpet drops produce implicit 16-sided scatter patch centred on cursor.
- `libs/features/layers-panel/` (F4.2) — right-rail panel with visibility/lock toggles, inline rename, opacity slider, reorder buttons, delete.
- `libs/features/templates/` (F5.1 + F5.2) — four built-in starter templates as fully-validated `AquaDocument`s + `TemplatesService` (personal-templates store capped at 32, persisted under `aquascape.templates.personal`) + `TemplateBrowserComponent` modal.
- `libs/features/export/` (F6.1 + F6.2 + F7.4) — pure helpers for image export (`renderSceneToImageBytes` → offscreen `Canvas2DRenderer` → PNG/JPEG `Uint8Array` via `canvas.toBlob`) + layout summary (`summarizeScene` + Markdown/JSON formatters; F7.4 adds livestock + equipment + stocking-warnings sections that auto-omit when empty) + `computeVolumeBreakdown` (gross / substrate / water; L + US gal via trapezoid integration).
- `libs/features/livestock-equipment/` (F7.1 + F7.2 + F7.3) — two sibling components. `LivestockToolComponent`: paginated tile browser + inventory list with +/− quantity controls + inline stocking-warnings section with tap-to-expand explanations + severity-coloured borders + ARIA `alert`/`status` roles. `EquipmentToolComponent`: paginated tile browser + inventory list with inline `<input>` notes (save on blur, empty trims to `null`) + per-row "▾ Settings" expand showing read-only `<dl>`. Both feed through the Command pipeline for undo/redo.
- `libs/features/editor-shell/` — composition root for the toolbar (New/Open/Save/Save As + Recent + autosave-recovery banner + error banner), the floating selection inspector (Mirror H/V, Duplicate, Z-up/down, Delete + keyboard shortcuts), the time slider (F4.4 — `PreviewTimeService`), the composition-overlay accordion (F5.3 — `OverlayOptionsService`), the zoom control + viewport service (F5.x — cursor-anchored Cmd/Ctrl+wheel zoom, 10–1000%), the wall-background accordion (F5.x — `WallBackgroundService`), the snap-settings accordion (F5.4 — `SnapOptionsService`), the templates modal (F5.1+F5.2), the export dialog (F6.1+F6.2), and the backdrop accordion (F6.3 — `BackdropService`).

#### Infrastructure

- `tools/` — workspace tooling: `scaffold-libs.cjs`, `validate-example.mjs` + `validate-catalog.mjs` (AJV CLIs), `build-icons.mjs` (`pnpm icons` — rasterizes `apps/web/src/favicon.svg` into every desktop + PWA size via `sharp` + `png-to-ico` + `iconutil`), `restart-desktop.sh` (`pnpm restart:desktop`), `package-desktop.sh` (`pnpm package:desktop` — stages Nx outputs into a flat tree, patches resolver paths, hands off to `electron-builder` for DMG/NSIS/AppImage).
- `docs/decisions/` — foundational ADRs (Electron tooling, pnpm, Jest coverage, Nx Cloud deferral).
- `docs/caveats/` — area-specific load-bearing gotchas extracted from `CLAUDE.md` so contributors (and Claude) only load what's relevant. See `docs/caveats/README.md` for the index + load triggers.
- `plans/` — per-feature implementation plans (one `F<X.Y>` file per feature, grouped by stage).
- `.claude/` — project sub-agent definitions (`scene-model-engineer`, `renderer-engineer`, `electron-platform-engineer`, etc.) + team playbooks.
- `.github/workflows/` — PR workflow with three jobs (nx affected lint + test + build; coverage gate across every implemented lib with `--configuration=ci`; document-round-trip job). Main workflow re-runs everything across the Ubuntu / macOS / Windows matrix.

</details>

---

## Contributing & docs

- **The spec:** [`aquascape-development-plan.md`](./aquascape-development-plan.md) — Stages 0–10 roadmap, architectural decisions, feature traceability. Stages 11 + 12 are extension plans living under [`plans/`](./plans/).
- **Working on the codebase:** [`CLAUDE.md`](./CLAUDE.md) carries architecture invariants, the Definition of Done, dev commands, and a table mapping each `docs/caveats/*.md` file to its load trigger so you only pull in the gotchas relevant to your area.
- **Architecture decisions:** [`docs/decisions/`](./docs/decisions/) — the foundational ADRs.
- **Area gotchas:** [`docs/caveats/`](./docs/caveats/) — when a change touches `libs/domain/document/`, load `docs/caveats/document-format.md`; when it touches `libs/rendering/renderer-2d/`, load `docs/caveats/renderer-2d.md`; etc.

CI runs `nx affected -t lint test build` plus a per-lib coverage gate, a real-browser Playwright e2e job (chromium, cached binaries, asserts a fish actually paints in 3D), and the `document-round-trip` property suite — on every PR. The full OS matrix runs on every push to `main`. The `document-round-trip` job is required — a format/loader regression fails the PR.

---

## License

MIT.
