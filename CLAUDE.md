# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**Stages 0–7 + Stage 10 v1 complete.** Stage 10 v1: Three.js `renderer-3d` lib implementing the existing `SceneRenderer` interface (read-only / simulation-only — `hitTest` returns null in 3D, no selection or editing); `ViewModeService` + toolbar `ViewToggleComponent` (segmented 2D | 3D pill, Cmd/Ctrl+Shift+3 keyboard shortcut); `apps/web` hosts two stacked `<canvas>` elements (one per context type — a single canvas can only have one context for its lifetime) with a renderer-swap effect that disposes the prior renderer + attaches the now-active one on mode change. **Next:** Stage 10 follow-ups (dynamic lighting / day-night cycle, water simulation, animated plants + livestock sprites with composited behaviors) or Stages 8 (community gallery) + 9 (AI render) if other priorities surface.

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
- The stage roadmap is sequenced deliberately. Stages 0–4 are the critical path to v1.0 (shipped). Stages 5–6 round out v1.x. Stages 7–10 are parallelizable once the scene model + platform abstraction stabilize.

## Claude Code workflow for this repo

Nine project-level sub-agents in `.claude/agents/` (one per architectural area: `aqua-document-guardian`, `scene-model-engineer`, `renderer-engineer`, `nx-workspace-engineer`, `angular-feature-engineer`, `electron-platform-engineer`, `catalog-engineer`, `growth-sim-engineer`, `test-engineer`). Each encodes the load-bearing constraints from the plan for its slice and pushes back rather than silently violating them. Invoke with `Task(subagent_type=<name>, …)`.

Agent teams are enabled via `.claude/settings.json` (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`); the reproducible artifact is the kickoff prompt in `.claude/team-playbooks/`.

**Default to sub-agents.** Reach for a team only when 3+ specialist areas must negotiate a fresh contract at the same time (Stage 4 planting+growth, Stage 9 AI render providers, Stage 10 3D-renderer adoption).
