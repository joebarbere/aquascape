# e2e caveats

**Load this when:** touching `apps/web-e2e/`, the debug hook (`apps/web/src/app/debug-hook.ts`), the e2e CI job, or adding a Playwright spec that exercises 3D rendering / livestock behaviour.

## Why Playwright was wired (and why now)

F11.1 + F11.2 landed the ECS-driven 3D livestock pipeline. Unit + component tests cover the math (Couzin polarisation, depth bands, determinism) and the wiring (3D mode injects `livestockWorld`, RAF tick steps the world). **Neither verifies that a fish pixel actually paints**, because jsdom has no real WebGL context and the ShaderMaterial's GLSL only runs when a browser actually rasterises a frame. The `apps/web-e2e/` placeholder sat at `nx:noop` since Stage 0 — F11.3 (territoriality / nipping / fear) would have shipped visible behaviours nothing could verify in CI. We closed that gap before F11.3 started.

## Debug hook contract

`apps/web/src/app/debug-hook.ts` attaches a read-only `window.__aquascape_debug__` in non-production builds. Gated by Angular's `isDevMode()` — the write becomes dead code under the production optimiser and tree-shakes out of `nx build web --configuration=production`.

```ts
export interface AquascapeDebugHandle {
  getWorld(): LivestockWorld | null;
  getEntityCount(): number; // sum over all archetypes, 0 when no world
  getScene(): Scene | null;
  getViewMode(): '2d' | '3d' | 'fish-eye';
}
```

**Hard rules — don't break:**

- **Read-only.** No dispatch, no setters, no renderer or world mutator surface. If a test needs to mutate state, it drives the real UI (click, key) like a user would. The `livestock-3d.spec.ts` smoke does exactly this — it adds tetras through `LivestockToolComponent` rather than reaching past it.
- **Attached in `AppComponent.ngOnInit`, detached as the first line of `ngOnDestroy`.** Don't re-attach on every change-detection cycle; that's a regression. The spec asserts the hook detaches on teardown.
- **Don't import the hook from production code paths.** It exists for tests only. If `app.component.ts` ever needs to read entity count for UI, that's a separate signal/selector — don't reuse the debug hook for it.
- **`getEntityCount` reads `world.snapshot(0).entityCount`** through the existing `LivestockSimulationService.getWorld()`. No new public accessor on the service or the world — anything you'd want from the snapshot is already there.

## Playwright config

`apps/web-e2e/playwright.config.ts`:

- **`webServer.command: 'pnpm exec nx serve web'` + 90s timeout.** The `docs/caveats/platform.md` dev-server race is real; 90s is intentional headroom.
- **`reuseExistingServer: !process.env.CI`** — local dev shares an already-running `nx serve web`; CI spawns fresh.
- **Single `chromium` project for now.** Firefox + WebKit can be added when cross-browser justifies the CI install time. Chromium is the bar.
- **`retries: process.env.CI ? 2 : 0`** — flake tolerance for CI only; local runs fail fast.
- **Outputs in `dist/.playwright/apps/web-e2e/`** — matches the Nx output-path convention so `nx affected` cache invalidation works.

## Cross-platform keyboard shortcuts

`page.keyboard.press('Control+Shift+3')` works everywhere. The view-toggle handler in `apps/web` accepts either `ctrlKey || metaKey`, and Playwright's `Control` key maps to `ctrlKey=true` on every OS — no macOS-vs-Linux branching in the spec. If a future shortcut is exclusive to `metaKey` (e.g., to match a system idiom), branch on `process.platform` then.

If a shortcut is eaten because focus is in an INPUT / TEXTAREA / SELECT, the handler's guard correctly skips it. Fall back to clicking the toolbar button via `getByRole('button', { name: /Switch to 3D view/ })` — the spec already shows the belt-and-braces pattern.

## Visual assertions — variance + frame-diff, never exact pixels

`livestock-3d.spec.ts` uses two empirical floors:

- **Pixel-channel variance > 100** to prove the canvas isn't blank. A solid colour measures ~0; a tank with substrate + lighting + a couple of fish measures ~7k (observed). 100 is generous floor with ~70× headroom.
- **Frame-to-frame pixel diff > 50** between two screenshots 800ms apart to prove the RAF tick is alive. Tail wiggle alone produces ~500 differing pixels (observed). Floor is conservative so future renderer perf regressions trip it.

**Why no exact-pixel snapshots:** lighting, device-pixel-ratio, font rasterisation, and Three.js shader compile differ across machines. Visual regression tests would be flaky for what they actually catch. Variance + frame-diff floors are the contract; if a test goes red after a legitimate visual change, tune the floor — don't reach for `test.retry(N)` or wrap in try/catch.

`sharp` (already a workspace dev dep) handles the PNG decode + variance math; no new deps were added for pixelmatch / pngjs.

**Text-readout specs** (`vitality-hud.spec.ts`, `water-chemistry.spec.ts`, `water-change-tool.spec.ts`) don't measure pixels — they boot `?mode=simulation`, wait for the live world (`getEntityCount() > 0`), and assert on **HUD DOM**. `water-chemistry.spec.ts` (Stage 13 F13.3 + F13.5b) asserts MOUNT + WIRING: (1) the simulation HUD's **test-kit readout** mounts — cycle badge + four `.sim-hud__kit-row`s, each with a `.sim-hud__kit-swatch` + a safe/caution/danger `.sim-hud__kit-band` + a **finite numeric** `.sim-hud__kit-val`; (2) the control HUD's **`Change 50%`** water-change button is enabled + operable — firing it surfaces the live-region status (`Changed 50% of the water.`) and leaves the readout a valid number (proving the `WaterChange` command + `applyWaterChange` pipeline is wired). `water-change-tool.spec.ts` (Stage 15 F15.2) walks the guided action-HUD flow (params → place-siphon → OUT → IN) through the live camera + GL canvas, asserting each step mounts + the canvas-drag raycast enables OUT. **Neither asserts that ammonia/nitrate numerically CLIMBS over time or DROPS after the change** — see "Software-WebGL e2e: assert mount/wiring, not simulation progression" below. The selector convention to know: the chemistry block is the **test-kit `.sim-hud__kit-row`** list (value cell `.sim-hud__kit-val`, row 0 = Ammonia, row 2 = Nitrate, row 3 = pH), NOT the old `.sim-hud__grid` `dd` cells — a spec reading the grid will break. (In simulation mode the editor time slider is hidden; the live tick IS the time axis. The editor-slider preview + the editor `Water test` panel / `WaterChange` dispatch are unit-tested in `features-editor-shell`.)

Two HUD-overlap + contention gotchas these specs hit: (a) the showcase HUDs are absolutely-positioned overlays, so the controls-panel `Change 50%` button can be **pointer-intercepted** by the vitality HUD title — `dispatchEvent('click')` (or `force`-then-verify-handler) fires the handler past the overlap once the button is asserted visible + enabled; (b) under serial software-WebGL the FIRST synthetic click on a flow-transition button can be **dropped** before Angular swaps the panel in, so wrap each transition in `expect(async () => { await btn.click(); await expect(nextStep).toBeVisible({ timeout: 2_000 }); }).toPass()` — a click-then-verify retry, NOT `test.retry`.

## Software-WebGL e2e: assert mount/wiring, not simulation progression

**The rule:** the CI e2e runs under **software WebGL (SwiftShader)**, where the world/sim/chemistry only ticks while the 3D canvas paints — and that RAF/sim cadence is **throttled + non-deterministic**. So an e2e MUST NOT assert a **time-dependent simulation/physics/chemistry numeric OUTCOME**. It can't reliably deliver one, and a spec that waits for one is flaky-by-construction (a 30s timeout when the value never crosses the threshold).

What the e2e DOES prove, reliably, under SwiftShader: **boot + render + WIRING** — the app boots, the canvas paints (variance/diff floors), the HUD/tool MOUNTS, and driving its controls **fires the pipeline** (a command dispatches, a service method runs, the flow advances a step, a live-region status appears, the readout stays a valid number). What it must NOT require: that the meter fills to N, the player displaces ≥ N mm, a catch scores, ammonia climbs past a threshold, or nitrate numerically drops.

The numeric/time-dependent outcomes are covered **deterministically** by unit + integration specs, which is where they belong:

- **Game physics / player movement / catches** → `predator-rules` / `survival-rules` / `feeding-rules` (features-game) + the per-mode game services (apps/web). `game-mode.spec.ts` asserts only the boot invariants (fish-eye, player marked, valid game state, score ≥ 0) — see its header + "Game-mode e2e under software WebGL".
- **Water chemistry progression + dilution** → `domain/water-sim` (the nitrogen-cycle + band math), `WaterChemistryService` (the live tick + `applyWaterChange`), the `WaterChange` command, and `water-change-flow` / `water-change.service` (apps/web). `water-chemistry.spec.ts` + `water-change-tool.spec.ts` assert only that the test-kit readout mounts with valid numbers + the water-change control/flow is operable.

When you write a new sim/game e2e: if an assertion would **wait for a number to change over time** (`expect.poll(...).toBeGreaterThan(threshold)` against a live sim value, or a before/after numeric delta), that's the anti-pattern — assert presence/validity/operability instead, and push the numeric assertion down to a unit/integration spec. (Counter-examples that ARE fine: a count that rises from a **direct user action** with no time dependence — `getFoodSpriteCount() ≥ 1` after a feed click, `getBubbleParticleCount() > 0` after placing an air-stone — those are wiring proofs, not progression.)

## CI integration

**`.github/workflows/pr.yml#e2e` job.** Cached Playwright browsers keyed on `@playwright/test` version (re-downloads only on bump); `nx affected -t e2e` so the suite runs only when `web-e2e` or its implicit dep on `web` changed. Per-run timeout 20 min; reports uploaded as artifacts on always (7-day retention).

**`.github/workflows/main.yml#matrix.E2E` step** now installs Playwright across the OS matrix (Ubuntu / macOS / Windows) with the same browser cache. `continue-on-error: true` stays until `apps/desktop-e2e/` is also real Playwright — once both web + desktop e2e are reliable, split into per-target steps and drop the flag for web-e2e.

## Running locally

```bash
pnpm exec playwright install chromium   # one-time, ~150 MB
pnpm exec nx run web-e2e:e2e            # boots `nx serve web` + runs specs
```

If `nx serve web` is already running (dev loop), Playwright reuses it. Reports + traces land in `dist/.playwright/apps/web-e2e/`.

## Demo recorder + headless visual validation (`tools/demo/record-demo.mjs`)

The README's 3D demo (`docs/media/demo-3d.webm` + `…-poster.png`) is generated headlessly by `tools/demo/record-demo.mjs` — it drives the dev server with Playwright (load the Jungle template → add a tetra school + sponge filter → 3D → orbit + day-night scrub), records WebM, and trims the scene-setup footage with ffmpeg. Regenerate after a visible renderer change:

```bash
pnpm exec nx serve web                 # terminal 1
node tools/demo/record-demo.mjs        # terminal 2
```

**Software-WebGL gotchas (load-bearing for any headless visual work here):**

- **WebGL works headless via SwiftShader**, but only with the launch args `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. Without them the 3D canvas is blank.
- **The main thread is saturated** by the RAF render loop, so every CDP round-trip (mouse move, `evaluate`, click) is slow. Keep the call COUNT low; resolve an element to a HANDLE once rather than re-querying a locator per frame; lean on `sleep` (no round-trip) for animation hold time. The recorder time-compresses the resulting long capture with ffmpeg.
- **`PLAYWRIGHT_CHROMIUM`** overrides the browser binary — set it when Playwright's managed download is unavailable (e.g. CDN blocked) and a system / pre-provisioned chromium must be used. The recorder, any ad-hoc validation script, AND `apps/web-e2e/playwright.config.ts` read it (the e2e config also adds the SwiftShader flags when it's set; unset ⇒ stock managed-browser behaviour). The `nx run web-e2e:e2e` target still attempts `playwright install` first — when the CDN is blocked, run `pnpm exec playwright test -c apps/web-e2e/playwright.config.ts` directly with the env var set.
- **The Playwright-bundled ffmpeg is a MINIMAL build** — VP8 encoder only (no VP9), and only the `pad`/`crop`/`scale` filters (no `setpts`/`fps`). Speed-changes use the `-itsscale` INPUT option, not a filter; frame extraction uses `-ss T -frames:v 1`, not `-vf fps=`.
- **Render-target / multi-pass post-processing can BLANK the canvas under SwiftShader.** `SSAOPass` (depth + normal + AO targets) renders a fully blank 3D view headlessly — and the CI e2e uses the same SwiftShader path, so an ungated SSAO would fail the 3D-paint assertion. The single-pass `UnrealBloomPass` + `OutputPass` work fine; the depth/normal/MRT-heavy passes (SSAO, screen-space refraction) do **not**. **Assume any new render-target effect breaks here and validate it on a real GPU before committing — don't ship blind off a headless pass.** SSAO now SHIPS (see `docs/caveats/renderer-3d.md` → "Screen-space ambient occlusion") but ONLY behind the Bucket-0 capability gate (`getRenderTargetEffectsSupported()`): on the SwiftShader e2e path the gate returns `false`, the pass is never constructed, and the composer falls back to the plain `RenderPass → bloom → OutputPass` chain. The e2e suite (9/9) is the regression guard that this fallback still paints under software WebGL.

## Real-GPU validation loop (Bucket-0 decision: local GPU dev)

Render-target effects (SSAO, future refraction) can't be validated under SwiftShader — they blank. The chosen validation loop is **local GPU dev**: drive the running `nx serve web` with Playwright on a box with a real GPU, using HARDWARE WebGL (NOT the SwiftShader flags).

- **The flags:** `--use-gl=angle --use-angle=gl --ignore-gpu-blocklist --enable-gpu` (ANGLE-over-GL on Mesa; `--use-angle=vulkan` is the alternative). The box needs `/dev/dri/renderD*` + a Mesa driver. Confirm hardware with `node tools/demo/gl-probe.mjs` — it prints `UNMASKED_RENDERER_WEBGL`; you want the GPU name (e.g. `ANGLE (AMD, AMD Radeon RX 7600 XT (radeonsi navi33 ACO), OpenGL 4.6)`), NOT a `SwiftShader`/`llvmpipe` string. On hardware, `detectRenderTargetEffectsSupport` returns `true` and SSAO is built.
- **The screenshotter:** `node tools/demo/validate-3d.mjs OUT.png` builds a scene (Jungle template + fish), switches to 3D, orbits, and writes a PNG of the 3D canvas. `ORBIT="dx,dy,steps"` + `ZOOM="wheelDelta"` env vars tune the camera without editing the file. This is the reusable Bucket-1 validation harness — use it to A/B any render-target change (e.g. a tasteful AO setting vs `kernelRadius:0` for a no-AO baseline at identical geometry, then a sharp pixel-diff).
- **Why not a GPU CI runner / manual checklist:** the maintainer has a local AMD GPU box, so local dev is the cheapest loop with zero standing infrastructure. A GPU CI runner remains a future option if automated regression coverage for gated effects becomes worth the setup.

## Anti-patterns to refuse

- **Pixel-perfect snapshot tests.** Flaky for what they catch. Variance/diff floors above are the pattern.
- **Tests that wait > 30s.** Long timeouts mask real failures. If a 3D canvas takes longer than 5s to reach steady-state, something's wrong — don't paper over it. (Distinct from a BUDGET correction: the day-night spec carries `test.slow()` because its setup + two scrubbed element-screenshots sit at the 30s ceiling under a parallel local software-WebGL run — the assertions and floors are unchanged.)
- **`test.retry(N)` for behaviour-system specs.** Determinism is load-bearing in `livestock-ecs`; retry hides real flakes. Use it only for genuinely-flaky infrastructure (network, page navigation timing).
- **Reaching past the debug hook into Angular internals.** If the test needs state the hook doesn't expose, extend the hook (with a typed read-only getter) rather than introspecting the component tree.
