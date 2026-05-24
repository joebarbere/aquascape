# Stage 4 kickoff — planting, layers, and growth simulation

Stage 4 is the project's signature differentiator: layered planting with deterministic, time-sliced growth simulation. Four specialist areas must agree on a fresh set of contracts at the same time (growth API, scatter contract, layer semantics, seeding scheme), and the result has to round-trip through the `.aqua` document losslessly. This is a strong fit for an agent team.

## Kickoff prompt (paste into an interactive Claude Code session)

```text
Start an agent team to execute Stage 4 of the Aquascape development plan
(see ./aquascape-development-plan.md §"Stage 4 — Layers & Planting Tool").

The goal is the signature planted-tank workflow: plant placement from a
categorized catalog, a layers panel (reorder/rename/opacity/lock/visibility),
grouping with "grow into each other" blending within a layer, a deterministic
time-slider growth simulation, and brush/scatter placement for carpets.

Prerequisite: Stages 0–3 are landed. Tank setup, document persistence,
substrate, and hardscape tools all work and round-trip.

Spawn these teammates from the sub-agent definitions in .claude/agents/:

  1. growth-sim-engineer    — LEAD on the simulation contract. Designs the
     pure function growth(plant, weeks, seed) -> RenderedShape, the seeded
     PRNG choice, the scatter algorithm, and the engine-versioning scheme.
     Authors libs/domain/growth-sim.

  2. catalog-engineer       — Owns the plant catalog schema additions for
     growth parameters (initialHeight, matureHeight, initialSpread,
     matureSpread, growthCurve, plus lighting/CO2/difficulty metadata).
     Validates that the schema fits real-world species data.

  3. scene-model-engineer   — Designs the PlantObject, the LayerGroup
     (for "grow into each other" blending), and the scatter Command
     (a CompositeCommand so undo treats a brush stroke as one user
     action). Confirms growth results are NOT persisted into the scene
     — recomputed on each render.

  4. angular-feature-engineer — Builds features/planting-tool (palette,
     brush, scatter parameters) and features/layers-panel (DnD reorder,
     opacity slider, lock/visibility toggles), plus the time-slider UI
     wired to a growth-sim Web Worker for large scenes.

  5. renderer-engineer      — Extends renderer-2d to consume growth
     results when rendering plants, including layer ordering, opacity,
     and the "grow into each other" blending mode.

  6. aqua-document-guardian — Adds the per-document seed (if not already
     in v1), the per-scatter seed field on PlantObjects, and any layer
     fields the new layers panel needs. Manages the schemaVersion bump
     and migration if the format changes.

  7. test-engineer          — Writes the property tests for seeded scatter
     reproducibility, growth interpolation at t=0/mid/max, layer
     reorder/lock semantics, and the Stage 4 e2e: plant a carpet, group
     a midground cluster, drag the growth slider, reorder layers, save,
     reopen — growth state and layer order preserved.

Coordination contract:

  - First task: the team agrees on three contracts in writing, posted to
    the shared task list, before any implementation begins:
      (a) growth-sim-engineer's RenderedShape type and growth() signature
      (b) the seeding scheme (document seed → layer seed → scatter seed)
      (c) the PlantObject shape and which fields persist vs. derive
  - aqua-document-guardian reviews contract (c) for forward-compatibility
    before scene-model-engineer locks it in.
  - growth-sim-engineer's pure function is implemented and property-tested
    BEFORE the renderer integrates it — no UI dependencies in the engine.
  - The Web Worker boundary is decided early: which functions are workerized
    and how results flow back. angular-feature-engineer owns the wiring.

Definition of Done for the milestone:

  - growth(plant, weeks, seed) is deterministic across runs and platforms;
    a property test pins this.
  - Brush/scatter placement is reproducible from a seed.
  - Layer reorder/lock/visibility commands are invertible.
  - Time slider re-renders without mutating the document.
  - Round-trip: plant a scene, save, reopen — growth state, layer order,
    and seeds are all preserved.
  - The e2e spec from plan §"Stage 4 Testing" passes in web and Electron.

When the team is done, the lead session reports back with: the commit(s)
created, the test results (especially the seeded reproducibility property
test output), and any contract decisions that should be documented in
ADR form.
```
