# Aquascape — Open Source Aquascaping Software

**Development Plan & Roadmap**

An open-source aquascaping design tool built with TypeScript and Angular in an Nx monorepo, shipping as both a web application and a cross-platform Electron desktop application. This document defines the architecture, the staged development plan, and detailed feature requirements with a testing strategy at every milestone.

---

## 1. Vision & Scope

Aquascape lets hobbyists design planted-tank and hardscape layouts visually. A user picks a tank, shapes substrate, drags in hardscape (rocks, driftwood), plants flora in layers, and previews the result. The project consolidates the best features observed across existing tools (Scape It, MyAquariumBuilder, Aquasketcher) into a single FOSS application, plus genuinely differentiating capabilities (true layered growth simulation, optional 3D, offline-first desktop).

### Design principles

- **Offline-first.** The desktop (Electron) build must be fully usable with no network. The web build degrades gracefully.
- **Data-driven content.** Tanks, substrates, hardscape, and plants are catalog data, not hardcoded — community can extend via JSON manifests.
- **Rendering-engine agnostic.** The scene model is decoupled from the renderer so a 2D canvas renderer and a later 3D (WebGL) renderer share one source of truth.
- **Deterministic + serializable.** Any layout serializes to a versioned document format (`.aqua`) that round-trips losslessly.
- **Testable by construction.** Pure domain logic in framework-free libraries; thin Angular shell.

---

## 2. Architecture

### 2.1 Monorepo (Nx)

Nx is chosen over a bare npm/pnpm workspace for its dependency graph, affected-test computation, generators, and first-class Angular + Electron support.

```
aquascape/
├── apps/
│   ├── web/                 # Angular web application (SPA / PWA)
│   ├── web-e2e/             # Playwright e2e for web
│   ├── desktop/             # Electron main + preload process
│   └── desktop-e2e/         # Playwright + Electron e2e
├── libs/
│   ├── domain/
│   │   ├── scene-model/     # Pure TS: entities, scene graph, commands
│   │   ├── document/        # .aqua schema, (de)serialization, migrations
│   │   ├── catalog/         # Tank/substrate/hardscape/plant data models + loaders
│   │   ├── growth-sim/      # Plant growth simulation engine (pure TS)
│   │   └── geometry/        # Vectors, transforms, hit-testing, golden-ratio helpers
│   ├── rendering/
│   │   ├── renderer-api/    # Renderer interface (draw scene -> surface)
│   │   ├── renderer-2d/     # Canvas/2D implementation
│   │   └── renderer-3d/     # Three.js (WebGL) implementation (later stage)
│   ├── features/            # Angular feature libs (editor, catalog browser, gallery…)
│   │   ├── editor-shell/
│   │   ├── tank-setup/
│   │   ├── substrate-tool/
│   │   ├── hardscape-tool/
│   │   ├── planting-tool/
│   │   ├── layers-panel/
│   │   ├── templates/
│   │   ├── export/
│   │   └── livestock-equipment/
│   ├── ui/                  # Presentational component library (design system)
│   ├── state/               # NgRx feature stores, selectors, effects
│   ├── platform/            # Platform abstraction (file IO, dialogs, storage)
│   │   ├── platform-api/    # Interface only
│   │   ├── platform-web/    # Browser implementation (File System Access, IndexedDB)
│   │   └── platform-electron/ # IPC-backed implementation
│   └── testing/             # Test harnesses, fixtures, builders, mocks
└── tools/                   # Nx generators, scripts, catalog build pipeline
```

### 2.2 Layering & dependency rules

Enforced with Nx module boundary tags (`@nx/enforce-module-boundaries`):

- `apps/*` may depend on `features/*`, `ui`, `state`, `platform-*`.
- `features/*` may depend on `domain/*`, `rendering/*`, `ui`, `state`, `platform-api`.
- `domain/*` depends only on other `domain/*` libs. **No Angular, no DOM, no Electron.** This keeps the core unit-testable and reusable in the 3D renderer and in headless tooling.
- `rendering/*` depends on `domain/scene-model` + `domain/geometry` only.
- `platform-api` is an interface library; concrete `platform-web` / `platform-electron` are injected at the app composition root.

### 2.3 The scene model (heart of the app)

A framework-free, immutable-friendly scene graph in `domain/scene-model`:

- **`Scene`** — root: tank, substrate, ordered list of `Layer`s, metadata.
- **`Layer`** — a z-ordered grouping (e.g. "background rocks", "midground plants"). Carries opacity, lock, visibility.
- **`SceneObject`** — base for `HardscapeObject`, `PlantObject`, `SubstanceObject`. Has transform (position, rotation, scale, flip), `catalogRef`, and per-type props.
- **Commands** — every mutation is a `Command` (`AddObject`, `MoveObject`, `Reshape­Substrate`, `SetLayerOrder`…) with `apply`/`invert`, enabling a robust **undo/redo** stack independent of the UI and the renderer.

State flows: **UI event → NgRx action → Command created → applied to Scene → new Scene in store → renderer re-draws.** Because commands are pure and invertible, undo/redo, persistence, and (later) collaboration all build on the same primitive.

### 2.4 Rendering abstraction

```ts
interface SceneRenderer {
  attach(surface: RenderSurface): void;
  render(scene: Scene, viewport: Viewport): void;
  hitTest(point: Vec2, scene: Scene): HitResult | null;
  dispose(): void;
}
```

`renderer-2d` implements this over an HTML canvas. `renderer-3d` later implements the same interface over WebGL. Features depend on `renderer-api`, never a concrete renderer, so the editor can switch renderers at runtime.

### 2.5 Platform abstraction

`platform-api` defines `FileService`, `DialogService`, `StorageService`, `RenderExportService`. The web app binds these to the File System Access API + IndexedDB; Electron binds them to IPC calls into the main process (native file dialogs, `fs`, OS integration). Features only ever see the interface, so the same feature libraries power both apps.

### 2.6 State management

NgRx for app state (open document, selection, tool mode, catalog cache, UI prefs). The authoritative _document_ state is the `Scene`; NgRx holds it plus ephemeral editor state. Selectors are memoized; effects handle async (catalog loading, file IO, autosave).

### 2.7 Document format (`.aqua`) — schema v1 drafted

`domain/document` owns the format. The full v1 schema now exists as three artifacts shipped alongside this plan:

- **`aqua-document.ts`** — the canonical, framework-free TypeScript definition (the source of truth).
- **`aqua-document.schema.json`** — a JSON Schema (Draft 2020-12) for runtime validation on load.
- **`example.aqua.json`** — a worked Iwagumi document, validated against the schema.

Key format decisions:

- **Canonical units = millimetres** (integers preferred). cm/in is display-only, so round-trips are exact.
- **Canonical coordinates** are a single right-handed 3D space (origin at the tank's front-bottom-left interior corner; +x right, +y up, +z back). The 2D renderer projects along −z; the Three.js 3D renderer consumes the _same_ coordinates. This is the concrete mechanism that lets Stage 10 add 3D without changing the document.
- **Catalog by reference** — objects carry a `CatalogRef` (`catalog` + `id` + `version`), never inlined catalog data, so documents stay small and portable and the community catalog can evolve independently.
- **Everything is plain serializable data** — no class instances, so `JSON.parse(JSON.stringify(doc))` is lossless.
- **Versioned + migratable** — a `schemaVersion` field drives a pure, total `Migration` chain (`from`→`to`) applied on load.
- **Forward-compatible** — an `extensions` bag and per-object optional fields mean older readers preserve unknown data rather than dropping it.
- **Container** — the on-disk `.aqua` file is a ZIP holding `document.json`, an `assets/` directory (imported tank photos, AI renders), and an optional `thumbnail.png`. Asset-free documents may be saved as bare JSON with the `.aqua` extension; readers sniff for ZIP magic and accept both.
- **Reproducibility** — a document-level `seed` (plus optional per-scatter seed) makes scatter planting, growth jitter, and AI renders deterministic.
- **AI render history** lives in the document as `renderHistory[]`, each record tagging whether a `local` or `hosted` provider produced it, the resolved request (prompt/seed/source), and the result asset.

---

## 3. Tooling & Quality Gates

- **Language/UI:** TypeScript (strict), Angular (standalone components, signals where sensible), Nx.
- **State:** NgRx.
- **3D:** Three.js for the `renderer-3d` library (Stage 10).
- **AI render:** dual `RenderProvider` implementations — a local/self-hosted model and a hosted bring-your-own-key API — behind one interface (Stage 9).
- **Desktop:** Electron with context isolation, no `nodeIntegration` in renderer, all native access via a typed preload bridge.
- **Unit tests:** Jest across all libs. Domain libs target ≥90% coverage; the pure logic (geometry, growth-sim, commands, document migrations) is exhaustively tested.
- **Component tests:** Angular Testing Library + Jest for feature/ui libs.
- **E2E:** Playwright for web; Playwright-Electron for desktop. Each milestone ships e2e specs that exercise the milestone's user-facing flows end to end.
- **CI:** `nx affected` for lint/test/build on PRs; full matrix (Linux/macOS/Windows) on main. Coverage gate, module-boundary lint, and a "document round-trip" contract test block merges on failure.
- **Definition of Done (every feature):** typed public API, unit tests, at least one component or e2e test through the UI, docs entry, accessible (keyboard + ARIA) interaction.

---

## 4. Staged Roadmap

Each stage ends with a demoable milestone. Features map back to the source-tool capabilities: tank setup, substrate shaping, drag-and-drop hardscape (+ categories, mirror), layered planting with growth, templates, precision guidelines, export, livestock/equipment, community gallery, AI render, and 3D.

---

### Stage 0 — Foundation & Walking Skeleton

**Goal:** An empty editor renders a tank on a canvas in both web and Electron, with CI green.

**Features / work items**

- F0.1 Nx monorepo scaffold with the structure in §2.1; module-boundary tags enforced.
- F0.2 `domain/geometry`: `Vec2`, transforms, AABB, hit-test primitives, golden-ratio/rule-of-thirds helpers.
- F0.3 `domain/scene-model`: `Scene`, `Layer`, `SceneObject`, `Command` interface, undo/redo stack.
- F0.4 `renderer-api` + minimal `renderer-2d` that draws a tank rectangle and grid.
- F0.5 `platform-api` + stub `platform-web` and `platform-electron` (in-memory) implementations.
- F0.6 `apps/web` shell (canvas host) and `apps/desktop` Electron shell loading the web build with secure defaults (context isolation on, sandbox, typed preload).
- F0.7 CI pipeline: lint, unit, build, affected graph, OS matrix.

**Testing**

- Unit: geometry math; command apply/invert; undo/redo ordering.
- E2E (web + electron): app boots, a tank is visible, window/IPC handshake works on desktop.

**Milestone:** "Blank tank renders everywhere, CI enforces architecture."

---

### Stage 1 — Tank Setup & Document Lifecycle

**Goal:** Create, save, open, and re-open a layout document.

**Features / work items**

- F1.1 **Tank size selection** — standard presets (Mini-M, common ADA/standard sizes) **and** custom dimensions (W×H×D in cm/in, unit toggle). _(mirrors Scape It tank setup)_
- F1.2 Tank glass/visual styling (frame, water tint, background color).
- F1.3 `domain/document` implements the **drafted `.aqua` v1 schema** (see `aqua-document.ts` / `aqua-document.schema.json`): typed model, JSON-Schema validation on load, `schemaVersion`, ZIP container read/write, and the `Migration` chain scaffold (v1 is the baseline).
- F1.4 New / Open / Save / Save As via `platform` (File System Access on web, native dialogs on Electron).
- F1.5 Autosave + crash-recovery draft (IndexedDB / userData).
- F1.6 NgRx `document` store: dirty tracking, recent files.

**Feature requirements (detail)**

- Custom dimensions validated (min/max, aspect sanity); changing tank size never corrupts placed objects (they clamp/scale per documented rule).
- Save must be lossless: open(save(scene)) deeply equals scene.
- Unit toggle (cm/in) is display-only; storage is canonical (mm).

**Testing**

- Unit: schema validation; migration no-op v1→v1; cm/in conversion; document round-trip property test (random scenes).
- Component: tank-setup form validation and presets.
- E2E: create custom tank → save → reopen → identical; autosave recovers after simulated crash.

**Milestone:** "Create and persist a tank in web and desktop."

---

### Stage 2 — Substrate Tool

**Goal:** Shape and style the substrate bed.

**Features / work items**

- F2.1 **Substrate types** (soil, sand, gravel) as catalog entries with textures/colors. _(mirrors Scape It substrate)_
- F2.2 **Substrate shaping** — editable height profile (control-point curve / heightline) so users sculpt slopes and terraces.
- F2.3 Multiple substrate bands/regions with blending.
- F2.4 Catalog loader (`domain/catalog`) reads substrate manifest JSON; first community-extensible content type.

**Feature requirements**

- Profile editing via draggable control points with snapping and undo per edit.
- Substrate persists in `.aqua`; renderer draws it beneath all layers.
- Catalog manifests validated against a JSON schema; invalid entries surfaced, not silently dropped.

**Testing**

- Unit: profile curve math; manifest schema validation; serialization of substrate regions.
- Component: substrate tool interactions (add/move/remove control point).
- E2E: sculpt a slope, save, reopen — profile preserved.

**Milestone:** "Sculpt and persist substrate."

---

### Stage 3 — Hardscape Tool

**Goal:** Drag-and-drop rocks and driftwood with full manipulation.

**Features / work items**

- F3.1 **Drag-and-drop placement** of hardscape from a palette onto the canvas. _(Scape It / Aquasketcher)_
- F3.2 **Hardscape categories** (rocks: Seiryu, Ryuoh…; driftwood: spiderwood, manzanita…) with filterable browser. _(Scape It 3.0)_
- F3.3 Transform handles: move, rotate, scale, **mirror/flip button**. _(Scape It 3.0 mirror)_
- F3.4 Per-object z-position within a layer; duplicate; delete.
- F3.5 Hardscape catalog manifest + thumbnails; community-addable.

**Feature requirements**

- Hit-testing respects rendered shape bounds; selection shows handles; multi-select with marquee.
- Mirror flips horizontally about the object's center without moving it.
- All transforms are commands (undoable) and serialized exactly.

**Testing**

- Unit: transform/mirror math; hit-test; command invert for each transform.
- Component: palette filtering by category; handle drag emits correct commands.
- E2E: drag two rocks, mirror one, scale another, undo/redo chain, save/reopen identical.

**Milestone:** "Compose a hardscape layout."

---

### Stage 4 — Layers & Planting Tool

**Goal:** The signature planted-tank workflow with layered growth.

**Features / work items**

- F4.1 **Plant placement** from a categorized plant catalog (foreground/midground/background, lighting/difficulty metadata). _(Scape It planting)_
- F4.2 **Layers panel** — create/reorder/rename layers, opacity, lock, visibility. _(Scape It layer tool)_
- F4.3 **Grouping** plants and "grow into each other" blending within a layer. _(Scape It)_
- F4.4 **Growth simulation** (`domain/growth-sim`) — a unique differentiator: a time slider shows plants at weeks N (size/spread interpolation from catalog growth params). Pure, deterministic engine.
- F4.5 Brush/scatter placement for carpeting plants.

**Feature requirements**

- Growth-sim is a pure function `growth(plant, weeks) -> renderedSize/spread`; no randomness unless seeded (seed stored in doc for reproducibility).
- Layer reorder changes draw order deterministically; locked layers reject edits.
- Plant metadata (light/CO2/difficulty) shown in inspector for planning.

**Testing**

- Unit: growth interpolation at t=0, mid, max; seeded scatter determinism; layer reorder/lock logic.
- Component: layers panel DnD reordering; planting brush emits batched command.
- E2E: plant a carpet, group a midground cluster, drag growth slider, reorder layers, save/reopen — growth state and layer order preserved.

**Milestone:** "Plant, layer, and time-simulate a scape."

---

### Stage 5 — Templates & Precision Guides

**Goal:** Faster starts and pro-level composition aids.

**Features / work items**

- F5.1 **Template library** — load starter layouts (Iwagumi, Dutch, jungle, beginner-friendly), fully editable after load. _(Scape It templates)_
- F5.2 Save user layouts as personal templates.
- F5.3 **Guidelines & selection markers** — golden ratio, rule-of-thirds overlays, focal-point markers, alignment/snap guides, distance readouts. _(Scape It 3.0 precision)_
- F5.4 Snapping (to guides, to grid, to other objects) with toggle.

**Feature requirements**

- Templates are `.aqua` documents tagged as templates; loading one creates an untitled editable copy.
- Overlays are non-printing/non-exported view aids, toggleable, with no effect on the saved document.

**Testing**

- Unit: golden-ratio/thirds line computation for arbitrary tank sizes; snap resolution.
- Component: overlay toggles; snapping behavior.
- E2E: load a template, customize it, verify overlays don't serialize, save personal template and re-instantiate.

**Milestone:** "Start from templates and compose with precision."

---

### Stage 6 — Export & Sharing

**Goal:** Get designs out of the app.

**Features / work items**

- F6.1 **Image export** (PNG/JPEG) of the current view at chosen resolution. _(common to all tools)_
- F6.2 Export layout summary: plant list, hardscape list, **substrate/volume calc**, suggested parameters.
- F6.3 **Composite onto a real tank photo** — import a photo as a backdrop layer and place plants/hardscape over it. _(unique GIMP-style capability, made native)_
- F6.4 Share/export the `.aqua` file; PWA install (web) and packaged installers (desktop).

**Feature requirements**

- Export pipeline uses the renderer offscreen so web and desktop produce identical pixels at a given size.
- Volume calc from tank dimensions (with substrate displacement estimate) in L and gal.

**Testing**

- Unit: volume/displacement math; summary aggregation from scene.
- Component: export dialog options.
- E2E (web + electron): export PNG to disk, import a backdrop photo and place an object over it, verify file written and reopened.

**Milestone:** "Export images, parts lists, and photo composites."

---

### Stage 7 — Livestock & Equipment

**Goal:** Plan the full setup, not just the scape.

**Features / work items**

- F7.1 **Fish/livestock catalog** — add fish/shrimp/snails to the design with metadata (adult size, temperament, temp/pH range, schooling min). _(MyAquariumBuilder)_
- F7.2 **Stocking guidance** — warnings for compatibility and rough bioload vs. tank volume.
- F7.3 **Equipment browser** — filters, heaters, lights, CO2; attach to design with notes. _(MyAquariumBuilder)_
- F7.4 Generated **setup sheet** combining plants + hardscape + livestock + equipment.

**Feature requirements**

- Livestock are catalog-driven, optionally rendered as decorative sprites (excluded from "scape-only" exports).
- Compatibility/bioload checks are advisory, rule-based, and explainable (show why a warning fired).

**Testing**

- Unit: bioload/volume rules; compatibility matrix; setup-sheet aggregation.
- Component: equipment filter/browse; stocking warning display.
- E2E: add incompatible fish → warning shown; generate setup sheet → contains all sections.

**Milestone:** "Plan livestock and equipment, generate a setup sheet."

---

### Stage 8 — Community Gallery

**Goal:** Browse and share layouts (optional/online feature, gracefully absent offline).

**Features / work items**

- F8.1 **Gallery** of shared layouts with planting plan, fish list, and gear visible per tank. _(MyAquariumBuilder)_
- F8.2 Publish a layout (thumbnail render + `.aqua`) and import others' layouts to remix.
- F8.3 Backend contract defined as an interface so the FOSS project can self-host or run gallery-less.

**Feature requirements**

- Gallery is strictly optional; desktop offline build hides it cleanly behind a capability flag.
- Imported layouts open as editable copies; attribution metadata preserved.

**Testing**

- Unit: gallery API client (mocked); capability-flag gating.
- Component: gallery browse/detail.
- E2E: publish (against mock server), import, remix, save.

**Milestone:** "Discover and remix community scapes."

---

### Stage 9 — AI Photorealistic Render (local **and** hosted)

**Goal:** Turn a layout into a realistic preview, via either a local model or a hosted provider — user's choice.

**Features / work items**

- F9.1 **AI render** of the finished design, conditioned on the scene description plus a flat 2D/3D render of the layout. _(MyAquariumBuilder's standout)_
- F9.2 **Dual provider support** behind one `RenderProvider` interface:
  - **Local provider** — runs an on-device/self-hosted model (e.g. a local Stable Diffusion-class endpoint). Fully offline; the desktop build can ship/point to a local runtime. No data leaves the machine.
  - **Hosted provider** — calls a remote image API (bring-your-own-key). Multiple hosted backends are pluggable by name.
  - The user selects and configures the active provider in settings; the document's `renderHistory` records which kind produced each image.
- F9.3 Render history attached to the document (`renderHistory[]` in the schema).

**Feature requirements (detail)**

- One contract, two implementations: `RenderProvider.generate(request: RenderRequest): Promise<RenderResult>`; the editor never branches on provider kind beyond configuration.
- `RenderRequest` is built purely from the scene + the flat render asset, so it's testable without any model.
- **Local-first/offline:** with no network and no local runtime configured, the panel shows a clear "configure a provider" state rather than failing; a configured local runtime works with networking fully disabled.
- **Security:** hosted API keys live in Electron main / OS secure storage (web: session-scoped, never persisted in plaintext); keys never reach the renderer process or the document.
- Image-to-image conditioning uses the flat layout render as control input so output composition matches the design.

**Testing**

- Unit: `RenderRequest` builder from scenes; provider-selection/config logic; a fake provider implementing the interface; secure-key handling (keys absent from serialized doc).
- Component: render panel states (idle / loading / result / error / provider-not-configured); provider switcher.
- E2E: with a stub **local** provider, render fully offline → result saved to history; with a stub **hosted** provider (mock server), configure key → render → history records `kind: "hosted"`.

**Milestone:** "Generate a photorealistic preview from a layout, via local or hosted AI."

---

### Stage 10 — 3D Renderer

**Goal:** True three-dimensional hardscape composition (the Blender-tier capability, built in).

**Features / work items**

- F10.1 `renderer-3d` implementing `SceneRenderer` over **Three.js** (WebGL), consuming the _same_ scene model and the same canonical 3D coordinates already in the `.aqua` document.
- F10.2 2D⇄3D view toggle; orbit/pan/zoom camera; depth (tank front-to-back) becomes meaningful.
- F10.3 3D hardscape/plant assets with graceful fallback to billboards where no mesh exists.

**Feature requirements**

- No change to `domain/scene-model`; 3D consumes existing depth/transform data, validating the abstraction from Stage 0.
- Performance budget (target 60fps mid-tier hardware) with object-count guidance.

**Testing**

- Unit: 3D transform/projection math; scene→3D mapping.
- Component: renderer switch preserves selection and document.
- E2E: toggle to 3D, orbit, place an object, toggle back — document unchanged and consistent.

**Milestone:** "Design in 2D or 3D from one document."

---

## 5. Cross-Cutting Concerns (continuous)

- **Accessibility:** keyboard operability for all tools, ARIA on panels, focus management, reduced-motion.
- **i18n:** Angular i18n from Stage 1; English/German/Japanese parity as a stretch (matching Scape It's languages).
- **Performance:** virtualized catalog lists; renderer dirty-region redraw; web workers for growth-sim on large scenes.
- **Security (Electron):** context isolation, sandbox, CSP, typed preload bridge, no remote module, validated IPC.
- **Telemetry:** opt-in only, privacy-respecting, fully disable-able (FOSS expectation).
- **Docs:** per-feature docs and an architecture decision record (ADR) log.

---

## 6. Feature → Stage Traceability

| Source capability                           | Stage | Item      |
| ------------------------------------------- | ----- | --------- |
| Tank size: presets + custom dimensions      | 1     | F1.1      |
| Substrate types + shaping                   | 2     | F2.1–F2.2 |
| Drag-and-drop hardscape                     | 3     | F3.1      |
| Hardscape categories                        | 3     | F3.2      |
| Mirror/flip button                          | 3     | F3.3      |
| Plant placement                             | 4     | F4.1      |
| Layer tool (group / grow-into)              | 4     | F4.2–F4.3 |
| Layered growth simulation (unique)          | 4     | F4.4      |
| Templates (incl. beginner-friendly)         | 5     | F5.1      |
| Guidelines & selection markers              | 5     | F5.3      |
| Image export                                | 6     | F6.1      |
| Composite onto real tank photo (GIMP-style) | 6     | F6.3      |
| Volume/parts list                           | 6     | F6.2      |
| Fish/livestock + stocking                   | 7     | F7.1–F7.2 |
| Equipment browser                           | 7     | F7.3      |
| Community gallery (plan/fish/gear per tank) | 8     | F8.1      |
| AI photorealistic render (local + hosted)   | 9     | F9.1–F9.2 |
| 3D modeling (Three.js, Blender-tier)        | 10    | F10.1     |

---

## 7. Suggested Sequencing Notes

Stages 0–4 are the critical path to a genuinely useful tool and should ship as a public **v1.0** ("design a planted layout, save, export"). Stages 5–6 round out v1.x. Stages 7–10 are independent value-adds that can be parallelized once the scene model and platform abstraction have proven stable through Stage 6. The architecture's payoff is concentrated at Stage 10: if the 3D renderer drops in without touching `domain/*`, the core abstractions were correct.
