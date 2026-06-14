# Water-sim caveats

**Load this when:** touching `libs/domain/water-sim/` — the nitrogen-cycle / tank-cycling / pH / algae chemistry model, or any consumer that depends on deterministic chemistry evolution across machines (the F13.2 document field, the F13.3 runtime `WaterChemistryService`).

## What this lib is (ADR-0006)

The **model lives in the lib; the state lives in the document.** `domain/water-sim` is the pure deterministic sibling of `domain/growth-sim`: framework-free (no Angular/DOM/Electron, no `Date.now()`, no `Math.random()`), time is an INPUT (`elapsedWeeks` / `dt`), and the same `(params, state, inputs, seed)` evolves byte-identically everywhere. The persistent `WaterState` snapshot round-trips through the `.aqua` schema (F13.2, v3 → v4); the live tick + the editor preview-time integration are thin runtime services (F13.3 — see "the two driver paths" below). The **model itself** stays framework-free in the lib; the Angular services live in `features/editor-shell` + `apps/web`.

## Public API

- `simulateChemistry(params, state, elapsedWeeks, sourceN, seed) -> WaterState` — pure, total, non-mutating. Advances the two-stage nitrogen cycle + pH over `elapsedWeeks`.
- `cycleProgress(state) -> 'uncycled' | 'cycling' | 'cycled'`.
- `algaeGrowth(type, nitrate, lightHours, flow, dt) -> number` — per-type growth increment.
- `freeAmmonia(totalN, ph, temperatureC)` / `freeAmmoniaFraction(ph, temperatureC)` — the NH3/NH4+ equilibrium (toxic-fraction).
- `freshWaterState(overrides?)` — a brand-new uncycled tank.
- `ENGINE_VERSION` — the rate-model version constant.

`sourceN` is the **ammonia source as a nitrogen MASS rate, mg-N/day** — supplied by the caller from `domain/stocking` bioload (+ a Stage-14 feeding-waste hook, default 0). The model **does not recompute bioload**; it takes it as an input. Internally `sourceN / volumeLitres` converts it to a concentration rate.

**Stage 14 F14.4 — the feeding-waste hook PRODUCER.** `domain/livestock-ecs`'s world exposes `getWasteSourceN()` returning a smoothed ammonia source term (nitrogen mass rate, mg-N/day) built from a per-fish baseline + uneaten-food decay (uneaten `FoodSprite`s fold `calories × wasteFactor` in on lifetime expiry). That value is the shape `simulateChemistry`'s `sourceN` argument expects. **Stage 13 F13.3 lands the CONSUMER — the loop is now closed end-to-end.** See the next section.

## F13.3 — the two driver paths (editor preview-time + live tick)

The model is driven two ways; both flow from the document `seed` and a stocking-derived source term, and they **agree on bioload → sourceN by construction** (they call the same `water-sim` helpers):

- **Shared helpers (in `water-sim`):**
  - `bioloadSourceN(scene, catalog)` → the editor's source term (mg-N/day). Anchors a `medium`-bioload-class fish to **exactly `FISH_BASELINE_WASTE_N_MG_PER_DAY = 0.6`** — the SAME constant `livestock-ecs`'s `waste-accumulator.ts` uses for its flat per-fish baseline (the two are MIRRORED — keep them in lock-step; a `water-sim` dep on bitECS just to import a number isn't worth it). `low`/`high` classes scale ×0.5 / ×2.0 (the `domain/stocking` weights). So a medium-class community tank previewed in the editor and ticked live tell the same story.
  - `waterParamsFromTank(tank)` → `{ volumeLitres, kh, temperatureC }`. Volume is the WATER volume at the effective fill line (`width × depth × effectiveWaterLevelMm`), floored at 1 L. KH (4 dKH) + temperature (25 °C) are **labelled defaults** — the scene model carries no per-tank KH/temperature today.
  - `initialWaterState(persisted)` → lifts `Tank.waterChemistry.chemistry` back into a `WaterState`, or `freshWaterState()` when absent.
  - `evaluateChemistryAtWeek(params, initial, targetWeek, sourceN, seed)` / `evaluateSceneChemistryAtWeek(scene, targetWeek, sourceN)` → the editor's pure per-week evaluation. `elapsed = targetWeek − initial.ageWeeks` clamped ≥ 0 (the model is **monotonic-forward** — scrubbing back below the persisted age returns the initial state; you can't un-cycle by scrubbing).

- **(a) Editor preview-time** (`features/editor-shell` → `PreviewChemistryService`): a `computed` signal folds the store scene + the `PreviewTimeService` week into a `WaterState` + `CycleStage`. Scrubbing the time slider previews the cycle (the same axis growth-sim uses). "Now" (slider `null`) shows the persisted/initial age. **Nothing is written to the document** — like the time slider, scrubbing must not dirty undo/autosave. A minimal `CycleIndicatorComponent` surfaces it beside the slider (the full test-kit readout is F13.5).

- **(b) Live tick** (`apps/web` → `WaterChemistryService`): started when the showcase / game mode activates, stopped on exit. Each tick reads `world.getWasteSourceN()` as the source term (per-fish baseline **plus** uneaten-food decay — the editor's `bioloadSourceN` is the warm-up fallback until the renderer lazily builds the world), advances `simulateChemistry`, and pushes `world.setWaterQuality({ammonia, nitrite})` so `vitalitySystem` reacts. **This closes feed → waste → ammonia → fish-health end-to-end.**

### Time-acceleration (live tick only)

A real tank cycles over **weeks**; the showcase must show it in **minutes**. The tick fires on a fixed wall-clock interval (`TICK_INTERVAL_MS = 250` ms, 4 Hz) but **never advances by the measured wall-clock delta** — each tick advances the model by a FIXED `WEEKS_PER_TICK = 0.0125`. At 4 Hz that's `0.05 weeks/real-second`, so the ~6-week hobby cycle window elapses in ~2 real minutes. The acceleration lives ONLY in the service (the model stays honest per simulated week). Because the per-tick advance is fixed, after N ticks the chemistry is a **pure function of (initial state, the source-term trace, N)** — replay-stable given the tick count (a dropped/late frame just means one fewer tick, never a smeared dt). Mirrors the livestock fixed-dt scheduler.

### Determinism + the livestock replay boundary

Same seed + same scene + same elapsed (week N, or N ticks with a fixed source trace) ⇒ identical `WaterState`. The live tick never reads a clock inside the model, never calls `Math.random`. **The 1000-tick livestock replay still holds**: `world.setWaterQuality` defaults clean (0/0), so a world with NO `WaterChemistryService` running is byte-identical. Only an ACTIVE service injects non-zero water quality, and it injects BETWEEN sim ticks via a host-driven scalar (`getWasteSourceN`) — it never perturbs the ECS PRNG streams.

### Persistence decision (F13.3)

Initial state is **read** from `Tank.waterChemistry` (the persisted snapshot, F13.2); the live tick state is **runtime-only** and is NOT written back per-tick (that would spam the undo stack + churn autosave). The current `WaterState` is exposed as a signal for the HUD. Persisting live chemistry back to the document (a non-undoable save-time snapshot) is left to save-time code — F13.3 prefers runtime-state + read-initial over continuous document writes.

## Engine version (replay / migration)

`ENGINE_VERSION = 1`. **Bump it whenever a change to the constants or equations below shifts the output of an existing `(state, inputs, seed)`.** A persisted `WaterState` records `engineVersion` (stamped on every output) so a saved sim can replay under its original model or be migrated explicitly — never silently rewrite history. The golden-snapshot test in `chemistry.spec.ts` is the drift tripwire: if it changes, the engine version must change with it.

## The model + constants (with sources)

Two bacterial guilds with populations that grow over sim-time toward a substrate-set carrying capacity (logistic + Monod), mass-conserving in the nitrogen channel:

- **Stage 1 — ammonia oxidisers (AOB):** NH3-N → NO2-N.
- **Stage 2 — nitrite oxidisers (NOB):** NO2-N → NO3-N. NOB only have food once AOB produce nitrite, so stage 2 lags stage 1 — **this lag IS the classic fishless-cycle curve** (ammonia spikes/falls, nitrite follows, nitrate accumulates).
- Nitrate only leaves via a water change (a separate event, not modelled here) → it accumulates monotonically between changes. That's the husbandry signal.

**Sourced relationships (real chemistry):**

- Two-stage nitrification + the nitrite lag, Monod substrate limitation: Hovanec & DeLong 1996; Hagopian & Riley 1998 (review of nitrification in aquaria/aquaculture).
- **NH3/NH4+ equilibrium** (`ammonia.ts`): `fraction NH3 = 1 / (1 + 10^(pKa − pH))` with `pKa = 0.09018 + 2729.92 / T_kelvin` — Emerson, Russo, Lund & Thurston 1975, *Aqueous ammonia equilibrium calculations*, J. Fish. Res. Board Can. 32(12):2379–2383. This is a real sourced formula, **not** an approximation; it's why high pH makes the same test-kit ammonia reading far more toxic.
- pH drift: nitrification consumes alkalinity → acidifies; KH buffers it (direction + KH-buffering are real; the coefficient is a labelled approximation).

**Calibrated approximations (labelled in code — NOT measured kinetic constants):** the absolute rate constants (`COLONY_GROWTH_PER_DAY`, `COLONY_DECAY_PER_DAY`, `PROCESS_PER_CAPACITY_PER_DAY`, `HALF_SATURATION_N = 0.1`, `CAPACITY_PER_SATURATED_N`, `PH_ACID_DRIFT_PER_DAY`) are tuned so a typical dosed fishless cycle reaches `cycled` in ~3–6 weeks — the hobby-standard window. `HALF_SATURATION_N` is deliberately low so a mature filter drives residual ammonia/nitrite well below the 0.25 mg/L safe floor. The Q10≈2 temperature factor (van 't Hoff) is clamped to a plausible aquarium band; the exact curve is ours.

Cycle thresholds (`cycle.ts`): `SAFE_NITROGEN_MG_L = 0.25` (hobby test-kit "safe" floor, e.g. API Master Kit colour bands — a labelled approximation of the readable bands, not an instrument spec). `cycled` requires BOTH nitrogen species ≤ safe AND both colonies established; high nitrate does **not** block `cycled`.

Algae niches (`algae.ts`) are labelled approximations of hobby consensus (green-spot = bright light; hair = high nutrient + long photoperiod; black-beard = strong flow; diatom = new-tank, low-light, flow-suppressed). Growth ∝ Monod(nitrate) × Gaussian(photoperiod vs optimum) × flow-affinity × dt.

## Determinism + seeding (mirrors growth-sim)

- All jitter flows from the document `seed` via stable sub-seeds (`prng.ts`: Wang-style `hashSeed` + `mulberry32`, identical algorithm to growth-sim's scatter). `signedJitter(seed, channel, step)` is the one primitive.
- **Channels** are per-purpose salts (`CHANNEL.SOURCE/AOB/NOB`) so sub-streams never collide.
- **`step` is keyed to the running `ageWeeks` clock**, NOT the call boundary — so splitting `simulateChemistry(s, 4w)` into four 1-week calls follows the same jitter stream. (Per-call 4dp rounding of the snapshot means the two agree to ~2dp, not byte-identically; byte-identity is guaranteed only for a FIXED call sequence — see the determinism property test.)
- Internal integration is fixed-Euler at `STEP_DAYS = 0.25` so the stiff colony/substrate coupling stays stable. Output fields are rounded to 4dp (`round4`) to keep persisted/compared state byte-stable across JS engines.

## Gotchas

- The Monod half-saturation is shared by the colony carrying-capacity term AND the per-step processing rate. Lowering it both (a) lets colonies establish on less substrate and (b) drives steady-state residuals lower — that's how a heavily-stocked tank still reads `cycled`.
- A continuously-stocked tank (constant `sourceN`) is NOT a dosed fishless cycle: ammonia rises to a spike then the established filter pulls it to ~0; residual nitrite settles below the safe floor. An empty tank (`sourceN = 0`) never cycles and stays `uncycled` with no nitrate.
- The model never removes nitrate — a `WaterChange` Command (F13.5, scene-model) is the only sink. Don't add a decay term here.
