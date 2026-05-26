# livestock-ecs caveats

**Load this when:** touching `libs/domain/livestock-ecs/`, `libs/domain/fish-anatomy/`, `libs/rendering/livestock-renderer-3d/`, or `apps/web/src/app/livestock-simulation.service.ts`. Cross-load `renderer-3d.md` if your change crosses into the 3D RAF tick or the bundle's dispose surface.

## Scope of F11.1 + F11.2

F11.1 shipped six static archetype meshes wiggling in place. F11.2 makes them swim — Perception → Schooling → Depth → SteeringIntegrator now run before Kinematic, and every entity tagged with a `BehaviorParamsRef` resolves Couzin three-zone schooling + vertical-band stratification each tick. Entities with `handleIdx === NO_BEHAVIOR_HANDLE` stay on the F11.1 static-wiggle path (the integrator short-circuits before touching Velocity).

F11.3 territoriality + nipping + fear; F11.4 feeding + grazing + curiosity; F11.5 flow field + hardscape SDF + bubble columns; F11.6 per-species presets + perf budget; F11.7 ambient polish (water surface, day-night, plant sway).

## World lifecycle

- **Owned by `LivestockSimulationService` in `apps/web`**, not by the renderer. The world survives the 2D ↔ 3D toggle. The renderer's `dispose()` only releases the GPU bundle; the world stays alive in the service.
- **Lazy creation.** The world is built on the first emission with non-empty `scene.livestock`. Empty livestock → no world (the service returns `null` from `getWorld()`).
- **Re-spawn on scene change.** When `(scene.seed, scene.livestock)` changes, the service tears down the world's entities and re-spawns them deterministically. The world object itself is reused across re-spawns (no GC churn); only the entities cycle.
- **One world per document.** Opening a new document tears down the world entirely (the `apps/web` document slice fires a "scene replaced" signal that the service observes).

## ParamStore + tankAabb (F11.2)

- **Species behaviour lives on the world's `ParamStore`, not on each entity.** A 200-fish school carries 200 × `BehaviorParamsRef` (4 B) instead of 200 × `SchoolingParams + DepthParams` (~88 B). Register via `world.registerSpeciesBehavior(speciesId, ResolvedBehavior)` → returns a `handleIdx` to pass back through `spawnFish({ ..., behaviorHandleIdx })`. Idempotent on `speciesId` — re-registration updates the row in place so existing entities pick up the new params on the next tick.
- **`NO_BEHAVIOR_HANDLE` (0xffff) = no behaviour registered.** Behaviour systems early-out and the entity stays on the F11.1 static-wiggle path (Velocity=0, only AnimationPhase advances). Useful for tests + the F11.1 fallback path the renderer's "fish wiggle even without a catalog behaviour block" contract relies on.
- **`world.tankAabb` is mutable; call `world.setTankAabb(aabb)`** to resize the interior box when the document's tank changes. DepthSystem reads `tankHeight = maxY - minY` each tick, SteeringIntegrator projects Velocity against the faces, KinematicSystem's clamp catches rounding-error escapes. The `LivestockSimulationService` already tears down + re-spawns on tank change today, but the world itself can survive a tank resize — let the AABB mutate before reaching for a full rebuild.

## System ordering (current + reserved)

F11.1 ran only Kinematic + Animation. F11.2 fills in Perception → Schooling → Depth → SteeringIntegrator. The plan reserves these seats in this order for F11.3+; honour it when adding new systems:

```
PerceptionSystem      (F11.2 — rebuilds the SpatialGrid)
FearSystem            (F11.3 — risk-driven mode flips, runs early so other behaviours read the latest mode)
NippingSystem         (F11.3)
TerritorialSystem     (F11.3)
FeedingSystem         (F11.4)
SchoolingSystem       (F11.2)
DepthSystem           (F11.2)
FlowFieldSystem       (F11.5)
SteeringIntegrator    (F11.2 — sums forces, clamps maxForce + maxTurnRate)
CollisionSystem       (F11.5 — SDF deflect)
KinematicSystem       (always last among physics — integrates velocity)
AnimationSystem       (always last overall — purely visual, no state reads)
```

"First system with a non-null target wins" — arbitration is by priority, not by force summation, for mode-flipping behaviours (Fear → Nip → Territory → Feeding). Schooling + Depth + Flow are additive forces summed by SteeringIntegrator.

## Sim rate vs. render rate

- **Sim rate: 30 Hz** (`SIM_DT = 1/30`). Fixed dt — every `world.step()` advances by exactly `SIM_DT` seconds.
- **Render rate: 60 Hz** (driven by `requestAnimationFrame` in `three-3d-renderer.ts`).
- **Accumulator pattern in the RAF tick.** The renderer drains the accumulator with `while (accumulator >= SIM_DT_MS && steps < 4) world.step(SIM_DT)`. The 4-step cap prevents spiral-of-death after a tab pause; the accumulator gets dropped if we're still behind after four catch-up steps.
- **Interpolation alpha** = `accumulator / SIM_DT_MS` ∈ `[0, 1)`. The world's `snapshot(alpha)` lerps `Position` and slerps `Orientation` between the last two sim states so the renderer reads sub-tick-smooth values at 60 Hz.

The lib (`livestock-ecs`) does NOT own the accumulator — it just exposes `step(dt)` + `snapshot(alpha)`. The caller (renderer-3d's RAF) owns the loop.

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

## Catalog `behavior` block (F11.2 — real schema)

F11.2 Wave 2 bumped the catalog manifest from `schemaVersion: 2 → 3` and added the `behavior?: { schooling?, depth?, animation? }` branch on `LivestockEntry` with `additionalProperties: false` at every level. Param types (`SchoolingParams`, `DepthParams`, `AnimationParams`) are owned by `@aquascape/domain/livestock-behaviors`; the catalog imports them as types only so the dep edge runs catalog → behaviors. The manifest migration is purely additive — v2 rows (no `behavior` block) load unchanged and `resolveBehavior()` picks the per-group preset.

- **Most catalog rows leave `behavior` absent.** Defaults via `resolveBehavior` are the design — manifest authors only declare what they want to override. `core/livestock.fish.neon-tetra` carries a single override (`schooling.wCoh: 1.5`) as a sample.
- **`resolveBehavior` is the only call site.** Don't read `entry.behavior` directly anywhere outside `livestock-behaviors`; always go through `resolveBehavior` so a missing field falls back to the preset instead of throwing.
- **Resolution heuristics:** explicit `tags: ['depth:top'|'depth:mid'|'depth:bottom']` wins; then `group: 'shrimp' | 'snail'` → bottom; then id substring (`'hatchet'/'gourami'/'pencilfish'` → top, `'cory'/'kuhli'/'pleco'/'oto'/'loach'` → bottom); fish/unknown default to mid.
- **F11.3+ extensions** will add `territory?`, `nipping?`, `fear?`, `feeding?`, `curiosity?` to the same block. They'll land additively, no schema bump per substage; manifest schemaVersion only bumps when a non-additive change forces it.

## Coverage gap

- **No real-browser smoke test yet.** Component-level specs cover the wiring (3D mode injects `livestockWorld`; service registers behaviours; world `step()` runs at `SIM_DT` from the RAF tick), and the schooling-system phase tests prove the math under headless conditions (polarisation, torus-mill, swarm). **Nothing verifies that a fish pixel actually appears on screen, that the depth bands look right at typical tank sizes, or that the orbit-camera + livestock interact correctly.** The ShaderMaterial's GLSL compile is regex-checked against shader source. Filling this in requires wiring the `apps/web-e2e` Playwright target (still a Stage-0 `nx:noop` placeholder); F11.3+ behaviour visibility is increasingly hard to verify without it — worth landing before F11.3.
