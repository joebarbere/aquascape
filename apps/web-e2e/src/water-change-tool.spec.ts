// Stage 15 F15.2 — water-change action-HUD e2e (Playwright, CI-validated).
//
// chromium is NOT provisioned in the agent sandbox (Playwright CDN blocked);
// this spec runs in CI per docs/caveats/e2e.md. What it proves end-to-end
// (that the unit + component tests can't): the GUIDED water-change flow in the
// bottom-center action HUD drives the live runtime through a real camera + GL
// canvas, lowering the Stage-13 test-kit NITRATE readout after the siphon OUT.
//
// The 4-step flow:
//   1. Select the Water change tool → the replacement-params form appears.
//   2. Confirm params → the place-siphon step (siphon nozzle mounts).
//   3. Drag on the 3D canvas → the nozzle is positioned (raycastTankPoint to the
//      water plane) and the OUT button enables.
//   4. Siphon OUT → water level drops + ammonia/nitrite/NITRATE dilute (the
//      WaterChange command + the live WaterChemistryService, one applyWaterChange
//      helper). The HUD nitrate cell drops.
//
// Uses the same `?mode=simulation` showcase the other sim specs drive. The
// nitrate assertion is the acceptance criterion; the component test
// (`simulation-actions.component.spec.ts`) + the helper test
// (`water-change-flow.spec.ts` / `water-change.service.spec.ts`) cover the
// state machine + command/runtime wiring should a SwiftShader regression make
// the canvas drag's raycast flaky.

import { expect, test } from '@playwright/test';

/** Parse the leading number out of a HUD readout cell. */
function num(text: string | null): number {
  const m = /-?\d+(?:\.\d+)?/.exec(text ?? '');
  return m ? Number(m[0]) : NaN;
}

test.describe('water-change action HUD (?mode=simulation)', () => {
  test('run the guided flow: params → place → OUT lowers the nitrate readout', async ({ page }) => {
    test.slow(); // showcase scene (~100 fish) under software WebGL is heavy

    await page.goto('/?mode=simulation');
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));

    await page.waitForFunction(
      () => (window.__aquascape_debug__?.getEntityCount() ?? 0) > 0,
      undefined,
      { timeout: 30_000 },
    );

    // The chemistry must have something to dilute — wait until nitrate has
    // accumulated off zero (it climbs as the cycle advances under sim time).
    const hud = page.locator('aquascape-simulation-hud');
    await expect(hud.getByText('Water chemistry')).toBeVisible({ timeout: 15_000 });
    const nitrateVal = hud.locator('.sim-hud__kit-row').nth(2).locator('.sim-hud__kit-val');
    await expect
      .poll(async () => num(await nitrateVal.textContent()), { timeout: 30_000 })
      .toBeGreaterThan(0.5);
    const beforeNitrate = num(await nitrateVal.textContent());

    // ── 1. Select the Water change tool → the replacement-params form.
    const actions = page.locator('aquascape-simulation-actions');
    await actions.getByRole('button', { name: 'Water change' }).click();
    await expect(actions.locator('[aria-label="Water change"]')).toBeVisible();
    await expect(actions.locator('input[aria-label="Replacement pH"]')).toBeVisible();

    // ── 2. Confirm params → the place-siphon step.
    await actions.getByRole('button', { name: 'Next: place siphon' }).click();
    await expect(actions.getByText('Place the siphon')).toBeVisible();

    // ── 3. Drag on the 3D canvas (the second stacked canvas) near its center to
    // position the nozzle — this enables the OUT button.
    const canvas = page.locator('canvas').nth(1);
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height * 0.4; // near the surface
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 8, cy + 4, { steps: 3 });
      await page.mouse.up();
    }

    const outBtn = actions.getByRole('button', { name: 'Siphon out' });
    await expect(outBtn).toBeEnabled({ timeout: 5_000 });

    // ── 4. Siphon OUT → nitrate drops in the live readout.
    await outBtn.click();
    await expect
      .poll(async () => num(await nitrateVal.textContent()), { timeout: 5_000 })
      .toBeLessThan(beforeNitrate * 0.9);

    // ── The IN step is available after OUT.
    await expect(actions.getByRole('button', { name: 'Siphon in fresh water' })).toBeVisible();
  });
});
