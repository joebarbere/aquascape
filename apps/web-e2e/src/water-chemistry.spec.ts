// Stage 13 F13.3 — live water-chemistry e2e (Playwright, CI-validated).
//
// chromium is NOT provisioned in the agent sandbox (Playwright CDN blocked);
// this spec runs in CI per docs/caveats/e2e.md. What it proves end-to-end
// (that unit tests can't):
//   1. Booting `?mode=simulation` mounts the simulation HUD's water-chemistry
//      block (cycle badge + ammonia/nitrite/nitrate/pH readout).
//   2. The chemistry advances over the simulation's time axis: the live
//      `WaterChemistryService` ticks the nitrogen cycle forward (time-
//      accelerated so it's visible in seconds, not weeks), pushes water quality
//      into the world, and the HUD readout CHANGES — the F13.3 acceptance
//      ("scrub the time axis in simulation mode and assert the chemistry/cycle
//      indicator changes"; in the showcase the time axis is the live tick, not
//      the editor slider, which is hidden in simulation mode).
//
// Uses the same `?mode=simulation` showcase the lights/game/vitality specs
// drive (the renderer-side `resolveAppMode()` honours the query param so the
// showcase runs under `nx serve web`). SwiftShader flags + the chromium
// executable come from the Playwright config.

import { expect, test } from '@playwright/test';

test.describe('live water chemistry (?mode=simulation)', () => {
  test('mounts the chemistry HUD and advances the cycle over sim time', async ({ page }) => {
    test.slow(); // showcase scene (~100 fish) under software WebGL is heavy

    await page.goto('/?mode=simulation');
    await expect(page.locator('canvas').first()).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));

    // The showcase spawns its livestock on first 3D paint; the chemistry tick
    // starts when simulation mode activates.
    await page.waitForFunction(
      () => (window.__aquascape_debug__?.getEntityCount() ?? 0) > 0,
      undefined,
      { timeout: 30_000 },
    );

    // ── 1. The water-chemistry block is present in the simulation HUD.
    const chemHead = page.locator('aquascape-simulation-hud').getByText('Water chemistry');
    await expect(chemHead).toBeVisible({ timeout: 15_000 });

    // The cycle badge reads one of the three stages.
    const badge = page.locator('aquascape-simulation-hud .sim-hud__cycle');
    await expect(badge).toHaveText(/uncycled|cycling|cycled/i);

    // The nitrate readout (the accumulating husbandry signal) renders a value.
    const grids = page.locator('aquascape-simulation-hud .sim-hud__grid');
    const chemGrid = grids.last(); // the chemistry grid (after the spec grid)
    await expect(chemGrid).toContainText('Ammonia');
    await expect(chemGrid).toContainText('Nitrate');

    // ── 2. The chemistry ADVANCES over sim time. Ammonia is the clearest
    // early signal — a stocked, freshly-started tank's ammonia climbs fast off
    // zero (the source term outruns the not-yet-established filter), changing
    // the 2-dp readout within a few seconds of time-accelerated ticks. Grab the
    // ammonia reading, wait, and assert it changed — the live tick is driving
    // the nitrogen cycle forward. (Nitrate moves too but lags far behind early,
    // so it's a less reliable short-window signal.)
    const ammoniaDd = chemGrid.locator('dd').nth(0); // Ammonia, Nitrite, Nitrate, pH
    const before = (await ammoniaDd.textContent())?.trim() ?? '';
    await page.waitForTimeout(5000);
    const after = (await ammoniaDd.textContent())?.trim() ?? '';
    expect(after).not.toBe(before);
  });
});
