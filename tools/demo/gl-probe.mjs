// Minimal probe: does headless Chromium get HARDWARE WebGL on this box?
// Prints the UNMASKED_RENDERER_WEBGL string. If it names the AMD GPU
// (radeonsi/navi) and NOT SwiftShader, the real-GPU validation loop works
// and Bucket-1 render-target effects (SSAO, refraction) can be validated here.
import { chromium } from '@playwright/test';

const CHROME = process.env.PLAYWRIGHT_CHROMIUM;
// ANGLE-over-GL (Mesa) — hardware path. NO swiftshader. Vulkan is the other
// option (--use-angle=vulkan) if GL misbehaves.
const angle = process.env.GL_BACKEND ?? 'gl';
const launchOpts = {
  args: [
    '--use-gl=angle',
    `--use-angle=${angle}`,
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    '--enable-features=Vulkan',
  ],
};
if (CHROME) launchOpts.executablePath = CHROME;

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage();
const info = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return { error: 'no webgl context' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    version: gl.getParameter(gl.VERSION),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '(no debug ext)',
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '(no debug ext)',
    maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
    hasDepthTexture: !!(gl instanceof WebGL2RenderingContext) || !!gl.getExtension('WEBGL_depth_texture'),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
