# Stage 11 — Animated Livestock + Ambient 3D Polish

## Context

Stage 7 added `LivestockEntry` to the document as inventory only (id + ref + quantity + reserved `decorObjectId` slot). Stage 10 v1 (Three.js renderer) explicitly deferred fish rendering — the header in `libs/rendering/renderer-3d/src/three-3d-renderer.ts:23` calls it out as future scope. The `.aqua` document already carries a `seed` and the catalog already carries `temperament`, `schoolingMin`, `bioloadClass`, and `compatibilityFlags` — those are advisory today (stocking warnings) but were sized for this work.

This stage brings the inventory to life **and** lands the ambient-scene polish that Stage 10 v1 deferred. Each `LivestockEntry` becomes N visible animated fish, populating the 3D scene deterministically from the document's seed. Behaviors (schooling, vertical stratification, glass-surfing, territoriality, fin-nipping, hiding, feeding, grazing) are driven by an Entity Component System. Fish swim under kinematic steering, avoid hardscape via a baked SDF, and respond to a precomputed tank flow field. Air-stone equipment produces visible bubble columns through a 2D stable-fluids slice. A final substage adds the ambient layer — animated water surface, dynamic lighting / day-night cycle, and plant sway — so the 3D view reads as alive rather than diorama-still.

**Out of scope for Stage 11:** persisted instance positions (instances are transient + seed-driven), real rigid-body solver (kinematic only), full SPH / PBF fluid (precomputed flow field + 2D bubble slice + procedural water surface only — no global free-surface solve), 2D-renderer livestock parity (3D-only — matches v1's "3D = simulation, 2D = authoring" split), authoring-time editing of individual fish (read-only simulation, same as v1), authoring-time editing of the day-night cycle (catalog-driven preset cycle only).

**Anchoring research:** A vetted bibliography lives at [`docs/research/stage-11-livestock-subsystem.md`](../docs/research/stage-11-livestock-subsystem.md) (read it before implementing each substage). Key papers: Reynolds 1987/1999, Couzin et al. 2002, Tu & Terzopoulos 1994, Stam 1999/2003, Gates 2001, Lima & Dill 1990, Maynard Smith & Parker 1976, Iovino et al. 2024. Sub-stage sections below cite the directly load-bearing ones.

## Architecture decisions (locked)

1. **Phasing:** Seven substages F11.1–F11.7, each independently shippable with DoD + caveat updates.
2. **Persistence:** Transient + seed-driven. The document's existing `seed` field is the entropy source; each load re-spawns the population deterministically. **No schema change to `LivestockEntry`'s instance shape** — only optional, additive behavior fields on the *catalog* `LivestockEntry` (v2 → v3 schema bump for the *catalog manifest*; the document schema is unchanged because instance state is transient).
3. **Physics:** Kinematic steering forces (Reynolds 1999) + per-fish ellipsoid sweep against a baked hardscape SDF. No `cannon-es` / `rapier`. Determinism preserved across browsers.
4. **Behavior data:** Optional `behavior` block on the catalog `LivestockEntry`. Defaults are filled in by a `resolveBehavior(entry)` function so existing catalog rows stay valid.

## Architecture — new libs and dependency graph

Five new libraries, all under existing module-boundary tags. Nx tags enforce that nothing pulls Three.js into `domain/*`.

```
libs/domain/livestock-ecs/         scope:domain   pure TS, no Three.js, no Angular
  ├ Components (SoA typed arrays via bitECS)
  ├ World factory, query helpers
  ├ Spatial grid (uniform 3D hash, cell ≈ max(ZOR,ZOA))
  ├ Deterministic PRNG (reuses domain/geometry seeded hash)
  └ Systems: Perception, Schooling, Depth, Territory, Nipping,
            Fear/Startle, Feeding, Grazing, Curiosity/Glass,
            FlowField, SteeringIntegrator, Collision, Kinematic,
            Animation

libs/domain/livestock-behaviors/   scope:domain   pure TS
  ├ Per-species behavior schema (Zod or hand-rolled type guards)
  ├ resolveBehavior(catalogEntry) → ResolvedBehavior with defaults
  └ Behavior presets (top/mid/bottom defaults, peaceful/semi/aggro)

libs/domain/fluid-sim/             scope:domain   pure TS
  ├ FlowField (32³ × Vec3, baked once per scene)
  ├ Flow bake: divergence-free solve from outflow/return positions
  └ BubbleStableFluids2D (32×32 vertical slice per air-stone)

libs/domain/fish-anatomy/          scope:domain   pure TS
  ├ Six procedural archetypes (slim-tetra, deep-bodied, barb,
  │   cory-cylinder, eel, hatchet-wedge) — each returns a
  │   BufferGeometry-shaped descriptor (positions, indices,
  │   spine UVs) ready for Three.js consumption
  ├ Fin geometry helpers (caudal, dorsal, anal, pectoral)
  └ archetypeForSpecies(catalogEntry) — maps to an archetype id

libs/rendering/livestock-renderer-3d/  scope:rendering    Three.js
  ├ Builders that consume fish-anatomy descriptors and produce
  │   InstancedMesh per archetype (one draw call per archetype)
  ├ Vertex shader: carangiform sine-spine deformation, per-instance
  │   phase + frequency + amplitude attributes
  ├ Bubble particle system (sprite billboards on shader-driven
  │   advection from BubbleStableFluids2D)
  └ SDF bake for collision (texture3D, ~64³)
```

Wiring (existing files extended):

```
libs/rendering/renderer-3d/src/three-3d-renderer.ts
  └ render() adds livestock content group (one InstancedMesh per archetype)
  └ RAF tick gains an ECS step at fixed 30 Hz with render interpolation
     to 60 Hz

libs/domain/catalog/src/types.ts
  └ LivestockEntry gains optional behavior: BehaviorBlock

libs/domain/document/src/aqua-document.ts
  └ Catalog manifest schemaVersion 2 → 3 (livestock entries gain
     optional behavior). Document schemaVersion unchanged.
```

## Sub-stage breakdown

Each substage is one PR. DoD per substage: typed public API, unit tests ≥ 90% coverage in domain libs, at least one e2e or component test through the UI, `README.md` + `CLAUDE.md` + matching `docs/caveats/*.md` updated in the same PR. Coverage gate workflow in `.github/workflows/pr.yml` selector must be extended to include each new lib.

### F11.1 — ECS scaffolding + procedural fish meshes (foundation)

**Goal:** Six archetype meshes render statically in the 3D view; ECS world exists and ticks but only runs the Kinematic + Animation systems (fish wiggle in place at a fixed point).

New libs:
- `libs/domain/livestock-ecs/` — bitECS world, components (Position, Velocity, Orientation, SpeciesId, BodyLength, Archetype, AnimationPhase, BehaviorMode enum), Kinematic + Animation systems only. Frame loop scheduler with fixed-dt accumulator (sim 30 Hz, render 60 Hz interpolation).
- `libs/domain/fish-anatomy/` — six archetypes returning `FishGeometryDescriptor` (positions, normals, uvs, indices, spineUv). Body ellipsoid + caudal/dorsal/anal/pectoral fins as separate geometry groups. **Proportional scaling from catalog `adultSize` (mm)** — anatomy is normalized to BL=1 then scaled at the InstancedMesh per-instance.
- `libs/rendering/livestock-renderer-3d/` — `buildLivestockMeshes(scene, catalog, ecsWorld)` returns a Group containing one `InstancedMesh` per archetype. Vertex shader (Gates 2001, Liu & Hu 2010 carangiform):
  ```glsl
  amplitude(s) = ampHead + (ampTail-ampHead) * pow(s, envelopeExp);
  phase(s,t)   = 2π * (t/T - s/L) + instancePhase;
  vertex.y    += amplitude(s) * sin(phase);
  ```
  Per-instance attributes: position, orientation quat, tail-beat freq, amplitude pair, scale.

Existing files extended:
- `libs/rendering/renderer-3d/src/three-3d-renderer.ts` — `render()` adds `buildLivestockMeshes(...)` to the content group at line 398 (after plants, so fish paint on top). The RAF loop in `startAnimationLoop()` (line 347) gains an ECS step:
  ```ts
  const tick = (now) => {
    accumulator += now - lastTime;
    while (accumulator >= SIM_DT) { ecs.step(SIM_DT); accumulator -= SIM_DT; }
    ecs.interpolate(accumulator / SIM_DT);  // updates InstancedMesh matrices
    ctl?.update();
    r.render(s, c);
    ...
  }
  ```
- `apps/web/src/app/app.component.ts` — DI for a new `LivestockSimulationService` (owns the bitECS World, spawns instances from `scene.livestock`, exposes a signal so renderer-swap can carry sim state across 2D↔3D toggles).
- `libs/domain/scene-model/src/types.ts` — no changes. `LivestockEntry` already has everything it needs.

**Population rule:** On scene load (or any livestock command), `LivestockSimulationService` reads `scene.livestock`, resolves each entry's catalog row + behavior block, and spawns `entry.quantity` ECS entities at seeded positions inside the tank interior. PRNG seeded by `document.seed` XOR `entry.id` so position determinism is per-entry-stable.

**Caveat file:** new `docs/caveats/livestock-ecs.md` — "Load this when touching the bitECS world, system ordering, or sim-vs-render rate."

### F11.2 — Schooling + vertical stratification

**Goal:** Tetras school cohesively, hatchetfish hug the surface, cories scoot along the substrate. Visually obvious change.

New behavior types in `libs/domain/livestock-behaviors/`:
```ts
interface SchoolingParams { ZOR: number; ZOO: number; ZOA: number;
  blindAngle: number; vPref: number; vMax: number; turnMax: number;
  wSep: number; wAli: number; wCoh: number; noise: number; }
interface DepthParams { preferredY: number; bandWidth: number;
  returnForce: number; }
```

New systems (livestock-ecs):
- **PerceptionSystem** — rebuilds the spatial grid (one uniform hash for all queries: schooling, territory, nipping, refuge). Cell size = `max(ZOR, ZOA, coreRadius)` over the population.
- **SchoolingSystem** — Couzin 2002 three-zone (ZOR/ZOO/ZOA) with blind cone, summing Reynolds 1987 separation/alignment/cohesion forces with per-species weights.
- **DepthSystem** — Y-spring toward `preferredY * tank.height`; out-of-band fish get a returnForce, in-band fish only get noise.
- **SteeringIntegrator** — sums all behavior forces, clamps by `maxForce` and `maxTurnRate`.

Behavior presets per group (defaults applied via `resolveBehavior` when catalog block is absent):
- *Top* (hatchetfish, gourami): `preferredY ≈ 0.92`, weak alignment, strong y-return.
- *Mid* (tetras, rasboras, danios): `preferredY ≈ 0.55`, moderate ZOO/ZOA, tight school.
- *Bottom* (cory, kuhli, pleco): `preferredY ≈ 0.05`, weak alignment, scoot impulses (burst-and-glide via stochastic `vPref` modulation).

**Tests:** Polarization metric ≥ 0.8 for tetra-default params at n=12 fish after 200 ticks. Phase-test: ZOO ≪ ZOA → polarized school; ZOO ≫ ZOA → torus mill; both small → swarm. Hatchetfish `preferredY ≥ 0.85` mean Y over 100 ticks. Determinism: same seed → identical position arrays after N ticks.

### F11.3 — Territoriality, fin-nipping, hiding/timid

**Goal:** Cichlids defend caves, tiger barbs nip bettas, startled tetras dart to plants.

New components:
- `Territory { anchorEid, coreRadius, displayRadius, aggression, fatigueRate }`
- `NippingDrive { groupThreshold, finFraction, rate }`
- `FearState { risk, mode: FORAGE|REFUGE, emergenceTimer }`

New systems (run after PerceptionSystem, before SchoolingSystem):
- **TerritorialSystem** — anchor + radius (Brown 1964, Adams 2001). Each territorial fish owns a hardscape anchor (auto-assigned at spawn time to the nearest cave/wood entity). Inside `coreRadius` non-conspecifics get a chase force; outside `displayRadius` they're ignored. Bourgeois conflict rule (Maynard Smith & Parker 1976): owner wins, intruder retreats away from anchor. Fatigue decays aggression over 5–15 s.
- **NippingSystem** — `NippingDrive` fires when `visibleConspecifics < groupThreshold`. Candidate victims are out-of-species fish with `finLengthFraction > nipTargetFinLengthFraction` and `speed < self.speed * 0.5`. Brief dart override.
- **FearSystem + StartleSystem** — risk = baseline + α·predatorVisibility + β·startleImpulse·decay(τ) + γ·lightLevel. Mode flips to REFUGE above species `refugeThreshold`. Refuge target = nearest hardscape tagged `cover` (dense plants, caves, driftwood). On emerge, wait `emergenceDelay` seconds.

Auto-anchor assignment: at spawn, each territorial fish picks the nearest hardscape entity within `2 × coreRadius`. If none in range, the fish is non-territorial-this-spawn. Anchor reassignment happens on hardscape mutation (subscribe to scene-model commands).

Hardscape "cover" tagging: add an optional `coverScore` to `HardscapeEntry` in the catalog (range [0,1]); auto-defaulted from category (`wood: 0.6`, `rock: 0.4`, `other: 0`). Plants are tagged `coverScore = 0.5 * density` based on existing scatter polygons.

**Caveat update:** `docs/caveats/livestock-ecs.md` gains the system-ordering table (Perception → Fear → Nip → Territory → Feeding → Schooling → Depth → Flow → Steering → Collision → Kinematic → Animation) — strict priority arbitration via "first system with a non-null target wins."

### F11.4 — Feeding, grazing, curiosity/glass-surfing

**Goal:** Otocinclus graze algae on rocks, silver dollars nibble plants, peaceful fish wander to a food sprite on user-triggered "feed."

New components:
- `FeedingDrive { hunger, threshold, category, circadianPhase }`  where `category ∈ surface | midwater | substrate | algae-grazer | plant-eater | detritivore`.
- `Curiosity { boldness, rate, dwell }`.

New systems:
- **FeedingSystem** — hunger accumulates linearly (1.0 = full hunger after species-typical 6–24 h sim time, scaled to 60–180 real-time seconds for visibility). Above threshold, fish seek nearest food cue per category. **Grazers and plant-eaters bias their wander toward `nearest surface with algaeScore > 0`** and decrement `algaeScore` continuously (rasping).
- **CuriositySystem / GlassInterestSystem** — Poisson trigger at `rate` Hz creates a transient front-pane attraction point; cleared after `dwell` s. Boldness gates the trigger probability.

UI additions in `libs/features/livestock-equipment/`:
- A "Feed tank" button dispatches a transient `FeedingPulse` action; the renderer spawns food sprite entities that the FeedingSystem picks up. Sprites have a 30 s lifetime, then despawn (no document mutation).

**Algae scoring (rendered):** A scalar field stored alongside the hardscape SDF; visualized as a subtle green tint on rock/glass surfaces that re-grows over sim-time hours. Already low-fidelity, deliberately hand-wavy.

### F11.5 — Flow field, hardscape SDF collision, bubble columns

**Goal:** Fish drift slightly toward filter intake, get pushed by current near outflow. Air-stone equipment produces a rising bubble column. Fish stop swimming through rocks.

New lib `libs/domain/fluid-sim/`:
- **FlowField** — 32×32×32 × Vec3 cell grid baked once per scene. Sources: each filter `outflow` position (positive divergence point) and each `intake` (negative divergence). Single Stam-style projection step makes the field divergence-free. Bake re-runs whenever equipment moves or tank dims change.
- **BubbleStableFluids2D** — one 32×32 vertical slice per air-stone equipment item, mapped to a plane in front of the air-stone. Standard Stam 1999/2003 advect/diffuse/project loop at sim-tick rate.

New SDF bake in `libs/rendering/livestock-renderer-3d/`:
- 64³ Float32 SDF of hardscape geometry, baked once at scene load (re-baked on hardscape mutation, debounced 200 ms). Stored on the GPU as a 3D texture for shader access AND as a CPU typed-array for CollisionSystem reads.

New systems:
- **FlowFieldSystem** — `pos → trilinearSample(flowField, pos) → force += sample * dragCoeff`. Adds tank current to every fish's force sum.
- **CollisionSystem** — for each fish: read `sdf.gradient(pos)`. If `sdf(pos) < BL × 0.5`, deflect velocity tangent to the gradient and inject a small repulsive force. Fish-vs-fish: use the same spatial grid; check pairs in adjacent cells with simple capsule overlap.

Bubbles:
- New `BubbleParticleSystem` in `livestock-renderer-3d/` — sprite billboards seeded at the air-stone, advected through the 2D slice's velocity field, rise to the waterline, despawn. ~200 bubbles max per stone.

Equipment catalog gains optional `flow?: { outflowVec?: Vec3; flowRate?: number }` on filter/pump entries and `airRateMl?: number` on air-stone entries. Backward-compatible; absent = no flow contribution.

### F11.6 — Polish + per-species presets + perf budget

**Goal:** Ship a curated set of behavior presets for the catalog's most common 20–30 species, hit the 60fps@200-fish budget on a 2022-class iGPU, and round out UX.

Work:
- Author `behavior` blocks for 20–30 catalog livestock entries (cardinals, neon tetras, ember tetras, harlequins, cherry barbs, tiger barbs, hatchetfish, gouramis, angelfish, discus, German rams, Apistogramma, bettas, kuhli loaches, corydoras varieties, otocinclus, plecos, common shrimp, snails).
- Performance pass:
  - Single uniform 3D grid hash amortizes neighbour queries across all systems (one rebuild per tick).
  - InstancedMesh per archetype = ≤6 livestock draw calls.
  - SoA components in bitECS = zero per-fish allocations after spawn.
  - Sim 30 Hz / render 60 Hz with linear interpolation of `Position` and slerp of `Orientation`.
  - Budget: < 4 ms ECS step at n=200, < 2 ms render-overhead from livestock, total frame budget unchanged.
- UI: a "behavior debug" overlay (dev-only, behind a feature flag) shows each fish's BehaviorMode, current force, and territorial anchor lines. Useful for the test plan and for users who want to peek.
- Snail + shrimp: handled by a simpler "crawler" archetype with a different kinematic model (substrate-glued, slow wander, no schooling). Snail entity uses surface-conforming locomotion against the SDF gradient.

### F11.7 — Ambient scene polish: water surface, day-night, plant sway

**Goal:** Land the three "the tank looks alive" items that Stage 10 v1 deferred and the README originally listed as a Stage 10 v2 milestone. None of them touch the document or the ECS; all three are renderer-only and read-only in 3D (no authoring controls).

Work:
- **Animated water surface.** Single Three.js plane at the waterline with a vertex shader sampling two stacked Gerstner / sine wave bands (low-frequency swell + high-frequency ripple). Amplitude pinned to ≤ 2 mm so the silhouette doesn't fight the substrate profile or hardscape AABBs. Refraction approximated via a screen-space normal perturbation against the existing scene framebuffer (no full screen-space refraction — single render pass, no extra render target). Surface caustics via a deterministic 2-channel noise texture animated by `tick * causticSpeed`; caustics modulate the directional light's intensity on substrate + hardscape (cheap — one extra texture sample in the existing PBR fragment shader).
- **Dynamic lighting / day-night cycle.** A `DayNightService` lives in `apps/web` and exposes a normalized `phase ∈ [0, 1)` driven by either real time (default off) or a UI scrub slider (mirrors the existing time-slider pattern). The renderer's directional light + ambient term + background tint key off `phase` via a small lookup ramp (dawn / noon / dusk / night). Plant scatter density picks an emissive boost at night so darker scenes don't go featureless. Equipment lights (catalog `equipment` entries with `category = 'lighting'`) override the directional light intensity once the user toggles "respect equipment schedule" — wire to the equipment entry's optional `photoperiodHours` field if present, otherwise default to a 10 h on / 14 h off cycle.
- **Plant sway.** Vertex displacement on the existing plant InstancedMesh: amplitude proportional to `(1 - clamp(plant.y / tank.height, 0, 1))` (lower plants sway more), phase offset per-instance from the same seeded PRNG that placed the plant. Sway frequency couples to the flow-field magnitude (F11.5) at the plant's base — plants near a filter outflow visibly wave; plants in dead zones barely move.

New code lives in `libs/rendering/renderer-3d/` (shaders) + `apps/web` (`DayNightService`). No new domain libs. No new schema fields on the document; the catalog `equipment` entry gains optional `photoperiodHours?: number` (additive, backward-compatible — same migration pattern as F11.5's `flow?` and `airRateMl?` additions, so this can land in the same catalog `schemaVersion: 3` bump).

**Tests:**
- Determinism: the water/caustic noise is `seededHash01`-driven so the same seed + same tick produces the same vertex displacement (snapshot test on a single waveform sample).
- Plant sway phase per instance is stable across renders given identical document seed.
- Performance: with all three on at n=200 fish + ~50 plant InstancedMesh instances, frame time stays ≤ 16 ms (60 fps).
- E2E: scrub the day-night slider, screenshot at four phase keypoints, assert background tint + light intensity match the lookup ramp.

**Caveat update:** `docs/caveats/renderer-3d.md` gains a section on the water shader's amplitude clamp + the day-night ramp lookup format. Note that the water surface must be drawn **after** the hardscape AABB clamp so it never extends past the glass.

## Catalog + schema changes

**Catalog `LivestockEntry` (extended, all fields optional):**
```ts
interface LivestockEntry extends CatalogEntryBase {
  // ... existing fields ...
  behavior?: {
    archetype?: 'slim-tetra' | 'deep-bodied' | 'barb' | 'cory-cylinder' | 'eel' | 'hatchet-wedge';
    finLengthFraction?: number;       // 0..1; for nip-target detection
    schooling?: Partial<SchoolingParams>;
    depth?: Partial<DepthParams>;
    territory?: { coreRadius?: number; displayRadius?: number; aggression?: number };
    nipping?: { groupThreshold?: number; rate?: number };
    fear?: { threshold?: number; coverPreference?: 'plants'|'caves'|'wood'; emergenceDelay?: number };
    feeding?: { category: 'surface'|'midwater'|'substrate'|'algae-grazer'|'plant-eater'|'detritivore' };
    curiosity?: { boldness?: number; glassRate?: number };
    animation?: { tailBeatFreq?: number; ampHead?: number; ampTail?: number; envelopeExp?: number };
  };
}
```

**Catalog manifest schemaVersion: 2 → 3.** Migration is pure-additive; v2 manifests load unchanged through `resolveBehavior(entry)` which fills defaults from `group` + `temperament` + `schoolingMin`.

**Document schemaVersion: unchanged at 2.** Instance state is transient. The only document touchpoint is reading `document.seed` to seed the spawn PRNG — already a load-bearing field.

**Catalog JSON schema:** `aqua-document.schema.json` does not reference catalog schemas — the catalog has its own JSON schema at `libs/domain/catalog/schemas/`. The `behavior` object is added there with `additionalProperties: false` and all subfields optional.

## Determinism + seed pipeline

Two PRNG streams, both seeded from `document.seed`:

1. **Spawn PRNG** — `PRNG.fromSeed(seed ^ hash(entry.id))` — generates initial positions, individual offsets (boldness ±20%, hunger phase, animation phase offset). Reseeded on every livestock-entry mutation.
2. **Tick PRNG** — `PRNG.fromSeed(seed ^ tickCounter)` — supplies all per-tick randomness (noise injection, Poisson triggers, conflict resolution). Tick counter resets to 0 on scene load.

Both reuse the seeded-hash helpers already in `libs/domain/geometry/` (per `docs/caveats/geometry.md`). No `Math.random()` anywhere in `livestock-ecs` — enforced by lint rule.

**Test invariant (across all substages):** Same seed + same scene + same N sim ticks → bit-identical position/velocity arrays. The `document-round-trip` job is unaffected because no document state changes.

## Verification

Per-substage acceptance:

- **F11.1** Run `pnpm exec nx serve web`, load `example.aqua.json`, switch to 3D mode (`Cmd/Ctrl+Shift+3`), confirm fish appear at correct sizes (cardinals ~30 mm, angels ~150 mm, plecos ~300 mm) and visibly wiggle. `pnpm exec nx test livestock-ecs fish-anatomy livestock-renderer-3d --configuration=ci`.
- **F11.2** Add 12 cardinals to a scene; confirm visible schooling (polarized, moving as a group). Add 4 hatchetfish; confirm they stay at the surface. Add 4 cories; confirm they stay on the substrate. Unit tests in `schooling.spec.ts` assert polarization metric ≥ 0.8.
- **F11.3** Place a cave + 1 German ram; confirm the ram defends the cave (chase any other fish entering its core radius). Place a betta + 6 tiger barbs; confirm barbs nip the betta but lose interest once 8 conspecifics are added.
- **F11.4** Add an otocinclus + a rock; confirm the oto grazes (visible movement along the rock surface, algae shading reduces over time). Click "Feed tank"; confirm peaceful fish swim to food sprites.
- **F11.5** Place a filter; confirm fish drift slightly with current near outflow. Place an air-stone; confirm a bubble column rises. Drag a rock and confirm fish path around it (no clipping).
- **F11.6** With 200 fish on a 2022-class iGPU, frame time stays ≤ 16 ms (60 fps). Behavior debug overlay shows correct mode per fish.
- **F11.7** Load a scene; confirm the water surface ripples subtly without breaking the silhouette. Scrub the day-night slider; confirm the directional light + ambient + background tint cross-fade through dawn → noon → dusk → night. Confirm plants visibly sway and that plants near a filter outflow sway more than plants in dead zones.

Cross-cutting:
- Determinism: `pnpm exec nx test livestock-ecs -t determinism` — fixed-seed 1000-tick replay produces identical state arrays across runs.
- Existing `document-round-trip` job remains green (no document schema change).
- `pnpm exec nx affected -t lint test build` green on every substage PR.
- Coverage gate workflow `.github/workflows/pr.yml` selector extended to include `livestock-ecs`, `livestock-behaviors`, `fluid-sim`, `fish-anatomy`, `livestock-renderer-3d` as each lands.

## Open follow-ups (not Stage 11)

- Persisted-snapshot mode (transient → optional pin-a-frame). Worth doing if users ask.
- 2D-renderer livestock parity (silhouettes that swim in 2D top-down). Probably not — 2D is the authoring surface, 3D is the simulation surface, and that split is working.
- Predator behavior (the simulator currently has no predator; "fear" is driven only by user-cursor proximity + light changes + neighbour startle). Could add catalog `predator: true` flag.
- Breeding / lifecycle (population growth over sim-time). Out of scope; this is a tank simulator, not an ecosystem simulator.
- Persistence of algae-grazed scoring back into the document (so a "lived-in" tank visibly shows grazing patterns when reloaded). Worth doing later as a v4 schema addition.

## Critical files reference

To touch:
- `libs/rendering/renderer-3d/src/three-3d-renderer.ts` — RAF tick (line 347) gains ECS step; `render()` (line 366) adds livestock content group at line ~398.
- `libs/rendering/renderer-3d/src/scene-builder/` — new sibling `livestock-mesh.ts` (or, cleaner, the new `libs/rendering/livestock-renderer-3d/` lib imported here to keep renderer-3d small).
- `libs/domain/catalog/src/types.ts` (line 175) — add optional `behavior` block to `LivestockEntry`.
- `libs/domain/catalog/schemas/livestock.schema.json` (or equivalent) — mirror the type change.
- `apps/web/src/app/app.component.ts` (line 819 onward) — add `LivestockSimulationService` DI; ensure the ECS world survives 2D ↔ 3D toggles (it lives in the service, not the renderer).
- `docs/caveats/renderer-3d.md` — add a section on the ECS-vs-render-loop split, the SDF bake, and the flow-field bake.
- `docs/caveats/livestock-ecs.md` — new file, owns the system-ordering table and determinism rules.
- `docs/caveats/stage-7-livestock-equipment.md` — update to note that livestock now has an instance-level rendered presence in 3D.
- `.github/workflows/pr.yml` — extend coverage selector to include new libs.
- `README.md` + `CLAUDE.md` — status line updates each substage; one combined Stage-11-complete update at end.

To create (new libs, one per substage roughly):
- `libs/domain/livestock-ecs/` (F11.1)
- `libs/domain/fish-anatomy/` (F11.1)
- `libs/rendering/livestock-renderer-3d/` (F11.1)
- `libs/domain/livestock-behaviors/` (F11.2 + extended each substage)
- `libs/domain/fluid-sim/` (F11.5)
- (F11.7 adds no new libs — work lives in `libs/rendering/renderer-3d/` shaders + a `DayNightService` in `apps/web`.)

Each new lib is generated with `pnpm exec nx g @nx/js:lib` with the appropriate `scope:*` tag — see `docs/caveats/build-test.md`.
