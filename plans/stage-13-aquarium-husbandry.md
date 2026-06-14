# Stage 13 — Aquarium husbandry simulation (nitrogen cycle, water quality, algae)

**Stage:** 13 — Aquarium husbandry (the "keep the water alive" simulation).
**Owner:** `growth-sim-engineer` (the `water-sim` model) + `aqua-document-guardian` (schema v3→v4) +
`catalog-engineer` (new catalog kinds) + `scene-model-engineer` (water-change Command).
**Status:** Not started.

## Goal

Model real aquarium husbandry on top of the existing scene + livestock sim: food → waste →
**bioload → nitrogen cycle** (ammonia → nitrite → nitrate), water quality + pH, **tank cycling**,
**water testing**, **water changes**, and **algae of several types**. This is the foundation the
feeding/vitality (Stage 14), the action HUD (Stage 15), and the cleaner/survival game modes
(Stage 16) build on.

## Spec reference

ADR-0006 (water-sim lib + chemistry document field). Reuses `domain/stocking` bioload,
`domain/growth-sim` (pattern + time axis), and the `.aqua` v1-locked migration checklist
(`docs/caveats/document-format.md`).

## Dependencies

**Requires:** scene-model + document (shipped); `domain/stocking` bioload
(`libs/domain/stocking/src/rules/bioload.ts`); `PreviewTimeService` (the weeks 0–52 time axis);
the catalog loader. **Enables:** Stage 14 (water quality → fish health; feeding waste → ammonia),
Stage 15 (the water-change tool), Stage 16 cleaner (algae + siphon).

## Architecture

```
domain/water-sim/   (NEW, pure, framework-free — mirrors domain/growth-sim)
  simulateChemistry(params, state, elapsedWeeks, bioload, seed) -> WaterState
  cycleProgress(state) -> 'uncycled' | 'cycling' | 'cycled'
  algaeGrowth(type, nitrate, lightHours, flow, dt) -> number

domain/document      v3 -> v4: optional Tank.waterChemistry / cycle / algae snapshot
domain/scene-model   mirror the field; SetWaterChemistry / WaterChange Commands
domain/catalog       new kinds: food, algae, water-test-kit (cleaning-tool lands in Stage 15/16)
state / apps/web     WaterChemistryService (live tick), test-kit + cycle UI
```

## Substages

### F13.1 — `domain/water-sim` model
Pure deterministic chemistry: a two-stage nitrifier model (ammonia oxidisers → nitrite oxidisers),
a bacterial-colony **capacity that grows over sim-time** (= cycling: ammonia/nitrite spike then
fall, nitrate accumulates), pH drift, all seeded from the document `seed`. Source term = bioload
(stocking) + feeding waste (Stage 14 hook, optional input now). ≥90% coverage; golden-curve tests
for an empty cycle, a stocked cycle, and a fish-in vs fishless cycle.

### F13.2 — Document v3 → v4 (persist chemistry state)
Additive optional `Tank.waterChemistry?` (ammonia/nitrite/nitrate/pH), `cycle` stage, and an algae
state block. Identity migration (absent stays absent), schema mirror in
`aqua-document.schema.json`, `scene-model/types.ts` mirror, marshal both directions, fixture
round-trip test. Follow the v1-locked checklist exactly. ⚑ ADR-0006.

### F13.3 — Time-axis integration ("cycle the tank")
Drive chemistry over the existing preview-time axis (`PreviewTimeService`) so scrubbing weeks shows
the cycle progress; plus a real-time tick in simulation mode (`WaterChemistryService`). Same
deterministic-from-seed contract as growth.

### F13.4 — Catalog kinds: `food`, `algae`, `water-test-kit`
New `oneOf` schema branches + types + loader handling + manifests under `data/<kind>/` (mirror how
`decor`/`equipment` were added). `food`: type (flake/pellet/wafer/live) + nutrition → waste factor.
`algae`: type (green-spot / hair / black-beard / diatom) + growth rate + grazer preference + light
dependence. `water-test-kit`: the parameters it reads. schemaVersion bump only if required by the
loader contract (kinds are additive — check the catalog caveat).

### F13.5 — Water testing UI + water-change Command
A test-kit readout (the classic colour-chart for ammonia/nitrite/nitrate/pH) surfaced in the editor
(and consumed by the Stage 15 HUD). A **`WaterChange` Command** (undo-able, in scene-model): removes
a volume (dilutes nitrate/ammonia proportionally) and/or sets replacement-water params — the model
primitive the Stage 15 siphon flow drives.

### F13.6 — Algae simulation ✅ SHIPPED
Algae growth ∝ nitrate × light(photoperiod from `EquipmentEntry.photoperiodHours`) × flow, per algae
type, feeding the ECS `Hardscape.algaeScore` (already a regrowing scalar in `feeding-system.ts`).
Extend that scalar toward per-type algae so grazers (otos) and the cleaner game mode can target
specific types.

SHIPPED: `Hardscape` gained four per-type stocks (green-spot/hair/black-beard/diatom); `algaeScore`
is now their clamped-sum aggregate (every existing consumer unchanged). A new `algaeGrowthSystem`
(slotted before `feedingSystem`) grows each type through the water-sim `algaeGrowth` model from
nitrate (`setWaterQuality.nitrate`, default 0) × photoperiod (`setPhotoperiodHours`, default 8 h,
fed from `EquipmentEntry.photoperiodHours`) × flow-field magnitude, scaled per type by the registered
`algae` catalog rows. `feedingSystem`'s rasp is now type-selective (per-species `registerGrazerPreference`
mask from the catalog `grazers[]` mapping; generalist fallback = highest-stock type). Per-type stocks
read via `world.getAlgaeByType(eid)` (snapshot shape unchanged — aggregate stays the rendered total).
Defaults (nitrate 0) keep a chemistry-less world replay-identical. The cleaner game mode consuming
per-type algae is Stage 16 F16.5 (gated on Stage 15). **This completes Stage 13.**

## Acceptance criteria

- [ ] A stocked tank cycles deterministically: ammonia spikes, nitrite follows, nitrate accumulates,
      and `cycle` reaches `cycled` on the same week every run for a given seed.
- [ ] A `.aqua` file saved with chemistry round-trips losslessly through v4; a v3 file loads with the
      field absent (no invented values).
- [ ] A water change reduces nitrate and shifts params toward the replacement water; undo restores.
- [x] Algae grows faster under high nitrate + long photoperiod; grazing reduces it. (F13.6 — per-type;
      `algae-growth-system.spec.ts` pins the nitrate + photoperiod monotonicity + type-selective rasp.)

## Testing

- **Unit (≥90%):** `water-sim` curves; the document migration + round-trip; the `WaterChange` command
  invert; catalog schema validation for the new kinds.
- **Component:** the test-kit readout reflects the chemistry state; the water-change action dispatches
  the Command.
- **E2E:** scrub the time axis in simulation mode and assert the chemistry readout changes.

## Notes

Keep the *model* in `domain/water-sim` (no Angular/DOM) and the *state* in the document; the live tick
is a thin runtime service. New caveat file `docs/caveats/water-sim.md` (the chemistry constants +
determinism rules + the "model in the lib, state in the document" split). Update
`docs/caveats/document-format.md` history + `docs/caveats/catalog.md` for the new kinds.
