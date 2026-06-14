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

## Launch modes — showcase simulation mode

Introduced a **launch-mode** concept selected by a CLI flag (`aquascape
--mode simulation`; default `normal` is the full editor) plus a first mode, the
**borderless-fullscreen showcase**. The Electron main process
(`apps/desktop/src/main/app-mode.ts` `parseAppMode`) reads the flag,
opens a `frame:false` + `fullscreen:true` window for `demo`, and forwards the
mode to the sandboxed preload via `webPreferences.additionalArguments` (NOT a
new IPC channel, and NOT by touching the security-asserted `buildWebPreferences`
— the forwarding is merged at the `createMainWindow` call site). The preload
re-exposes it as `window.aquascape.mode`; the renderer resolves it with
`resolveAppMode()` (`apps/web/src/app/app-mode.ts`), which also honours a
`?mode=simulation` URL query param so the showcase runs in a plain browser / e2e /
`nx serve web` with no packaging. On `demo`, `AppComponent` loads a large
deterministic `createShowcaseScene()` (a 1500 × 600 × 600 mm show tank — ~518 L
— with 14 hardscape, ~80 plantings across five zoned layers, 5 decor, and ~108
livestock individuals across four mid-water schooling shoals), forces the 3D
view via a new hydration-locking `ViewModeService.forceMode('3d')` (so the
persisted last-used-view read can't clobber it), hides all editor chrome via a
`.simulation-mode` class on the shell, and mounts a corner **HUD**
(`aquascape-simulation-hud`) listing the full tank spec — dimensions, volume (L + US
gal), substrate, object counts, the livestock manifest with quantities, and the
equipment list. Validated on the real-GPU Playwright loop (3D view, populated
HUD, chrome gone). See
[`docs/caveats/app-modes.md`](caveats/app-modes.md).

## Stage 16 — game modes (`--mode game:<submode>`)

Extended the launch-mode grammar with a **game** family — `game:<submode>`
(`survival` / `feeding` / `predator` / `cleaner`) — branching the SAME
`--mode` parse + `additionalArguments` transport as `simulation` (ADR-0007).
F16.1 shipped the shared shell (`libs/features/game/`): a framework-free state
machine, scoring, an input-intent layer, per-sub-mode descriptors, plus the
Angular `GameModeService` + game HUD. The **player-control seam** lives in
`livestock-ecs` (`setPlayer` / `setPlayerVelocity` injected at the top of
`step()`, `SteeringIntegrator` skips the player) — the one live-input boundary,
gated so non-game worlds replay byte-identically. F16.1b wired it into
`apps/web` (`enterGameMode` mirrors the showcase activation + marks a player;
`GameInputService` owns the keyboard listener + per-frame rAF loop).

**F16.4 — the predator game (first fully-playable mode).** You ARE the predator:
`world.setPlayerPredator(true)` adds the existing `Predator` tag to the marked
player, so prey **flee via the existing `FearSystem` proximity path** — zero new
fear/flee code. Each frame, `PredatorGameService` (`apps/web/src/app/game/`)
reads the live snapshot, runs the **pure** `detectCatches`
(`libs/features/game/src/lib/predator-rules.ts`), **despawns** every prey inside
the catch radius (90 mm), awards a point per catch, and dispatches `win`/`lose`
on the first decided outcome (catch 8 prey before a 60-second countdown). The
rule logic (catch detection, win/lose, countdown) is pure + exhaustively unit
tested; the world mutation (despawn) + the rAF wiring stay in the app layer. The
**catch/despawn is a non-deterministic game event** kept OUT of the
replay-critical sim core — it runs between sim ticks, only while an active game
has a live player, so the 1000-tick byte-identical replay for non-game worlds
holds (proven by `player-seam.spec.ts` + `predator-game.service.spec.ts`). The
HUD shows a countdown (the descriptor gained an optional `timeLimitSec`); the
debug hook gained read-only `getGameScore()` / `getGameState()` for the e2e.
Survival / feeding / cleaner remain on the generic playable loop, gated on
Stages 14 / 13 / 15. See [`docs/caveats/game-modes.md`](caveats/game-modes.md).

**F16.2 — the survival game.** You are **prey**: roaming predators hunt you via
the existing `FearSystem` path, and you flee with the keyboard. `SurvivalGameService`
(`apps/web/src/app/game/`) reads the live predator + player positions each frame
(it **mutates nothing** in the sim — only reads), steps a **game-local stamina**
bar (drains when a predator looms within 280 mm, recovers when safe), awards the
seconds-survived score, and dispatches **lose** on caught (predator within
90 mm) / health-0 / stamina-0 or **win** on outlasting 90 s. If the loaded scene
has no predators of its own, the service promotes the few fish FARTHEST from the
player to roaming hunters at start (demoted on exit) so there's always a threat.
The pure rules live in `libs/features/game/src/lib/survival-rules.ts`.

**F16.3 — the feeding game.** Typed food (Stage 14 `FoodSprite`) **falls from
the surface** and you eat it by proximity. `FeedingGameService` periodically
drops food (a service-local PRNG picks drop columns — never the sim core),
detects which sprites are within the eat radius (70 mm) via the pure
`detectEaten`, **despawns** them, and folds the bites into a **food meter**: each
bite fills + scores, but a bite taken while the meter is full **gorges** (wasted
+ a score penalty). The meter slowly drains; **fill it to 90 %** to win, or lose
on health-0 (starved) / clock-expiry below target. The pure rules live in
`libs/features/game/src/lib/feeding-rules.ts`.

**Both modes wire the HUD vitality bars to REAL values** (replacing the F16.1
placeholder): `GameModeService.setVitality(health, food, stamina)` reads the
player's `HealthDrive.health` + `FeedingDrive.hunger` from the snapshot via
`readPlayerVitals`; survival adds a third **stamina** bar. The
caught/eat/drop are all non-deterministic GAME EVENTS kept OUT of the sim core
(between ticks, gated on an active game) — the 1000-tick non-game replay still
holds (proven by `survival-game.service.spec.ts` + `feeding-game.service.spec.ts`).
e2e (`game-mode.spec.ts`) boots each mode and asserts the live score updates
(survival's survived-seconds climbs; feeding's score increments on an eat),
validated on a provisioned chromium. See
[`docs/caveats/game-modes.md`](caveats/game-modes.md).

**F16.5 — the cleaner game (the LAST mode; Stage 16 complete).** You wield a
`cleaning-tool` (scraper / brush / siphon — the siphon **reuses Stage 15's
`SiphonTool`**, no fork) and **clean the tank**. `T` cycles the active tool; HOLD
the use button (Space) near a rock/wood surface within reach (120 mm) and the
tool **rasps its TARGETED per-type algae** (the Stage 13 F13.6 stocks) — a
scraper clears green-spot + diatom, a brush clears black-beard + hair off
hardscape — scaled by the tool's catalog `effectiveness`. The gravel siphon
**removes waste**: while active its nozzle hangs at the player + vacuums,
diluting the live chemistry via the EXISTING `WaterChemistryService.applyWaterChange`
(no new dilution math). The HUD's "Food" bar becomes a **cleanliness meter** and
the **score is the tank's clean-percent** (sum of `getAlgaeByType` across
hardscape → `cleanlinessFraction`). **Win** by cleaning below the algae target;
**lose** on the 90-second clock. Pure rules (reach detection, tool→algae mapping,
rasp amount, cleanliness scoring, win/lose) live in
`libs/features/game/src/lib/cleaner-rules.ts`; the algae rasp + waste dilution +
win/lose dispatch + tool-select state live in `CleanerGameService`
(`apps/web/src/app/game/`). Two new `livestock-ecs` world seams back it —
`getHardscapeEntities()` (snapshot surfaces + positions) +
`raspAlgaeType(eid, type, amount)` (per-type reduce + aggregate re-derive,
mirroring the FeedingSystem grazer rasp) — both between-ticks reads/mutations,
never inside `world.step()`. The siphon nozzle's renderer calls
(`setSiphonPosition` / `setSiphonMode` / the `RenderOptions.siphonTool` mount)
stay in `AppComponent` event/effect handlers (NG0600-safe), driven off the
service's `siphonActive()` + `activeTool()` signals + the input loop's frame
hook. The rasp/dilution are non-deterministic GAME EVENTS kept OUT of the sim
core — the 1000-tick non-game replay holds (proven by
`cleaner-game.service.spec.ts` + the unchanged determinism suite). e2e adds a
`cleaner` boot case (advisory tier — mount/wiring, not progression); all 4
game-mode boot tests green on a provisioned chromium. **All four game sub-modes
are now playable — Stage 16 is complete.** See
[`docs/caveats/game-modes.md`](caveats/game-modes.md).

## Nutrients & additives + dosing

A new catalog **kind** of real-world aquarium nutrients/additives plus a way to
dose them in simulation mode. Landed across three PRs:

- **F-A — catalog `nutrient` kind.** A seventh `CatalogEntry` branch
  (`NutrientEntry`: `category` / `brand` / `form` / `dose` / `disclosed` /
  optional `contributes` / `affects[]` / `color` / cited `source`), 30 real
  products seeded under `src/data/nutrients/` (dry EI salts, all-in-one liquids,
  liquid carbon, conditioners, remineralizers, buffers, bacteria). **Honesty
  contract:** disclosed products carry per-dose ppm/dGH from a cited source;
  proprietary products omit `contributes` and rely on a qualitative `affects`
  list — fabricating ppm is forbidden. Catalog `schemaVersion` stays **3**
  (purely additive).
- **F-B — `DoseNutrient` command** (scene-model, undoable). The
  `doseNutrient(resolvedNutrient, amount, { id, seq, unit? })` factory resolves
  the catalog row, linearly scales the disclosed `contributes` block
  (`delta = contributes × amount / dose.amount`), and bakes a finished
  `DoseEvent` so apply/invert stay a pure push/pop append/remove on the new
  optional runtime `Scene.doseLog`. **Runtime-only / chemistry deferred** — no
  `Tank.waterChemistry` exists yet (Stage 13); the dose log records the intent,
  a future `domain/water-sim` consumes it. `doseLog` is **not** persisted, so
  `document-round-trip` is untouched. Selectors `selectDoseLog` /
  `selectDoseEventById` / `nextDoseSeq`.
- **F-C — Dose action HUD + `dose` console verb.** The simulation control HUD
  gained a **Dose nutrient** group (category filter, colour-swatched nutrient
  picker, representative-dose-prefilled amount stepper, accessible status line)
  and the Quake console gained a `dose list | dose <product> [amount]` verb with
  fuzzy product matching (reusing the `matchSpecies` helper), a unit-suffix
  amount token (`2ml` / `0.6g`), Tab-completion over nutrient ids/names, and a
  `help` entry. Both surfaces go through a shared `doseNutrientOp` in
  `simulation-scene-ops.ts` and dispatch `DoseNutrient` through the normal NgRx +
  Command pipeline — the UI never mutates the scene directly. Dosing is
  surfaced as recorded-only, with the chemistry effect explicitly deferred.

## Stage 13 — aquarium husbandry (nitrogen cycle, water chemistry)

The deterministic `domain/water-sim` chemistry model, its persisted document
field, the new catalog kinds, and the two driver paths that bring the tank's
nitrogen cycle to life.

- **F13.1 — `domain/water-sim` model.** A pure, seeded, framework-free chemistry
  engine (the sibling of `domain/growth-sim`): two-stage nitrification (ammonia →
  nitrite → nitrate) with bacterial colonies that grow over sim-time toward a
  substrate-set carrying capacity (the classic fishless-cycle curve), the honest
  Emerson-1975 NH₃/NH₄⁺ pH/temperature equilibrium, KH-buffered pH drift, and
  per-type algae growth. Time is an INPUT (`elapsedWeeks` / `dt`); an
  `ENGINE_VERSION` stamps every output for replay/migration.
- **F13.2 — `.aqua` v3 → v4.** Additive optional `Tank.waterChemistry` (the
  persistable `WaterState` subset + denormalized `cycle` stage + per-type algae
  block). Identity migration, schema mirror, marshal both directions, fixture
  round-trip.
- **F13.4 — catalog kinds.** Additive `food` / `algae` / `water-test-kit` oneOf
  branches + manifests.
- **F13.3 — time-axis integration ("cycle the tank").** Wired the model into the
  app over **two driver paths that agree on bioload by construction** (shared
  `water-sim` helpers `bioloadSourceN` / `waterParamsFromTank` /
  `evaluateChemistryAtWeek`, anchored to the ECS per-fish baseline):
  - **Editor preview-time** (`PreviewChemistryService` + a minimal
    `CycleIndicatorComponent`): scrubbing the time slider previews the cycle
    weeks ahead — deterministic from the scene seed, never dirtying undo/autosave.
  - **Live tick** (`WaterChemistryService`): in simulation/game mode, a
    fixed-`WEEKS_PER_TICK` deterministic tick reads `world.getWasteSourceN()` as
    the source term, advances `simulateChemistry`, and pushes `setWaterQuality`
    back so fish health responds — **closing feed → waste → ammonia → health
    end-to-end**. Time-accelerated (~6-week cycle in ~2 real minutes); the live
    chemistry surfaces in the simulation HUD's water-chemistry block.

  Initial state loads from `Tank.waterChemistry` (else fresh); the live tick state
  is runtime-only (not written back per-tick — no undo-stack spam). The 1000-tick
  livestock replay still holds (`setWaterQuality` defaults clean, so only an active
  service injects water quality, between sim ticks via a host-driven scalar).

- **F13.5a — `WaterChange` Command + pure `applyWaterChange`.** The undoable model
  primitive (`domain/scene-model`) that dilutes `Tank.waterChemistry` by a fraction
  of clean (or replacement) water, plus the exported pure `applyWaterChange(chemistry,
frac, replacement?)` helper — the **single source of dilution truth**. Honest
  biology: dilutes the water column's dissolved compounds (ammonia/nitrite/nitrate/pH)
  only; the bacterial colony + cycling clock live on surfaces and are left untouched,
  so a water change never resets the cycle. Capture-and-restore invert (dilution is
  lossy).
- **F13.5b — test-kit readout + water-change action (closes F13.5).** The classic
  colour-chart readout (ammonia / nitrite / nitrate / pH) surfaced two ways: a
  **Water test** accordion in the editor right rail (`TestKitReadoutComponent`,
  reading `PreviewChemistryService`) and the **simulation HUD** chemistry block
  (reading the live `WaterChemistryService`). A pure `water-test-kit.ts` helper maps
  each value against a selected `water-test-kit` entry's `reads[]` ranges (API
  Freshwater Master default) → a swatch position + colour + a safe/caution/danger
  verdict (the verdict keyed off honest hobby thresholds, not the kit's chart range).
  A **water-change action** (25 / 50 % presets + a fraction slider/buttons) dispatches
  the undoable `WaterChange` Command through the NgRx pipeline (editor) and, in
  simulation mode, also calls a new `WaterChemistryService.applyWaterChange` that
  dilutes the **live runtime** `WaterState` via the **same** pure helper — so the live
  ammonia/nitrate drop immediately and fish health responds (one math source, no
  re-implemented dilution). A `water` console verb gained `water test` (prints the
  readout) + `water change <pct>` (default 25), Tab-completing `auto` / `test` /
  `change` consistent with the other verbs. e2e (`water-chemistry.spec.ts`) extended:
  assert the test-kit readout mounts (4 rows, swatch + band), ammonia climbs over sim
  time, and `Change 50%` drops it.

- **F13.6 — per-type algae simulation (completes Stage 13).** Extended the single
  F11.4 `Hardscape.algaeScore` regrowing scalar into FOUR per-type stocks
  (green-spot / hair / black-beard / diatom) on the `Hardscape` slab, with
  `algaeScore` kept as their clamped-sum aggregate so every existing consumer
  (renderer overlay, the `algaeScore > 0.1` grazer gate, `getAlgaeScore`) is
  unchanged. A new `algaeGrowthSystem` (slotted before `feedingSystem`) grows each
  type through the SINGLE source-of-truth `domain/water-sim` `algaeGrowth` model:
  **nitrate** × **photoperiod** × **flow**, scaled per type by the registered
  `algae` catalog rows (`growthRate` / `lightDependence`). Three default-safe input
  seams: `setWaterQuality` now carries an optional `nitrate` (default 0 ⇒ no growth);
  `setPhotoperiodHours` (default 8 h, fed from `EquipmentEntry.photoperiodHours`);
  and the flow-field magnitude sampled at each surface. `feedingSystem`'s algae rasp
  became TYPE-SELECTIVE — a per-species `registerGrazerPreference` bitmask (built by
  the service from the catalog `algae.grazers[]` → species-bucket mapping: oto / pleco
  / SAE / nerite-snail / shrimp) reduces only the type(s) the grazer controls, with a
  highest-stock generalist fallback; the old flat regrowth left `feedingSystem`. The
  snapshot shape is UNCHANGED — the aggregate stays the rendered total; per-type stocks
  read via `world.getAlgaeByType(eid)` for the Stage 16 cleaner game + tests.
  `WaterChemistryService` now pushes `nitrate` alongside ammonia/nitrite. Determinism:
  pure scalar math, no PRNG — same seed + same inputs ⇒ byte-identical over 1000 ticks
  (`algae-growth-system.spec.ts` + a new `determinism.spec.ts` case); with nitrate 0
  the algae state is constant, so a chemistry-less world replays run-to-run identical.
  Coverage 97.7 %; p95 bench 3.5 ms @ 200 fish (nitrate-0 fast path keeps growth cheap).
  **This completes Stage 13.** The cleaner game mode that targets specific algae types
  is Stage 16 F16.5 (gated on Stage 15).

## Stage 14 — fish vitality & feeding

Made feeding meaningful: typed food, a health/hunger model, and a vitality
surface — without touching the renderer's per-instance data.

- **F14.1 — typed food + per-type sink.** `FoodSprite` gained a `foodType`
  (flake / pellet / wafer / live) with distinct sink behaviour (flakes float
  then sink, pellets drop fast, wafers settle on the substrate, live food
  darts), a deterministic `food-kinematics` system, and a typed-spawn primitive
  on the simulation service. The legacy "Feed tank" pulse became a quick random
  flake scatter on top of it. Additive `WorldSnapshot.foodSpriteType`; no new
  fish vertex attribute (food is a separate billboard mesh).
- **F14.2 — health + hunger.** A `HealthDrive { health: f32 }` in `[0,1]` and a
  `vitalitySystem` (after `feedingSystem`) that decays health under sustained
  starvation + injected bad water quality and slowly recovers it when fed +
  clean — deterministic, mode-agnostic. `world.setWaterQuality(...)` defaults to
  clean, so a chemistry-less world replays byte-identically. A `wasteSystem`
  (F14.4 producer) folds per-fish baseline + uneaten-food waste into a smoothed
  ammonia source term (`world.getWasteSourceN()`). `WorldSnapshot` gained
  `health` + `hunger` slabs (parallel to the fish slab) — **HUD-surfaced, not a
  vertex attribute** (the fish shader is at the 16-attribute ANGLE ceiling).
- **F14.3 — vitality HUD + click-to-inspect.** A read-only fish-vitality HUD
  (`apps/web/src/app/simulation/vitality-hud.*`) mounts in simulation mode
  (left-middle), polling the snapshot's `health`/`hunger` slabs ~12× a second:
  **school avg / min health + % hungry** (a pure `computeVitalityAggregate`
  helper; "hungry" = the feeding seek-threshold 0.7, with an f32-tolerant
  compare) plus a **selectable fish list** and a **click-to-inspect inspector**
  (per-fish health hearts + hunger meter). Picking is a selectable list, not a
  canvas raycast — the 3D `hitTest` returns null (read-only view) and the
  renderer doesn't expose its live camera, so there's no reliable world→screen
  projection; the inspector is camera-independent so a future picker can feed
  the same selection. The per-fish readout (`fishVitalityAt` / `healthToHearts`)
  is the **game-mode reuse seam** — Stage 16's game HUD renders the same hearts
  for `world.getPlayerEntity()`. Console `hud … vitality` toggles it. (The
  **waste → chemistry live loop** was closed shortly after by Stage 13 F13.3's
  `WaterChemistryService` — see the Stage 13 section above.)

## Stage 15 — husbandry interactions (the hands-on action HUD)

A bottom-center action HUD in simulation mode — square, rounded tool buttons
that drive hands-on husbandry through the same NgRx + Command pipeline the
editor uses. The renderer surface (`SimulationInteractionRenderer`:
`raycastTankPoint` + the shared `SiphonTool` + `setSiphonPosition` /
`setSiphonMode`, opt-in via `RenderOptions.siphonTool`) landed in a renderer PR
ahead of the HUD.

- **F15.1 — feeding tool.** Select **Feed** → a catalog-`food` picker; pick a
  food, then click the 3D canvas to drop typed food at the ray-cast substrate
  point (`raycastTankPoint({ plane: 'floor' })` → the Stage 14 typed-spawn API),
  replacing the random scatter with placed feeding. A drop-preview marker
  follows the cursor. The `SimulationActionService` owns the tool state machine
  (idle → tool-selected → sub-step); all renderer imperative calls live in the
  app's canvas **event handlers**, never the render effect (NG0600). A pure
  `resolveFoodDrop` helper is the catalog-row-lookup + raycast + spawn seam.
- **F15.2 — water-change tool (multi-step flow).** Selecting **Water change**
  runs a guided 4-step flow: (1) a **replacement-params form** (temperature /
  pH / hardness) stored on the tool state; (2) **place-siphon** — mounts the
  shared `SiphonTool` and a 3D-canvas drag positions the nozzle at the **water
  plane** (`raycastTankPoint({ plane: 'water' })` → `setSiphonPosition`, off an
  event handler); (3) **siphon OUT** — `setSiphonMode('out')`, the water level
  drops (`SetWaterLevel`) and ammonia/nitrite/**nitrate** dilute toward clean
  source water; (4) **siphon IN** — `setSiphonMode('in')`, the level rises back
  and the chemistry lerps toward the replacement params. Each step dispatches an
  undoable `WaterChange` + `SetWaterLevel` Command **and** drives the live
  runtime (`WaterChemistryService.applyWaterChange`), both reusing the single
  `applyWaterChange` dilution helper — so the test-kit readout + fish respond at
  once and **undo reverses** the level + chemistry mutations. A pure
  `water-change-flow` helper maps the OUT/IN volume fraction → the dilution
  fraction + the new water level (no re-implemented dilution math); a
  `WaterChangeService` owns the OUT/IN command-dispatch + live-runtime drive and
  captures the pre-drain level so IN restores it exactly. `RenderOptions.siphonTool`
  is wired into `renderCurrent` only while the tool is active (renders stay
  bit-identical otherwise); on tool exit the nozzle is parked
  (`setSiphonMode('idle')`) and disposed. The `SiphonTool` is shared with the
  Stage 16 cleaner mode (F16.5) — no fork. e2e (`water-change-tool.spec.ts`):
  drive the flow (params → place → OUT) and assert the test-kit **nitrate**
  reading drops after OUT. **This closes Stage 15.**

## Document & catalog version history

| Version         | Change                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.aqua` v1      | Initial locked format (Stage 0).                                                                                                                                                                                                                                                                                                           |
| `.aqua` v2      | Optional `Layer.zone` ('foreground' \| 'midground' \| 'background') for 3D depth banding (Stage 10 follow-up).                                                                                                                                                                                                                             |
| `.aqua` v3      | Optional `Tank.waterLevelMm` — the adjustable water fill line (post-Stage-11 fidelity work).                                                                                                                                                                                                                                               |
| Catalog v1 → v2 | Pre-Stage-11 manifest evolution.                                                                                                                                                                                                                                                                                                           |
| Catalog v3      | Optional `LivestockEntry.behavior`, `HardscapeEntry.coverScore?`, `EquipmentEntry.flow?` / `airRateMl?` / `photoperiodHours?`, and `textures?` refs on substrate/hardscape/plant entries — all additive; older manifests load unchanged. The `decor` entry kind (GLB model refs) landed later as another additive oneOf branch — still v3. |

Every format bump shipped with a pure `Migration` entry and a round-trip
property test, per the v1-locked checklist in
[`docs/caveats/document-format.md`](caveats/document-format.md).
