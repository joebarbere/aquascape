#!/usr/bin/env bash
# Package the desktop app into a distributable installer (DMG on macOS,
# NSIS .exe on Windows, AppImage on Linux). Stage 6 F6.4 follow-up.
#
# Why a script vs `electron-builder` directly? Our Nx monorepo emits the
# main + preload + web bundle to deep paths (`dist/apps/desktop/main/src/
# main/main.js`, `dist/apps/desktop/preload/src/preload/preload.js`,
# `dist/apps/web/browser/index.html`) that electron-builder can't trace
# from a single root. This script flattens those outputs into a clean
# staging tree at `dist/apps/desktop/electron-app/`, writes a minimal
# `package.json` pointing at the staged main, then hands the result to
# electron-builder.
#
# Strategy: copy → stage → package. Re-runs are deterministic — the
# staging directory is removed first, then rebuilt from scratch from
# the latest nx-build outputs.
#
# Code signing + notarisation are deliberately disabled (`identity: null`
# in electron-builder.json + `hardenedRuntime: false`). Real distribution
# needs an Apple Developer ID + Windows EV cert; out of scope for v1.
# The produced macOS .dmg installs but Gatekeeper will require a
# right-click → Open (or `xattr -d com.apple.quarantine`) the first time.
#
# Usage:  pnpm package:desktop      (or: bash tools/package-desktop.sh)
# Output: dist/apps/desktop/installers/{Aquascape-1.0.0.dmg,...}

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DESKTOP="$REPO_ROOT/dist/apps/desktop"
DIST_WEB="$REPO_ROOT/dist/apps/web"
STAGE_DIR="$DIST_DESKTOP/electron-app"
ELECTRON_VERSION="$(node -e "console.log(require('$REPO_ROOT/node_modules/electron/package.json').version)")"

echo "[package-desktop] building desktop + web…"
pnpm exec nx build desktop >/dev/null
pnpm exec nx build web --configuration=production >/dev/null

echo "[package-desktop] staging into $STAGE_DIR"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/main" "$STAGE_DIR/preload" "$STAGE_DIR/web" "$STAGE_DIR/assets"

# Flatten the deeply-nested @nx/js:tsc outputs. The Nx build emits
# `main/src/main/main.js`; we copy the inner src/main/* into `main/`
# so the staged main.js is at a predictable top-level path.
cp -R "$DIST_DESKTOP/main/src/main/." "$STAGE_DIR/main/"
cp -R "$DIST_DESKTOP/preload/src/preload/." "$STAGE_DIR/preload/"
cp -R "$DIST_DESKTOP/main/assets/." "$STAGE_DIR/assets/"
cp -R "$DIST_WEB/browser/." "$STAGE_DIR/web/"

# Patch the resolver paths so the staged main.js can find its peers in
# the flatter layout. The original `paths.ts` walks 4 levels up to find
# `web/browser/index.html`; in the staged layout web is just one level
# up from main/. Same for preload.
echo "[package-desktop] patching resolver paths for the flat staged layout…"
node - "$STAGE_DIR" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const stage = process.argv[2];
const mainJs = path.join(stage, 'main', 'main.js');
let src = fs.readFileSync(mainJs, 'utf8');
// Replace the climb-4 + climb-3 + climb-2 patterns with the flat
// staged layout. The relative paths are: web/browser/index.html
// → ../web/index.html; preload.js → ../preload/preload.js;
// assets/icon.* → ../assets/icon.*. We rewrite the resolver
// constants inline so we don't need to ship a separate paths.ts.
src = src.replace(
  /path\.join\(mainDir, ['"]\.\.['"], ['"]\.\.['"], ['"]\.\.['"], ['"]\.\.['"], ['"]web['"], ['"]browser['"], ['"]index\.html['"]\)/g,
  "path.join(mainDir, '..', 'web', 'index.html')",
);
src = src.replace(
  /path\.join\(mainDir, ['"]\.\.['"], ['"]\.\.['"], ['"]\.\.['"], ['"]preload['"], ['"]src['"], ['"]preload['"], ['"]preload\.js['"]\)/g,
  "path.join(mainDir, '..', 'preload', 'preload.js')",
);
src = src.replace(
  /path\.join\(mainDir, ['"]\.\.['"], ['"]\.\.['"], ['"]assets['"], `icon\.\$\{kind\}`\)/g,
  "path.join(mainDir, '..', 'assets', `icon.${kind}`)",
);
fs.writeFileSync(mainJs, src);
console.log('  patched', mainJs);
NODE

# Write the minimal package.json electron-builder needs at the staging
# root. `main` points to the staged main.js; `version` mirrors the
# workspace; `electron` is pinned to the installed runtime.
cat > "$STAGE_DIR/package.json" <<EOF
{
  "name": "aquascape",
  "productName": "Aquascape",
  "version": "1.0.0",
  "description": "Open-source aquascaping design tool",
  "main": "main/main.js",
  "author": "Aquascape contributors",
  "license": "MIT",
  "devDependencies": {
    "electron": "$ELECTRON_VERSION"
  }
}
EOF
echo "  wrote $STAGE_DIR/package.json (electron@$ELECTRON_VERSION)"

echo "[package-desktop] running electron-builder…"
# Explicit `--projectDir` so electron-builder resolves the
# `directories.{app,output,buildResources}` paths relative to
# apps/desktop, no matter where in the monorepo this script was invoked
# from. Without it the paths in the JSON were being read against the
# workspace root and failing to find the staged tree.
pnpm exec electron-builder \
  --config "$REPO_ROOT/apps/desktop/electron-builder.json" \
  --projectDir "$REPO_ROOT/apps/desktop" \
  "$@"

echo "[package-desktop] done."
echo "  installers in $DIST_DESKTOP/installers/"
ls -lh "$DIST_DESKTOP/installers/" 2>/dev/null | head -20 || true
