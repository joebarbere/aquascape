// Stage 15 F15.2 — water-change action-HUD e2e (Playwright, CI-validated).
//
// chromium is NOT provisioned in the agent sandbox (Playwright CDN blocked);
// this spec runs in CI per docs/caveats/e2e.md. What it proves end-to-end
// (that the unit + component tests can't): the GUIDED water-change flow in the
// bottom-center action HUD renders and is OPERABLE through a real camera + GL
// canvas — its 4 steps mount in order, the canvas-drag raycast positions the
// siphon (enabling OUT), and driving it through to refill leaves the live
// test-kit readout in a valid state.
//
// The 4-step flow:
//   1. Select the Water change tool → the replacement-params form appears.
//   2. Confirm params → the place-siphon step (siphon nozzle mounts).
//   3. Drag on the 3D canvas → the nozzle is positioned (raycastTankPoint to the
//      water plane) and the OUT button enables.
//   4. Siphon OUT → the WaterChange command + the live WaterChemistryService
//      dilution run (one applyWaterChange helper), and the IN step opens.
//
// WHAT THIS DELIBERATELY DOES NOT ASSERT — and why (see docs/caveats/e2e.md →
// "Software-WebGL e2e: assert mount/wiring, not simulation progression"): the
// CI e2e runs under SOFTWARE WebGL (SwiftShader), where the live nitrogen-cycle
// tick is THROTTLED + non-deterministic. So this spec does NOT wait for nitrate
// to climb off zero before the change, nor assert that the OUT siphon
// numerically LOWERS the nitrate readout. That dilution math is covered
// deterministically by `domain/water-sim`, the `WaterChange` command, and the
// `water-change-flow` / `water-change.service` specs in apps/web. The component
// state machine (params → place → OUT → IN) is covered by
// `simulation-actions.component.spec.ts`. This spec is the integration proof
// that the flow boots + drives end-to-end on real GL.
//
// Uses the same `?mode=simulation` showcase the other sim specs drive.

import { expect, test } from '@playwright/test';

/** Parse the leading number out of a HUD readout cell. */
function num(text: string | null): number {
  const m = /-?\d+(?:\.\d+)?/.exec(text ?? '');
  return m ? Number(m[0]) : NaN;
}

test.describe('water-change action HUD (?mode=simulation)', () => {
  test('run the guided flow: params → place → OUT → IN keeps the readout valid', async ({
    page,
  }) => {
    test.slow(); // showcase scene (~100 fish) under software WebGL is heavy

    await page.goto('/?mode=simulation');
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));

    await page.waitForFunction(
      () => (window.__aquascape_debug__?.getEntityCount() ?? 0) > 0,
      undefined,
      { timeout: 30_000 },
    );

    // The live test-kit nitrate cell — bound to the WaterChemistryService. We
    // read it before/after only to assert it stays a VALID number through the
    // flow (not that it dropped — that's unit-tested deterministically).
    const hud = page.locator('aquascape-simulation-hud');
    await expect(hud.getByText('Water chemistry')).toBeVisible({ timeout: 15_000 });
    const nitrateVal = hud.locator('.sim-hud__kit-row').nth(2).locator('.sim-hud__kit-val');
    await expect(nitrateVal).toHaveText(/\d/);
    expect(Number.isFinite(num(await nitrateVal.textContent()))).toBe(true);

    // ── 1. Select the Water change tool → the replacement-params form. Under
    // serial software-WebGL contention the first synthetic click can be dropped
    // before Angular's change detection swaps the panel in, so click-then-verify
    // with a retry. The panel is the unambiguous `role="group"` (the toolbar
    // button shares the "Water change" aria-label).
    const actions = page.locator('aquascape-simulation-actions');
    const toolBtn = actions.getByRole('button', { name: 'Water change' });
    const panel = actions.getByRole('group', { name: 'Water change' });
    await expect(async () => {
      await toolBtn.click();
      await expect(panel).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await expect(actions.locator('input[aria-label="Replacement pH"]')).toBeVisible();

    // ── 2. Confirm params → the place-siphon step (retry the transition click
    // against dropped clicks under serial software-WebGL contention).
    const nextBtn = actions.getByRole('button', { name: 'Next: place siphon' });
    await expect(async () => {
      await nextBtn.click();
      await expect(actions.getByText('Place the siphon')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });

    // ── 3. Drag on the 3D canvas (the second stacked canvas) near its center to
    // position the nozzle — this enables the OUT button (the raycast → place
    // wiring runs through the live camera + GL canvas).
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

    // ── 4. Siphon OUT → the dilution pipeline runs (WaterChange command + the
    // live WaterChemistryService). We assert the flow ADVANCES to the refill
    // step (proving OUT fired its handler) and the readout stays valid — not
    // that nitrate numerically dropped (unit-tested deterministically).
    await expect(async () => {
      await outBtn.click();
      await expect(
        actions.getByRole('button', { name: 'Siphon in fresh water' }),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await expect(nitrateVal).toHaveText(/\d/);
    expect(Number.isFinite(num(await nitrateVal.textContent()))).toBe(true);
  });
});
