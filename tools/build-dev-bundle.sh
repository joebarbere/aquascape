#!/usr/bin/env bash
# Build a local dev `.app` bundle that wraps the installed Electron binary
# with a patched `Info.plist` so macOS uses "Aquascape (dev)" for the dock
# hover / Cmd-Tab / menu bar — and our brand-mark `icon.icns` for the dock
# tile.
#
# Why this is necessary: `app.setName()` from JS cannot override the
# `CFBundleName` macOS reads from the launched `.app` bundle's
# `Info.plist`. In a dev run (`electron path/to/main.js`) the launched
# bundle is `node_modules/electron/dist/Electron.app`, whose
# `CFBundleName` is hard-coded to "Electron". The JS-side `app.setName()`
# DOES update the userData directory + the "About" menu title, but the
# dock-hover tooltip stays "Electron" until we hand macOS a bundle that
# claims to be Aquascape.
#
# Strategy: copy `Electron.app` once into `apps/desktop/.dev-bundle/`,
# patch the `Info.plist`, and swap the icon. macOS APFS copy-on-write
# makes the bulk copy near-instant; the patched files are tiny.
#
# Idempotent: if the bundle already exists and is newer than its inputs
# (the source Electron.app + our `icon.icns`), this script is a no-op.
# That keeps `pnpm restart:desktop` fast on the hot path.
#
# Usage:  bash tools/build-dev-bundle.sh
# Output: apps/desktop/.dev-bundle/Aquascape (dev).app/

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_APP="$REPO_ROOT/node_modules/electron/dist/Electron.app"
OUT_DIR="$REPO_ROOT/apps/desktop/.dev-bundle"
BUNDLE_NAME="Aquascape (dev).app"
OUT_APP="$OUT_DIR/$BUNDLE_NAME"
SRC_ICNS="$REPO_ROOT/apps/desktop/src/assets/icon.icns"
PLIST_BUDDY="/usr/libexec/PlistBuddy"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[build-dev-bundle] skipping — macOS only (uname=$(uname -s))" >&2
  exit 0
fi

if [ ! -d "$SRC_APP" ]; then
  echo "[build-dev-bundle] ERROR: $SRC_APP not found — is the electron package installed?" >&2
  exit 1
fi
if [ ! -f "$SRC_ICNS" ]; then
  echo "[build-dev-bundle] ERROR: $SRC_ICNS not found — run \`pnpm icons\` first." >&2
  exit 1
fi
if [ ! -x "$PLIST_BUDDY" ]; then
  echo "[build-dev-bundle] ERROR: $PLIST_BUDDY not found (expected on macOS)." >&2
  exit 1
fi

# ── Idempotency check: skip rebuild if the bundle is newer than every input.
# `find -newer` returns non-empty only if there is a newer input file.
if [ -d "$OUT_APP" ]; then
  NEWER=$(
    {
      find "$SRC_APP/Contents/Info.plist" -newer "$OUT_APP/Contents/Info.plist" 2>/dev/null
      find "$SRC_ICNS" -newer "$OUT_APP/Contents/Info.plist" 2>/dev/null
    } | head -n 1
  )
  if [ -z "$NEWER" ]; then
    echo "[build-dev-bundle] dev bundle up to date — skipping rebuild"
    echo "  $OUT_APP"
    exit 0
  fi
  echo "[build-dev-bundle] inputs changed — rebuilding"
fi

mkdir -p "$OUT_DIR"
rm -rf "$OUT_APP"

# Copy the Electron.app bundle. On macOS APFS this is copy-on-write under
# the hood (cp uses clonefile() when the source + dest are on the same
# volume), so the ~200 MB Electron binary is duplicated nearly instantly
# without consuming the disk space twice.
echo "[build-dev-bundle] cloning Electron.app → $BUNDLE_NAME"
cp -R "$SRC_APP" "$OUT_APP"

# Patch Info.plist. CFBundleName drives the dock hover + menu bar app name;
# CFBundleDisplayName is what Finder shows for the .app. CFBundleIdentifier
# stays unchanged (we're not pretending to be a different signed app — the
# dev bundle is still cosmetically "Electron" at the identity layer to keep
# code-signing and entitlement inheritance sane).
INFO_PLIST="$OUT_APP/Contents/Info.plist"
echo "[build-dev-bundle] patching $INFO_PLIST"
"$PLIST_BUDDY" -c "Set :CFBundleName Aquascape (dev)" "$INFO_PLIST"
# CFBundleDisplayName isn't present in stock Electron.app's plist — add it.
if "$PLIST_BUDDY" -c "Print :CFBundleDisplayName" "$INFO_PLIST" >/dev/null 2>&1; then
  "$PLIST_BUDDY" -c "Set :CFBundleDisplayName Aquascape (dev)" "$INFO_PLIST"
else
  "$PLIST_BUDDY" -c "Add :CFBundleDisplayName string Aquascape (dev)" "$INFO_PLIST"
fi

# Swap the icon. CFBundleIconFile stays "electron" (the filename in
# Resources/); we just overwrite the file with our ICNS. macOS doesn't care
# about the filename — only that it resolves.
RES_DIR="$OUT_APP/Contents/Resources"
echo "[build-dev-bundle] swapping icon → Resources/electron.icns"
cp "$SRC_ICNS" "$RES_DIR/electron.icns"

# Bump the bundle mtime so the idempotency check above will skip cleanly
# next time.
touch "$INFO_PLIST"

echo "[build-dev-bundle] done."
echo "  $OUT_APP"
