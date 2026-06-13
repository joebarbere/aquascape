# Development history — the stage roadmap

> **Looking for what the app can do today?** See the [feature list in the
> README](../README.md#features). This page is the historical record of _how_
> the project got there: the staged roadmap, what each stage delivered, and
> in what order. Load it when you need to know when something landed or why
> the work was sequenced the way it was.

The project was built against a deliberately sequenced roadmap defined in
[`aquascape-development-plan.md`](../aquascape-development-plan.md) §4
(Stages 0–10) and extended by per-stage plans under [`plans/`](../plans/).
Stages 0–4 were the critical-path foundation; 5–6 rounded out the editor
surface; 7+ were parallelizable once the scene model and platform
abstraction stabilized.

## Stage summary

| Stage | Theme                                                                                                                                                    | Status     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0     | Foundation & walking skeleton                                                                                                                            | ✅ Shipped |
| 1     | Tank setup & document lifecycle                                                                                                                          | ✅ Shipped |
| 2     | Substrate tool                                                                                                                                           | ✅ Shipped |
| 3     | Hardscape tool                                                                                                                                           | ✅ Shipped |
| 4     | Layers, planting, growth simulation                                                                                                                      | ✅ Shipped |
| 5     | Templates, snapping, composition overlays                                                                                                                | ✅ Shipped |
| 6     | Image export, layout summary, photo backdrop, PWA install, packaged installers                                                                           | ✅ Shipped |
| 7     | Livestock & equipment + stocking guidance + setup sheet                                                                                                  | ✅ Shipped |
| 8     | Community gallery (browse + remix shared layouts) — [`plans/stage-8-community-gallery/`](../plans/stage-8-community-gallery/)                            | 📐 Planned |
| 9     | AI photorealistic render (local + hosted) — [`plans/stage-9-ai-render/`](../plans/stage-9-ai-render/)                                                    | 📐 Planned |
| 10    | 3D renderer (Three.js / WebGL — read-only)                                                                                                               | ✅ Shipped |
| 11    | Animated livestock & ambient simulation (F11.1–F11.7) — [`plans/stage-11-animated-livestock.md`](../plans/stage-11-animated-livestock.md)                | ✅ Shipped |
| 12    | Release pipeline — `pnpm release <version>`, installers, GitHub Releases — [`plans/stage-12-release-pipeline.md`](../plans/stage-12-release-pipeline.md) | 📐 Planned |

Remaining work is tracked in the [README's TODO section](../README.md#todo--whats-next).

## What each stage delivered

### Stage 0 — Foundation & walking skeleton

The Nx monorepo, the layer-boundary tags (`@nx/enforce-module-boundaries`),
the `.aqua` v1 document format (`aqua-document.ts` + JSON Schema mirror +
AJV validator + migration chain), the `SceneRenderer` interface, the
platform abstraction (`platform-api` / `platform-web` / `platform-electron`),
the NgRx store skeleton, both app shells (Angular web, Electron desktop),
and CI (PR affected-graph workflow + full OS matrix on `main` + the required
`document-round-trip` property-test job).

### Stage 1 — Tank setup & document lifecycle

Tank preset picker (ADA / UNS / Waterbox / US standard sizes), custom
dimensions with mm/cm/in display toggle, frame styles, water tint, tank
background. New / Open / Save / Save As, recent files, dirty tracking,
crash-recovery autosave (3 s debounce), the ZIP `.aqua` container with
bare-JSON fallback.

### Stage 2 — Substrate tool

Multi-region substrate with per-region material and blend, the front-back
profile curve editor, Catmull-Rom silhouette rendering with deterministic
per-region grain noise.

### Stage 3 — Hardscape tool

Hardscape catalog browser (categories, pagination, filter chips), pointer
drag-and-drop onto the canvas, real hit-testing and selection handles
(move / scale / rotate), z-ordering.

### Stage 4 — Layers, planting, growth simulation

Layers panel (visibility, lock, opacity, rename, reorder), plant browser
with zone filters, carpet-brush scatter placement (deterministic, seeded),
the growth-sim lib (`plantScale` logistic curve), and the weeks 0–52 time
slider.

### Stage 5 — Templates, snapping, composition overlays

Four built-in starter templates (Iwagumi / Dutch / Jungle / Beginner),
personal templates (capped at 32), snap-to grid/guides/objects with
alignment lines, golden-ratio + rule-of-thirds + focal-point overlays,
multi-select marquee, the floating selection inspector, cursor-anchored
zoom.

### Stage 6 — Export, backdrop, PWA, installers

PNG/JPEG image export at 1080p/2K/4K, the layout-summary export
(Markdown/JSON), photo backdrop compositing, wall background, PWA install +
offline service worker, `pnpm package:desktop` → DMG / NSIS / AppImage.

### Stage 7 — Livestock & equipment

Livestock + equipment catalog browsers and inventories, per-row equipment
notes and settings, the `domain/stocking` rules engine (six explainable
warnings: bioload, temperature/pH intersection, temperament clash,
schooling minimums, fin-nipper risk), and the setup-sheet export gaining
livestock/equipment/warnings sections.

### Stage 10 — 3D renderer (shipped before Stages 8–9)

`renderer-3d` (Three.js/WebGL) implementing the _same_ `SceneRenderer`
interface over the _same_ canonical mm coordinates in the document — the
architectural bet from Stage 0 paying off. Read-only (`hitTest` returns
`null`); OrbitControls camera; per-element scene builders (glass tank,
extruded substrate, hardscape/plant silhouettes, lighting). The 2D ⇄ 3D
toggle uses two stacked `<canvas>` elements because one canvas can hold
only one context type for its lifetime. A follow-up bumped `.aqua` v1 → v2
adding optional `Layer.zone` (foreground / midground / background) so the
3D renderer can band-remap object depth.

### Stage 11 — Animated livestock & ambient simulation

Delivered in seven substages, anchored by
[`docs/research/stage-11-livestock-subsystem.md`](research/stage-11-livestock-subsystem.md):

| Substage  | What landed                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F11.1** | ECS foundation — `libs/domain/livestock-ecs/` (bitECS world, 30 Hz fixed-dt scheduler), `libs/domain/fish-anatomy/` (six procedural archetype geometry generators), `libs/rendering/livestock-renderer-3d/` (one InstancedMesh per archetype + carangiform tail-beat vertex shader), and the `LivestockSimulationService` that owns the world across 2D ⇄ 3D toggles and respawns deterministically from `scene.seed`. |
| **F11.2** | Swimming — Couzin three-zone schooling (ZOR/ZOO/ZOA with blind cone), Reynolds separation/alignment/cohesion, vertical depth bands (surface / midwater / bottom presets), turn-rate-clamped steering. `libs/domain/livestock-behaviors/` became the single source of truth for behaviour params; catalog manifest schemaVersion 2 → 3 added the optional `LivestockEntry.behavior` block.                              |
| **F11.3** | Personality — territoriality (bourgeois owner-wins chase with fatigue), fin-nipping (group-threshold-suppressed), fear (FORAGE → REFUGE mode flip, dart to nearest hardscape cover). Hardscape gained `coverScore`; priority arbitration runs Fear → Nip → Territory → Schooling via `BehaviorMode`.                                                                                                                   |
| **F11.4** | Feeding — hunger drive across six feeding categories (surface / midwater / substrate / algae-grazer / plant-eater / detritivore), algae scores on hardscape that decay under grazing and regrow, boldness-gated glass-surfing, the "Feed tank" button dropping transient food sprites.                                                                                                                                 |
| **F11.5** | Environment — `libs/domain/fluid-sim/` baking a 32³ divergence-free flow field from filter equipment and a 64³ hardscape SDF for collision; FlowFieldSystem + CollisionSystem; air-stone bubble columns (capped at 200 particles). Catalog gained `EquipmentEntry.flow?` + `airRateMl?`.                                                                                                                               |
| **F11.6** | Breadth + budget — 24 livestock species exercising every behaviour branch; the 7th "crawler" archetype for shrimp + snails; the dev-only behaviour debug overlay (Ctrl/Cmd+Shift+D); the perf benchmark gating a 4 ms ECS step at n=200 fish (measured 3.43 ms p95).                                                                                                                                                   |
| **F11.7** | Ambient polish — animated water surface (≤ 2 mm sine bands), the day-night cycle (4-keypoint lookup ramp, sidebar slider, manual / real-time / equipment modes), deterministic plant sway seeded from the document. Catalog gained `EquipmentEntry.photoperiodHours?`.                                                                                                                                                 |

Stage 11 also forced long-overdue infrastructure: `apps/web-e2e/` went from
a Stage-0 placeholder to real Playwright driving `nx serve web` under
SwiftShader WebGL, asserting that a 3D fish actually paints (pixel-variance

- frame-diff floors, the read-only `window.__aquascape_debug__` hook).

### The 3D fidelity passes (post-Stage 11)

A series of focused PRs raised the 3D render from "low-poly diorama" to the
demo on the README (follow-ups tracked in
[`plans/3d-fidelity-followups.md`](../plans/3d-fidelity-followups.md)):

- **Rendering polish** — ACES filmic tone mapping, sRGB output, a
  deterministic PMREM image-based-lighting environment, soft shadows,
  physically-based transmissive glass.
- **Caustics** — procedural world-anchored caustic light on substrate +
  hardscape, faded by the day-night cycle; later extended to the water
  surface itself.
- **Flow-coupled plant sway** (amplitude _and_ frequency) + **iridescent
  fish sheen** + **per-fin flutter** (dorsal/anal/pectoral secondary
  animation at 2.3× the tail beat).
- **Startle-wave propagation** — fear ripples through a school
  deterministically.
- **EffectComposer bloom**, **helical bubble wobble**, a **predator
  entity** (the angelfish — prey flee it), a **scenic gradient backdrop**.
- **Per-instance fish colour**, substrate grain, cross-plane plant volume,
  hardscape stone texture.
- **Catalog-driven PBR textures** — 9 deterministic, seamlessly-tiling
  texture families baked offline (`pnpm generate:textures`), applied
  triplanar in world space, opt-in via `RenderOptions.catalogTextureBaseUrl`.
- **The render-target capability gate** — SSAO blanks the canvas under the
  SwiftShader headless path CI uses, so `getRenderTargetEffectsSupported()`
  guards any multi-pass effect. The load-bearing lesson lives in
  [`docs/caveats/e2e.md`](caveats/e2e.md). (SSAO later shipped behind this
  gate — see "SSAO on a real-GPU validation loop" below.)
- **Adjustable water fill line** — `.aqua` v2 → v3 added optional
  `Tank.waterLevelMm`; the 3D water plane, 2D tint band, and the fish
  simulation's ceiling all read one source of truth
  (`effectiveWaterLevelMm`).
- **Overhead equipment lighting + fish-eye view** — attaching a
  `category: 'light'` equipment entry hangs a glowing LED-bar fixture above
  the rim (SpotLight + emissive housing, auto-distributed along the width,
  dimmed by the day-night cycle); the catalog gained an additive
  `EquipmentEntry.light?` block (`lumens` / `colorTempK` / `beamAngleDeg` /
  `fixtureLengthMm`) and six new researched LED fixtures (NICREW, Finnex,
  ADA, Kessil, ONF, Current USA — nine lights total). A third toolbar view
  mode, **Fish eye**, parks the camera at a live fish's eye with a wide
  FOV and follows it in first person (`RenderOptions.cameraMode`).

### 3D-modeled decorations (post-Stage 11)

The classic aquarium ornaments — researched archetypes, not brands: sunken
treasure chest, galleon wreck, giant skull, antique diver helmet, ship
anchor, Greek column ruins, moai head, castle tower, toppled amphora,
pirate cannon. The scene model's dormant `DecorObject` (`kind: 'decor'`,
reserved since Stage 7) finally got a backing catalog kind (`DecorEntry`,
additive oneOf branch — manifest schemaVersion stays 3) and both render
paths:

- **Models are glTF binaries (GLB)** — baked deterministically offline by
  `tools/generate-decor-models.mjs` (`pnpm generate:models`, double-bake
  byte-identity asserted, splitmix32 seeds) from three.js primitives +
  seeded displacement, carrying `MeshPhysicalMaterial` PBR via KHR
  extensions (clearcoat, transmission + IOR, iridescence, emissive
  strength) and vertex-colour weathering — no embedded images.
- **3D**: a renderer-lifetime model cache (GLTFLoader, placeholder
  upgrades in place, failed loads keep an extruded-silhouette fallback,
  opt-in via `RenderOptions.catalogModelBaseUrl`); models rest on the
  substrate, clamp inside the glass, cast + receive shadows, and take the
  caustics patch. **2D**: silhouette painting + hit-testing on the
  hardscape convention.
- **Fish integration**: decor registers with the livestock world as cover
  (per-category coverScore defaults) and joins the hardscape-SDF collision
  bake — frightened fish genuinely shelter in the wreck.
- **UI**: a Decorations palette (wreck / ruin / bones / structure chips,
  silhouette tiles, drag-to-place) in `libs/features/decorations-tool/`.

### SSAO on a real-GPU validation loop (post-Stage 11)

With the maintainer's AMD RX 7600 XT box, the **Bucket-0 validation-loop
decision** was settled as **local GPU dev**: headless Chromium gets hardware
WebGL via ANGLE-over-GL (Mesa/radeonsi), so the render-target effects that
blank under SwiftShader can be _seen_ rendering. Two reusable harness scripts
landed — `tools/demo/gl-probe.mjs` (confirm hardware GL) and
`tools/demo/validate-3d.mjs` (screenshot the 3D canvas at a tunable camera).

That unblocked **Bucket 1a — SSAO**, which shipped behind the capability gate:
`RenderPass → SSAOPass → bloom → OutputPass` on hardware GL, the unchanged
bloom-only chain on software WebGL (so the SwiftShader e2e never blanks). The
load-bearing surprise was that three 0.184's `SSAOPass` _augments_ the read
buffer (multiplies AO) rather than rendering its own beauty like older
versions — so it sits AFTER `RenderPass`, not in place of it. Tuned on the GPU
loop (`kernelRadius` 40 mm, contact darkening on ~2.3 % of pixels, substrate
not re-crushed to black). **Bucket 1b — screen-space water-surface
refraction — was deferred** (not blocked): the transmissive glass already
supplies the dominant refraction read, so the extra render-target pre-pass is
low value. See [`docs/caveats/renderer-3d.md`](caveats/renderer-3d.md) →
"Screen-space ambient occlusion" and [`plans/3d-fidelity-followups.md`](../plans/3d-fidelity-followups.md).

## Document & catalog version history

| Version         | Change                                                                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.aqua` v1      | Initial locked format (Stage 0).                                                                                                                                                                                                         |
| `.aqua` v2      | Optional `Layer.zone` ('foreground' \| 'midground' \| 'background') for 3D depth banding (Stage 10 follow-up).                                                                                                                           |
| `.aqua` v3      | Optional `Tank.waterLevelMm` — the adjustable water fill line (post-Stage-11 fidelity work).                                                                                                                                             |
| Catalog v1 → v2 | Pre-Stage-11 manifest evolution.                                                                                                                                                                                                         |
| Catalog v3      | Optional `LivestockEntry.behavior`, `HardscapeEntry.coverScore?`, `EquipmentEntry.flow?` / `airRateMl?` / `photoperiodHours?`, and `textures?` refs on substrate/hardscape/plant entries — all additive; older manifests load unchanged. The `decor` entry kind (GLB model refs) landed later as another additive oneOf branch — still v3. |

Every format bump shipped with a pure `Migration` entry and a round-trip
property test, per the v1-locked checklist in
[`docs/caveats/document-format.md`](caveats/document-format.md).
