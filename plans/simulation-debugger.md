# Simulation debugger — a `debugger` console command + 3D dev overlay

**Type:** Developer tooling (renderer-3d + apps/web).
**Owner:** `renderer-engineer` (3D debug layers) + `angular-feature-engineer` (console command + overlay).
**Status:** Not started.

## Goal

A `debugger` command in the simulation Quake console that opens a **3D simulation developer
debugger** — visualising the otherwise-invisible parts of the live sim (flow field, collision SDF,
AABBs, system timings, per-entity state) so the husbandry + gameplay work below is tunable.

## Context

Two debug surfaces already exist: the dev-only `BehaviorDebugOverlayComponent` +
`BehaviorDebugService` (Ctrl+Shift+D; polls the live `LivestockWorld` ~15 Hz —
`apps/web/src/app/behavior-debug-overlay.component.ts`) and the read-only
`window.__aquascape_debug__` hook (`debug-hook.ts`). The world already exposes
`getFlowField()`, `getHardscapeSdf()`, `tickCounter`, and `tankAabb`. This plan turns those into an
*in-3D-scene* developer view, reachable from the simulation console (the natural dev entry point now
that `~` exists). Sequence it **early** — it pays for itself across Stages 13–16.

## Scope

**In:**
- A `debugger` console command (`debugger <on|off|toggle> [layer]`) registered in
  `apps/web/src/app/simulation/simulation-console.service.ts`; drives a `SimulationDebuggerService`.
- **3D debug layers** (renderer-3d Object3D groups, toggled, no rebuild of the real scene):
  - **Flow field** — arrow field sampled from `world.getFlowField()` on a coarse grid.
  - **Collision SDF** — contour/slice viz from `world.getHardscapeSdf()` (distance shells).
  - **AABBs / wireframes** — tank bounds (`tankAabb`) + per-entity boxes (`BoxHelper`-style lines).
  - **Shader debug modes** — AO-only / caustic-only passes to tune SSAO + caustics.
- **Entity inspector** — select a fish (raycast pick) → all component values (reuse the behavior
  overlay's per-fish formatting), live-updating.
- **System tick timings** — per-system ms (requires the ECS `step()` to optionally time each system;
  expose via the world).
- A water-chemistry readout once Stage 13 lands.

**Out:** editing the sim from the debugger (read-only, like the existing debug hook); shipping in
production builds (gate behind simulation mode; keep the heavy viz dev-leaning).

## Dependencies

**Requires:** simulation mode + console (shipped); `livestock-ecs` world introspection (mostly
exists — add per-system timing + an entity-pick helper). **Enables:** efficient tuning of Stages
13–16.

## Acceptance criteria

- [ ] `debugger toggle flow` shows/hides a flow-field arrow overlay aligned to the real current.
- [ ] `debugger toggle sdf` shows hardscape distance shells matching where fish deflect.
- [ ] Clicking a fish opens an inspector with its live component values.
- [ ] System timings panel sums to roughly the measured tick time (sanity vs the perf strip).
- [ ] All debug layers add zero allocation per frame when OFF and never blank the real scene.

## Testing

- **Real-GPU Playwright loop:** assert each layer toggles a visible change (pixel diff) and the base
  scene still paints with the layer off.
- **Unit:** the arrow/SDF sampling helpers (pure given a field/SDF); the console command parsing.
- **Manual:** inspect a fish; confirm values track the behavior overlay.

## Notes

Keep the debug layers in their own renderer module (`scene-builder/debug-*`) and never let them touch
the dispose/rebuild path of the real scene. Document the layer set + the `debugger` grammar in
`docs/caveats/renderer-3d.md` and the simulation-mode guide.
