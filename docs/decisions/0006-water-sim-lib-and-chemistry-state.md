# ADR 0006 — Water-chemistry simulation: a `domain/water-sim` lib + a versioned document field

**Status:** Accepted (planning).
**Date:** Stage 13, F13.1–F13.2.

## Context

Stage 13 adds aquarium husbandry simulation — the nitrogen cycle (ammonia → nitrite →
nitrate), pH, tank cycling, and algae. This needs (a) a home for the **simulation logic**
and (b) a home for the **persistent state** that round-trips through `.aqua` files.

The codebase already separates these concerns for plant growth: `libs/domain/growth-sim/`
holds pure, deterministic, framework-free functions; the per-plant `growth.ageWeeks`/`vigor`
lives in the document; the transient preview-time lives in a runtime service
(`PreviewTimeService`). Water chemistry is the same shape of problem.

## Options

**A. New `libs/domain/water-sim/` lib + a versioned document field (`Tank.waterChemistry` etc.).**
Pure deterministic chemistry model in the new lib (mirrors `growth-sim`); persistent snapshot
added to the `.aqua` schema (v3 → v4) via the v1-locked migration checklist; live tick state in a
runtime `WaterChemistryService`.

**B. Bolt the logic onto `domain/stocking` or `domain/growth-sim`.** Stocking already computes
bioload; chemistry could live beside it. — Conflates a static guidance heuristic (stocking) with a
time-evolving simulation; muddies `growth-sim`'s single responsibility.

**C. Store chemistry in the document `extensions` bag, no schema bump.** — The `extensions` bag is
for *unknown* forward-compat data; core simulation state that the app reads/writes and that users
share belongs in the versioned schema, not the escape hatch.

## Recommendation

**Option A.** It matches the established `growth-sim` pattern exactly: framework-free deterministic
domain lib + versioned document state + transient runtime service. `domain/*` boundary rules keep
the model reusable by headless tooling and both renderers. Bioload (the ammonia source term) is
imported from `domain/stocking` (a `domain → domain` dependency, which the boundary rules allow).

## Consequences

- New lib `libs/domain/water-sim/` (tags `scope:domain`, `type:lib`), pure TS, ≥90% coverage like
  other domain libs. Exposes e.g. `simulateChemistry(params, state, elapsed, bioload, seed)`.
- `.aqua` schema **v3 → v4**: an optional, additive `Tank.waterChemistry?` (+ cycle/algae) field,
  identity migration (absent stays absent), schema + `scene-model/types.ts` mirror + marshal +
  fixture round-trip test — the standard checklist in `docs/caveats/document-format.md`.
- A runtime `WaterChemistryService` owns the live tick (not persisted every frame); it reads
  bioload from `domain/stocking` and the time axis from `PreviewTimeService`.
- Determinism: chemistry is seeded from the document `seed`, same as growth + the livestock sim.

## Revisit

If chemistry needs to influence the livestock ECS every tick at 30 Hz (e.g. fish health from water
quality), revisit whether the model should run *inside* the ECS scheduler rather than as a separate
service — at that point a shared `dt` clock between `water-sim` and `livestock-ecs` may be cleaner.
