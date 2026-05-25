#!/usr/bin/env bash
# Restart the desktop dev stack (web dev-server + Electron) cleanly.
#
# Why a script vs. `nx serve desktop` directly?
#   1. Reap orphans: `nx serve desktop` parallels `nx serve web` and
#      `electron` without a readiness wait. Restarting via Ctrl-C + re-
#      run leaves orphan processes when Electron crashes mid-frame or
#      the web server didn't shut down cleanly. This script reaps them
#      by port (4200) and by the desktop main-process script path BEFORE
#      relaunching so the new processes have clean ports + sockets.
#   2. Sequencing fixes the documented race in CLAUDE.md — `nx serve
#      desktop` spawns Electron immediately, which then hits
#      ERR_CONNECTION_REFUSED until `nx serve web` finishes its first
#      build. We start web first, wait for the port to listen, THEN
#      launch Electron via `nx run desktop:serve-electron`.
#   3. The filter `dist/apps/desktop/main/src/main/main.js` matches ONLY
#      this app's Electron processes — Slack, VS Code, Cursor, and any
#      other Electron-based app you have open are not touched.
#
# Usage: `pnpm restart:desktop` (or `bash tools/restart-desktop.sh`).
# Ctrl-C in the foreground tears down both children cleanly.

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=4200
MAIN_JS="$REPO_ROOT/dist/apps/desktop/main/src/main/main.js"
MAIN_PATTERN='dist/apps/desktop/main/src/main/main.js'
READY_TIMEOUT_SEC=60
DEV_BUNDLE="$REPO_ROOT/apps/desktop/.dev-bundle/Aquascape (dev).app"
DEV_BUNDLE_BIN="$DEV_BUNDLE/Contents/MacOS/Electron"

echo "[restart-desktop] reaping prior dev stack…"

# Kill anything bound to the web dev port. Covers `nx serve web` plus any
# stray watcher that may have lingered.
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti:"$PORT" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "  port $PORT in use by PID(s): $PIDS — killing"
    # shellcheck disable=SC2086
    kill -9 $PIDS 2>/dev/null || true
  fi
fi

# Kill the Electron process(es) for THIS app, by main-script path. Narrow
# enough not to touch other Electron-based apps. Renderer subprocesses
# exit when the main process dies.
if pgrep -f "$MAIN_PATTERN" >/dev/null 2>&1; then
  echo "  electron desktop main process running — killing"
  pkill -f "$MAIN_PATTERN" 2>/dev/null || true
fi

# Brief settle so the OS reclaims the port + IPC socket.
sleep 1

# ── Stage 1: web dev-server in background ─────────────────────────────────
echo "[restart-desktop] starting web dev-server…"
pnpm exec nx serve web &
WEB_PID=$!

# Clean up the web server on Ctrl-C / script exit. Also kills its child
# esbuild watcher because Nx propagates SIGTERM through its run-commands
# parent.
cleanup() {
  echo "[restart-desktop] shutting down…"
  if kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  if [ -n "${ELECTRON_PID:-}" ] && kill -0 "$ELECTRON_PID" 2>/dev/null; then
    kill "$ELECTRON_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

# ── Stage 2: wait for :4200 to listen ─────────────────────────────────────
echo "[restart-desktop] waiting for http://localhost:$PORT (timeout ${READY_TIMEOUT_SEC}s)…"
WAITED=0
until curl -fsS -o /dev/null "http://localhost:$PORT/" 2>/dev/null; do
  # If the web server died before binding, bail rather than block forever.
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "[restart-desktop] web dev-server exited before :$PORT bound — aborting" >&2
    exit 1
  fi
  if [ "$WAITED" -ge "$READY_TIMEOUT_SEC" ]; then
    echo "[restart-desktop] timed out waiting for :$PORT — aborting" >&2
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
echo "[restart-desktop] :$PORT ready (after ${WAITED}s)"

# ── Stage 3: build the desktop main + preload bundles ────────────────────
# `nx serve` would do this for us, but we want to launch the Electron
# binary directly from our dev bundle (so the dock hover reads "Aquascape
# (dev)" instead of "Electron") — which means we manage the build step
# ourselves rather than going through `nx run desktop:serve-electron`.
echo "[restart-desktop] building desktop main + preload…"
pnpm exec nx run-many -t build-main,build-preload -p desktop >/dev/null

# ── Stage 4: build the macOS dev .app bundle (idempotent) ─────────────────
# Wraps the installed Electron binary with a patched Info.plist so
# `CFBundleName = "Aquascape (dev)"`. `app.setName()` from JS cannot
# override the dock-hover name macOS reads from the launched .app's
# Info.plist — this bundle is the workaround. Skipped on non-macOS (the
# build script handles that internally).
echo "[restart-desktop] ensuring dev .app bundle is up to date…"
bash "$REPO_ROOT/tools/build-dev-bundle.sh"

# ── Stage 5: Electron in foreground via the dev bundle ────────────────────
# On macOS, launch the patched-bundle binary directly so env vars
# (DEV_SERVER_URL) propagate and the dock hover picks up CFBundleName.
# Falls back to plain `electron` on non-macOS or if the bundle is missing
# (e.g. the build-dev-bundle skipped because /usr/libexec/PlistBuddy is
# absent in a stripped container).
echo "[restart-desktop] launching Electron…"
if [ -x "$DEV_BUNDLE_BIN" ]; then
  echo "  via dev bundle: $DEV_BUNDLE"
  DEV_SERVER_URL="http://localhost:$PORT" "$DEV_BUNDLE_BIN" "$MAIN_JS" &
else
  echo "  via plain electron (no dev bundle available)"
  DEV_SERVER_URL="http://localhost:$PORT" pnpm exec electron "$MAIN_JS" &
fi
ELECTRON_PID=$!

# Wait on Electron (the foreground concern — when the window closes, the
# user expects the whole stack to shut down). The EXIT trap reaps the
# web server. `wait -n` would also catch the web server dying first, but
# it isn't in macOS's bundled bash 3.2, and ERR_CONNECTION_REFUSED in
# Electron is a loud-enough signal that the web side is gone.
wait "$ELECTRON_PID"
