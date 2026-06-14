// Stage 15 F15.1 — feeding action-HUD e2e (Playwright, CI-validated).
//
// chromium is NOT provisioned in the agent sandbox (Playwright CDN blocked);
// this spec runs in CI per docs/caveats/e2e.md. What it proves end-to-end
// (that the unit + component tests can't):
//   1. Booting `?mode=simulation` mounts the bottom-center action HUD with
//      square tool buttons.
//   2. Selecting Feed shows the catalog food picker; picking a food arms the
//      placing sub-step (the "click the tank to drop" prompt appears).
//   3. Clicking the 3D canvas drops typed food at the raycast point — the ECS
//      world's food-sprite count rises (debug hook `getFoodSpriteCount`),
//      proving the canvas-pixel → raycastTankPoint → spawnFood path works
//      through a real camera + GL canvas.
//
// Uses the same `?mode=simulation` showcase the lights/vitality specs drive
// (the renderer-side `resolveAppMode()` honours the query param so the
// showcase runs under `nx serve web`). SwiftShader flags + the chromium
// executable come from the Playwright config.
//
// NOTE on the raycast under software WebGL: the drop relies on
// `raycastTankPoint` casting through the LIVE orbit camera. The camera frames
// the tank AABB, so a click near the canvas center lands on the substrate
// floor inside the footprint (out-of-footprint hits clamp into the tank by
// default). If a future SwiftShader regression makes the center-click miss,
// the component test (`simulation-actions.component.spec.ts`) + the
// `feeding-drop.spec.ts` helper test still cover the picker → spawn wiring;
// this spec is the integration proof on real GL.

import { expect, test } from '@playwright/test';

test.describe('feeding action HUD (?mode=simulation)', () => {
  test('select feed, pick a food, click the tank → food sprite spawns', async ({ page }) => {
    test.slow(); // showcase scene (~100 fish) under software WebGL is heavy

    await page.goto('/?mode=simulation');
    await expect(page.locator('canvas').first()).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));

    // The showcase spawns its livestock on first 3D paint; wait for a world so
    // food sprites have somewhere to land.
    await page.waitForFunction(
      () => (window.__aquascape_debug__?.getEntityCount() ?? 0) > 0,
      undefined,
      { timeout: 30_000 },
    );

    // ── 1. The action HUD is present with the tool buttons.
    const toolbar = page.locator('aquascape-simulation-actions [role="toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 15_000 });
    const feedBtn = page.getByRole('button', { name: 'Feed' });
    await expect(feedBtn).toBeVisible();

    // No sprites before we feed.
    const before = await page.evaluate(
      () => window.__aquascape_debug__?.getFoodSpriteCount() ?? -1,
    );
    expect(before).toBe(0);

    // ── 2. Select Feed → the food picker appears; pick the first food.
    await feedBtn.click();
    const picker = page.locator('aquascape-simulation-actions [aria-label="Food types"]');
    await expect(picker).toBeVisible();
    await page.locator('aquascape-simulation-actions .actions__food').first().click();
    await expect(page.locator('aquascape-simulation-actions .actions__panel-title')).toContainText(
      /Click the tank to drop/i,
    );

    // ── 3. Click the 3D canvas near its center → a food sprite drops at the
    // raycast point. The 3D canvas is the SECOND stacked canvas (the 2D one is
    // hidden behind it).
    const canvas = page.locator('canvas').nth(1);
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) {
      // Click slightly below center so the floor-plane ray lands well inside
      // the tank footprint (the camera looks down at the substrate).
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.62);
    }

    // The drop is synchronous (event handler → spawnFood → world), but poll for
    // robustness against the change-detection cycle.
    await expect
      .poll(() => page.evaluate(() => window.__aquascape_debug__?.getFoodSpriteCount() ?? 0))
      .toBeGreaterThanOrEqual(1);
  });

  test('hud hide actions removes the action HUD; show restores it', async ({ page }) => {
    await page.goto('/?mode=simulation');
    await expect(page.locator('canvas').first()).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));

    const hud = page.locator('aquascape-simulation-actions');
    await expect(hud).toBeVisible({ timeout: 15_000 });

    // Open the console (~ / Backquote) and hide the action HUD.
    await page.keyboard.press('Backquote');
    const field = page.locator('aquascape-simulation-console input');
    await expect(field).toBeVisible();
    await field.fill('hud hide actions');
    await field.press('Enter');
    await expect(hud).toHaveCount(0);

    await field.fill('hud show actions');
    await field.press('Enter');
    await expect(page.locator('aquascape-simulation-actions')).toBeVisible();
  });
});
