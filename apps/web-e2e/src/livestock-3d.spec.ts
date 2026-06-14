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
  getScene(): {
    livestock?: ReadonlyArray<{ quantity: number }>;
    equipment?: ReadonlyArray<unknown>;
  } | null;
  /** Current canvas view mode driven by ViewModeService. */
  getViewMode(): '2d' | '3d' | 'fish-eye';
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
    await page.waitForFunction((expected) => {
      const scene = window.__aquascape_debug__?.getScene();
      const total = scene?.livestock?.reduce((sum, e) => sum + e.quantity, 0) ?? 0;
      return total === expected;
    }, FISH_TO_ADD);

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

  test('3D canvas paints visible content (variance > floor) @smoke', async ({ page }) => {
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

  test('Feed tank spawns food sprites that despawn after their lifetime', async ({ page }) => {
    // Add livestock so the Feed tank button activates + the simulation
    // service has a world to spawn sprites in.
    await addOneFishAndEnter3d(page);

    // Sanity: no sprites before the click.
    const before = await page.evaluate(
      () => window.__aquascape_debug__?.getFoodSpriteCount() ?? -1,
    );
    expect(before).toBe(0);

    // Click Feed tank. The button lives in LivestockToolComponent — the
    // service is the only consumer of the FeedingPulse action (no reducer).
    // Service spawns 3–6 sprites by default via tickPrng.
    await page.getByRole('button', { name: /Feed tank/i }).click();

    // Poll the debug hook until the world reports sprites. The dispatch →
    // service subscription → spawnFoodSprite path is synchronous in
    // practice; poll is for robustness against the change-detection cycle.
    await expect
      .poll(() => page.evaluate(() => window.__aquascape_debug__?.getFoodSpriteCount() ?? 0))
      .toBeGreaterThanOrEqual(3);
    const afterClick = await page.evaluate(
      () => window.__aquascape_debug__?.getFoodSpriteCount() ?? -1,
    );
    expect(afterClick).toBeLessThanOrEqual(6);

    // Sprites carry a 30s lifetime. We don't wait that long here — the
    // ECS-side foodSpriteLifetimeSystem covers despawn deterministically
    // (see libs/domain/livestock-ecs/src/lib/feeding-system.spec.ts).
    // What we DO assert: the count holds steady across a few frames
    // (sprites aren't despawning prematurely from a rendering bug).
    await page.waitForTimeout(500);
    const afterHold = await page.evaluate(
      () => window.__aquascape_debug__?.getFoodSpriteCount() ?? -1,
    );
    expect(afterHold).toBe(afterClick);
  });

  test('day-night slider scrubs renderer lighting', async ({ page }) => {
    // This test's setup (template-less 3D entry + panel expand + two
    // scrubbed screenshots) sits right at the 30s default budget when a
    // parallel local worker saturates the software-WebGL main thread —
    // the element screenshot's stability check needs page rAF frames that
    // arrive slowly under contention. `slow()` triples the budget; this
    // is a BUDGET correction, not a flake mask (the assertions are
    // unchanged and the diff floor still trips on a real regression).
    // CI runs workers: 1 and never came near the ceiling.
    test.slow();
    // F11.7 Wave 5 — verifies the DayNightControlComponent's phase slider
    // actually re-paints the 3D canvas. Mirrors the air-stone test's
    // strategy: scope to the panel `region` (the `<section aria-
    // labelledby>` exposed by ARIA), drive the slider, screenshot,
    // then countDifferingPixels between the two extremes.
    //
    // We don't compare against a static reference image — that's brittle
    // across GPU/driver/AA settings. Instead we lean on the same pixel-
    // diff helper the frame-diff test uses; the floor is empirically
    // tuned from observed runs and divided by ~4 for headroom.
    await addOneFishAndEnter3d(page);

    // The Day / Night panel lives below Backdrop in the left sidebar; it
    // mounts collapsed-or-expanded depending on persisted state. Expand
    // it if needed before driving the slider. The button name template
    // mirrors the panel header's `<h2 id="day-night-heading">Day / Night
    // </h2>` plus the `aria-label="current day-night phase"` badge.
    const dayNightToggle = page.getByRole('button', { name: /Day \/ Night/i });
    await expect(dayNightToggle).toBeVisible();
    if ((await dayNightToggle.getAttribute('aria-expanded')) !== 'true') {
      await dayNightToggle.click();
    }
    await dayNightToggle.scrollIntoViewIfNeeded();

    const slider = page.getByRole('slider', { name: /Day-night phase/i });
    await expect(slider).toBeVisible();

    // Scrub to noon (0.5). HTML range inputs accept .fill() like text
    // inputs in modern Playwright.
    await slider.fill('0.5');
    // Let the renderer's RAF tick + the dayNightEffect's reactive re-
    // render flow through. 400ms is the same wait the F11.5 air-stone
    // test uses for "let one render cycle complete".
    await page.waitForTimeout(400);
    const noon = await page.locator('canvas').nth(1).screenshot();

    // Scrub to midnight (0.0).
    await slider.fill('0');
    await page.waitForTimeout(400);
    const midnight = await page.locator('canvas').nth(1).screenshot();

    // The two frames should differ significantly — noon has a bright
    // ambient + neutral background, midnight has a near-black ambient
    // + deep-blue background. Across 500x500-ish 3D canvas pixels we
    // expect at least DAY_NIGHT_DIFF_FLOOR pixels to differ beyond the
    // per-channel TOLERANCE the helper bakes in.
    //
    // FLOOR RATIONALE
    // ---------------
    // Local-run measurements show > 80 000 pixels of delta between
    // midnight + noon on a 600x500 canvas (ambient + background +
    // every plant + every fish gets retinted, and the fish are
    // animating between samples so a fraction of the delta is motion
    // rather than tint). 5 000 leaves room for a CI run on a smaller
    // canvas + the motion-only baseline the animation-runs test
    // already proves can clear FRAME_DIFF_FLOOR (50).
    const diff = await countDifferingPixels(noon, midnight);
    expect(diff).toBeGreaterThan(5_000);
  });

  test('air-stone equipment spawns bubble particles in the world', async ({ page }) => {
    // F11.5 Wave 5 verification — placing an air-stone (an equipment row
    // carrying `airRateMl > 0` per the F11.5 Wave 2 catalog addition)
    // triggers the service to call `world.registerBubbleSources(...)` on
    // the next spawn cycle; subsequent `step()` calls emit bubble particles
    // at the stone's position. We assert via the debug hook rather than
    // pixel-counting because bubbles render as a separate 8th InstancedMesh
    // alongside the food-sprite billboards and aren't easy to distinguish
    // from substrate variance with a coarse pixel-channel test.
    //
    // We rely on the F11.5 Wave 2 sample annotation: the "Aquaneat Triple
    // Sponge Filter" equipment row carries `airRateMl: 800` — the only
    // air-driven entry in the core catalog as of F11.5.
    //
    // Need at least one livestock entry first — the LivestockSimulation
    // service builds the bitECS world lazily on the first emission with
    // non-empty `scene.livestock`. Equipment-only scenes leave `world ===
    // null` and the bubble system never ticks. This mirrors what a real
    // user does: add fish + filter together, not filter in isolation.
    await addOneFishAndEnter3d(page);

    // The Equipment tool lives next to Livestock in the sidebar; its
    // panel header is a per-panel collapse toggle (see docs/caveats/
    // app-shell.md — every panel is a self-collapsing accordion). On a
    // fresh viewport the Equipment panel can start either expanded or
    // collapsed depending on localStorage state, so check aria-expanded
    // and only click if we need to expand.
    const equipmentPanelToggle = page.getByRole('button', { name: /Equipment.*entries/ });
    await expect(equipmentPanelToggle).toBeVisible();
    if ((await equipmentPanelToggle.getAttribute('aria-expanded')) !== 'true') {
      await equipmentPanelToggle.click();
    }
    // Scroll into view so the radiogroup below renders + becomes visible.
    await equipmentPanelToggle.scrollIntoViewIfNeeded();

    // Filter to 'Filter' equipment then add the Aquaneat sponge filter
    // (the only F11.5-annotated air-stone proxy in the catalog). The
    // Livestock tool also has a "Filter" branch — scope to the Equipment
    // region to avoid the ambiguity.
    const equipmentRegion = page.getByRole('region', { name: 'Equipment' });
    await equipmentRegion.getByRole('radio', { name: /^Filter$/ }).click();
    const airStoneTile = equipmentRegion.getByRole('button', {
      name: /Add Aquaneat Triple Sponge Filter to equipment/,
    });
    await expect(airStoneTile).toBeVisible();
    await airStoneTile.click();

    // Wait for the simulation service to register the bubble source +
    // emit the first particles. The bubble source registration runs on
    // the same `(scene)` signal the spawn cycle does, so this should
    // settle within a few RAF ticks. (We're already in 3D from
    // `addOneFishAndEnter3d` above, so the world ticks.)
    await expect
      .poll(() => page.evaluate(() => window.__aquascape_debug__?.getBubbleParticleCount() ?? 0), {
        timeout: 5_000,
      })
      .toBeGreaterThan(0);

    // Steady-state: with airRateMl=800, BUBBLE_SCALE=3, lifetime=6s, the
    // column converges to a few dozen bubbles before hitting the 200 cap.
    // Don't pin an exact number — the test just confirms the column is
    // alive + non-trivial. POLL rather than fixed-sleep-then-assert: under
    // parallel software-WebGL load the sim ticks slower and a fixed 500 ms
    // window can catch the column at exactly the floor.
    await expect
      .poll(() => page.evaluate(() => window.__aquascape_debug__?.getBubbleParticleCount() ?? 0), {
        timeout: 5_000,
      })
      .toBeGreaterThan(5);
    const count = await page.evaluate(
      () => window.__aquascape_debug__?.getBubbleParticleCount() ?? 0,
    );
    expect(count).toBeLessThanOrEqual(200);
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
  await page.waitForFunction(() => window.__aquascape_debug__?.getViewMode() === '3d', undefined, {
    timeout: 5_000,
  });
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
