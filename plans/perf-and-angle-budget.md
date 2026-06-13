# Performance pass + reclaim the ANGLE vertex-attribute budget

**Type:** Renderer optimization (renderer-3d + livestock-renderer-3d + bundle).
**Owner:** `renderer-engineer` (lead) + `nx-workspace-engineer` (lazy-load + bundle budget) +
`test-engineer` (benches + the determinism gate).
**Status:** Not started.

## Goal

Two related renderer concerns, one plan: (A) reclaim headroom in the livestock fish shader's
**16/16 vertex-attribute budget** so per-fish data (e.g. Stage 14 health/hunger) becomes possible
without a zero-fish-render regression, and (B) cut runtime + load-time cost — render-on-demand,
quality tiers, and lazy-loading the 3D stack off the cold-boot bundle.

## Spec reference

`docs/caveats/livestock-ecs.md` (the 16-attribute ANGLE ceiling + finType-in-`spineUv.y` pack +
the 1000-tick determinism gate); `docs/caveats/renderer-3d.md` (the composer + capability gate);
`docs/caveats/build-test.md` (bundle budgets). Unblocks Stage 14
([`stage-14-fish-vitality-feeding.md`](stage-14-fish-vitality-feeding.md)).

## Dependencies

**Requires:** nothing new — all within the existing renderer/sim. **Enables:** Stage 14 per-fish
vitality data (Part A frees the slots); a smoother, cheaper 3D view everywhere (Part B).

## Context (confirmed)

- The livestock vertex program sits at **exactly 16/16** `MAX_VERTEX_ATTRIBS`: 7 auto
  (`position`+`normal`+`uv` = 3; `instanceMatrix` mat4 = **4**) + 9 custom (`spineUv` +
  `instancePosition`/`instanceQuat`/`instanceScale`/`instancePhase`/`instanceTailBeatFreq`/
  `instanceAmpHead`/`instanceAmpTail`/`instanceColor`). A 17th declared attribute fails linking and
  **zero fish render** — invisible to unit tests.
- **The `instanceMatrix` (4 slots) is dead weight** — the shader builds its own transform from
  `instancePosition`+`instanceQuat`+`instanceScale` and never references `instanceMatrix`
  (`libs/rendering/livestock-renderer-3d/src/lib/shaders.ts`; the build code even comments it).
  `InstancedMesh` forces it anyway.
- The 3D renderer runs a **continuous RAF** (paints 60 fps even on a still, empty tank), unlike the
  2D renderer's event-driven dirty-redraw. The `EffectComposer` (RenderPass → SSAO → bloom →
  OutputPass) carries the cost; SSAO is already capability-gated (`render-target-support.ts`).
- The whole 3D stack (three.js + postprocessing + livestock libs, ~600–800 KB) is **eagerly bundled**
  via a `providedIn:'root'` renderer factory injected in `AppComponent`'s constructor; the initial web
  bundle is ~1.85 MB — over the 1.5 MB warning budget (`apps/web/project.json`).

## Scope

### Part A — Reclaim the attribute budget (16 → 10)

- **A1 — Drop the dead `instanceMatrix` (frees 4 → 12/16).** Switch each livestock archetype mesh from
  `InstancedMesh` to a plain `Mesh` + `InstancedBufferGeometry` (`geometry.instanceCount` per frame in
  place of `mesh.count`), so three.js stops auto-allocating the unused `mat4 instanceMatrix`. The
  shader is unchanged (already transform-from-attributes). Food/bubble meshes already lack it.
  (`build-livestock-meshes.ts`.)
- **A2 — Pack the static animation scalars (frees 2 → 10/16).** Fold `instanceTailBeatFreq` +
  `instanceAmpHead` + `instanceAmpTail` into a single `vec3` attribute (construction-time defaults;
  only crawlers mutate the amps per frame — that write targets the packed channel); unpack in the
  vertex shader. Mirrors the existing `finType`-in-`spineUv.y` pack.
- **A3 — Tests + docs.** Move the ≤9-attribute regression cap to the new count; update
  `docs/caveats/livestock-ecs.md` with the 10/16 budget + the reclaim; note it **unblocks per-fish
  vitality data** (Stage 14 may revisit floating health bars).

### Part B — Performance pass (render-side; determinism-safe)

- **B1 — Render-on-demand.** Gate the 3D `paint()` behind a dirty flag (sim stepped ≥1 tick /
  OrbitControls change / day-night clock advanced / host signal changed); idle otherwise. Aligns 3D
  with the 2D event-driven model — saves a full 60 fps on a still tank. (`three-3d-renderer.ts`.)
- **B2 — Quality tiers + per-pass toggles.** `RenderOptions.quality` (`low` = RenderPass→OutputPass,
  `medium` = +bloom, `high` = +SSAO (current), `adaptive` = step down when frame time exceeds budget
  via `SimulationPerfService`), plus explicit `ssao.enabled` / `bloom.enabled`.
- **B3 — Lazy-load the 3D stack.** Move `Three3DRenderer` + `livestock-renderer-3d` +
  `livestock-ecs` + three.js/postprocessing off the cold-boot path (dynamic-import on first 3D /
  simulation entry; the `renderer.token` factory / DI resolves lazily; `LivestockSimulationService`
  constructed lazily). Target: initial bundle under the 1.5 MB warning (~600–800 KB saved).
- **B4 — Full-frame profiling bench.** Extend the `BENCH=1` harness to time the **whole** RAF frame
  (`world.step` + `syncFromSnapshot` + composer render), not just the ECS step, owning the 16 ms /
  60 fps budget end-to-end. Optionally a dev breakdown via the simulation debugger.

### Out

- Implementing the per-fish vitality bars themselves (Stage 14 — Part A just unblocks them).
- Changing any simulation logic / system ordering / spawn sequence (would break determinism).

## Acceptance criteria

- [ ] After A1+A2, the livestock shader declares ≤ 7 custom attributes and fish render correctly on
      **both** the real-GPU and the SwiftShader e2e paths (the zero-fish-render trap); animation +
      per-instance colour visually unchanged; ≥ 6 slots of headroom for future per-instance data.
- [ ] B1: an idle tank (no entities, camera still) stops repainting; the scene still updates on any
      input / sim activity / day-night scrub.
- [ ] B2: `quality: 'low'` renders without SSAO/bloom; `adaptive` steps down under load.
- [ ] B3: `nx build web` initial bundle is back under the 1.5 MB warning; the 3D view loads on first
      entry with no functional regression.
- [ ] B4: the full-frame bench reports a number under the 16 ms budget at n=200.
- [ ] The 1000-tick byte-identity determinism replay still matches (the safety gate).

## Testing

- **Unit:** the attribute-count regression cap (new number); the vec3 pack/unpack; the dirty-flag
  gating logic; the quality-tier composer selection; the full-frame bench (`BENCH=1`).
- **E2E (load-bearing for Part A):** the **real-GPU + SwiftShader** Playwright suites must both SHOW
  fish painting after the InstancedBufferGeometry switch — a linker regression is invisible to unit
  tests. Plus an idle-frame assertion for B1 and a low-quality render for B2.
- **Determinism:** re-run the 1000-tick replay after any change that touches the sim path (none
  expected — both parts are render-side).

## Notes

Sequencing: **Part A first** (independent; unblocks Stage 14). **B1** is the quickest standalone win;
**B3** is the highest-effort / highest-bundle-payoff. No ADR — these are within-renderer
optimizations, no new architectural fork. Caveat updates land with the implementation:
`docs/caveats/livestock-ecs.md` (attribute budget), `docs/caveats/renderer-3d.md` (render-on-demand +
quality tiers), `docs/caveats/build-test.md` (lazy-loading + bundle budget).
