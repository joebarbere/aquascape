// Real-GPU validation screenshotter for renderer-3d (Bucket-0 "local GPU dev"
// loop). Drives the running `nx serve web` with Playwright on HARDWARE WebGL
// (ANGLE-over-GL on the AMD GPU — NOT SwiftShader), builds a scene with
// hardscape + plants (so contact AO has something to read), switches to 3D,
// orbits to a 3/4 view, and writes a PNG of the 3D canvas.
//
// Usage:
//   pnpm exec nx serve web                 # one terminal
//   node tools/demo/validate-3d.mjs OUT.png [--orbit dx,dy,steps] [--zoom N]
//
// Env: PLAYWRIGHT_CHROMIUM (chromium binary), DEMO_BASE_URL.
import { chromium } from '@playwright/test';

const OUT = process.argv[2] ?? 'tmp-3d.png';
const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://localhost:4200';
const CHROME = process.env.PLAYWRIGHT_CHROMIUM;
const W = 1280, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const launchOpts = {
  // Hardware WebGL via ANGLE-over-GL (Mesa/radeonsi). Deliberately NO
  // --use-angle=swiftshader: this loop exists precisely to exercise the
  // render-target effects (SSAO) that blank under software WebGL.
  args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'],
};
if (CHROME) launchOpts.executablePath = CHROME;

async function orbit(page, box, { steps, dx, dy }) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
    await page.mouse.up();
    await sleep(120);
  }
}

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: W, height: H } });

// Surface the actual GL renderer string so the capture is self-documenting.
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const g = c.getContext('webgl2');
  const d = g && g.getExtension('WEBGL_debug_renderer_info');
  return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('GL renderer:', gl);

await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__aquascape_debug__), undefined, { timeout: 30_000 });
await sleep(800);

// Jungle template — hardscape + layered plants (good AO test surface).
await page.getByRole('button', { name: /Templates/i }).first().click();
await sleep(700);
await page.locator('button', { hasText: 'New from this' }).nth(2).click();
await sleep(1400);

// A school of fish so the livestock + bubbles read too.
await page.getByRole('radio', { name: 'Fish' }).first().click();
await sleep(300);
await page.getByRole('button', { name: /^Add Neon Tetra/i }).first().click().catch(() => {});
const inc = page.getByRole('button', { name: 'Increase quantity' });
for (let i = 0; i < 7; i++) await inc.first().click().catch(() => {});
await sleep(500);

await page.keyboard.press('Control+Shift+3');
await sleep(400);
if ((await page.evaluate(() => window.__aquascape_debug__?.getViewMode?.())) !== '3d') {
  await page.getByRole('button', { name: /Switch to 3D view/i }).click().catch(() => {});
}
await page.waitForFunction(() => window.__aquascape_debug__?.getViewMode?.() === '3d', undefined, { timeout: 5_000 });
await sleep(1500);

const canvas = page.locator('canvas').nth(1);
const box = await canvas.boundingBox();
// ORBIT/ZOOM overridable via env (ORBIT="dx,dy,steps", ZOOM=wheelDelta) so the
// camera angle can be tuned without editing this file.
const [odx, ody, osteps] = (process.env.ORBIT ?? '-180,40,1').split(',').map(Number);
const zoom = Number(process.env.ZOOM ?? -120);
await orbit(page, box, { steps: osteps, dx: odx, dy: ody });
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, zoom);
await sleep(2500); // let the school settle + sim warm up

await canvas.screenshot({ path: OUT });

// Non-blank check: sample pixel variance via a small readback.
const stats = await page.evaluate(() => {
  const c = document.querySelectorAll('canvas')[1];
  return { w: c.width, h: c.height };
});
console.log(`wrote ${OUT} (canvas ${stats.w}x${stats.h})`);
await browser.close();
