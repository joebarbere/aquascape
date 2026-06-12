// Overhead equipment lights + fish-eye view mode — Playwright e2e.
//
// WHAT THIS PROVES (that unit tests can't):
//   * Attaching a `category: 'light'` equipment entry through the real
//     LivestockEquipmentToolComponent UI makes the 3D render measurably
//     BRIGHTER — the SpotLight + emissive fixture actually rasterise.
//   * Flipping to the fish-eye toolbar segment relocates the camera inside
//     the tank: the frame differs massively from the orbit framing, and the
//     debug hook reports `viewMode === 'fish-eye'`.
//
// VISUAL ASSERTIONS follow the suite convention (see livestock-3d.spec.ts
// header): empirical floors over mean-luminance / differing-pixel counts,
// never exact-pixel snapshots.
//
//   * Mean-luminance ratio floor 1.02: the Chihiros WRGB II Pro (6630 lm —
//     the brightest catalog light) measured ~1.3× brighter in headless
//     SwiftShader captures; 1.02 is a generous floor.
//   * Fish-eye frame-diff floor 5000 px (same floor the day-night scrub
//     test uses): the camera teleports from outside the tank to inside it,
//     so nearly every pixel changes — observed diffs are ~two orders of
//     magnitude above the floor.

import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

// The `window.__aquascape_debug__` global is declared (and its
// `AquascapeDebugHandle` mirror documented) in `livestock-3d.spec.ts` —
// global augmentations are project-wide, so re-declaring it here would
// conflict. This spec only reads `getScene` / `getViewMode`.

/** With-light / without-light mean-luminance ratio floor. */
const BRIGHTNESS_RATIO_FLOOR = 1.02;
/** Orbit-vs-fish-eye differing-pixel floor (same as the day-night scrub). */
const FISH_EYE_DIFF_FLOOR = 5_000;

test.describe('equipment lights + fish-eye view', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));
  });

  test('a catalog light brightens the 3D render; fish-eye relocates the camera', async ({
    page,
  }) => {
    test.slow(); // two 3D entries + three screenshots under software WebGL

    // ── One tetra so fish-eye has a fish to ride.
    await page.getByRole('radio', { name: 'Fish' }).click();
    const tetraTile = page.getByRole('button', { name: /^Add Neon Tetra/i });
    await expect(tetraTile).toBeVisible();
    await tetraTile.click();
    await page.waitForFunction(() => {
      const scene = window.__aquascape_debug__?.getScene();
      return (scene?.livestock?.length ?? 0) > 0;
    });

    // ── 3D baseline shot WITHOUT a light.
    await enter3d(page);
    const canvas = page.locator('canvas').nth(1);
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(1_000);
    const withoutLight = await canvas.screenshot();

    // ── Back to 2D, attach the brightest catalog light through the UI.
    await page.getByRole('button', { name: /Switch to 2D view/ }).click();
    await page.waitForFunction(() => window.__aquascape_debug__?.getViewMode() === '2d');
    await page.getByRole('radio', { name: 'Light' }).click();
    const lightTile = page.getByRole('button', { name: /^Add Chihiros WRGB II Pro 60/i });
    await expect(lightTile).toBeVisible();
    await lightTile.click();
    await page.waitForFunction(() => {
      const scene = window.__aquascape_debug__?.getScene();
      return (scene?.equipment?.length ?? 0) > 0;
    });

    // ── 3D again — the overhead fixture + spot must brighten the frame.
    await enter3d(page);
    await page.waitForTimeout(1_000);
    const withLight = await canvas.screenshot();
    const [darkMean, litMean] = await Promise.all([
      meanLuminance(withoutLight),
      meanLuminance(withLight),
    ]);
    expect(litMean).toBeGreaterThan(darkMean * BRIGHTNESS_RATIO_FLOOR);

    // ── Fish-eye: the camera leaves the orbit pose and rides the fish.
    await page.getByRole('button', { name: /Switch to fish-eye view/ }).click();
    await page.waitForFunction(
      () => window.__aquascape_debug__?.getViewMode() === 'fish-eye',
      undefined,
      { timeout: 5_000 },
    );
    await page.waitForTimeout(1_000);
    const fishEye = await canvas.screenshot();
    expect(await countDifferingPixels(withLight, fishEye)).toBeGreaterThan(FISH_EYE_DIFF_FLOOR);

    // ── Returning to plain 3D restores the orbit camera mode.
    await page.getByRole('button', { name: /Switch to 3D view/ }).click();
    await page.waitForFunction(() => window.__aquascape_debug__?.getViewMode() === '3d');
  });
});

/** Enter 3D via the cross-platform chord, toolbar-button fallback. */
async function enter3d(page: Page): Promise<void> {
  if ((await currentMode(page)) !== '3d') {
    await page.keyboard.press('Control+Shift+3');
  }
  if ((await currentMode(page)) !== '3d') {
    await page.getByRole('button', { name: /Switch to 3D view/ }).click();
  }
  await page.waitForFunction(() => window.__aquascape_debug__?.getViewMode() === '3d', undefined, {
    timeout: 5_000,
  });
}

async function currentMode(page: Page): Promise<string> {
  return page.evaluate(() => window.__aquascape_debug__?.getViewMode() ?? 'unknown');
}

/** Mean luminance across all channels — sharp's per-channel means averaged. */
async function meanLuminance(buf: Buffer): Promise<number> {
  const stats = await sharp(buf).removeAlpha().stats();
  const sum = stats.channels.reduce((acc, c) => acc + c.mean, 0);
  return sum / stats.channels.length;
}

/**
 * Count pixels whose RGB differs between two same-sized PNGs. Mirrors the
 * helper in livestock-3d.spec.ts (kept local — each spec file is
 * self-contained by suite convention).
 */
async function countDifferingPixels(a: Buffer, b: Buffer): Promise<number> {
  const [ra, rb] = await Promise.all([
    sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) {
    // Different dims = everything differs.
    return ra.info.width * ra.info.height;
  }
  let differing = 0;
  const channels = ra.info.channels;
  for (let p = 0; p < ra.data.length; p += channels) {
    if (
      ra.data[p] !== rb.data[p] ||
      ra.data[p + 1] !== rb.data[p + 1] ||
      ra.data[p + 2] !== rb.data[p + 2]
    ) {
      differing++;
    }
  }
  return differing;
}
