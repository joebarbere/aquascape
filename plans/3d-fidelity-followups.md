# 3D fidelity — follow-up plan

Next steps after the Stage 10/11 fidelity pass + enhancements (see
[`docs/research/3d-fidelity-enhancements.md`](../docs/research/3d-fidelity-enhancements.md)
for the observation-grounded recommendations and
[`docs/caveats/renderer-3d.md`](../docs/caveats/renderer-3d.md) for what shipped).

## Context — what's done vs. what's left

**Shipped + validated** (headlessly via Playwright + SwiftShader): ACES tone
mapping + colour mgmt, IBL environment, soft shadows, transmissive glass,
animated caustics, EffectComposer **bloom**, flow-coupled plant sway, iridescent
fish sheen, helical bubble wobble, startle-wave propagation, predator entity,
substrate grain, cross-plane plant volume, hardscape stone texture, and
**per-instance fish colour**. A headless demo recorder (`tools/demo/record-demo.mjs`)
+ the Playwright visual-validation loop (CLAUDE.md → "Visual validation with
Playwright").

**Also shipped (this plan's SwiftShader-safe slice):** the **Bucket-0
capability gate** (`render-target-support.ts` + `Three3DRenderer.
getRenderTargetEffectsSupported()` — future SSAO/refraction passes MUST gate on
it) and **all of Bucket 3**: per-fin fish animation (the `FIN_TYPE` vertex code
rides `spineUv.y` — the livestock program sits exactly at the WebGL
16-attribute budget; a 17th attribute fails linking on ANGLE/SwiftShader and
no fish render — see `docs/caveats/livestock-ecs.md`), scenic gradient
backdrop (`scene-builder/backdrop.ts`, day-night-tinted in place),
flow-coupled sway **frequency** (`FLOW_FREQ_COUPLING`), and water-surface
caustics (`uCausticStrength` on the water handle, day-night-faded). All
headlessly validated; demo regenerated.

**Not yet done** — two buckets, in priority order below:

1. **Render-target / multi-pass effects** (SSAO, screen-space water refraction)
   — BLOCKED on validation, not on code. SSAO was wired + then backed out
   because it renders a **blank canvas under SwiftShader** (the headless path
   the visual loop + CI e2e both use). These need a **real-GPU validation loop**
   first — the capability gate is in place, but the *validation-loop choice*
   (local GPU dev vs GPU CI runner vs manual checklist, below) is still an
   open decision for the maintainer.
2. **Catalog-driven textures** (albedo / normal / roughness maps) — the honest
   long-term material fix; large (schema + asset pipeline + loader + renderer).

---

## Bucket 0 (prerequisite): a real-GPU validation loop

**Why:** the SwiftShader headless loop renders a blank canvas for depth/normal/
MRT render-target passes (proven by the SSAO attempt — see
[`docs/caveats/e2e.md`](../docs/caveats/e2e.md) → "Render-target / multi-pass…").
Single-pass effects (bloom, OutputPass) are fine; SSAO + refraction are not. So
**nothing in Bucket 1 can ship until there's a way to see it render on a GPU.**

**Options (pick one):**
- **Local GPU dev** — run `pnpm exec nx serve web` + the visual loop on a
  machine with a real GPU (hardware WebGL). Cheapest; the Playwright scripts
  already work, just drop the SwiftShader `--use-angle=swiftshader` flag.
- **GPU CI runner** — a self-hosted GitHub Actions runner with a GPU (or a
  cloud GPU runner) for a `nx affected -t e2e` job gated to renderer-3d changes.
  Heavier to stand up; gives automated regression coverage.
- **Manual pre-merge checklist** — a documented "open these N scenes in a real
  browser, eyeball these effects" checklist for renderer-3d PRs. Lowest effort,
  no automation.

**✅ Capability gate: SHIPPED.** `src/render-target-support.ts` exposes
`detectRenderTargetEffectsSupport(gl)` (software-renderer string match via
`WEBGL_debug_renderer_info` + depth-texture availability; defensive — anything
unprovable → `false`). `Three3DRenderer.setupComposer` probes it and exposes
`getRenderTargetEffectsSupported()`. **The validation-loop choice above is
still open** — pick one before starting Bucket 1.

---

## Bucket 1: render-target effects (after Bucket 0)

### 1a. SSAO (re-apply the backed-out work)

The wiring + composer integration already existed (reverted commit on this
branch — recover from git history). Tasks:
- Re-add the `SSAOPass` addon wiring: `__mocks__/postprocessing-stub.ts`
  (`SSAOPass` class), the jest `moduleNameMapper` regex in BOTH
  `libs/rendering/renderer-3d/jest.config.ts` + `apps/web/jest.config.ts`, the
  `apps/web/tsconfig.app.json` path-map, and the ambient shim
  `apps/web/src/three-orbitcontrols.d.ts`.
- In `setupComposer`, add `SSAOPass(scene, camera, w, h)` as the scene pass
  (REPLACING `RenderPass`) → bloom → `OutputPass`. Constants
  `SSAO_KERNEL_RADIUS_MM ≈ 18`, `SSAO_MIN_DISTANCE_MM ≈ 1`,
  `SSAO_MAX_DISTANCE_MM ≈ 60` (the SSAOPass defaults are metre-scale; the tank
  is mm-scale). **Behind the Bucket-0 capability gate.**
- Sequence it so it deepens crevices/contact shadows WITHOUT re-crushing the
  (now grain-lifted) substrate to black — tune on a real GPU.
- **Validate on a real GPU** (Bucket 0). Confirm the canvas is non-blank +
  AO reads on the substrate/rock contacts before committing.

### 1b. Screen-space water-surface refraction

- Render the opaque scene to a `WebGLRenderTarget`, pass its texture to the
  water `ShaderMaterial` (`scene-builder/water-mesh.ts`), and sample it with a
  surface-normal-derived screen-UV offset for "looking through the surface"
  distortion. Thread the pre-pass around the EffectComposer (or use a
  `MeshPhysicalMaterial` transmission water plane — cheaper, reuses three's
  transmission target — but loses the custom wave vertex shader unless patched).
- **Low incremental value** — the transmissive glass (PR1) already gives the
  dominant refraction — so do this only if a real-GPU loop exists and the glass
  read isn't enough. Same capability gate as SSAO.

---

## Bucket 2: catalog-driven textures (large)

The procedural passes (substrate grain, stone texture, fish sheen) buy most of
the realism cheaply; catalog textures are the honest long-term fix for
photoreal albedo/normal detail. Coordinate with the **catalog-engineer** +
**renderer-engineer**.

- **Schema** (`libs/domain/catalog/`): additive optional `textures?: { albedo?,
  normal?, roughness? }` (asset refs) on substrate / hardscape / plant /
  livestock entries. Additive → no schemaVersion bump; regenerate
  `validator.generated.cjs` (`pnpm precompile:validators`).
- **Asset pipeline** (`tools/`): bundle the texture assets into the catalog
  build output; keep them content-addressed + deterministic.
- **Loader** (`libs/domain/catalog/`): expose decoded texture refs; the host
  loads them with `THREE.TextureLoader` (platform-aware — web vs Electron file
  access).
- **Renderer**: apply `map` / `normalMap` / `roughnessMap` to the
  substrate / hardscape / plant materials (replacing or modulating the
  procedural passes), and a per-archetype texture for fish (needs UVs that the
  procedural fish geometry already generates).
- Triplanar mapping for hardscape (no good UVs on the noise-displaced rock).

---

## Bucket 3: smaller polish (no render targets — SwiftShader-safe) — ✅ SHIPPED

All four items landed (headlessly validated; 7/7 Playwright e2e green; demo
regenerated):

- **✅ Per-fin fish animation** — `fish-anatomy` tags every vertex with a
  `FIN_TYPE` code (`FishGeometryDescriptor.finType`); the livestock vertex
  shader's `// FIN FLUTTER` block oscillates dorsal/anal (lateral Z) +
  pectoral (Y/Z row) fins at 2.3× the tail-beat, gated by the per-instance
  carangiform amp so crawlers stay still. **Load-bearing lesson:** the code
  is PACKED into `spineUv.y` — the program sits exactly at ANGLE/SwiftShader's
  `MAX_VERTEX_ATTRIBS = 16` (declared attributes count), and a 17th attribute
  failed linking with "Too many attributes" → zero fish rendered, invisible
  to unit tests. See `docs/caveats/livestock-ecs.md` → "Per-fin animation".
- **✅ Scenic backdrop** — `scene-builder/backdrop.ts` builds an equirect
  gradient `DataTexture` for `scene.background`; the day-night ramp tints its
  pixel data in place (per render, only on tint change).
- **✅ Flow-coupled sway FREQUENCY** — `swayFreq = base · mix(1, flowAmp,
  FLOW_FREQ_COUPLING = 0.5)` reusing the existing flow factor; no-field
  behaviour is bit-identical to before.
- **✅ Water-surface caustics** — `aqWaterCaustic` in the water fragment
  shader (world-anchored, alpha-capped) + `setCausticStrength` on the handle,
  faded by the day-night directional level like the floor caustics.

---

## Definition of done (per item)

Typed API · unit test · headless e2e/visual check (real-GPU for Bucket 1) ·
`docs/caveats/*` + `README.md` + `CLAUDE.md` updated · determinism preserved
(any `livestock-ecs` snapshot change must keep the 1000-tick two-world replay
byte-identical) · perf budget held (ECS p95 < 4 ms @ 200 fish; watch the web
bundle budget — the postprocessing addons already pushed it toward the warning
line). Regenerate `docs/media/demo-3d.webm` after a visible renderer change.
