// Stage 13 F13.3 + F13.5b — water chemistry + test-kit readout + water-change e2e.
// (Playwright, CI-validated.)
//
// chromium is NOT provisioned in the agent sandbox (Playwright CDN blocked);
// this spec runs in CI per docs/caveats/e2e.md. What it proves end-to-end
// (that unit tests can't):
//   1. Booting `?mode=simulation` mounts the simulation HUD's water-chemistry
//      block — the F13.5b TEST-KIT readout (cycle badge + per-parameter swatch +
//      safe/caution/danger band for ammonia/nitrite/nitrate/pH).
//   2. The chemistry advances over the simulation's time axis: the live
//      `WaterChemistryService` ticks the nitrogen cycle forward (time-
//      accelerated so it's visible in seconds, not weeks), pushes water quality
//      into the world, and the HUD readout CHANGES — the F13.3 acceptance.
//   3. F13.5b — performing a WATER CHANGE from the simulation controls dilutes
//      the live runtime: the nitrate/ammonia readout DROPS. The control
//      dispatches the undoable `WaterChange` Command and calls the live
//      dilution (one `applyWaterChange` helper) so fish-health responds.
//
// Uses the same `?mode=simulation` showcase the lights/game/vitality specs
// drive (the renderer-side `resolveAppMode()` honours the query param so the
// showcase runs under `nx serve web`). SwiftShader flags + the chromium
// executable come from the Playwright config.

import { expect, test } from '@playwright/test';

/** Parse the leading number out of a HUD readout cell (e.g. "12.34" → 12.34). */
function num(text: string | null): number {
  const m = /-?\d+(?:\.\d+)?/.exec(text ?? '');
  return m ? Number(m[0]) : NaN;
}

test.describe('water chemistry + test-kit + water change (?mode=simulation)', () => {
  test('mounts the test-kit readout, advances the cycle, and a water change lowers it', async ({
    page,
  }) => {
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

    // ── 1. The F13.5b test-kit readout is present in the simulation HUD.
    const hud = page.locator('aquascape-simulation-hud');
    await expect(hud.getByText('Water chemistry')).toBeVisible({ timeout: 15_000 });

    const badge = hud.locator('.sim-hud__cycle');
    await expect(badge).toHaveText(/uncycled|cycling|cycled/i);

    const kit = hud.locator('.sim-hud__kit');
    await expect(kit).toContainText('Ammonia');
    await expect(kit).toContainText('Nitrate');
    // Four rows, each with a swatch + a band verdict.
    await expect(hud.locator('.sim-hud__kit-row')).toHaveCount(4);
    await expect(hud.locator('.sim-hud__kit-swatch')).toHaveCount(4);
    await expect(hud.locator('.sim-hud__kit-band').first()).toHaveText(/safe|caution|danger/i);

    // The Ammonia value cell — row 0 of the kit readout.
    const ammoniaVal = hud.locator('.sim-hud__kit-row').nth(0).locator('.sim-hud__kit-val');

    // ── 2. The chemistry ADVANCES over sim time. Ammonia climbs fast off zero
    // in a freshly-started stocked tank; wait until it's measurably elevated so
    // the water change below has something to dilute.
    await expect
      .poll(async () => num(await ammoniaVal.textContent()), { timeout: 30_000 })
      .toBeGreaterThan(0.1);
    const beforeAmmonia = num(await ammoniaVal.textContent());

    // ── 3. Perform a 50% water change from the simulation controls. The live
    // runtime dilutes via the same applyWaterChange helper the command uses, so
    // the readout drops immediately.
    const controls = page.locator('aquascape-simulation-controls');
    await controls.getByRole('button', { name: 'Change 50%' }).click();

    // The diluted ammonia is roughly half — assert it dropped clearly.
    await expect
      .poll(async () => num(await ammoniaVal.textContent()), { timeout: 5_000 })
      .toBeLessThan(beforeAmmonia * 0.8);
  });
});
