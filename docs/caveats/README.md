# Load-bearing caveats — index

This directory holds the gotchas that bite future contributors. They were
once one long section in [`../../CLAUDE.md`](../../CLAUDE.md); they were
extracted so Claude (and humans) can load only what's relevant to the area
they're touching.

**Cardinal rule:** the codebase tells you *what shipped*; these files tell
you *why a non-obvious decision sticks*. Add to them when a contributor
trips on something a reasonable reader couldn't have predicted.

## How to use

Each file is a flat bullet list. Lead each file with a 1-sentence "Load
this when…" trigger; subsequent bullets are independent invariants /
policies / gotchas.

When working on a slice of the codebase, load the file(s) that match the
area you're touching. Cross-cutting features (e.g. a new command that
adds a view-only overlay) need multiple files — load all of them.

## Files

| File | Load when working on… |
|---|---|
| [`document-format.md`](document-format.md) | Anything in `libs/domain/document/`, schema changes, migrations, AJV regeneration, marshal between `Scene` and `AquaDocument`. |
| [`scene-model.md`](scene-model.md) | Adding `Command`s, scene/layer/object mutations, undo/redo, the lock-guard policy. |
| [`geometry.md`](geometry.md) | Pure geometry math — transform composition, Catmull-Rom sampling, seeded hashing. |
| [`renderer-2d.md`](renderer-2d.md) | `libs/rendering/renderer-2d/` — paint order, hit-test, selection handles, view-only overlay integration. |
| [`renderer-3d.md`](renderer-3d.md) | `libs/rendering/renderer-3d/` (Stage 10) — Three.js scene builders, OrbitControls, dispose discipline, the 2D ↔ 3D toggle + canvas pair. |
| [`growth-sim.md`](growth-sim.md) | `libs/domain/growth-sim/` — plant growth curve, scatter PRNG. |
| [`state-ngrx.md`](state-ngrx.md) | `libs/state/` — actions, effects, selectors, autosave, recovery, `provideMockStore` testing. |
| [`platform.md`](platform.md) | `libs/platform/*` or `apps/desktop/` — `platform-api` services, IPC contract, capability detection, dev-server race. |
| [`app-shell.md`](app-shell.md) | `apps/web/src/app/` — composition root, drag state machine, sidebar layout, viewport zoom, per-panel collapse, view-only services (overlays / wall / snap / backdrop / templates / export). |
| [`catalog.md`](catalog.md) | `libs/domain/catalog/` — adding entry kinds, schema branches, manifest authoring discipline. |
| [`stage-7-livestock-equipment.md`](stage-7-livestock-equipment.md) | `libs/features/livestock-equipment/`, `libs/domain/stocking/`, or any livestock / equipment command — F7.1 / F7.2 / F7.3. |
| [`livestock-ecs.md`](livestock-ecs.md) | `libs/domain/livestock-ecs/`, `libs/domain/fish-anatomy/`, `libs/domain/livestock-behaviors/`, `libs/rendering/livestock-renderer-3d/`, `apps/web/src/app/livestock-simulation.service.ts` — Stage 11 ECS world, ParamStore + tankAabb, sim-vs-render rate, determinism rules, Couzin three-zone schooling, system ordering. |
| [`e2e.md`](e2e.md) | `apps/web-e2e/`, `apps/web/src/app/debug-hook.ts`, the e2e CI job — Playwright config + dev-server race, debug-hook contract, variance/diff floors, browser cache strategy. |
| [`build-test.md`](build-test.md) | New lib scaffolding, Jest coverage gates, CI selectors, packaging (`pnpm package:desktop`), icons pipeline, app-name + version display, userData path. |
