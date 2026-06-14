// Stage 16 F16.1b — game-mode activation smoke test (Playwright e2e).
//
// What this proves end-to-end (that unit tests can't):
//   1. Booting `?mode=game:predator` enters the game: the renderer flips to
//      3D FISH-EYE and a player entity is marked on the live ECS world.
//   2. The app-layer input loop is wired: a synthetic keyboard `keydown` on
//      a movement key moves the player — its world position changes — through
//      the REAL pipeline (held key → keysToIntent → intentToVelocity →
//      world.setPlayerVelocity → world.step).
//
// This relies on the same `window.__aquascape_debug__` read-only hook the
// livestock-3d spec uses (gated by `isDevMode()`, present under `nx serve
// web`). We read the marked player's eid + its snapshot position via the hook;
// we never mutate the world from the test (discipline noted in debug-hook.ts).
//
// SwiftShader flags + the chromium executable come from the Playwright config
// (see `docs/caveats/e2e.md`). The world tick runs off the renderer's RAF, so
// the player only integrates while the 3D canvas is painting — we hold a beat
// with the key down to let several sim steps accumulate.

import { expect, test } from '@playwright/test';

// Locally-redeclared mirror of the relevant slice of `AquascapeDebugHandle`
// (cross-project import into apps/web is blocked by module boundaries — same
// reasoning as livestock-3d.spec.ts). We additionally read `getWorld()` to
// reach the player seam.
interface PlayerSnapshot {
  ids: Uint32Array | number[];
  position: Float32Array | number[];
  entityCount: number;
}
interface DebugWorld {
  getPlayerEntity(): number;
  snapshot(alpha: number): PlayerSnapshot;
}
interface AquascapeDebugHandle {
  getViewMode(): string;
  getEntityCount(): number;
  getWorld(): DebugWorld | null;
}
declare global {
  interface Window {
    __aquascape_debug__?: AquascapeDebugHandle;
  }
}

/** Read the marked player's position from the live world via the debug hook. */
function readPlayerPosition() {
  const dbg = window.__aquascape_debug__;
  const world = dbg?.getWorld();
  if (!world) return null;
  const player = world.getPlayerEntity();
  const snap = world.snapshot(0);
  for (let i = 0; i < snap.entityCount; i++) {
    if (snap.ids[i] === player) {
      return { x: snap.position[i * 3], y: snap.position[i * 3 + 1], z: snap.position[i * 3 + 2] };
    }
  }
  return null;
}

test.describe('game-mode activation (?mode=game:predator)', () => {
  test('boots into 3D fish-eye, marks a player, and a key moves it', async ({ page }) => {
    test.slow(); // game scene is the showcase (populated) under software WebGL

    await page.goto('/?mode=game:predator');
    await expect(page.locator('canvas').first()).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));

    // ── Entered the game: 3D fish-eye + a populated world with a marked player.
    await page.waitForFunction(
      () => window.__aquascape_debug__?.getViewMode() === 'fish-eye',
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForFunction(() => (window.__aquascape_debug__?.getEntityCount() ?? 0) > 0, {
      timeout: 10_000,
    });
    const playerEid = await page.evaluate(
      () => window.__aquascape_debug__?.getWorld()?.getPlayerEntity() ?? -1,
    );
    expect(playerEid).toBeGreaterThanOrEqual(0);

    // ── Hold a beat so the world ticks, sample the player position.
    await page.waitForTimeout(500);
    const before = await page.evaluate(readPlayerPosition);
    expect(before).not.toBeNull();

    // ── Press + hold a movement key; the input loop injects velocity and the
    //    RAF sim steps integrate it, so the player moves.
    await page.keyboard.down('KeyD'); // strafe +x
    await page.waitForTimeout(1_200);
    await page.keyboard.up('KeyD');

    const after = await page.evaluate(readPlayerPosition);
    expect(after).not.toBeNull();

    // The player integrated the injected velocity → its position changed.
    // We assert a meaningful displacement (the AI behaviours also nudge fish,
    // but the player is integrator-skipped, so only the injected input moves
    // it — a held +x for >1s at 260 mm/s should travel well over 50 mm before
    // the AABB clamp).
    const dx = Math.abs((after!.x ?? 0) - (before!.x ?? 0));
    const dy = Math.abs((after!.y ?? 0) - (before!.y ?? 0));
    const dz = Math.abs((after!.z ?? 0) - (before!.z ?? 0));
    const moved = Math.hypot(dx, dy, dz);
    expect(moved).toBeGreaterThan(20);
  });
});
