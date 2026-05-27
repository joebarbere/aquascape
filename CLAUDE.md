# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**Stages 0–7 + Stage 10 complete; Stage 11 F11.1–F11.6 shipped; `.aqua` document schema is at version 2, catalog manifest schemaVersion is at 3.** Stage 10 (3D renderer): Three.js `renderer-3d` lib implementing the existing `SceneRenderer` interface (read-only / simulation-only — `hitTest` returns null in 3D, no selection or editing); `ViewModeService` + toolbar `ViewToggleComponent` (segmented 2D | 3D pill, Cmd/Ctrl+Shift+3 keyboard shortcut); `apps/web` hosts two stacked `<canvas>` elements (one per context type — a single canvas can only have one context for its lifetime) with a renderer-swap effect that disposes the prior renderer + attaches the now-active one on mode change. A follow-up commit landed the `.aqua` schema bump (v1 → v2) that adds optional `Layer.zone` ('foreground' | 'midground' | 'background'); the 3D renderer reads it to band-remap object Z into front/mid/back thirds of the tank, clamps hardscape + plant positions so their AABB stays inside the glass, and applies deterministic per-vertex noise to hardscape so rocks read as irregular rather than flat-extruded slabs. Layers panel gains a per-row zone dropdown that dispatches the `SetLayerZone` command. **Stage 11 F11.1** added three new libs — `libs/domain/livestock-ecs/` (bitECS world + components + Kinematic/Animation systems + 30 Hz fixed-dt scheduler + spatial-grid scaffold), `libs/domain/fish-anatomy/` (six procedural archetype geometry generators: slim-tetra / deep-bodied / barb / cory-cylinder / eel / hatchet-wedge), `libs/rendering/livestock-renderer-3d/` (one InstancedMesh per archetype + carangiform tail-beat vertex shader) — plus `apps/web/src/app/livestock-simulation.service.ts` which owns the bitECS world across 2D↔3D toggles and deterministically respawns from `scene.seed`. Three3DRenderer's RAF tick gained the fixed-dt accumulator + `WorldSnapshot` → `InstancedBufferAttribute` sync; `RenderOptions.livestockWorld` is the optional contract surface. **Stage 11 F11.2** added `libs/domain/livestock-behaviors/` (the single source of truth for `SchoolingParams` / `DepthParams` / `AnimationParams` + `TOP_PRESET` / `MID_PRESET` / `BOTTOM_PRESET` + `resolveBehavior()`); extended `livestock-ecs` with Perception → Schooling → Depth → SteeringIntegrator systems running before Kinematic, a `ParamStore` on the world (one row per registered species, not per entity), and tank-AABB awareness (`setTankAabb` on the world; DepthSystem reads `tankHeight` from it); KinematicSystem now integrates non-zero Velocity and clamps to the AABB. Catalog schema bumped 2 → 3 to add the optional `LivestockEntry.behavior` block (additive — v2 manifests load unchanged via preset defaults). The `LivestockSimulationService` now resolves behaviour per unique species and registers each with the world; the renderer is unchanged (WorldSnapshot shape is stable). The visible result: tetras school, hatchetfish hug the surface, cories scoot along the substrate. **Stage 11 F11.3** added three more systems running before Schooling: FearSystem (risk-driven FORAGE↔REFUGE mode flip + nearest-cover refuge selection per species `coverPreference`), NippingSystem (group-threshold-suppressed nip attempts at long-finned slow-swimming victims with a 2s cooldown), TerritorialSystem (bourgeois owner-wins chase with fatigue decay over 5–15s). Priority arbitration runs through `BehaviorMode`: FearSystem may flip FORAGE → REFUGE; Nip/Territory set PURSUE for one tick; Schooling skips when mode ≠ FORAGE so the dominant force isn't diluted. A new `Hardscape` tag component + `world.registerHardscape(...)` API lets the world see refuges (rock/wood/other) and lets `spawnFish` auto-pick the nearest hardscape within `2·coreRadius` as the Territory anchor at spawn time. `NO_ENTITY_REF = 0xffffffff` is the "no anchor / no refuge" sentinel (eid 0 is a valid bitECS allocation). `LivestockSimulationService` extended to walk `scene.layers[].objects` for `kind: 'hardscape'`, register the loaded catalog rows' `coverScore` + `category` with the world before spawn, and the `spawnKey` fingerprint extended to fire re-spawn on hardscape mutations. Catalog gained optional `LivestockEntry.behavior.{territory,nipping,fear}` + `HardscapeEntry.coverScore?` (loader fills default by category: wood→0.6, rock→0.4, other→0). **One planned stage continues**: [`plans/stage-11-animated-livestock.md`](plans/stage-11-animated-livestock.md) (Stage 11 — F11.3 territoriality + nipping + fear, F11.4 feeding + grazing + curiosity, F11.5 flow field + hardscape SDF + bubbles, F11.6 per-species presets + perf budget, F11.7 ambient polish (water surface, day-night, plant sway); anchored by [`docs/research/stage-11-livestock-subsystem.md`](docs/research/stage-11-livestock-subsystem.md)). [`plans/stage-12-release-pipeline.md`](plans/stage-12-release-pipeline.md) (Stage 12 — `pnpm release <version>`, electron-builder installers, GitHub-published releases) is also queued; the script is scheme-agnostic — the version scheme is an open decision tracked inside the plan, ADR-0005 lands when the maintainer settles on it. **Stage 11 F11.5** added a new domain lib `libs/domain/fluid-sim/` (`bakeFlowField` → 32³ divergence-free `FlowField`; `bakeHardscapeSdf` → 64³ sphere-union `HardscapeSdf`; `createBubbleSlice` + `stepBubbleSlice` for a Stam 1999 advect/diffuse/project loop that's wired but unused in F11.5 — saved for a fidelity pass), extended `livestock-ecs` with two more systems (FlowFieldSystem between Depth and SteeringIntegrator → trilinear-samples the field, adds drag-coupled force; CollisionSystem between SteeringIntegrator and Kinematic → SDF deflect + tangent project plus fish-vs-fish separation via the F11.2 SpatialGrid), a `BubbleParticle` tag with `bubbleSourceSpawnSystem` (per-source debt accumulator, global cap 200) + `bubbleLifetimeSystem` (rise at 150 mm/s, despawn at waterline). New world API: `registerFlowField` / `registerHardscapeSdf` / `registerBubbleSources` / `getBubbleParticleCount`. `WorldSnapshot` additively gained `bubbleCount` + `bubblePosition` slabs sorted by `(sourceEid, spawnSeq)` to keep cross-world determinism (eids are bitECS module-globals — raw iteration order would break the 1000-tick byte-identical replay). The renderer's `LivestockMeshBundle` got an 8th `InstancedMesh` for bubble billboards (smaller than food sprites, blue-white with off-centre highlight). Catalog `EquipmentEntry` gained optional `flow?: { outflowPos, outflowVec, intakePos, flowRate }` (filters) + `airRateMl?: number` (air-stones); schemaVersion stays at 3. `LivestockSimulationService` walks `scene.equipment` to build `FlowSource[]` + bubble source list, calls `bakeFlowField` + `bakeHardscapeSdf` from the loaded catalog rows, registers everything with the world before spawn; `spawnKey` extended so equipment mutations re-fire the rebuild. e2e gained an air-stone test that asserts `getBubbleParticleCount > 0` after adding the Aquaneat sponge filter — 6/6 Playwright tests green. **Stage 11 F11.6** rounded out the behaviour layer: 16 new livestock catalog rows (cardinal tetra, ember tetra, harlequin rasbora, cherry barb, tiger barb, marbled hatchetfish, dwarf + pearl gourami, angelfish, discus, German blue ram, kuhli loach, bronze cory, otocinclus, bristlenose + common pleco) bringing total livestock to 24; each new row exercises a different branch of the F11.2–F11.4 heuristic-resolution pipeline (tiger barb fires explicit nipping; cherry barb fires `nipping: null` opt-out; angelfish + ram fire territory; kuhli + oto + pleco fire feeding / curiosity substring heuristics). A new 7th procedural archetype `FISH_ARCHETYPE.CRAWLER = 6` (stubby ovoid body + antennae, no fins) covers shrimp + snails; `archetypeForSpecies` routes them automatically; the renderer zeroes the carangiform amp per crawler instance + `kinematicSystem` clamps crawler Y velocity to ±5 mm/sec so they stay glued to the substrate. A dev-only `BehaviorDebugOverlayComponent` (gated by `isDevMode()` + `Ctrl/Cmd+Shift+D` chord OR `?debug-behavior=1` query param) polls the simulation service at ~15 Hz and renders a corner panel listing each fish's archetype + `BehaviorMode` + territory anchor + refuge eid — useful for QA + the curious. A `BENCH=1`-gated perf benchmark (`libs/domain/livestock-ecs/src/lib/perf-bench.spec.ts`) measures p95 tick time at n=200 fish with the full F11.5 stack — **3.43 ms** on Apple Silicon, comfortably inside the **4 ms** budget with ~14 % headroom; no optimisation work was needed (the F11.5-era SoA + SpatialGrid + pre-allocated scratch buffers already hit the target). **Long-overdue infrastructure also landed:** `apps/web-e2e/` is no longer a Stage-0 `nx:noop` placeholder. Real Playwright (chromium) drives `nx serve web` end-to-end, asserting that a 3D fish actually paints — pixel-channel variance + frame-diff floors prove a non-blank, animating canvas; entity counts come from a read-only `window.__aquascape_debug__` debug hook gated by Angular's `isDevMode()`. Hooked into both `pr.yml` (nx-affected, cached chromium binaries) and `main.yml` (full OS matrix, Playwright install added). The `docs/caveats/livestock-ecs.md` coverage gap is closed; F11.3+ visible-behaviour specs extend the same Playwright suite. See [`docs/caveats/e2e.md`](docs/caveats/e2e.md). **Next:** Stage 11 F11.7 (ambient polish — animated water surface, dynamic lighting / day-night cycle, plant sway), Stage 12 (release pipeline once a version scheme is chosen), or Stages 8 (community gallery) + 9 (AI render) if other priorities surface.

`README.md` carries the long-form story of what shipped; this file only mentions the *next* concrete thing.

Planning artifacts (repo root or `libs/domain/document/src/`): `aquascape-development-plan.md` (the spec — 11-stage roadmap), `aqua-document.ts`, `aqua-document.schema.json`, `example.aqua.json` (canonical fixture for `document-round-trip.spec.ts`). Foundational ADRs in `docs/decisions/0001–0004`.

## What this project is

Open-source aquascaping design tool. Hobbyists pick a tank, sculpt substrate, place hardscape, plant flora in layers, preview the result. Ships as **both** an Angular web SPA/PWA and an Electron desktop app from one Nx monorepo; the desktop build is fully offline-capable.

Differentiators vs. Scape It / MyAquariumBuilder / Aquasketcher: deterministic plant **growth simulation** over time (Stage 4 — shipped), composite layouts onto real tank photos (Stage 6), dual **local + hosted** AI render providers behind one interface (Stage 9), **Three.js 3D renderer** consuming the same document as the 2D renderer (Stage 10).

## Architecture — non-negotiable invariants

These are the load-bearing decisions. Don't deviate without re-opening the plan.

### Layer boundaries (enforced via Nx `@nx/enforce-module-boundaries`)

- `domain/*` libs are **framework-free**: no Angular, no DOM, no Electron, no NgRx. Pure TypeScript only. This is what makes the 3D renderer and headless tooling drop in later. `domain/*` depends only on other `domain/*`.
- `rendering/*` depends only on `domain/scene-model` + `domain/geometry`.
- `features/*` may depend on `domain/*`, `rendering/*`, `ui`, `state`, `platform-api` (interface, never a concrete platform).
- `apps/*` compose `features/*`, `ui`, `state`, and inject a concrete `platform-web` or `platform-electron`.

### The scene model is the heart of the app

`domain/scene-model`: `Scene` → ordered `Layer`s → `SceneObject`s (hardscape / plant / substrate). **Every mutation is a `Command`** with `apply` / `invert`. Undo/redo, persistence, and future collaboration build on this single primitive. UI events become NgRx actions which produce Commands which apply to the Scene — the UI **never** mutates the scene directly.

### One scene model, two renderers

`renderer-2d` (canvas) ships now; `renderer-3d` (Three.js / WebGL, Stage 10) drops in over the **same** `SceneRenderer` interface and the **same** canonical 3D coordinates already stored in `.aqua` documents. Features depend on `renderer-api`, never a concrete renderer.

### Platform abstraction

`platform-api` defines `FileService`, `DialogService`, `StorageService`, `RenderExportService`. `platform-web` binds to File System Access API + IndexedDB. `platform-electron` binds to IPC into the main process. Features only ever see the interface — that's why one set of feature libs powers both apps.

### The `.aqua` document format (the format rules)

`aqua-document.ts` is the **single source of truth**; `aqua-document.schema.json` mirrors it for AJV runtime validation. **Both must be updated together.**

- **Canonical units = millimetres** (integers preferred). cm/in are display-only.
- **Canonical coordinates** = one right-handed 3D space, origin at the tank's front-bottom-left interior corner (+x right, +y up, +z back). 2D projects along −z; 3D consumes the same coordinates.
- **Catalog by reference**: objects carry `CatalogRef` (`catalog` + `id` + `version`), never inlined catalog data.
- **Plain serializable data**: no class instances, no functions. `JSON.parse(JSON.stringify(doc))` must be lossless.
- **Versioned + migratable**: `schemaVersion` drives a pure, total `Migration` chain.
- **Forward-compatible**: an `extensions` bag + optional per-object fields mean older readers preserve unknown data.
- **Container**: on-disk `.aqua` is a ZIP (`document.json` + `assets/` + optional `thumbnail.png`); asset-free docs may be bare JSON, readers sniff for ZIP magic.
- **Reproducibility**: a document-level `seed` makes scatter planting, growth jitter, and AI renders deterministic.

### Electron security posture

Context isolation **on**, sandbox **on**, no `nodeIntegration` in renderer, all native access through a typed preload bridge, validated IPC, CSP enforced. Hosted AI provider keys live in OS secure storage / Electron main only — they must never reach the renderer process or get serialized into a document.

## Definition of Done

Typed public API · unit tests · at least one component or e2e test through the UI · docs entry · accessible (keyboard + ARIA) interaction · **`README.md` + `CLAUDE.md` + relevant `docs/caveats/*.md` updated in the same PR**. Domain libs target ≥ 90 % coverage; pure logic (geometry, growth-sim, commands, document migrations, stocking) is exhaustively tested.

## Documentation discipline

Treat documentation drift like a failing test. After a feature lands, refresh the right surface — bundled into the feature's last commit, or as a trailing `docs:` commit.

- **`README.md`** carries: status line, "Implemented so far" bullets (move stubs out of "Empty placeholders" when bodies land), document-format additions, shared infrastructure, quick-start commands, license, project pitch.
- **`CLAUDE.md`** (this file) carries: status line + the *next* concrete thing, architecture invariants, DoD, dev commands, sub-agent workflow, and a **pointer to `docs/caveats/`** for area-specific gotchas. Keep it short — anything that bites only when working on a specific area belongs in the matching caveat file.
- **`docs/caveats/<area>.md`** carries: the load-bearing gotchas / invariants / policies / default constants for a single area. Each file leads with a 1-sentence "Load this when…" trigger so future readers know whether to pull it into context.
- **`docs/decisions/<NNNN>-<slug>.md`** carries: ADRs — one-time architectural decisions with context, options, and consequences.

When a feature lands a new gotcha, add it to the matching `docs/caveats/*.md`. When that creates a new area (new lib, new cross-cutting concern), add a new caveat file AND a row in the table below.

## Load-bearing caveats — area index

Detailed gotchas live in [`docs/caveats/`](docs/caveats/). Load the file(s) for the area you're touching; cross-cutting work needs multiple. Trust but verify — gotchas list is current; the codebase tells you what shipped.

| File | Load when working on… |
|---|---|
| [`docs/caveats/document-format.md`](docs/caveats/document-format.md) | `libs/domain/document/`, schema changes, migrations, AJV regen, marshal between `Scene` and `AquaDocument`. |
| [`docs/caveats/scene-model.md`](docs/caveats/scene-model.md) | Adding `Command`s, scene/layer/object mutations, undo/redo, the lock-guard policy. |
| [`docs/caveats/geometry.md`](docs/caveats/geometry.md) | Pure geometry math — transform composition, Catmull-Rom sampling, seeded hashing. |
| [`docs/caveats/renderer-2d.md`](docs/caveats/renderer-2d.md) | `libs/rendering/renderer-2d/` — paint order, hit-test, selection handles, view-only overlay slots. |
| [`docs/caveats/renderer-3d.md`](docs/caveats/renderer-3d.md) | `libs/rendering/renderer-3d/` (Stage 10) — Three.js scene builders, OrbitControls, dispose discipline, the 2D ↔ 3D toggle + canvas pair. |
| [`docs/caveats/growth-sim.md`](docs/caveats/growth-sim.md) | `libs/domain/growth-sim/` — plant growth curve, scatter PRNG. |
| [`docs/caveats/state-ngrx.md`](docs/caveats/state-ngrx.md) | `libs/state/` — actions, effects, selectors, autosave, recovery, `provideMockStore` testing. |
| [`docs/caveats/platform.md`](docs/caveats/platform.md) | `libs/platform/*`, IPC contract, capability detection, dev-server race. |
| [`docs/caveats/app-shell.md`](docs/caveats/app-shell.md) | `apps/web/src/app/` — composition root, drag state, sidebar layout, viewport zoom, per-panel collapse, view-only services (overlays / wall / snap / backdrop / templates / export). |
| [`docs/caveats/catalog.md`](docs/caveats/catalog.md) | `libs/domain/catalog/` — adding entry kinds, schema branches, manifest authoring. |
| [`docs/caveats/stage-7-livestock-equipment.md`](docs/caveats/stage-7-livestock-equipment.md) | `libs/features/livestock-equipment/`, `libs/domain/stocking/`, livestock / equipment commands — F7.1 / F7.2 / F7.3. |
| [`docs/caveats/livestock-ecs.md`](docs/caveats/livestock-ecs.md) | Stage 11 ECS — `libs/domain/livestock-ecs/`, `libs/domain/fish-anatomy/`, `libs/domain/livestock-behaviors/`, `libs/rendering/livestock-renderer-3d/`, the `LivestockSimulationService` in `apps/web`. ParamStore + tankAabb, Couzin three-zone schooling, sim 30 Hz / render 60 Hz with accumulator + interpolation, determinism rules, system ordering. |
| [`docs/caveats/e2e.md`](docs/caveats/e2e.md) | `apps/web-e2e/`, `apps/web/src/app/debug-hook.ts`, the e2e CI job — Playwright config + dev-server race, debug-hook contract, variance/diff floors, browser cache strategy. |
| [`docs/caveats/build-test.md`](docs/caveats/build-test.md) | New lib scaffolding, Jest coverage gates, CI selectors, `pnpm package:desktop`, icons, app-name / userData path on desktop. |

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
pnpm exec nx serve desktop                   # web dev-server + Electron (see platform caveat re: race)
pnpm exec nx run desktop:serve-electron      # Electron only (assumes nx serve web is already up)
pnpm exec nx build desktop                   # → dist/apps/desktop/{main,preload}/
```

CI workflows in `.github/workflows/`:

- `pr.yml` — `nx affected -t lint test build` + the explicit coverage-gate job (runs `--configuration=ci` across `tag:scope:domain,scope:rendering,scope:platform-web,scope:platform-electron,scope:state` + each implemented `features-*` lib by name) + the `document-round-trip` job (`nx test testing -t document-round-trip`). Linux only. When a new feature lib lands, add it to the workflow selector.
- `main.yml` — full `nx run-many` across the ubuntu / macos / windows matrix.

The `document-round-trip` job is REQUIRED on main — a format/loader regression fails the PR.

## Working with the planning artifacts

- Treat `aquascape-development-plan.md` as the spec. If a request conflicts with it, surface the conflict instead of silently deviating.
- When changing the document format: follow the v1-locked checklist in [`docs/caveats/document-format.md`](docs/caveats/document-format.md).
- The stage roadmap is sequenced deliberately. Stages 0–4 are the critical-path foundation (shipped). Stages 5–6 round out the editor surface. Stages 7–12 are parallelizable once the scene model + platform abstraction stabilize.

## Claude Code workflow for this repo

Nine project-level sub-agents in `.claude/agents/` (one per architectural area: `aqua-document-guardian`, `scene-model-engineer`, `renderer-engineer`, `nx-workspace-engineer`, `angular-feature-engineer`, `electron-platform-engineer`, `catalog-engineer`, `growth-sim-engineer`, `test-engineer`). Each encodes the load-bearing constraints from the plan for its slice and pushes back rather than silently violating them. Invoke with `Task(subagent_type=<name>, …)`.

Agent teams are enabled via `.claude/settings.json` (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`); the reproducible artifact is the kickoff prompt in `.claude/team-playbooks/`.

**Default to sub-agents.** Reach for a team only when 3+ specialist areas must negotiate a fresh contract at the same time (Stage 4 planting+growth, Stage 9 AI render providers, Stage 10 3D-renderer adoption).
