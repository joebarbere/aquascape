# Glossary

> **Load this when:** you hit a term you don't know — hobby jargon, a
> codebase type, a rendering technique, or a tooling name. Terms are
> grouped by area; use your browser/editor search (Ctrl/Cmd+F) for direct
> lookup.

**Jump to:**
[Aquascaping & hobby](#aquascaping--hobby-terms) ·
[Document & data model](#document--data-model) ·
[Editor & UI](#editor--ui) ·
[Rendering](#rendering) ·
[Livestock simulation](#livestock-simulation) ·
[Workspace & tooling](#workspace--tooling)

---

## Aquascaping & hobby terms

| Term | Meaning |
| --- | --- |
| **Aquascaping** | The craft of arranging plants, rocks, wood, and substrate in an aquarium into a deliberate composition. The thing this app helps you design. |
| **Bioload** | The waste burden livestock place on a tank's filtration. The stocking rules use a weighted body-length heuristic per litre. |
| **Carpet plant** | A low foreground plant (e.g. Monte Carlo, dwarf hairgrass) that spreads into a lawn. Placed in this app via the carpet brush, which scatter-plants a patch. |
| **CO₂ injection** | Pressurized carbon-dioxide dosing for plant growth. An equipment category in the catalog. |
| **Detritivore** | A bottom-dweller that eats detritus (shrimp, snails). One of the six feeding categories in the simulation. |
| **Dutch style** | A dense, plant-focused aquascaping style with terraced "streets" of contrasting species. One of the built-in templates. |
| **Fin-nipper** | A species (e.g. tiger barb) prone to biting tankmates' long fins. Flagged by the stocking rules; simulated in 3D. |
| **Decor** | Manufactured ornaments (treasure chest, sunken galleon, skull, …) as opposed to natural hardscape. `DecorEntry` in the catalog (with a required `.glb` model ref), `DecorObject` (`kind: 'decor'`) in the scene; paints as a silhouette in 2D and loads its baked GLB model in 3D. |
| **Hardscape** | The non-living structure of a scape: rocks and wood. |
| **Iwagumi** | A minimalist Japanese style built around an odd-numbered rock arrangement, typically with a single carpet species. A built-in template, and the worked `example.aqua.json`. |
| **Photoperiod** | The daily duration a tank light runs. Catalog lights can carry `photoperiodHours`; the day-night cycle's "equipment" mode reads it. |
| **Rimless / framed / braced** | Tank construction styles: bare glass edges; a plastic rim; or a rim plus a centre cross-brace. A `TankStyle` choice. |
| **Schooling / shoaling** | Coordinated group swimming. Species have a `schoolingMin` — keeping fewer stresses the fish, which both the stocking rules and the fear simulation reflect. |
| **Scape** | Shorthand for an aquascape — one design, one `.aqua` document. |
| **Substrate** | The floor material — aquasoil, sand, gravel. Sculpted in this app as regions with an elevation profile. |
| **Temperament** | A livestock catalog classification (peaceful / semi-aggressive / aggressive) used by the stocking rules. |
| **Zone (foreground / midground / background)** | Depth bands of the tank, front to back. Plants are classified by zone; layers can be assigned a zone for 3D depth remapping. |

## Document & data model

| Term | Meaning |
| --- | --- |
| **`.aqua`** | The document format: one file = one design. A ZIP container (`document.json` + `assets/` + optional `thumbnail.png`) or bare JSON; readers sniff ZIP magic. See [architecture/document-format.md](architecture/document-format.md). |
| **`AquaDocument`** | The TypeScript type of a parsed `.aqua` file — the on-disk envelope (`meta`, tank, layers, livestock, equipment, `seed`, `extensions`, …). |
| **`AQUA_MIGRATIONS`** | The ordered chain of pure `Migration` steps (`{ from, to, migrate }`) that upgrades old documents to `CURRENT_SCHEMA_VERSION`. |
| **AJV** | The JSON-Schema validator library used for runtime validation of documents and catalog manifests (validators precompiled via `pnpm precompile:validators`). |
| **Canonical coordinates** | The one shared space: right-handed 3D **millimetres**, origin at the tank's front-bottom-left interior corner, +x right / +y up / +z back. 2D projects along −z. |
| **Canonical units** | Millimetres, integers preferred. cm/inches/gallons are display-only conversions. |
| **`Catalog` / `CatalogEntry`** | The typed content database (substrates, hardscape, plants, livestock, equipment) loaded from per-entry JSON manifests. See [architecture/catalog.md](architecture/catalog.md). |
| **`CatalogRef`** | `{ catalog, id, version }` — how a scene object points at a catalog entry. Catalog data is never inlined into documents. |
| **`Command`** | A plain, serializable, invertible record describing one scene mutation. The single mutation primitive — undo/redo and persistence build on it. See [architecture/scene-model-and-commands.md](architecture/scene-model-and-commands.md). |
| **`CommandResult`** | What `applyCommand` returns: `{ ok: true, scene }` or a typed rejection (`locked` / `not-found` / `invalid`). |
| **`CompositeCommand`** | A command whose children apply in order and invert in reverse, atomically — one undo step for a multi-part gesture. |
| **`coverScore`** | A hardscape entry's value as a fish refuge (0–1). Loader defaults: wood 0.6, rock 0.4. Fear-stricken fish flee to the nearest entry with `coverScore > 0`. |
| **`effectiveWaterLevelMm()`** | The single waterline source of truth: the authored `Tank.waterLevelMm` clamped to the tank, else tank height − 25 mm (`DEFAULT_WATER_GAP_BELOW_RIM_MM`). Consumed by the 3D water plane, the 2D tint band, and the simulation's ceiling. |
| **`extensions`** | The forward-compatibility bag on the document envelope — readers preserve fields they don't understand. |
| **`History`** | The bounded immutable undo/redo stack (default 200 entries) pairing each applied command with its inverse. |
| **`Layer`** | An ordered group of scene objects with visibility, lock, opacity, optional zone. |
| **Marshal** | `documentToScene` / `sceneToDocument` — the lossless translation between the on-disk `AquaDocument` and the in-memory `Scene`. |
| **`Migration`** | A pure, total function upgrading a document one schema version. Never invents values for optional fields. |
| **Round-trip test** | The property-based suite (fast-check, `libs/testing`) proving save → load → save loses nothing. Required CI job on every PR. |
| **`Scene`** | The in-memory model: `Tank` + ordered `Layer`s + substrate + livestock + equipment + `seed`. The heart of the app. |
| **`SceneObject`** | One placed thing (hardscape / plant / …): id, `CatalogRef`, `Transform`, optional `groupId`. |
| **`schemaVersion`** | The integer that drives the migration chain. Currently **3** for `.aqua`; the catalog manifest schema is also at 3 (independent counters). |
| **`seed`** | The document-level entropy source. Everything random-looking (scatter, growth jitter, fish spawns, sway phase) derives from it, so a document reproduces identically everywhere. |
| **`TankStyle`** | Frame style + water tint + background of the tank. |
| **`Transform`** | Position (mm), rotation, scale, flips for a scene object. |

## Editor & UI

| Term | Meaning |
| --- | --- |
| **Autosave draft** | The crash-recovery copy persisted 3 s (debounced) after any edit, surfaced as a recovery banner on next launch. |
| **Carpet brush** | The planting-tool gesture that drops a scatter patch (a 16-sided polygon of seeded plant instances) instead of a single specimen. |
| **Composition overlays** | View-only guides: golden ratio, rule of thirds, focal-point markers. |
| **Dirty (document)** | Has unsaved changes. Tracked in the document slice; drives the title asterisk and save prompts. |
| **Drag readout** | The little pill showing live numbers during a gesture: `X, Y mm` move, `% × %` scale, `°` rotate. |
| **Editor shell** | `libs/features/editor-shell/` — the toolbar, selection inspector, time slider, zoom control, and the accordion panels' composition root. |
| **Feature lib** | An Angular library implementing one tool or panel (`tank-setup`, `substrate-tool`, `planting-tool`, `layers-panel`, `templates`, `export`, `livestock-equipment`, `editor-shell`). |
| **Marquee** | Shift-drag multi-select rectangle (centre-in-rect semantics). |
| **NgRx** | The Redux-style state library. Three slices: scene, document, selection. See [architecture/state-management.md](architecture/state-management.md). |
| **Personal template** | A user-saved template (max 32) stored via `StorageService`, alongside the four built-ins. |
| **Profile curve** | The substrate's front-to-back elevation line, edited as control points and rendered through Catmull-Rom sampling. |
| **Selection inspector** | The floating panel over a selection: Mirror H/V, Duplicate, Z-order, Delete. |
| **Setup sheet** | The Markdown/JSON export summarizing tank, volumes, plants, hardscape, livestock, equipment, and stocking warnings. |
| **Snap guides** | Magenta alignment lines shown while dragging when grid/guide/object snapping engages. |
| **Stocking warnings** | The six explainable rule results from `domain/stocking` (`info` / `warning` / `error`), live in the livestock panel and the setup sheet. |
| **Time slider** | Scrubs `previewAgeWeeks` 0–52 to preview deterministic plant growth, in 2D and 3D. |
| **View mode** | 2D or 3D, toggled in the toolbar or `Cmd/Ctrl+Shift+3`. A per-user UI preference — never saved into the document. |

## Rendering

| Term | Meaning |
| --- | --- |
| **Caustics** | The dancing light patterns water focuses onto surfaces. Procedurally generated in the 3D fragment shaders (floor + water surface), faded at night. |
| **Catmull-Rom** | The spline used to draw smooth substrate silhouettes through every control point (centripetal variant — no cusps). |
| **Day-night lookup** | A 4-keypoint ramp (midnight/dawn/noon/dusk → ambient colour, key intensity, background tint, plant emissive) passed via `RenderOptions.dayNightLookup`. |
| **Dispose discipline** | The rule that every Three.js geometry/material/texture attached must be explicitly `.dispose()`d — Three.js leaks otherwise. |
| **EffectComposer** | Three.js post-processing pipeline: RenderPass → UnrealBloomPass → OutputPass. |
| **Hit-test** | `hitTest(point, scene, viewport)` → the topmost object (or selection handle) under a point. Fully wired in 2D; always `null` in 3D (read-only). |
| **IBL (image-based lighting)** | Lighting from an environment texture (here a deterministic gradient, PMREM-filtered) so PBR materials have something to reflect. |
| **`InstancedMesh`** | One draw call rendering many copies of a geometry with per-instance transforms/attributes. How all fish, food sprites, and bubbles render. |
| **`onBeforeCompile` patch** | Injecting GLSL into a built-in Three.js material's shader. Caustics, grain, stone noise, sway, and catalog textures chain through it — every patch must chain the previous one. |
| **Paint order** | The fixed back-to-front pass sequence of the 2D renderer (backdrop → … → selection handles). |
| **PBR (physically-based rendering)** | Material model using albedo/normal/roughness; the catalog texture pack feeds it. |
| **PMREM** | Prefiltered Mipmapped Radiance Environment Map — the GPU-baked form of the IBL environment. |
| **Render-target capability gate** | `getRenderTargetEffectsSupported()` — detects software WebGL / missing depth textures so multi-pass effects (SSAO, refraction) self-disable instead of blanking the canvas. |
| **`RenderOptions`** | The options-object parameter of `render()` — catalog, selection, preview age, overlays, livestock world, flow field, day-night lookup, texture base URL. Every field optional, off when omitted. |
| **`RenderSurface`** | What `attach()` receives: the canvas + DPR + logical size. |
| **`SceneRenderer`** | The interface (`attach` / `render` / `hitTest` / `dispose`) both renderers implement. See [architecture/rendering.md](architecture/rendering.md). |
| **SSAO** | Screen-space ambient occlusion. Attempted, backed out (blanks under SwiftShader), now a TODO gated behind real-GPU validation. |
| **SwiftShader** | Chromium's software (CPU) WebGL implementation — what headless CI rendering runs on. Needs special launch flags; can't run depth/MRT-heavy passes. |
| **Tone mapping (ACES filmic)** | The HDR→display curve applied once via OutputPass; rolls off highlights instead of clipping. |
| **Triplanar mapping** | Sampling a texture along all three world axes blended by the surface normal — no UVs needed; used for catalog textures. |
| **`Viewport`** | The 2D framing (`center` mm, `zoom` px/mm, `rotation`). Ignored by the 3D renderer (OrbitControls owns its camera). |
| **X-mirror (doc→world)** | The `scale.x = −1` group transform reconciling the document's +Z-back convention with Three.js's +Z-toward-viewer. Don't remove it. |
| **16-attribute budget** | ANGLE/SwiftShader's `MAX_VERTEX_ATTRIBS` limit; the livestock shader sits exactly at it, so new per-vertex data must ride existing channels (fin type is packed into `spineUv.y`). |

## Livestock simulation

| Term | Meaning |
| --- | --- |
| **Archetype** | One of 7 procedural fish body shapes (slim-tetra, deep-bodied, barb, cory-cylinder, eel, hatchet-wedge, crawler). Each gets one `InstancedMesh`; species map to archetypes by catalog group. |
| **`BehaviorMode`** | Per-fish state — FORAGE / REFUGE / PURSUE — used for priority arbitration between behaviour systems. |
| **bitECS** | The entity-component-system library backing the world. Structure-of-arrays components, module-global entity ids. |
| **Carangiform** | The body-and-tail wave most fish swim with — implemented as a vertex-shader displacement along the spine. |
| **Couzin three-zone model** | Schooling as concentric zones: repulsion (ZOR), orientation (ZOO), attraction (ZOA), with a blind cone behind the fish. |
| **ECS** | Entity-Component-System: entities are ids, components are data arrays, systems are functions over component queries — fast and allocation-free. |
| **Fixed-dt accumulator** | The pattern decoupling the 30 Hz simulation from the 60 Hz render loop (max 4 catch-up steps; interpolated snapshots between ticks). |
| **`FlowField`** | The 32³ divergence-free water-current grid baked from filter outflow/intake positions (`domain/fluid-sim`). Drags fish and scales plant sway. |
| **`HardscapeSdf`** | The 64³ signed-distance field (sphere-union) of the hardscape, used to deflect fish off rocks. |
| **`LivestockSimulationService`** | The `apps/web` service that owns the world across view toggles, resolves behaviours, bakes fields, and re-spawns on `spawnKey` change. |
| **`NO_ENTITY_REF`** | `0xffffffff` — the "no anchor / no refuge" sentinel. Entity id 0 is valid, so never use 0 as "none". |
| **`ParamStore`** | One behaviour-param row per registered *species* on the world; fish carry only a handle index. |
| **Perception / SpatialGrid** | The first system each tick rebuilds a uniform spatial hash so neighbour queries are O(cell) instead of O(n). |
| **Predator** | A catalog-flagged fish (the angelfish) that prey fear and flee via proximity risk. |
| **`resolveBehavior()`** | Merges per-group presets (TOP/MID/BOTTOM) with optional per-species catalog overrides into a `ResolvedBehavior`. |
| **`spawnIndex`** | The stable, monotonic per-spawn counter used as the PRNG key instead of the unstable bitECS eid. |
| **`spawnKey`** | The service's fingerprint of (seed, livestock, hardscape, equipment) — any change triggers a deterministic re-spawn. |
| **Startle wave** | Fear propagating to neighbours with distance attenuation, applied next tick — panic ripples through a school instead of flashing. |
| **Tick PRNG** | `seededHash01(seed ⊕ tickCounter ⊕ keys)` — the in-simulation noise source. `Math.random()` is banned. |
| **`WorldSnapshot`** | The pooled typed-array view of the world (`position`, `orientation`, `phase`, `archetype`, `scale`, `color`, food + bubble slabs) — the only thing the renderer sees. |

## Workspace & tooling

| Term | Meaning |
| --- | --- |
| **ADR** | Architectural Decision Record — a one-time decision with context and consequences, in [`docs/decisions/`](decisions/). |
| **Affected graph** | Nx's change-detection: PR CI runs lint/test/build only for projects affected by the diff. |
| **Caveat file** | A per-area list of load-bearing gotchas in [`docs/caveats/`](caveats/), each led by a "Load this when…" trigger. Treat doc drift like a failing test. |
| **Composition root** | The app component/bootstrap that wires concrete platforms, renderers, and store — `apps/web/src/app/`. |
| **Coverage gate** | Per-lib Jest thresholds enforced by `--configuration=ci` (domain libs ≥ 90 %). |
| **Debug hook** | `window.__aquascape_debug__` — the read-only, dev-only handle e2e tests use (entity count, scene, view mode). |
| **DoD (Definition of Done)** | Typed API · unit tests · a UI-level test · docs entry · accessibility · README/CLAUDE/caveats updated in the same PR. |
| **Module boundaries** | `@nx/enforce-module-boundaries` lint rules driven by project tags — the mechanical enforcement of the layer diagram. |
| **Monorepo** | One repository holding all apps + libs, orchestrated by **Nx** (task running, caching, dependency graph). |
| **Playwright** | The browser-automation framework behind `apps/web-e2e` and the demo recorder; runs WebGL headlessly via SwiftShader. |
| **pnpm** | The package manager (pinned via `package.json#packageManager`; enable with `corepack enable`). |
| **Sub-agents** | The `.claude/agents/` definitions (one per architectural area) used when developing with Claude Code. |
