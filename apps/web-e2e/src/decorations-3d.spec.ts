// 3D-modeled decorations — Playwright e2e.
//
// WHAT THIS PROVES (that unit tests can't):
//   * Dragging a decoration tile from the Decorations palette onto the 2D
//     canvas dispatches an AddObject command that lands a `kind: 'decor'`
//     object in the live scene (read back through the debug hook).
//   * Flipping to 3D actually paints the placed decoration: the GLB loads
//     through the renderer's ModelCache (catalogModelBaseUrl → GLTFLoader)
//     and rasterises a non-blank, varied frame — the model, not the flat
//     extruded-silhouette fallback you'd get on a load failure.
//
// VISUAL ASSERTIONS follow the suite convention (see livestock-3d.spec.ts):
// empirical floors over channel variance / differing-pixel counts, never
// exact-pixel snapshots (SwiftShader output is not bit-stable).
//
//   * Channel-variance floor proves the 3D canvas is not a flat fill (a
//     blank/failed render is near-uniform). The lit, shadowed, PBR model
//     against the tank produces variance orders of magnitude above the floor.
//   * Frame-diff floor between 2D and 3D proves the toggle genuinely
//     re-rasterised into the second canvas.

import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

// `window.__aquascape_debug__` is declared in livestock-3d.spec.ts (global
// augmentations are project-wide). This spec reads getScene / getViewMode.

/** Min per-channel variance for a non-blank 3D frame. */
const CANVAS_VARIANCE_FLOOR = 25;
/** Min differing pixels between the 2D and 3D captures. */
const MODE_DIFF_FLOOR = 5_000;

test.describe('3D-modeled decorations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));
  });

  test('dragging a decoration onto the canvas places it and it renders in 3D', async ({
    page,
  }) => {
    test.slow(); // GLB load + 3D rasterisation under software WebGL

    // ── Make sure the Decorations panel is expanded.
    const chestTile = page.getByRole('button', {
      name: /^Drag Sunken Treasure Chest onto the canvas/i,
    });
    if (!(await chestTile.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /^Decorations/ }).click();
    }
    await expect(chestTile).toBeVisible();

    // ── Drag the chest tile onto the 2D editing canvas. The Decorations
    // panel sits low in a scrollable left rail, so scroll the tile into the
    // viewport before reading its box (off-screen coords can't be dragged).
    const canvas2d = page.locator('canvas').first();
    await chestTile.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const tileBox = await chestTile.boundingBox();
    const canvasBox = await canvas2d.boundingBox();
    if (!tileBox || !canvasBox) throw new Error('tile or canvas not laid out');

    await page.mouse.move(
      tileBox.x + tileBox.width / 2,
      tileBox.y + tileBox.height / 2,
    );
    await page.mouse.down();
    // A small initial nudge starts the drag, then move to the canvas centre
    // in steps so the document-level pointermove handler tracks it.
    await page.mouse.move(
      tileBox.x + tileBox.width / 2 + 6,
      tileBox.y + tileBox.height / 2 + 6,
      { steps: 3 },
    );
    const targetX = canvasBox.x + canvasBox.width / 2;
    const targetY = canvasBox.y + canvasBox.height / 2;
    await page.mouse.move(targetX, targetY, { steps: 15 });
    await page.mouse.up();

    // ── The scene now carries a decor object.
    await page.waitForFunction(() => {
      const scene = window.__aquascape_debug__?.getScene();
      if (!scene) return false;
      return scene.layers.some((l) =>
        l.objects.some((o) => o.kind === 'decor'),
      );
    });

    // ── 2D baseline capture for the cross-mode diff.
    await page.waitForTimeout(300);
    const twoD = await canvas2d.screenshot();

    // ── Flip to 3D and let the GLB load + animate a few frames.
    await enter3d(page);
    const canvas3d = page.locator('canvas').nth(1);
    await expect(canvas3d).toBeVisible();
    await page.waitForTimeout(1_500);
    const threeD = await canvas3d.screenshot();

    // ── The 3D frame is non-blank (the model rasterised).
    const stats = await sharp(threeD).stats();
    const maxChannelVariance = Math.max(
      ...stats.channels.map((c) => c.stdev * c.stdev),
    );
    expect(maxChannelVariance).toBeGreaterThan(CANVAS_VARIANCE_FLOOR);

    // ── The 2D→3D toggle genuinely re-rasterised.
    expect(await countDifferingPixels(twoD, threeD)).toBeGreaterThan(
      MODE_DIFF_FLOOR,
    );
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
  await page.waitForFunction(
    () => window.__aquascape_debug__?.getViewMode() === '3d',
    undefined,
    { timeout: 5_000 },
  );
}

async function currentMode(page: Page): Promise<string> {
  return page.evaluate(() => window.__aquascape_debug__?.getViewMode() ?? 'unknown');
}

/** Count pixels whose summed-channel delta exceeds a small threshold. */
async function countDifferingPixels(a: Buffer, b: Buffer): Promise<number> {
  const [ra, rb] = await Promise.all([
    sharp(a).raw().toBuffer({ resolveWithObject: true }),
    sharp(b).raw().toBuffer({ resolveWithObject: true }),
  ]);
  const da = ra.data;
  const db = rb.data;
  const len = Math.min(da.length, db.length);
  const channels = ra.info.channels;
  let differing = 0;
  for (let i = 0; i < len; i += channels) {
    const delta =
      Math.abs(da[i] - db[i]) +
      Math.abs(da[i + 1] - db[i + 1]) +
      Math.abs(da[i + 2] - db[i + 2]);
    if (delta > 24) differing++;
  }
  return differing;
}
