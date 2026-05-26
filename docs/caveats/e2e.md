# e2e caveats

**Load this when:** touching `apps/web-e2e/`, the debug hook (`apps/web/src/app/debug-hook.ts`), the e2e CI job, or adding a Playwright spec that exercises 3D rendering / livestock behaviour.

## Why Playwright was wired (and why now)

F11.1 + F11.2 landed the ECS-driven 3D livestock pipeline. Unit + component tests cover the math (Couzin polarisation, depth bands, determinism) and the wiring (3D mode injects `livestockWorld`, RAF tick steps the world). **Neither verifies that a fish pixel actually paints**, because jsdom has no real WebGL context and the ShaderMaterial's GLSL only runs when a browser actually rasterises a frame. The `apps/web-e2e/` placeholder sat at `nx:noop` since Stage 0 — F11.3 (territoriality / nipping / fear) would have shipped visible behaviours nothing could verify in CI. We closed that gap before F11.3 started.

## Debug hook contract

`apps/web/src/app/debug-hook.ts` attaches a read-only `window.__aquascape_debug__` in non-production builds. Gated by Angular's `isDevMode()` — the write becomes dead code under the production optimiser and tree-shakes out of `nx build web --configuration=production`.

```ts
export interface AquascapeDebugHandle {
  getWorld(): LivestockWorld | null;
  getEntityCount(): number;            // sum over all archetypes, 0 when no world
  getScene(): Scene | null;
  getViewMode(): '2d' | '3d';
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

## CI integration

**`.github/workflows/pr.yml#e2e` job.** Cached Playwright browsers keyed on `@playwright/test` version (re-downloads only on bump); `nx affected -t e2e` so the suite runs only when `web-e2e` or its implicit dep on `web` changed. Per-run timeout 20 min; reports uploaded as artifacts on always (7-day retention).

**`.github/workflows/main.yml#matrix.E2E` step** now installs Playwright across the OS matrix (Ubuntu / macOS / Windows) with the same browser cache. `continue-on-error: true` stays until `apps/desktop-e2e/` is also real Playwright — once both web + desktop e2e are reliable, split into per-target steps and drop the flag for web-e2e.

## Running locally

```bash
pnpm exec playwright install chromium   # one-time, ~150 MB
pnpm exec nx run web-e2e:e2e            # boots `nx serve web` + runs specs
```

If `nx serve web` is already running (dev loop), Playwright reuses it. Reports + traces land in `dist/.playwright/apps/web-e2e/`.

## Anti-patterns to refuse

- **Pixel-perfect snapshot tests.** Flaky for what they catch. Variance/diff floors above are the pattern.
- **Tests that wait > 30s.** Long timeouts mask real failures. If a 3D canvas takes longer than 5s to reach steady-state, something's wrong — don't paper over it.
- **`test.retry(N)` for behaviour-system specs.** Determinism is load-bearing in `livestock-ecs`; retry hides real flakes. Use it only for genuinely-flaky infrastructure (network, page navigation timing).
- **Reaching past the debug hook into Angular internals.** If the test needs state the hook doesn't expose, extend the hook (with a typed read-only getter) rather than introspecting the component tree.
