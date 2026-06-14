# Aquascape — Implementation plans

This directory decomposes `aquascape-development-plan.md` into one plan file per feature. The development plan is the **strategy**; these files are the **tactics**. Each plan is a self-contained briefing a sub-agent (or future contributor) can be pointed at without re-reading the full development plan.

## Conventions

- **One file per feature**, named `F<X.Y>-<kebab-case-slug>.md` and grouped by stage subdirectory.
- Plans are **derived from the development plan**, not authoritative over it. If the two ever disagree, `aquascape-development-plan.md` wins — open a PR to reconcile.
- Plans are **not implementation logs**. Don't write progress notes into them; the git history is the log. Update a plan only when its scope, dependencies, acceptance criteria, or test plan change.
- Later-stage plans (Stages 7+) are necessarily more skeletal — the architecture will evolve through Stages 0–6 and details will firm up as those stages land.

## Plan template

```markdown
# F<X.Y> — <Feature Name>

**Stage:** <N> — <Stage name>
**Owner:** <primary sub-agent>
**Collaborators:** <other sub-agents involved>
**Status:** Not started

## Goal

<1–2 sentences>

## Spec reference

Plan §"Stage <N>" F<X.Y>; <relevant architecture sections>.

## Dependencies

**Requires:** <upstream features>
**Enables:** <downstream features>

## Scope

**In:** <bullets>
**Out:** <deferred bullets>

## Acceptance criteria

- [ ] <testable criterion>

## Testing

- **Unit:** ...
- **Component / integration:** ...
- **E2E:** ...

## Notes

<risks, open questions>
```

## Index

### Critical path to v1.0

- **Stage 0 — Foundation & Walking Skeleton** ([dir](stage-0-foundation/))
  - [F0.1 — Nx monorepo scaffold](stage-0-foundation/F0.1-nx-monorepo-scaffold.md)
  - [F0.2 — domain/geometry](stage-0-foundation/F0.2-domain-geometry.md)
  - [F0.3 — domain/scene-model](stage-0-foundation/F0.3-domain-scene-model.md)
  - [F0.4 — renderer-api + renderer-2d](stage-0-foundation/F0.4-renderer-api-and-2d.md)
  - [F0.5 — platform-api + stubs](stage-0-foundation/F0.5-platform-api-and-stubs.md)
  - [F0.6 — App shells (web + Electron)](stage-0-foundation/F0.6-app-shells.md)
  - [F0.7 — CI pipeline](stage-0-foundation/F0.7-ci-pipeline.md)

- **Stage 1 — Tank Setup & Document Lifecycle** ([dir](stage-1-tank-and-document/))
  - [F1.1 — Tank size selection](stage-1-tank-and-document/F1.1-tank-size-selection.md)
  - [F1.2 — Tank styling](stage-1-tank-and-document/F1.2-tank-styling.md)
  - [F1.3 — Document format implementation](stage-1-tank-and-document/F1.3-document-format-implementation.md)
  - [F1.4 — File operations](stage-1-tank-and-document/F1.4-file-operations.md)
  - [F1.5 — Autosave & recovery](stage-1-tank-and-document/F1.5-autosave-and-recovery.md)
  - [F1.6 — NgRx document store](stage-1-tank-and-document/F1.6-ngrx-document-store.md)

- **Stage 2 — Substrate Tool** ([dir](stage-2-substrate/))
  - [F2.1 — Substrate types](stage-2-substrate/F2.1-substrate-types.md)
  - [F2.2 — Substrate shaping](stage-2-substrate/F2.2-substrate-shaping.md)
  - [F2.3 — Substrate bands](stage-2-substrate/F2.3-substrate-bands.md)
  - [F2.4 — Catalog loader](stage-2-substrate/F2.4-catalog-loader.md)

- **Stage 3 — Hardscape Tool** ([dir](stage-3-hardscape/))
  - [F3.1 — Drag-and-drop placement](stage-3-hardscape/F3.1-drag-and-drop-placement.md)
  - [F3.2 — Hardscape categories](stage-3-hardscape/F3.2-hardscape-categories.md)
  - [F3.3 — Transform handles + mirror](stage-3-hardscape/F3.3-transform-handles-and-mirror.md)
  - [F3.4 — Z-position, duplicate, delete](stage-3-hardscape/F3.4-z-duplicate-delete.md)
  - [F3.5 — Hardscape catalog](stage-3-hardscape/F3.5-hardscape-catalog.md)

- **Stage 4 — Layers & Planting Tool** ([dir](stage-4-planting-and-growth/))
  - [F4.1 — Plant placement](stage-4-planting-and-growth/F4.1-plant-placement.md)
  - [F4.2 — Layers panel](stage-4-planting-and-growth/F4.2-layers-panel.md)
  - [F4.3 — Grouping & blending](stage-4-planting-and-growth/F4.3-grouping-and-blending.md)
  - [F4.4 — Growth simulation](stage-4-planting-and-growth/F4.4-growth-simulation.md)
  - [F4.5 — Brush/scatter placement](stage-4-planting-and-growth/F4.5-brush-scatter-placement.md)

### Rounding out v1.x

- **Stage 5 — Templates & Precision Guides** ([dir](stage-5-templates-and-guides/))
  - [F5.1 — Template library](stage-5-templates-and-guides/F5.1-template-library.md)
  - [F5.2 — Personal templates](stage-5-templates-and-guides/F5.2-personal-templates.md)
  - [F5.3 — Guidelines & markers](stage-5-templates-and-guides/F5.3-guidelines-and-markers.md)
  - [F5.4 — Snapping](stage-5-templates-and-guides/F5.4-snapping.md)

- **Stage 6 — Export & Sharing** ([dir](stage-6-export-and-sharing/))
  - [F6.1 — Image export](stage-6-export-and-sharing/F6.1-image-export.md)
  - [F6.2 — Layout summary & volume](stage-6-export-and-sharing/F6.2-layout-summary-and-volume.md)
  - [F6.3 — Photo composite backdrop](stage-6-export-and-sharing/F6.3-photo-composite.md)
  - [F6.4 — Share & installers](stage-6-export-and-sharing/F6.4-share-and-installers.md)

### Parallelizable value-adds (post-v1)

- **Stage 7 — Livestock & Equipment** ([dir](stage-7-livestock-and-equipment/))
  - [F7.1 — Livestock catalog](stage-7-livestock-and-equipment/F7.1-livestock-catalog.md)
  - [F7.2 — Stocking guidance](stage-7-livestock-and-equipment/F7.2-stocking-guidance.md)
  - [F7.3 — Equipment browser](stage-7-livestock-and-equipment/F7.3-equipment-browser.md)
  - [F7.4 — Setup sheet](stage-7-livestock-and-equipment/F7.4-setup-sheet.md)

- **Stage 8 — Community Gallery** ([dir](stage-8-community-gallery/))
  - [F8.1 — Gallery browse](stage-8-community-gallery/F8.1-gallery-browse.md)
  - [F8.2 — Publish & import](stage-8-community-gallery/F8.2-publish-and-import.md)
  - [F8.3 — Backend contract](stage-8-community-gallery/F8.3-backend-contract.md)


- **Stage 10 — 3D Renderer** ([dir](stage-10-3d-renderer/))
  - [F10.1 — Three.js renderer](stage-10-3d-renderer/F10.1-threejs-renderer.md)
  - [F10.2 — 2D/3D view toggle](stage-10-3d-renderer/F10.2-2d-3d-view-toggle.md)
  - [F10.3 — 3D assets + fallback](stage-10-3d-renderer/F10.3-3d-assets-and-fallback.md)

- **Stage 11 — Animated livestock + ECS behaviors** ([plan](stage-11-animated-livestock.md))
  - Substages F11.1–F11.6 inline in the plan: procedural fish meshes + ECS scaffolding, schooling + stratification, territoriality + nipping + fear, feeding + grazing + curiosity, flow field + SDF collision + bubbles, polish + per-species presets + perf budget.
  - Anchoring research: [`docs/research/stage-11-livestock-subsystem.md`](../docs/research/stage-11-livestock-subsystem.md).

### Cross-cutting

- **Stage 12 — Release pipeline** ([plan](stage-12-release-pipeline.md)) — first release cuts `v0.1.0`; version scheme covers the full pre-v1 / v1.0 / post-v1 progression. Lands when we're ready to ship signed installers; the plan-as-spec is already locked.

### Simulation & gameplay (post-simulation-mode)

A dependency-ordered wave building on simulation mode (the borderless 3D showcase + HUDs + `~` console). Do the bug fix + debugger first; Stage 13 is the foundation; 14 → 15 → 16 build on it.

- **Fix — 3D light flicker** ([plan](fix-3d-light-flicker.md)) — kill the brightness flicker while orbiting; single-source the day-night/caustic lighting in the RAF tick.
- **Simulation debugger** ([plan](simulation-debugger.md)) — a `debugger` console command + 3D dev overlay (flow field / SDF / AABBs / entity inspector / system timings). Force-multiplier for the stages below.
- **Stage 13 — Aquarium husbandry** ([plan](stage-13-aquarium-husbandry.md)) — `domain/water-sim` nitrogen cycle, water quality, cycling, water testing, water changes, algae types. ⚑ [ADR-0006](../docs/decisions/0006-water-sim-lib-and-chemistry-state.md). _Foundation._
- **Stage 14 — Fish vitality & feeding** ([plan](stage-14-fish-vitality-feeding.md)) — food types + animated drops; fish health (hearts) + hunger, surfaced as a HUD + click-to-inspect. _Builds on 13._
- **Stage 15 — Simulation action HUD** ([plan](stage-15-husbandry-interactions.md)) — a bottom-center tool HUD: feeding (place the drop) + a multi-step water change (place/move a siphon, siphon out → in). Builds the reusable `SiphonTool`. _Builds on 13 + 14._
- **Stage 16 — Game modes** ([plan](stage-16-game-modes.md)) — `--mode game:<submode>` survival / feeding / predator / cleaner; fish-eye, player-controlled. ⚑ [ADR-0007](../docs/decisions/0007-game-mode-cli-grammar.md). _Capstone; cleaner reuses Stage 15's siphon._
- **Performance + ANGLE attribute budget** ([plan](perf-and-angle-budget.md)) — reclaim the livestock shader's 16/16 vertex-attribute ceiling (drop the dead `instanceMatrix`, pack scalars → 10/16) and a render-side perf pass (render-on-demand, quality tiers, lazy-load the 3D stack). _Part A unblocks Stage 14's per-fish vitality data._
- **Game-controller support** ([plan](game-controller-support.md)) — broad gamepad support (W3C Standard mapping + fallback): orbit/zoom the 3D camera, move the player fish in game modes, basic UI. _Enables Stage 16 player control._
- **Nutrients & additives + dosing** ([plan](nutrients-additives-and-dosing.md)) — a `nutrient` catalog kind of ~25–30 real products (honest chemical values + sources), a `DoseNutrient` command, a **Dose** action-HUD button, and a `dose` console command. _Builds on Stage 13 (water chemistry) + Stage 15 (action HUD)._
