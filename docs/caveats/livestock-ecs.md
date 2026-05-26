# livestock-ecs caveats

**Load this when:** touching `libs/domain/livestock-ecs/`, `libs/domain/fish-anatomy/`, `libs/rendering/livestock-renderer-3d/`, or `apps/web/src/app/livestock-simulation.service.ts`. Cross-load `renderer-3d.md` if your change crosses into the 3D RAF tick or the bundle's dispose surface.

## Scope of F11.1

Six static archetype meshes wiggle in place. No steering, no schooling, no collision, no flow. F11.2 adds schooling + vertical stratification; F11.3 territoriality + nipping + fear; F11.4 feeding + grazing + curiosity; F11.5 flow field + hardscape SDF + bubble columns; F11.6 per-species presets + perf budget; F11.7 ambient polish (water surface, day-night, plant sway).

## World lifecycle

- **Owned by `LivestockSimulationService` in `apps/web`**, not by the renderer. The world survives the 2D ↔ 3D toggle. The renderer's `dispose()` only releases the GPU bundle; the world stays alive in the service.
- **Lazy creation.** The world is built on the first emission with non-empty `scene.livestock`. Empty livestock → no world (the service returns `null` from `getWorld()`).
- **Re-spawn on scene change.** When `(scene.seed, scene.livestock)` changes, the service tears down the world's entities and re-spawns them deterministically. The world object itself is reused across re-spawns (no GC churn); only the entities cycle.
- **One world per document.** Opening a new document tears down the world entirely (the `apps/web` document slice fires a "scene replaced" signal that the service observes).

## System ordering (current + reserved)

F11.1 runs only Kinematic + Animation. The plan reserves these seats in this order for F11.2+; honour it when adding new systems:

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

- **Same `(seed, livestock)` → bit-identical world state at every tick.** This is the single invariant the entire stage rests on. The 1000-tick replay spec in `apps/web/src/app/livestock-simulation.service.spec.ts` is the gate.
- **No `Math.random()` anywhere in `livestock-ecs` or the service.** Enforced by an `eslint no-restricted-syntax` rule scoped to the lib's `eslint.config.cjs`. Every random draw uses `seededHash01(seed, ...keys)` from `libs/domain/geometry/` (the same primitive `growth-sim` uses for scatter — see `growth-sim.md`).
- **Two PRNG streams seeded from `scene.seed`:**
  1. **Spawn PRNG** — `seededHash01(scene.seed XOR hash(entry.id), drawIndex, axisIdx)` produces initial positions, orientations, phase offsets. Re-seeded on every livestock-entry mutation.
  2. **Tick PRNG** — `tickPrng(world, ...keys)` returns `[0, 1)` from `seed XOR tickCounter XOR hash(keys)`. Reserved for F11.2+ noise injection. Exposed now to lock the API; not called by F11.1's systems.
- **`scene.seed` is the entropy source.** It's already on `Scene` (`libs/domain/scene-model/src/types.ts`) — populated by `documentToScene` from `AquaDocument.seed`. No schema change was needed to plumb it through; if you find code falling back to a derived seed, file it as a regression.

## bitECS contract surface

- **The renderer never imports bitECS.** It consumes the `WorldSnapshot` interface — typed-array slabs (`Uint32Array ids`, `Float32Array position` stride 3, `Float32Array orientation` stride 4 quat, `Float32Array phase`, `Uint8Array archetype`, `Float32Array scale` mm) — and that's it. If a renderer file gains a `from 'bitecs'` import, it's wrong.
- **The snapshot is pooled.** `world.snapshot(alpha)` returns a shared object whose typed arrays may be mutated by the next call. Consumers must not retain references across calls; the bundle's `syncFromSnapshot` consumes in place and writes into Three.js `InstancedBufferAttribute`s, then never touches the snapshot again.
- **Components are SoA via `defineComponent` + bitECS `Types`.** Don't add per-entity allocations — the perf budget (Stage 11 F11.6) is `< 4 ms ECS step at n=200`, which requires zero allocation in the hot path. Pre-allocate any scratch buffers on the world's `dispose`-able lifecycle.

## Catalog `behavior` block — forward-read

The catalog's `LivestockEntry.behavior` block is the design surface for F11.2+ (schooling params, depth bands, territory radii, etc.). **It is NOT on the catalog schema yet** — the schema bump (catalog manifest `schemaVersion: 2 → 3`) lands with F11.2.

For F11.1, the `LivestockSimulationService` forward-reads `behavior.animation.tailBeatFreq` etc. through a **structural cast** (`const behavior = (catalogRow as { behavior?: { animation?: …; } }).behavior`). When the field is absent — which it always is in F11.1 — defaults apply (4 Hz, ampHead 0.02, ampTail 0.12). This deliberately tolerates catalog rows that don't yet declare the block; F11.2 will add the real schema branch + the AJV mirror.

**Don't** wire a runtime validator that rejects rows without a `behavior` block — every existing catalog row would fail. Defaults are the right answer until F11.2 lands the schema and a migration.

## Coverage gap

- **No real-browser smoke test for F11.1.** The component-level spec in `apps/web/src/app/app.component.spec.ts` asserts the wiring (3D mode injects `livestockWorld`; 2D mode omits it), and `three-3d-renderer.spec.ts` asserts the RAF tick steps the world at `SIM_DT`. **Neither verifies that a fish pixel actually appears on screen.** The ShaderMaterial's GLSL compile-time correctness is verified by a regex check on the shader source, not by a real WebGL context. Filling this in requires wiring the `apps/web-e2e` Playwright target (still a Stage-0 `nx:noop` placeholder); not a F11.1 blocker but worth a follow-up before F11.2 lands the visible behaviours that *do* depend on the render being correct.
