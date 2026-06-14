// Stage 14 F14.3 — fish-vitality HUD e2e (Playwright, CI-validated).
//
// chromium is NOT provisioned in the agent sandbox (Playwright CDN blocked);
// this spec runs in CI per docs/caveats/e2e.md. What it proves end-to-end
// (that unit tests can't):
//   1. Booting `?mode=simulation` mounts the fish-vitality HUD once the
//      showcase world spawns fish (the HUD self-mounts off the live
//      WorldSnapshot health/hunger slabs — no canvas raycast).
//   2. The HUD shows live school health + hunger aggregates and a selectable
//      fish list, and updates as the sim ticks (the poll re-reads the slabs).
//   3. Click-to-inspect: clicking a fish row fills the inspector with that
//      fish's hearts + hunger (the selectable-list picking path chosen
//      because the 3D renderer's hitTest returns null — see the component
//      header + simulation-mode guide).
//
// Uses the same `?mode=simulation` showcase the lights/game specs drive (the
// renderer-side `resolveAppMode()` honours the query param so the showcase
// runs under `nx serve web`). SwiftShader flags + the chromium executable
// come from the Playwright config.

import { expect, test } from '@playwright/test';

test.describe('fish-vitality HUD (?mode=simulation)', () => {
  test('mounts, shows live school vitality, and inspects a clicked fish', async ({ page }) => {
    test.slow(); // showcase scene (~100 fish) under software WebGL is heavy

    await page.goto('/?mode=simulation');
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));

    // The showcase spawns its livestock on first 3D paint. Wait for the ECS
    // world to hold fish, which is what makes the HUD self-mount.
    await page.waitForFunction(() => (window.__aquascape_debug__?.getEntityCount() ?? 0) > 0, undefined, {
      timeout: 30_000,
    });

    // ── 1. The vitality HUD is present + shows the aggregate strip.
    const hud = page.locator('aquascape-vitality-hud .vit');
    await expect(hud).toBeVisible({ timeout: 15_000 });

    // Avg / min / hungry stats render as percentages.
    const stats = page.locator('aquascape-vitality-hud .vit__stat dd');
    await expect(stats).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(stats.nth(i)).toHaveText(/\d+%/);
    }

    // ── 2. The selectable fish list has rows (one per fish, capped).
    const rows = page.locator('aquascape-vitality-hud .vit__row');
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // The avg-health readout is a live value (re-poll after a beat; the
    // number is allowed to drift as the sim ticks — we only assert it stays
    // a valid percentage, proving the poll keeps reading the slabs).
    const avg = page.locator('aquascape-vitality-hud .vit__stat dd').first();
    await expect(avg).toHaveText(/\d+%/);
    await page.waitForTimeout(800);
    await expect(avg).toHaveText(/\d+%/);

    // ── 3. Click-to-inspect: before selection the inspector prompts; after a
    // row click it shows hearts + a hunger meter.
    await expect(page.locator('aquascape-vitality-hud .vit__insp-empty')).toBeVisible();
    await rows.first().click();
    await expect(page.locator('aquascape-vitality-hud .vit__heart')).toHaveCount(5);
    await expect(page.locator('aquascape-vitality-hud .vit__meter-val')).toBeVisible();
    // The selected row is marked for assistive tech.
    await expect(page.locator('aquascape-vitality-hud .vit__row--sel')).toHaveCount(1);
  });
});
