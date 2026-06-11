// Records a short WebM demo of the 3D simulation for the README.
//
// Drives the running `nx serve web` dev server with Playwright: loads the
// "Jungle" starter template, adds a school of neon tetras + a sponge filter
// (bubbles), switches to 3D, then performs a slow camera orbit and a
// day→night scrub while the deterministic sim animates (fish school, plants
// sway in the filter current, caustics dance, bubbles rise). The raw
// Playwright capture is trimmed with ffmpeg to drop the scene-setup footage.
//
// Usage:
//   pnpm exec nx serve web            # in one terminal (http://localhost:4200)
//   node tools/demo/record-demo.mjs   # in another
//
// Env:
//   DEMO_BASE_URL         dev-server URL (default http://localhost:4200)
//   PLAYWRIGHT_CHROMIUM   path to a chromium binary (default: Playwright's
//                         managed browser). Set this when the managed download
//                         is unavailable and a system/preinstalled chromium
//                         must be used.
//   DEMO_FFMPEG           path to an ffmpeg binary (default: `ffmpeg` on PATH)
//   DEMO_OUT              output webm path (default docs/media/demo-3d.webm)
//
// The output is intentionally small + loopable so it can be embedded directly
// in the README.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://localhost:4200';
const FFMPEG = process.env.DEMO_FFMPEG ?? 'ffmpeg';
const OUT = process.env.DEMO_OUT ?? 'docs/media/demo-3d.webm';
const W = 1280;
const H = 800;

const launchOpts = {
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
};
if (process.env.PLAYWRIGHT_CHROMIUM) launchOpts.executablePath = process.env.PLAYWRIGHT_CHROMIUM;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Continuous camera orbit: a run of small left-drags on the 3D canvas. */
async function orbit(page, canvasBox, { steps, dx, dy }) {
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
    await page.mouse.up();
    await sleep(120);
  }
}

/**
 * Smoothly scrub an <input type=range> from `from`→`to` over `ms`. Takes a
 * resolved element HANDLE (not a locator) so we don't re-query the DOM every
 * frame — under software WebGL the per-frame locator resolution dominates and
 * inflates the captured video to minutes.
 */
async function scrubRange(handle, from, to, ms) {
  const frames = 10;
  for (let i = 0; i <= frames; i++) {
    const v = from + ((to - from) * i) / frames;
    await handle.evaluate((el, val) => {
      el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    await sleep(ms / frames);
  }
}

const tmpDir = mkdtempSync(join(tmpdir(), 'aqua-demo-'));
const browser = await chromium.launch(launchOpts);
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: tmpDir, size: { width: W, height: H } },
});
const page = await context.newPage();
const recordStart = Date.now(); // video begins ~here (context/page creation)

await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__aquascape_debug__), undefined, { timeout: 30_000 });
await sleep(800);

// 1. Load the Jungle starter template (hardscape + layered plants).
await page.getByRole('button', { name: /Templates/i }).first().click();
await sleep(700);
await page.locator('button', { hasText: 'New from this' }).nth(2).click(); // Iwagumi,Dutch,Jungle,Beginner
await sleep(1400);

// 2. Add a school of neon tetras.
await page.getByRole('radio', { name: 'Fish' }).first().click();
await sleep(300);
await page.getByRole('button', { name: /^Add Neon Tetra/i }).first().click();
const inc = page.getByRole('button', { name: 'Increase quantity' });
for (let i = 0; i < 9; i++) await inc.first().click().catch(() => {});

// 3. Add a sponge filter (air-stone → bubbles + a little flow for plant sway).
const filterRadio = page.getByRole('radio', { name: 'Filter' });
if (await filterRadio.count()) {
  await filterRadio.first().click();
  await sleep(300);
  const sponge = page.getByRole('button', { name: /Add Aquaneat Triple Sponge/i });
  if (await sponge.count()) await sponge.first().click().catch(() => {});
}
await sleep(700);

// 4. Switch to 3D (keyboard, with the toolbar button as fallback).
await page.keyboard.press('Control+Shift+3');
await sleep(400);
if ((await page.evaluate(() => window.__aquascape_debug__?.getViewMode?.())) !== '3d') {
  await page.getByRole('button', { name: /Switch to 3D view/i }).click().catch(() => {});
}
await page.waitForFunction(() => window.__aquascape_debug__?.getViewMode?.() === '3d', undefined, {
  timeout: 5_000,
});
await sleep(1500);

const canvas = page.locator('canvas').nth(1);
const box = await canvas.boundingBox();

// Initial orbit into a 3/4 view + a touch of zoom-out so the glass reads.
await orbit(page, box, { steps: 1, dx: -220, dy: -50 });
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, 260);
await sleep(1200);

// ── DEMO WINDOW START ──────────────────────────────────────────────────
const demoStart = Date.now();

// NOTE: under software WebGL (swiftshader) the browser main thread is busy
// driving the RAF loop, so every CDP round-trip (mouse move, evaluate) is
// slow. We keep the call COUNT low and lean on `sleep` (which doesn't round-
// trip) for the animation hold time; the captured footage is then time-
// compressed by ffmpeg's `-itsscale` into a snappy clip.

// Hold so the school settles + caustics/bubbles read.
await sleep(2500);
// Slow orbit around the tank — a few large drags (few CDP calls).
await orbit(page, box, { steps: 3, dx: -110, dy: 0 });
await sleep(2000);

// Day → night → day scrub (background darkens, plants pick up their emissive
// glow). Resolve the slider to a handle ONCE; keep the frame count low.
const phaseHandle = await page
  .getByRole('slider', { name: /Day-night phase/i })
  .first()
  .elementHandle()
  .catch(() => null);
if (phaseHandle) {
  await scrubRange(phaseHandle, 0.5, 0.0, 1800); // noon → midnight
  await sleep(1500);
  await scrubRange(phaseHandle, 0.0, 0.5, 1500); // back to noon
}
await sleep(1500);
// A final orbit the other way.
await orbit(page, box, { steps: 3, dx: 110, dy: 0 });
await sleep(2000);

const demoMs = Date.now() - demoStart;
const setupMs = demoStart - recordStart; // footage before the demo window
// ── DEMO WINDOW END ────────────────────────────────────────────────────

await context.close(); // flushes the video file
await browser.close();

// Encode with the Playwright-bundled ffmpeg — a minimal build with ONLY the
// VP8 encoder (`libvpx`) and ONLY the pad/crop/scale filters (no `setpts`).
// To compress the slow software-rendered capture into a snappy clip we use
// `-itsscale`, an INPUT timestamp rescale (not a filter), computed so the
// demo window lands at ~`TARGET_SEC`. `-ss`/`-t` then run on the rescaled
// timeline to drop the scene-setup footage.
const raw = await page.video().path();
const TARGET_SEC = 15;
const itsscale = Math.min(1, TARGET_SEC / (demoMs / 1000)); // < 1 ⇒ speed up
const startScaled = ((setupMs - 1000) / 1000) * itsscale; // skip setup (rescaled)
execFileSync(
  FFMPEG,
  [
    '-y',
    '-itsscale', itsscale.toFixed(4),
    '-i', raw,
    '-ss', Math.max(0, startScaled).toFixed(2),
    '-t', String(TARGET_SEC + 2),
    '-an',
    '-c:v', 'libvpx',
    '-crf', '31',
    '-b:v', '2M',
    '-vf', 'scale=960:-2',
    OUT,
  ],
  { stdio: 'inherit' },
);
rmSync(tmpDir, { recursive: true, force: true });
if (!existsSync(OUT)) throw new Error(`demo render failed: ${OUT} not written`);
console.log(
  `demo written: ${OUT} (demo window ${(demoMs / 1000).toFixed(1)}s real-time, ` +
    `time-scaled ×${(1 / itsscale).toFixed(1)} to ~${TARGET_SEC}s, setup ${(setupMs / 1000).toFixed(1)}s dropped)`,
);
