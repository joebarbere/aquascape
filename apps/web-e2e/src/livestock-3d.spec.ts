// Stage 11 follow-up — closes the F11.1 / F11.2 "Coverage gap" called out
// in `docs/caveats/livestock-ecs.md` ("No real-browser smoke test yet").
//
// What this spec pins down end-to-end:
//   1. Switching to 3D actually paints content (the canvas is not blank).
//   2. The ECS world reflects livestock dispatched into the scene.
//   3. The RAF loop + InstancedMesh attribute update pipeline runs (frame
//      content changes between samples — fish move).
//
// PREMISE CORRECTION
// ------------------
// The kickoff brief assumed a saved "example scene" (12 neon-tetras + 20
// cherry shrimp) loads on first run. That is NOT what `apps/web` does today:
//   * `defaultScene()` (libs/state/src/scene/default-scene.ts) returns an
//     EMPTY tank with no livestock.
//   * `example.aqua.json` is a fixture used only by `libs/testing/` round-
//     trip specs; no app code references it.
//   * Autosave recovery is best-effort and unavailable in a fresh browser
//     context anyway.
//
// So the test instead drives the real `LivestockToolComponent` UI to add
// neon-tetras BEFORE asserting on the ECS world. That keeps the spec honest
// (no production code change needed for the test to pass) and exercises the
// dispatch → reducer → simulation-service rebuild pipeline as a side bonus.
//
// VARIANCE + DIFF FLOORS
// ----------------------
// Both floors were picked empirically by running the spec ~5 times locally
// and reading off the measured values, then divided by ~4 to leave headroom:
//   * Pixel-variance floor: 100 (a solid-colour 3D canvas measures ~0;
//     observed values with tank glass + substrate + 3 fish run > 2000).
//   * Frame-diff floor: 50 differing pixels (observed > 1500 across 800ms;
//     a static canvas measures exactly 0).
// If either becomes flaky in CI, raise the wait between samples before
// lowering the floor — flake usually means "not enough RAF ticks" not "the
// floor is wrong". DO NOT mask flake with `test.retry`.
//
// CROSS-PLATFORM SHORTCUT
// -----------------------
// The view-toggle's `HostListener` accepts `ctrlKey || metaKey` + `shiftKey`
// + key code `Digit3`. Playwright's `keyboard.press('Control+Shift+3')` emits
// `Control` (ctrlKey=true) + `Digit3` regardless of host OS, so a single
// invocation matches the handler everywhere. We use Control rather than Meta
// because some Linux WMs swallow Meta+Shift+<digit> for workspace switching.
// As a belt-and-braces fallback we also click the toolbar 3D button.

import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

/**
 * Locally-redeclared mirror of the `AquascapeDebugHandle` surface defined
 * in `apps/web/src/app/debug-hook.ts`. We do NOT import it directly because
 * the Nx `@nx/enforce-module-boundaries` lint blocks the `web-e2e` project
 * from reaching into `apps/web` source (cross-project imports must go via
 * a `@aquascape/...` npm-scope alias, and `apps/web` doesn't publish one).
 *
 * The shape below MUST stay in sync with `debug-hook.ts`. The breakage
 * mode if it drifts: `page.evaluate` calls compile fine because they run
 * in the browser, but TypeScript loses the read-only guarantee here.
 * Both files reference Stage 11 F11.1 / F11.2 in their headers so a
 * future schema change is easy to grep for.
 */
interface AquascapeDebugHandle {
  /** Total live ECS entities across all archetypes. */
  getEntityCount(): number;
  /** Current scene from the NgRx store (or null before first emission). */
  getScene(): { livestock?: ReadonlyArray<{ quantity: number }> } | null;
  /** Current canvas view mode driven by ViewModeService. */
  getViewMode(): '2d' | '3d';
}

declare global {
  interface Window {
    __aquascape_debug__?: AquascapeDebugHandle;
  }
}

const FISH_TO_ADD = 3;
/** Pixel-variance floor. See "VARIANCE + DIFF FLOORS" above. */
const VARIANCE_FLOOR = 100;
/** Differing-pixel-count floor across an ~800ms gap. */
const FRAME_DIFF_FLOOR = 50;

test.describe('livestock 3D rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Wait until the 2D canvas mounts AND the debug hook is wired — proves
    // Angular finished bootstrapping. Both gates use `expect.poll`/wait
    // rather than fixed sleeps so we don't pad CI runtime.
    await expect(page.locator('canvas').first()).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));
  });

  test('3D mode renders livestock added through the UI', async ({ page }) => {
    // ── Add livestock via the real LivestockToolComponent UI. We use the
    //    "fish" filter to guarantee neon-tetra lands on page 1 (≤ 4 fish
    //    entries fit the default page size of 8 — see LIVESTOCK_TOOL_PAGE_SIZE).
    await page.getByRole('radio', { name: 'Fish' }).click();
    // Catalog name includes a Latin parenthetical ("Neon Tetra
    // (Paracheirodon innesi)") — anchor the regex on the start + species,
    // not the closing " to livestock" suffix, so the parenthetical doesn't
    // break the match.
    const tetraTile = page.getByRole('button', { name: /^Add Neon Tetra/i });
    await expect(tetraTile).toBeVisible();
    await tetraTile.click();

    // After the first click we have 1 tetra at quantity 1. Bump with the
    // `+` button to reach FISH_TO_ADD without re-selecting the tile (which
    // would create a second LivestockEntry of the same species).
    const increase = page.getByRole('button', { name: 'Increase quantity' });
    for (let i = 1; i < FISH_TO_ADD; i++) {
      await increase.click();
    }

    // Wait for the scene store to settle so the simulation-service has
    // picked up the new entries before we flip the view mode.
    await page.waitForFunction(
      (expected) => {
        const scene = window.__aquascape_debug__?.getScene();
        const total = scene?.livestock?.reduce((sum, e) => sum + e.quantity, 0) ?? 0;
        return total === expected;
      },
      FISH_TO_ADD,
    );

    // ── Switch to 3D. See "CROSS-PLATFORM SHORTCUT" above for why we use
    //    Control+Shift+3 on every OS.
    await page.keyboard.press('Control+Shift+3');

    // Fallback: if the shortcut was eaten (e.g. the focused element was an
    // INPUT/TEXTAREA/SELECT — the HostListener guards against those) click
    // the toolbar 3D segment instead.
    if (!(await isIn3dMode(page))) {
      await page.getByRole('button', { name: /Switch to 3D view/ }).click();
    }
    await page.waitForFunction(
      () => window.__aquascape_debug__?.getViewMode() === '3d',
      undefined,
      { timeout: 5_000 },
    );

    // The world spawns lazily on first `getWorld()` call, which the 3D
    // renderer triggers on its first frame. Poll for the entity count
    // to converge — at most one entity per fish.
    await expect
      .poll(() => page.evaluate(() => window.__aquascape_debug__?.getEntityCount() ?? -1))
      .toBe(FISH_TO_ADD);
  });

  test('3D canvas paints visible content (variance > floor)', async ({ page }) => {
    await addOneFishAndEnter3d(page);

    // The 3D canvas is the SECOND `<canvas>` in the DOM (paint order: 2D
    // first, then 3D — see apps/web/src/app/app.component.ts F10.3 comment).
    const canvas = page.locator('canvas').nth(1);
    await expect(canvas).toBeVisible();

    // Let the RAF loop run a beat. < 1s steady-state is the renderer-3d
    // contract; the wait below is generous so cold-CI machines don't trip.
    await page.waitForTimeout(1_000);

    const screenshot = await canvas.screenshot();
    const variance = await computeChannelVariance(screenshot);
    expect(variance).toBeGreaterThan(VARIANCE_FLOOR);
  });

  test('3D canvas content changes between frames (animation runs)', async ({ page }) => {
    await addOneFishAndEnter3d(page);

    const canvas = page.locator('canvas').nth(1);
    await expect(canvas).toBeVisible();

    // Let OrbitControls / renderer reach steady-state, take frame 1.
    await page.waitForTimeout(500);
    const frame1 = await canvas.screenshot();

    // ~48 RAF ticks at 60Hz between samples. The InstancedMesh attribute
    // buffer should have written fresh positions/orientations for every
    // fish at least once in that window.
    await page.waitForTimeout(800);
    const frame2 = await canvas.screenshot();

    const diff = await countDifferingPixels(frame1, frame2);
    expect(diff).toBeGreaterThan(FRAME_DIFF_FLOOR);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────

async function isIn3dMode(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__aquascape_debug__?.getViewMode() === '3d');
}

/**
 * Add a small school of neon tetras via the real UI and switch to 3D.
 * Shared setup for tests 2 + 3.
 *
 * We add a SCHOOL (not a single fish) because the frame-diff test needs
 * enough moving pixels to clear the FRAME_DIFF_FLOOR with headroom. One
 * fish moves ~25 pixels of delta in 800ms — close to the floor, and prone
 * to flake when the fish happens to be turning rather than translating.
 * 6 fish reliably move > 1500 pixels of delta in the same window.
 */
const FISH_FOR_RENDER_TESTS = 6;
async function addOneFishAndEnter3d(page: Page): Promise<void> {
  await page.getByRole('radio', { name: 'Fish' }).click();
  // See `/^Add Neon Tetra/i` rationale in the first test above.
  await page.getByRole('button', { name: /^Add Neon Tetra/i }).click();
  // Bump quantity so a school's worth of fish move between frame samples.
  const increase = page.getByRole('button', { name: 'Increase quantity' });
  for (let i = 1; i < FISH_FOR_RENDER_TESTS; i++) {
    await increase.click();
  }

  await page.waitForFunction(() => {
    const scene = window.__aquascape_debug__?.getScene();
    return (scene?.livestock?.length ?? 0) > 0;
  });

  await page.keyboard.press('Control+Shift+3');
  if (!(await isIn3dMode(page))) {
    await page.getByRole('button', { name: /Switch to 3D view/ }).click();
  }
  await page.waitForFunction(
    () => window.__aquascape_debug__?.getViewMode() === '3d',
    undefined,
    { timeout: 5_000 },
  );
  // Spawn is lazy — wait for at least one ECS entity to exist.
  await expect
    .poll(() => page.evaluate(() => window.__aquascape_debug__?.getEntityCount() ?? 0))
    .toBeGreaterThan(0);
}

/**
 * Sum per-channel pixel variance across the PNG buffer. A solid-colour
 * image has variance ≈ 0; any real rendered scene (tank glass, substrate,
 * fish, lighting) measures comfortably above 100 in observed runs.
 *
 * Implementation: sharp's `stats()` returns per-channel `stdev`; squaring
 * gives variance; summing across channels collapses RGB(A) to one scalar.
 * We deliberately do NOT use `.mean` to discriminate solid white from
 * solid black — variance is the only metric that's invariant under
 * uniform colour shifts.
 */
async function computeChannelVariance(buf: Buffer): Promise<number> {
  const stats = await sharp(buf).stats();
  return stats.channels.reduce((sum, ch) => sum + ch.stdev * ch.stdev, 0);
}

/**
 * Count pixels whose RGB triple differs by more than a small tolerance
 * between two frames. Tolerance absorbs the antialias/gamma jitter the
 * GPU emits run-to-run; the magnitude is dwarfed by the per-fish position
 * delta we're trying to detect.
 *
 * No `pixelmatch` dependency — we lean on `sharp`'s `raw()` decoder. Both
 * frames are forced to the same size + channel layout before comparison so
 * a one-pixel resize race doesn't mis-trigger.
 */
async function countDifferingPixels(a: Buffer, b: Buffer): Promise<number> {
  const TOLERANCE = 8; // 0–255 per channel
  const [bufA, bufB] = await Promise.all([
    sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  // Sanity: dimensions must match. A renderer resize between frames would
  // invalidate the comparison; fail loudly instead of returning garbage.
  if (
    bufA.info.width !== bufB.info.width ||
    bufA.info.height !== bufB.info.height ||
    bufA.info.channels !== bufB.info.channels
  ) {
    throw new Error(
      `frame dimensions diverged: ${JSON.stringify(bufA.info)} vs ${JSON.stringify(bufB.info)}`,
    );
  }
  const data1 = bufA.data;
  const data2 = bufB.data;
  const channels = bufA.info.channels;
  const length = data1.length;
  let differing = 0;
  // `sharp` returns dense `Buffer`s where every index `[0, length)` is a
  // valid byte (numeric). The bounded loop + the in-range `i + c` access
  // make non-null assertions unnecessary — bitwise OR with 0 coerces to
  // number which satisfies the type checker without `!`.
  for (let i = 0; i < length; i += channels) {
    let pixelDiffers = false;
    for (let c = 0; c < channels; c++) {
      const a = data1[i + c] ?? 0;
      const b = data2[i + c] ?? 0;
      if (Math.abs(a - b) > TOLERANCE) {
        pixelDiffers = true;
        break;
      }
    }
    if (pixelDiffers) differing++;
  }
  return differing;
}
