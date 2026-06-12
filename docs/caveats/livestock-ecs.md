# livestock-ecs caveats

**Load this when:** touching `libs/domain/livestock-ecs/`, `libs/domain/fish-anatomy/`, `libs/rendering/livestock-renderer-3d/`, or `apps/web/src/app/livestock-simulation.service.ts`. Cross-load `renderer-3d.md` if your change crosses into the 3D RAF tick or the bundle's dispose surface.

## Scope of F11.1 + F11.2 + F11.3 + F11.4

F11.1 shipped six static archetype meshes wiggling in place. F11.2 makes them swim — Perception → Schooling → Depth → SteeringIntegrator now run before Kinematic, and every entity tagged with a `BehaviorParamsRef` resolves Couzin three-zone schooling + vertical-band stratification each tick. Entities with `handleIdx === NO_BEHAVIOR_HANDLE` stay on the F11.1 static-wiggle path (the integrator short-circuits before touching Velocity).

F11.3 added three behaviour systems — FearSystem, NippingSystem, TerritorialSystem — plus the `Hardscape` tag + `world.registerHardscape(...)` surface. Every fish now carries `FearState` (fear params are required on `ResolvedBehavior`); fish with non-null `territory` get `Territory` + an auto-anchor at spawn; fish with non-null `nipping` get `NippingDrive`. Priority arbitration runs through `BehaviorMode`: FearSystem may flip FORAGE → REFUGE, NippingSystem / TerritorialSystem set PURSUE for one tick. Downstream systems (Nip, Territory, Schooling) early-out when `BehaviorMode !== FORAGE`; DepthSystem always runs.

F11.4 added FeedingSystem + CuriositySystem (between Territory and Schooling per the reserved seats) and the `FoodSpriteLifetimeSystem` that runs after Animation. New components: `FeedingDrive` + `Curiosity` on every fish with a registered behaviour, `FoodSprite` tag on transient food entities, and `algaeScore` extended onto `Hardscape` (initialised by `registerHardscape`: rocks + wood → 1.0; plant + other → 0.0). New world API: `spawnFoodSprite(pos, lifetimeSec=30, calories=1)`, `getFoodSpriteCount()`, `getAlgaeScore(eid)`. `WorldSnapshot` gained `foodSpriteCount` + `foodSpritePosition` slabs — additive only; the fish slab is unchanged so F11.1+ renderers keep working.

F11.5 flow field + hardscape SDF + bubble columns; F11.6 per-species presets + perf budget; F11.7 ambient polish (water surface, day-night, plant sway).

## World lifecycle

- **Owned by `LivestockSimulationService` in `apps/web`**, not by the renderer. The world survives the 2D ↔ 3D toggle. The renderer's `dispose()` only releases the GPU bundle; the world stays alive in the service.
- **Lazy creation.** The world is built on the first emission with non-empty `scene.livestock`. Empty livestock → no world (the service returns `null` from `getWorld()`).
- **Re-spawn on scene change.** When `(scene.seed, scene.livestock)` changes, the service tears down the world's entities and re-spawns them deterministically. The world object itself is reused across re-spawns (no GC churn); only the entities cycle.
- **One world per document.** Opening a new document tears down the world entirely (the `apps/web` document slice fires a "scene replaced" signal that the service observes).

## ParamStore + tankAabb (F11.2)

- **Species behaviour lives on the world's `ParamStore`, not on each entity.** A 200-fish school carries 200 × `BehaviorParamsRef` (4 B) instead of 200 × `SchoolingParams + DepthParams` (~88 B). Register via `world.registerSpeciesBehavior(speciesId, ResolvedBehavior)` → returns a `handleIdx` to pass back through `spawnFish({ ..., behaviorHandleIdx })`. Idempotent on `speciesId` — re-registration updates the row in place so existing entities pick up the new params on the next tick.
- **`NO_BEHAVIOR_HANDLE` (0xffff) = no behaviour registered.** Behaviour systems early-out and the entity stays on the F11.1 static-wiggle path (Velocity=0, only AnimationPhase advances). Useful for tests + the F11.1 fallback path the renderer's "fish wiggle even without a catalog behaviour block" contract relies on.
- **`world.tankAabb` is mutable; call `world.setTankAabb(aabb)`** to resize the interior box when the document's tank changes. DepthSystem reads `tankHeight = maxY - minY` each tick, SteeringIntegrator projects Velocity against the faces, KinematicSystem's clamp catches rounding-error escapes. The `LivestockSimulationService` already tears down + re-spawns on tank change today, but the world itself can survive a tank resize — let the AABB mutate before reaching for a full rebuild.
- **`tankAabb.maxY` is the WATERLINE, not the glass rim.** The host builds it as `tank.height − WATER_OFFSET_BELOW_RIM_MM` (exported from `@aquascape/rendering/renderer-3d`) so everything keyed off the AABB top — depth-band fractions, the kinematic clamp, bubble despawn (`maxY − BUBBLE_WATERLINE_INSET_MM`), surface food sprites — matches the water surface the renderer paints. Passing the raw rim height reintroduces fish/bubbles/food floating in the air gap.

## System ordering (current + reserved)

F11.1 ran only Kinematic + Animation. F11.2 fills in Perception → Schooling → Depth → SteeringIntegrator. F11.3 added Fear → Nip → Territory between Perception and Schooling. F11.4 added Feeding + Curiosity in their reserved seats and `FoodSpriteLifetimeSystem` at the very end. F11.5 added FlowFieldSystem (between Depth and SteeringIntegrator) + CollisionSystem (between SteeringIntegrator and Kinematic) + bubble particle spawn + lifetime after FoodSprite. Honour the seat ordering when adding new systems:

```
PerceptionSystem          (F11.2 — rebuilds the SpatialGrid)
FearSystem                (F11.3 — risk-driven mode flips, runs early so other behaviours read the latest mode)
NippingSystem             (F11.3 — group-threshold suppression + nip dart)
TerritorialSystem         (F11.3 — bourgeois rule + fatigue decay)
FeedingSystem             (F11.4 — hunger integration + sprite/algae targeting + algae regrowth)
CuriositySystem           (F11.4 — Poisson glass-surfing trigger + dwell)
SchoolingSystem           (F11.2)
DepthSystem               (F11.2)
FlowFieldSystem           (F11.5 — trilinear-samples world.flowField, adds drag-coupled force; always-on, mode-agnostic)
SteeringIntegrator        (F11.2 — sums forces, clamps maxForce + maxTurnRate)
CollisionSystem           (F11.5 — SDF deflect + tangent project; fish-vs-fish separation via the F11.2 SpatialGrid; always-on)
KinematicSystem           (always last among physics — integrates velocity)
AnimationSystem           (always last overall — purely visual, no state reads)
FoodSpriteLifetimeSystem  (F11.4 — drains FoodSprite.lifetime + despawns expired sprites; runs after Animation so mid-tick consumption settles first)
BubbleSourceSpawnSystem   (F11.5 — per-source spawn-debt accumulator; emits one BubbleParticle per integer unit of debt; clamps to BUBBLE_GLOBAL_CAP_COUNT = 200)
BubbleLifetimeSystem      (F11.5 — Position.y += velocityY * dt; despawn at waterline OR lifetime ≤ 0)
```

**"First system with a non-null target wins"** — arbitration is by priority, not by force summation, for mode-flipping behaviours (Fear → Nip → Territory → Feeding → Curiosity). Implemented as **early-out checks on `BehaviorMode`**: FearSystem may flip FORAGE → REFUGE; NippingSystem / TerritorialSystem set PURSUE for exactly one tick (NippingSystem resets PURSUE → FORAGE at the start of its own loop the following tick). FeedingSystem still integrates hunger for REFUGE/PURSUE fish (fish get hungry even when fleeing) but skips target-seeking; CuriositySystem skips entirely. SchoolingSystem skips entirely when `mode !== FORAGE` so REFUGE/PURSUE forces aren't diluted. DepthSystem **always** runs — fleeing fish still respect depth bands. Schooling + Depth + Flow + Feeding + Curiosity are additive forces summed by SteeringIntegrator.

**Startle-wave propagation (fidelity pass):** when FearSystem flips a fish FORAGE → REFUGE it queries the SpatialGrid (PerceptionSystem rebuilds it the same tick, so it's fresh) for conspecifics within `STARTLE_PROP_RADIUS_MM` (150 mm) and queues a distance-attenuated startle (`STARTLE_PROP_MAGNITUDE = 0.4` at zero distance) for each. Those impulses are applied **next tick** — merged into `pendingStartles` AFTER the per-tick cleanup that drains it — which is what makes fear a travelling WAVE through a school rather than a synchronous flash. The propagation accumulator is allocated LAZILY (only on an actual flip), so a calm tank pays zero per-tick allocation. **Determinism:** the grid query order is fixed and impulses are summed (order-independent), so two identical worlds propagate identically — the 1000-tick byte-identical replay holds (verified). The magnitude sits well below a typical `threshold` and risk decay damps the wave, so it ripples out and dies rather than self-sustaining. A roaming **predator entity** (catalog `predator?` flag + a snapshot-visible entity) is the natural next step but is deferred — it changes the `WorldSnapshot` shape (new position slabs) + the replay fixture; startle propagation is the contained, snapshot-stable half of the predator/fear tier.

**Hardscape registration:** `world.registerHardscape(entries)` tears down all existing `Hardscape`-tagged entities and adds fresh ones from the input. Re-registration is the chosen rebuild path; hardscape mutations trigger a livestock re-spawn upstream (same pattern as F11.2 tank resizes), so callers MUST NOT depend on specific bitECS eids surviving across re-registrations. Auto-anchor for territorial fish happens at `spawnFish` time — the nearest hardscape within `2 * coreRadius` wins; if none in range, `Territory.anchorEid = NO_ENTITY_REF` (0xffffffff) and TerritorialSystem skips that fish. Hardscape entities live in the same `Position` query as fish, so systems that walk neighbours must filter via `hasComponent(ecs, Hardscape, nid)` to exclude them.

**`NO_ENTITY_REF` sentinel:** bitECS allocates entity ids starting at 0, so 0 is a *valid* eid. The "no anchor / no refuge" sentinel for `Territory.anchorEid` + `FearState.refugeEid` is `0xffffffff` (max ui32). Never compare those slabs against 0.

## Flow field + hardscape SDF + bubble particles (F11.5)

- **`@aquascape/domain/fluid-sim`** owns the bakes: `bakeFlowField({ tankAabb, sources })` → 32³ divergence-free `FlowField`, `bakeHardscapeSdf({ tankAabb, hardscape: { position, radius }[] })` → 64³ sphere-union `HardscapeSdf`. Both are deterministic — same inputs → byte-identical Float32Array outputs.
- **`world.registerFlowField(field | null)`** + **`world.registerHardscapeSdf(sdf | null)`** are how the service hands baked outputs to the systems. Stored by reference (no copy). FlowFieldSystem early-outs when the field is null; CollisionSystem early-outs its SDF pass when sdf is null but still runs the fish-vs-fish pass (which is cheap + always-useful).
- **Sphere-radius approximation.** The F11.5 SDF bake takes `(position, radius)[]` — a sphere per hardscape entry. The service supplies `radius = 50 mm` by default (no per-row catalog field yet); a real per-row `naturalRadius` is a follow-up. Fish-body-length is ~30 mm typical, so 50 mm spheres around rocks give a comfortable repulsion margin without over-blocking the tank.
- **`world.registerBubbleSources(sources)`** — sources are `{ position, airRateMl }[]`. Spawn rate per source: `(airRateMl / 60) * BUBBLE_SCALE` particles/sec where `BUBBLE_SCALE = 3`. Global cap `BUBBLE_GLOBAL_CAP_COUNT = 200` ensures the renderer's per-frame attribute write stays bounded regardless of `airRateMl` excess.
- **Bubble wobble (fidelity pass):** `bubbleLifetimeSystem` now adds a **deterministic helical drift** as bubbles rise — `x/z += A·{sin,cos}(k·y + phase)·dt`, phase per-bubble from `spawnSeq`, driven by HEIGHT (not wall-clock) so it stays pure + replay-stable. Constants `BUBBLE_WOBBLE_VEL_MM_PER_S` (28) + `BUBBLE_WOBBLE_WAVENUMBER` (0.045). This is the lightweight spiral; the full **BubbleStableFluids2D** Stam slice (`domain/fluid-sim`, still unwired) would add genuine multi-stone column INTERACTION (one air-stone's plume nudging another's) — saved for a deeper pass, since the helix already delivers the "bubbles spiral up" read at a fraction of the cost. Determinism holds: the drift is a pure function of height + `spawnSeq`, so the 1000-tick two-world replay stays byte-identical.
- **`(sourceEid, spawnSeq)` is the cross-world stable sort key for the bubble snapshot.** bitECS' query returns entities in eid allocation order, but eids come from a module-global cursor — two cold worlds get distinct ranges and the raw iteration order would silently break the 1000-tick byte-identical replay. `snapshot()` sorts bubbles by `(sourceEid, spawnSeq)` before writing the pooled `bubblePosition` slab. Mirrors the F11.2 `spawnIndex`-instead-of-eid pattern.
- **`scene.equipment` mutations re-fire the spawn cycle.** The service's `spawnKey` fingerprint includes a per-equipment digest (kind + integer-mm position + flowRate@3dp + airRateMl); any add / remove / move / rate-change triggers re-bake of FlowField + SDF + re-register of bubble sources, then re-spawn of fish. No surgical update path — the F11.3 "rebuild on hardscape mutation" pattern extends here.

## Sim rate vs. render rate

- **Sim rate: 30 Hz** (`SIM_DT = 1/30`). Fixed dt — every `world.step()` advances by exactly `SIM_DT` seconds.
- **Render rate: 60 Hz** (driven by `requestAnimationFrame` in `three-3d-renderer.ts`).
- **Accumulator pattern in the RAF tick.** The renderer drains the accumulator with `while (accumulator >= SIM_DT_MS && steps < 4) world.step(SIM_DT)`. The 4-step cap prevents spiral-of-death after a tab pause; the accumulator gets dropped if we're still behind after four catch-up steps.
- **Interpolation alpha** = `accumulator / SIM_DT_MS` ∈ `[0, 1)`. The world's `snapshot(alpha)` lerps `Position` and slerps `Orientation` between the last two sim states so the renderer reads sub-tick-smooth values at 60 Hz.

The lib (`livestock-ecs`) does NOT own the accumulator — it just exposes `step(dt)` + `snapshot(alpha)`. The caller (renderer-3d's RAF) owns the loop.

## Performance budget (F11.6)

- **Target: p95 ≤ 4 ms ECS step at n=200 fish** with the full F11.5 system stack (Perception → Fear → Nip → Territory → Feeding → Curiosity → Schooling → Depth → FlowField → SteeringIntegrator → Collision → Kinematic → Animation → FoodSpriteLifetime → BubbleSourceSpawn → BubbleLifetime). At 30 Hz sim that leaves 29 ms of the 33 ms tick for everything else (RAF, render, layout, GC).
- **How to run the bench:**
  ```
  BENCH=1 pnpm exec nx test domain-livestock-ecs -t perf-bench
  ```
  Lives in `libs/domain/livestock-ecs/src/lib/perf-bench.spec.ts`. Builds 5 species × 40 fish (one preset per band + nipping + territorial variants), 5 hardscape entries, 2 air-stone bubble sources, 1 baked FlowField, 8 FoodSprites. Warm-up = 60 ticks; measured = 1000 ticks via `performance.now()` deltas.
- **Opt-in only.** `BENCH` env var; without it the suite reports `1 skipped` and exits in ~150 ms. CI does NOT run the bench — the hard correctness guarantees (no per-tick allocation, byte-identical determinism) live in the system specs + `determinism.spec.ts`, and bench numbers are machine-dependent.
- **Measured (Apple Silicon laptop, F11.5 stack, no SDF):** mean ≈ 2.6 ms, median ≈ 2.5 ms, **p95 ≈ 3.4 ms**, p99 ≈ 4.1 ms, max ≈ 5.0 ms. First run was under budget — no optimization required. Update this paragraph on a different reference machine if the numbers shift materially.
- **If you add a new system, run the bench.** Any addition to `step()` is a candidate hot-path regression. The likely hotspots if p95 starts breaching are: `SchoolingSystem` (three-zone neighbour iteration is the heaviest per-tick loop, worst-case O(neighbours-per-cell × n)); `CollisionSystem` fish-vs-fish pair iteration in dense clusters; per-tick allocations in any system; and the snapshot's bubble bubble-sort (`Array.from + sort` on each snapshot has GC overhead at 60 Hz — convert to a pre-allocated index array + insertion sort if it surfaces in a profile). Optimize ONLY where measurement points the finger — premature optimization is unnecessary churn against the "byte-identical determinism" contract.

## Determinism (load-bearing)

- **Same `(seed, livestock)` → bit-identical world state at every tick.** This is the single invariant the entire stage rests on. The 1000-tick replay spec in `apps/web/src/app/livestock-simulation.service.spec.ts` is the gate. The F11.2 byte-identity test in `libs/domain/livestock-ecs/src/lib/determinism.spec.ts` covers the behaviour-system path (registered species + tickPrng noise).
- **No `Math.random()` anywhere in `livestock-ecs` or the service.** Enforced by an `eslint no-restricted-syntax` rule scoped to the lib's `eslint.config.cjs`. Every random draw uses `seededHash01(seed, ...keys)` from `libs/domain/geometry/` (the same primitive `growth-sim` uses for scatter — see `growth-sim.md`).
- **Two PRNG streams seeded from `scene.seed`:**
  1. **Spawn PRNG** — `seededHash01(scene.seed XOR hash(entry.id), drawIndex, axisIdx)` produces initial positions, orientations, phase offsets. Re-seeded on every livestock-entry mutation.
  2. **Tick PRNG** — `tickPrng(world, ...keys)` returns `[0, 1)` from `seed XOR tickCounter XOR hash(keys)`. SchoolingSystem + DepthSystem call it for noise injection.
- **Per-entity tick-PRNG key MUST be `BehaviorParamsRef.spawnIndex[eid]`, not the raw bitECS eid.** bitECS allocates eids from a module-global cursor — two cold worlds in the same process get distinct id ranges, so a raw eid would silently break byte-identical replay across worlds. `spawnIndex` is a monotonic 0-based counter stamped on every `spawnFish` call and is stable across cold restarts with the same SpawnOpts sequence.
- **`scene.seed` is the entropy source.** It's already on `Scene` (`libs/domain/scene-model/src/types.ts`) — populated by `documentToScene` from `AquaDocument.seed`. No schema change was needed to plumb it through; if you find code falling back to a derived seed, file it as a regression.

## bitECS contract surface

- **The renderer never imports bitECS.** It consumes the `WorldSnapshot` interface — typed-array slabs (`Uint32Array ids`, `Float32Array position` stride 3, `Float32Array orientation` stride 4 quat, `Float32Array phase`, `Uint8Array archetype`, `Float32Array scale` mm) — and that's it. If a renderer file gains a `from 'bitecs'` import, it's wrong.
- **The snapshot is pooled.** `world.snapshot(alpha)` returns a shared object whose typed arrays may be mutated by the next call. Consumers must not retain references across calls; the bundle's `syncFromSnapshot` consumes in place and writes into Three.js `InstancedBufferAttribute`s, then never touches the snapshot again.
- **Components are SoA via `defineComponent` + bitECS `Types`.** Don't add per-entity allocations — the perf budget (Stage 11 F11.6) is `< 4 ms ECS step at n=200`, which requires zero allocation in the hot path. Pre-allocate any scratch buffers on the world's `dispose`-able lifecycle.

## Per-fin animation (3D fidelity pass — `finType` contract)

- **`FishGeometryDescriptor.finType` is one float per vertex** carrying a `FIN_TYPE` code (`BODY: 0, CAUDAL: 1, DORSAL: 2, ANAL: 3, PECTORAL: 4` — exported from `@aquascape/domain/fish-anatomy`, same const-object pattern as `FISH_ARCHETYPE`). The body builder writes BODY; each fin builder stamps its own code via `pushVertex`. The crawler archetype (no fins; antennae count as body) is all zeros. The domain descriptor keeps `spineUv.y = 0` everywhere.
- **The renderer does NOT upload `finType` as its own attribute — it packs the code into `spineUv.y`** (`packFinTypeIntoSpineUv` in `build-livestock-meshes.ts`, a copy — the shared descriptor buffer is never mutated). **Load-bearing: the livestock shader program sits exactly at ANGLE/SwiftShader's `MAX_VERTEX_ATTRIBS = 16`** (three's prefix declares `position` + `normal` + `uv` + the 4-slot `instanceMatrix` = 7 slots; our 9 custom attribute declarations make 16, and that translator counts **declared** attributes, active or not). A 17th `finType` attribute failed program linking with `Too many attributes` and **no fish rendered at all** — observed headlessly, invisible to unit tests (jest never compiles GLSL). Any future per-vertex data must ride an existing channel (or replace one); a regex regression test caps the shader's declared-attribute count at 9. The fragment scale shimmer now samples `fract(vSpineUv.y)` — identical output to the constant-0 channel it had before, since the codes are integers.
- **The vertex shader's `// FIN FLUTTER` block** (between `// /CARANGIFORM` and the per-instance transform in `LIVESTOCK_VERTEX_SHADER`) adds a low-amplitude secondary oscillation at **2.3× `instanceTailBeatFreq`**: dorsal + anal flutter laterally (local Z, 0.02 BL, anal offset +2.1 rad so they're not in lockstep), pectorals row in a Y/Z mix (0.018 / 0.008 BL, offset +4.2 rad). Branchless `float(finCode == N.0)` lane selection (`finCode = spineUv.y`). Both the carangiform block and the flutter block are pinned by regex source tests in `build-livestock-meshes.spec.ts` — keep the markers + formula lines intact.
- **The caudal stays carangiform-driven** (no `finCode == 1.0` lane — a regex test asserts its absence): it already gets the largest spine-wave displacement at s ≈ 1.
- **The flutter is gated by `instanceAmpTail / 0.12`** (ratio to the nominal tail amp), so crawler instances — whose carangiform amps the renderer zeroes every sync — don't flutter, and any future amp-zeroed instance is automatically still.
- **Normals are left undisplaced** by the flutter, consistent with the carangiform displacement (which also doesn't recompute them). Render-side only — no ECS / `WorldSnapshot` change, so the 1000-tick byte-identical replay is untouched.

## Catalog `behavior` block (F11.2 — real schema)

F11.2 Wave 2 bumped the catalog manifest from `schemaVersion: 2 → 3` and added the `behavior?: { schooling?, depth?, animation? }` branch on `LivestockEntry` with `additionalProperties: false` at every level. Param types (`SchoolingParams`, `DepthParams`, `AnimationParams`) are owned by `@aquascape/domain/livestock-behaviors`; the catalog imports them as types only so the dep edge runs catalog → behaviors. The manifest migration is purely additive — v2 rows (no `behavior` block) load unchanged and `resolveBehavior()` picks the per-group preset.

- **Most catalog rows leave `behavior` absent.** Defaults via `resolveBehavior` are the design — manifest authors only declare what they want to override. `core/livestock.fish.neon-tetra` carries a single override (`schooling.wCoh: 1.5`) as a sample.
- **`resolveBehavior` is the only call site.** Don't read `entry.behavior` directly anywhere outside `livestock-behaviors`; always go through `resolveBehavior` so a missing field falls back to the preset instead of throwing.
- **Resolution heuristics:** explicit `tags: ['depth:top'|'depth:mid'|'depth:bottom']` wins; then `group: 'shrimp' | 'snail'` → bottom; then id substring (`'hatchet'/'gourami'/'pencilfish'` → top, `'cory'/'kuhli'/'pleco'/'oto'/'loach'` → bottom); fish/unknown default to mid.
- **F11.3+ extensions** will add `territory?`, `nipping?`, `fear?`, `feeding?`, `curiosity?` to the same block. They'll land additively, no schema bump per substage; manifest schemaVersion only bumps when a non-additive change forces it.

## Real-browser verification — closed

The earlier coverage gap (no test could verify a fish pixel actually paints) is closed. `apps/web-e2e/src/livestock-3d.spec.ts` drives a real chromium against `nx serve web`:

- Toggles to 3D mode via `Ctrl+Shift+3`.
- Adds tetras through `LivestockToolComponent` (the real user flow — not the debug hook).
- Asserts via `window.__aquascape_debug__.getEntityCount()` that the ECS world holds the expected entities.
- Asserts pixel-channel variance on the 3D canvas > 100 (proves not blank — typical scene measures ~7k).
- Asserts frame-to-frame pixel diff > 50 over 800 ms (proves RAF + ECS + InstancedMesh attribute updates are alive — tail wiggle produces ~500 px diff).

Load `docs/caveats/e2e.md` for the load-bearing details: debug-hook contract, Playwright config + dev-server race, variance/diff floors, CI cache strategy. F11.3+ behaviour specs extend this same spec rather than re-introducing the gap.
