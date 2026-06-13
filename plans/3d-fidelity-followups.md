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

**Bucket 2 (catalog-driven textures) also shipped** — see its section below.

**Bucket 1 status — SSAO SHIPPED, refraction deferred:**

The validation-loop decision is settled: **local GPU dev** on the maintainer's
AMD RX 7600 XT box (Mesa/radeonsi). Headless Chromium gets hardware WebGL via
ANGLE-over-GL, so render-target effects can be seen rendering (not blanked).
The reusable harness is `tools/demo/gl-probe.mjs` (confirm hardware GL) +
`tools/demo/validate-3d.mjs` (screenshot the 3D canvas) — see
`docs/caveats/e2e.md` → "Real-GPU validation loop".

1. **SSAO — ✅ SHIPPED** behind the Bucket-0 capability gate. `RenderPass →
   SSAOPass → bloom → OutputPass` on hardware GL; the unchanged bloom-only
   chain on software WebGL (gate `false`), so the SwiftShader e2e never blanks.
   See `docs/caveats/renderer-3d.md` → "Screen-space ambient occlusion" for the
   ordering / units / tuning gotchas (the big one: three 0.184's SSAOPass
   AUGMENTS the read buffer, it does NOT replace RenderPass — the plan text
   below assumed the older self-beauty SSAOPass).
2. **Screen-space water-surface refraction — DEFERRED (not blocked).** On the
   real-GPU render the transmissive glass (PR1) already refracts the tank
   contents through the front/side panes — the dominant cue. Distorting the
   water PLANE adds an extra opaque-scene render-target pre-pass threaded around
   the now-4-pass composer for a marginal payoff at typical viewing angles (you
   look THROUGH the glass, not down through the surface). Revisit only if the
   glass read proves insufficient. Same capability gate as SSAO when it lands.

---

## Bucket 0 (prerequisite): a real-GPU validation loop

**Why:** the SwiftShader headless loop renders a blank canvas for depth/normal/
MRT render-target passes (proven by the SSAO attempt — see
[`docs/caveats/e2e.md`](../docs/caveats/e2e.md) → "Render-target / multi-pass…").
Single-pass effects (bloom, OutputPass) are fine; SSAO + refraction are not. So
**nothing in Bucket 1 can ship until there's a way to see it render on a GPU.**

**✅ DECIDED: Local GPU dev.** Run `pnpm exec nx serve web` + the Playwright
visual loop on the maintainer's AMD RX 7600 XT box (Mesa/radeonsi). Headless
Chromium gets hardware WebGL via `--use-gl=angle --use-angle=gl
--ignore-gpu-blocklist --enable-gpu` (NOT the SwiftShader flags) — confirmed by
`tools/demo/gl-probe.mjs` reporting `ANGLE (AMD … radeonsi navi33 …)`. Cheapest
option, zero standing infrastructure. (A GPU CI runner remains a future option
for automated regression coverage of gated effects; a manual checklist was the
fallback.)

**✅ Capability gate: SHIPPED.** `src/render-target-support.ts` exposes
`detectRenderTargetEffectsSupport(gl)` (software-renderer string match via
`WEBGL_debug_renderer_info` + depth-texture availability; defensive — anything
unprovable → `false`). `Three3DRenderer.setupComposer` probes it and exposes
`getRenderTargetEffectsSupported()`. **SSAO is its first consumer** (Bucket 1a,
shipped).

---

## Bucket 1: render-target effects (after Bucket 0)

### 1a. SSAO — ✅ SHIPPED

Written fresh — no backed-out commit ever existed in history (the earlier
attempt only lived in a working tree; `9b64a02` was docs-only). What landed:
- `SSAOPass` addon wiring: the `SSAOPass` class in
  `__mocks__/postprocessing-stub.ts`, the jest `moduleNameMapper` regex in BOTH
  `libs/rendering/renderer-3d/jest.config.ts` + `apps/web/jest.config.ts`, the
  `apps/web/tsconfig.app.json` path-map, and the ambient shim
  `apps/web/src/three-orbitcontrols.d.ts`.
- In `setupComposer`, `SSAOPass(scene, camera, w, h)` inserted AFTER `RenderPass`
  (NOT replacing it — three 0.184's SSAOPass multiplies AO onto the read buffer;
  see `docs/caveats/renderer-3d.md`), giving `RenderPass → SSAOPass → bloom →
  OutputPass`. **Behind the Bucket-0 capability gate** — gated out ⇒ plain
  bloom-only chain. Constants `SSAO_KERNEL_RADIUS_MM = 40` (view-space mm),
  `SSAO_MIN_DISTANCE_MM = 1`, `SSAO_MAX_DISTANCE_MM = 180` (converted to
  normalised depth at build time). The plan's 18/60 was nearly invisible.
- Validated on the AMD RX 7600 XT real-GPU loop: canvas non-blank, AO darkens
  ~2.3 % of pixels at contacts, substrate not re-crushed to black. The 9/9
  SwiftShader e2e guards the gated-off fallback.

### 1b. Screen-space water-surface refraction — DEFERRED (not blocked)

The real-GPU render confirmed the transmissive glass (PR1) already gives the
dominant refraction read of the tank contents, so this is low incremental value
for the cost (an extra opaque-scene `WebGLRenderTarget` pre-pass threaded around
the now-4-pass EffectComposer, sampled by the water `ShaderMaterial` with a
surface-normal-derived screen-UV offset; or a `MeshPhysicalMaterial`-transmission
water plane that loses the custom wave vertex shader). Revisit only if the glass
read proves insufficient. Same capability gate as SSAO when/if it lands.

---

## Bucket 2: catalog-driven textures — ✅ SHIPPED

Landed as a deterministic, fully-offline texture pack (no licensed assets, no
network) + a world-space triplanar renderer patch:

- **✅ Schema** — additive `textures?: { albedo?, normal?, roughness? }`
  (`CatalogTextureRefs`) on substrate / hardscape / plant entries;
  schemaVersion stays 3; validator regenerated; all 53 eligible manifests
  mapped to 9 shared texture families. **Livestock deliberately excluded** —
  per-species textures fight the per-archetype InstancedMesh batching and the
  16-attribute shader budget; revisit with a texture array if demand surfaces.
- **✅ Asset pipeline** — `tools/generate-textures.mjs` (`pnpm
  generate:textures`): seeded splitmix32 fBm/Worley baker producing 27
  seamlessly-tiling 256² PNGs (~1.7 MB committed), byte-identical across
  runs; semantic family names instead of content-addressing (committed files
  are the source of truth — same policy as the generated validators).
  Served at `assets/catalog-textures/` via an apps/web asset glob (Electron
  loads the web dist, so both apps are covered).
- **✅ Renderer** — `RenderOptions.catalogTextureBaseUrl` (opt-in; absent ⇒
  byte-identical pre-Bucket-2 shaders), a renderer-lifetime `TextureCache`
  (neutral-placeholder → in-place image upgrade, no recompile, 404-safe),
  and a **triplanar world-space** `onBeforeCompile` patch
  (`scene-builder/catalog-texture.ts`) for substrate + hardscape + plants —
  albedo/roughness MODULATE the authored catalog colours; normals are
  swizzled-UDN (plants skip them). Triplanar everywhere, not just hardscape —
  ExtrudeGeometry UVs are useless on side walls for all three kinds.
- See `docs/caveats/renderer-3d.md` → "Catalog-driven textures" +
  `docs/caveats/catalog.md` for the full contracts.

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
