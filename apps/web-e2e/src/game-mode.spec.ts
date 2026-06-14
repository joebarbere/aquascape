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
  getGameScore(): number;
  getGameState(): string;
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
    await expect(page.locator('canvas').nth(1)).toBeVisible();
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

  // F16.4 — the predator RULES: hunting a prey within the catch radius eats it
  // and increments the score. We steer the player toward the nearest prey each
  // beat (the showcase tank is densely shoaled, so the player starts amid prey)
  // and poll the game score via the debug hook until it ticks up. The score is
  // catches; a single catch proves the catch-detection → despawn → award
  // pipeline runs end-to-end through the live world + state machine.
  //
  // NOTE: prey flee via FearSystem (the player is flagged a predator), so this
  // is an honest hunt — we chase the nearest prey rather than asserting an
  // instant freebie. Validated in CI (chromium isn't provisioned in the
  // authoring sandbox — see docs/caveats/e2e.md); the deterministic catch +
  // win/lose logic is exhaustively unit-tested in features-game + apps/web.
  test('hunting a prey within the catch radius scores a catch', async ({ page }) => {
    test.slow();

    await page.goto('/?mode=game:predator');
    await expect(page.locator('canvas').nth(1)).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));
    await page.waitForFunction(
      () => window.__aquascape_debug__?.getViewMode() === 'fish-eye',
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForFunction(() => (window.__aquascape_debug__?.getEntityCount() ?? 0) > 1, {
      timeout: 10_000,
    });
    // The run is live (predator rules started on entry).
    expect(await page.evaluate(() => window.__aquascape_debug__?.getGameState())).toBe('playing');
    expect(await page.evaluate(() => window.__aquascape_debug__?.getGameScore())).toBe(0);

    // Steer toward the nearest prey for up to ~12 s, polling the score. Each
    // iteration: read the player + nearest-prey direction, press the matching
    // cardinal keys for a beat, then release. The catch loop runs on the input
    // rAF, so a held key that closes within 90 mm lands a catch.
    let scored = 0;
    for (let i = 0; i < 24 && scored === 0; i++) {
      const dir = await page.evaluate(() => {
        const dbg = window.__aquascape_debug__;
        const world = dbg?.getWorld();
        if (!world) return null;
        const player = world.getPlayerEntity();
        const snap = world.snapshot(0);
        let px = 0;
        let py = 0;
        let pz = 0;
        let found = false;
        const prey: { x: number; y: number; z: number }[] = [];
        for (let j = 0; j < snap.entityCount; j++) {
          const x = snap.position[j * 3] as number;
          const y = snap.position[j * 3 + 1] as number;
          const z = snap.position[j * 3 + 2] as number;
          if (snap.ids[j] === player) {
            px = x;
            py = y;
            pz = z;
            found = true;
          } else {
            prey.push({ x, y, z });
          }
        }
        if (!found || prey.length === 0) return null;
        let bestX = px;
        let bestY = py;
        let bestZ = pz;
        let bestD = Infinity;
        for (const p of prey) {
          const d = (p.x - px) ** 2 + (p.y - py) ** 2 + (p.z - pz) ** 2;
          if (d < bestD) {
            bestD = d;
            bestX = p.x;
            bestY = p.y;
            bestZ = p.z;
          }
        }
        return { dx: bestX - px, dy: bestY - py, dz: bestZ - pz };
      });
      if (dir === null) break;

      // Press the cardinal keys toward the nearest prey for a beat.
      // DEFAULT_KEY_BINDINGS: x = KeyD/KeyA (right/left), y = KeyW/KeyS
      // (up/down), z = KeyE/KeyQ (forward/back into depth).
      const pressed: string[] = [];
      if (dir.dx > 30) pressed.push('KeyD');
      else if (dir.dx < -30) pressed.push('KeyA');
      if (dir.dy > 30) pressed.push('KeyW');
      else if (dir.dy < -30) pressed.push('KeyS');
      if (dir.dz > 30) pressed.push('KeyE');
      else if (dir.dz < -30) pressed.push('KeyQ');
      for (const k of pressed) await page.keyboard.down(k);
      await page.waitForTimeout(500);
      for (const k of pressed) await page.keyboard.up(k);

      scored = (await page.evaluate(() => window.__aquascape_debug__?.getGameScore() ?? 0)) as number;
    }

    expect(scored).toBeGreaterThan(0);
  });
});

// F16.2 — survival: the player is prey; predators hunt it; the objective is to
// outlast the clock. We assert the run boots live + the survived-seconds SCORE
// climbs (the survival service awards the whole seconds survived each frame).
// A full win (90 s) is too slow for CI, so we prove the loop is alive + scoring.
// Lose-on-caught + win-at-the-limit are exhaustively covered by the integration
// spec (survival-game.service.spec.ts) — this proves the live pipeline ticks.
//
// Validated in CI / on a provisioned chromium (see docs/caveats/e2e.md).
test.describe('game-mode survival (?mode=game:survival)', () => {
  test('boots live and the survived-seconds score climbs', async ({ page }) => {
    test.slow();

    await page.goto('/?mode=game:survival');
    await expect(page.locator('canvas').nth(1)).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));
    await page.waitForFunction(
      () => window.__aquascape_debug__?.getViewMode() === 'fish-eye',
      undefined,
      { timeout: 10_000 },
    );
    await page.waitForFunction(() => (window.__aquascape_debug__?.getEntityCount() ?? 0) > 1, {
      timeout: 10_000,
    });
    // The run booted live (the survival rules started on entry); the mode is set.
    expect(['playing', 'won', 'lost']).toContain(
      await page.evaluate(() => window.__aquascape_debug__?.getGameState()),
    );

    // Swim AWAY from a hunter (toward the far +x wall) and poll the score. The
    // survival service awards the WHOLE SECONDS SURVIVED each frame, so the
    // score climbs while the run is live. We assert it reaches >= 2 (the player
    // outlasted at least 2 s of the hunt) — that proves the live survival loop
    // is scoring through the real pipeline. The run may end in a `lost` later
    // (a hunter eventually catches a fleeing prey) — that's legitimate; the
    // score is latched at the seconds survived. Win-at-the-limit + lose-on-
    // caught are covered exhaustively by survival-game.service.spec.ts.
    await page.keyboard.down('KeyD');
    await page.waitForFunction(
      () => (window.__aquascape_debug__?.getGameScore() ?? 0) >= 2,
      undefined,
      { timeout: 15_000 },
    );
    await page.keyboard.up('KeyD');

    const score = (await page.evaluate(
      () => window.__aquascape_debug__?.getGameScore() ?? 0,
    )) as number;
    expect(score).toBeGreaterThanOrEqual(2);
  });
});

// F16.3 — feeding: food falls from the surface; eating it by proximity fills
// the meter + scores. We steer the player toward the nearest food sprite each
// beat and poll the score until it ticks up (the eat → despawn → score pipeline
// through the live world). Food sprites carry no Orientation, so we read them
// from the snapshot's food slab (foodSpritePosition / foodSpriteCount).
//
// Validated in CI / on a provisioned chromium (see docs/caveats/e2e.md).
test.describe('game-mode feeding (?mode=game:feeding)', () => {
  test('eating dropped food increments the score', async ({ page }) => {
    test.slow();

    await page.goto('/?mode=game:feeding');
    await expect(page.locator('canvas').nth(1)).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__aquascape_debug__));
    await page.waitForFunction(
      () => window.__aquascape_debug__?.getViewMode() === 'fish-eye',
      undefined,
      { timeout: 10_000 },
    );
    expect(await page.evaluate(() => window.__aquascape_debug__?.getGameState())).toBe('playing');
    expect(await page.evaluate(() => window.__aquascape_debug__?.getGameScore())).toBe(0);

    // Steer toward the nearest dropped food for up to ~14 s, polling the score.
    let scored = 0;
    for (let i = 0; i < 28 && scored === 0; i++) {
      const dir = await page.evaluate(() => {
        const dbg = window.__aquascape_debug__;
        const world = dbg?.getWorld();
        if (!world) return null;
        const player = world.getPlayerEntity();
        const snap = world.snapshot(0);
        let px = 0;
        let py = 0;
        let pz = 0;
        let found = false;
        for (let j = 0; j < snap.entityCount; j++) {
          if (snap.ids[j] === player) {
            px = snap.position[j * 3] as number;
            py = snap.position[j * 3 + 1] as number;
            pz = snap.position[j * 3 + 2] as number;
            found = true;
          }
        }
        // Food sprites are a separate slab on the snapshot.
        const fc = (snap as unknown as { foodSpriteCount?: number }).foodSpriteCount ?? 0;
        const fp =
          (snap as unknown as { foodSpritePosition?: Float32Array | number[] }).foodSpritePosition ??
          [];
        if (!found || fc === 0) return null;
        let bestX = px;
        let bestY = py;
        let bestZ = pz;
        let bestD = Infinity;
        for (let k = 0; k < fc; k++) {
          const fx = fp[k * 3] as number;
          const fy = fp[k * 3 + 1] as number;
          const fz = fp[k * 3 + 2] as number;
          const d = (fx - px) ** 2 + (fy - py) ** 2 + (fz - pz) ** 2;
          if (d < bestD) {
            bestD = d;
            bestX = fx;
            bestY = fy;
            bestZ = fz;
          }
        }
        return { dx: bestX - px, dy: bestY - py, dz: bestZ - pz };
      });
      if (dir === null) {
        await page.waitForTimeout(400); // wait for the next drop
        continue;
      }

      const pressed: string[] = [];
      if (dir.dx > 30) pressed.push('KeyD');
      else if (dir.dx < -30) pressed.push('KeyA');
      if (dir.dy > 30) pressed.push('KeyW');
      else if (dir.dy < -30) pressed.push('KeyS');
      if (dir.dz > 30) pressed.push('KeyE');
      else if (dir.dz < -30) pressed.push('KeyQ');
      for (const k of pressed) await page.keyboard.down(k);
      await page.waitForTimeout(500);
      for (const k of pressed) await page.keyboard.up(k);

      scored = (await page.evaluate(
        () => window.__aquascape_debug__?.getGameScore() ?? 0,
      )) as number;
    }

    expect(scored).toBeGreaterThan(0);
  });
});
