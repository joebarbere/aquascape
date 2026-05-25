#!/usr/bin/env node
// Generate the desktop app's platform icon files from the canonical SVG
// brand mark. Run via `pnpm icons` whenever `apps/web/src/favicon.svg`
// changes.
//
// Source of truth: `apps/web/src/favicon.svg`.
// Outputs (committed to git, consumed by Electron at runtime + at package
// time):
//
//   apps/desktop/src/assets/icon.png   — 1024×1024 RGBA. Used by
//     `BrowserWindow({ icon })` on Windows / Linux and by
//     `app.dock.setIcon()` on macOS at runtime.
//   apps/desktop/src/assets/icon.ico   — Multi-size Windows icon (16, 24,
//     32, 48, 64, 128, 256). Will be picked up by the packager (Stage 8+)
//     for Win32 .exe metadata.
//   apps/desktop/src/assets/icon.icns  — macOS-native icon bundle (every
//     size from 16 to 1024, including @2x retina variants). Built via
//     Apple's built-in `iconutil` so the output is bit-identical to what
//     Xcode would produce. Will be picked up by the packager for the .app
//     bundle's `Contents/Resources/`.
//
// Why this approach:
//   * `sharp` (libvips) rasterizes the SVG once per requested size — no
//     blurry up-/downscaling from a single master, no shimmer at small
//     sizes. The hinting at 16×16 vs 1024×1024 is genuinely different
//     because the SVG's 22 % corner radius lands on subtly different
//     pixel boundaries.
//   * `png-to-ico` writes a spec-compliant Windows ICO without us having
//     to roll the BMP / PNG header dance.
//   * `iconutil` is shipped with macOS and produces a bit-identical
//     ICNS to Xcode's tooling. Skipped with a warning on non-macOS — the
//     committed binary is what CI consumes, so cross-platform regen on
//     Linux isn't required.

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import sharp from 'sharp';
import pngToIco from 'png-to-ico';

// ─── Paths ────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const sourceSvg = join(repoRoot, 'apps', 'web', 'src', 'favicon.svg');
const outDir = join(repoRoot, 'apps', 'desktop', 'src', 'assets');

// ─── Icon size matrices ───────────────────────────────────────────────────

/** Windows ICO sizes. Microsoft's guidance + de-facto convention. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * macOS ICNS iconset entries. Each entry: [filename, pixel size]. Apple's
 * naming convention encodes both the displayed size and the @2x retina
 * marker. `iconutil` consumes a directory named `<name>.iconset` containing
 * exactly these PNGs.
 */
const ICNS_ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Rasterize the source SVG to a PNG buffer at exactly `size` × `size`. */
async function rasterize(svgBytes, size) {
  // `density` boosts libvips's SVG render DPI so the output is sharp at
  // the target size. 72 DPI is the default SVG render density; we scale it
  // up linearly with the target side so a 1024-px icon renders at 1152 DPI
  // and a 16-px icon at 18 DPI, both with the same on-screen sharpness.
  const density = Math.max(72, Math.round((72 * size) / 16));
  return sharp(svgBytes, { density })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Convert a multi-PNG set to a Windows ICO. */
async function buildIco(pngsBySize) {
  // png-to-ico accepts an array of PNG buffers ordered smallest → largest.
  const ordered = [...pngsBySize.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, buf]) => buf);
  return pngToIco(ordered);
}

/**
 * Build an ICNS from an iconset directory using macOS's `iconutil`. Returns
 * `true` on success, `false` when `iconutil` isn't available (non-macOS or
 * stripped /usr/bin). The caller decides whether to warn or fail.
 */
function buildIcnsFromIconset(iconsetDir, outFile) {
  if (process.platform !== 'darwin') return { ok: false, reason: 'not-darwin' };
  const result = spawnSync('iconutil', ['-c', 'icns', '-o', outFile, iconsetDir], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    return { ok: false, reason: `iconutil exit ${result.status ?? 'null'}` };
  }
  return { ok: true };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[build-icons] reading ${sourceSvg}`);
  const svgBytes = await readFile(sourceSvg);

  await mkdir(outDir, { recursive: true });

  // 1) The Electron runtime icon — used by BrowserWindow + app.dock.
  console.log(`[build-icons] rasterising icon.png (1024×1024)`);
  const png1024 = await rasterize(svgBytes, 1024);
  await writeFile(join(outDir, 'icon.png'), png1024);

  // 2) Windows ICO. Rasterise the source SVG at each Windows size (vs
  //    downsampling from one master) so glyph hinting stays sharp at 16px.
  console.log(`[build-icons] rasterising ICO sizes: ${ICO_SIZES.join(', ')}`);
  const icoPngs = new Map();
  for (const size of ICO_SIZES) {
    icoPngs.set(size, await rasterize(svgBytes, size));
  }
  const icoBytes = await buildIco(icoPngs);
  await writeFile(join(outDir, 'icon.ico'), icoBytes);
  console.log(`[build-icons] wrote icon.ico (${icoBytes.length} bytes)`);

  // 3) macOS ICNS. Build a `.iconset` directory of exactly the files Apple's
  //    `iconutil` expects, then shell out. Skipped with a clear warning when
  //    not on macOS — the committed binary serves CI.
  const tmpIconset = join(tmpdir(), `aquascape-icon-${process.pid}.iconset`);
  await mkdir(tmpIconset, { recursive: true });
  try {
    console.log(`[build-icons] rasterising ICNS iconset (${ICNS_ICONSET.length} files)`);
    for (const [filename, size] of ICNS_ICONSET) {
      const buf = await rasterize(svgBytes, size);
      await writeFile(join(tmpIconset, filename), buf);
    }
    const icnsOut = join(outDir, 'icon.icns');
    const result = buildIcnsFromIconset(tmpIconset, icnsOut);
    if (result.ok) {
      console.log(`[build-icons] wrote icon.icns via iconutil`);
    } else if (result.reason === 'not-darwin') {
      console.warn(
        `[build-icons] WARNING: not on macOS, skipping icon.icns regeneration. ` +
          `Run \`pnpm icons\` on macOS to refresh the committed binary.`,
      );
    } else {
      throw new Error(`iconutil failed: ${result.reason}`);
    }
  } finally {
    await rm(tmpIconset, { recursive: true, force: true });
  }

  console.log(`[build-icons] done. Outputs in ${outDir}`);
}

main().catch((err) => {
  console.error('[build-icons] failed:', err);
  process.exit(1);
});
