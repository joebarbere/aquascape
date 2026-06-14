// Stage 16 — game-mode activation smoke tests (Playwright e2e).
//
// WHAT THESE PROVE END-TO-END (that unit/integration tests can't):
//   `?mode=game:<submode>` resolves the CLI grammar, boots the app into 3D
//   FISH-EYE, marks a player entity on the live ECS world, mounts the game
//   HUD, and starts a live game loop (a valid game state + a numeric score).
//
// WHAT THEY DELIBERATELY DON'T ASSERT — and why:
//   The CI e2e runs under SOFTWARE WebGL (SwiftShader). The world only ticks
//   while the 3D canvas paints, and under SwiftShader the RAF cadence + input
//   timing are NON-DETERMINISTIC: a held key may integrate 0 mm in one run and
//   move the player in the next; a predator amid a dense shoal can win on frame
//   0; a survival run can flip to `lost` immediately. So these tests assert
//   only the BOOT/RENDER INVARIANTS that hold reliably under SwiftShader, and
//   do NOT hard-assert physics/timing OUTCOMES (displacement ≥ N, a catch
//   scores, the meter fills to N). Those gameplay rules are exhaustively
//   covered deterministically by the unit/integration specs:
//   `predator-rules` / `survival-rules` / `feeding-rules` (features-game) and
//   `predator-game.service` / `survival-game.service` / `feeding-game.service`
//   (apps/web — a synthetic key → velocity → `world.step` moves a marked
//   player; catches despawn + score; etc.). See docs/caveats/e2e.md →
//   "Game-mode e2e under software WebGL".
//
// We also do NOT assert canvas visibility: in fish-eye the 2D canvas is hidden
// and, under SwiftShader, the 3D canvas can read as `hidden` to Playwright even
// while it paints. The debug hook + view mode are the reliable readiness gate.

import { expect, test, type Page } from '@playwright/test';

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

/** The game states the shared state machine can report once a run is live. */
const LIVE_GAME_STATES = ['playing', 'won', 'lost'];

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

/**
 * Boot a game sub-mode and assert the BOOT INVARIANTS that hold reliably under
 * software WebGL: the debug hook appears, the renderer enters fish-eye, the
 * world is populated, a player is marked, the game loop is live (a valid state
 * + a finite, non-negative score). Returns once the game is live.
 */
async function bootIntoGame(page: Page, submode: string): Promise<void> {
  await page.goto(`/?mode=game:${submode}`);
  // Readiness = the debug hook (NOT canvas visibility — see file header).
  await page.waitForFunction(() => Boolean(window.__aquascape_debug__), undefined, {
    timeout: 15_000,
  });
  // Entered the game: the renderer flipped to fish-eye.
  await page.waitForFunction(
    () => window.__aquascape_debug__?.getViewMode() === 'fish-eye',
    undefined,
    { timeout: 15_000 },
  );
  // The world is populated and a player entity is marked.
  await page.waitForFunction(() => (window.__aquascape_debug__?.getEntityCount() ?? 0) > 0, {
    timeout: 15_000,
  });
  const playerEid = await page.evaluate(
    () => window.__aquascape_debug__?.getWorld()?.getPlayerEntity() ?? -1,
  );
  expect(playerEid).toBeGreaterThanOrEqual(0);
  // The game loop is live: a valid state + a finite, non-negative score.
  const state = await page.evaluate(() => window.__aquascape_debug__?.getGameState());
  expect(LIVE_GAME_STATES).toContain(state);
  const score = await page.evaluate(() => window.__aquascape_debug__?.getGameScore() ?? -1);
  expect(Number.isFinite(score)).toBe(true);
  expect(score).toBeGreaterThanOrEqual(0);
}

test.describe('game-mode activation', () => {
  // F16.1b — the activation pipeline boots end-to-end for each sub-mode: the
  // grammar resolves, the renderer enters fish-eye, a player is marked, and a
  // live game loop runs. (The deterministic input→velocity→step→move pipeline
  // is unit-tested in game-input.service.spec.ts.)
  // F16.5 (cleaner) now boots into the same playable loop — the player wields a
  // cleaning tool (T cycles scraper/brush/siphon) + scrubs algae. Its gameplay
  // PROGRESSION (algae falls, cleanliness climbs) is deterministically covered
  // by cleaner-rules + cleaner-game.service specs; here we only smoke the BOOT
  // invariants (advisory tier — see docs/caveats/e2e.md "assert mount/wiring,
  // not simulation progression").
  for (const submode of ['predator', 'survival', 'feeding', 'cleaner'] as const) {
    test(`?mode=game:${submode} boots into fish-eye with a live player loop`, async ({ page }) => {
      test.slow(); // populated showcase scene under software WebGL

      await bootIntoGame(page, submode);

      // Best-effort smoke of the input seam: hold a movement key a beat, then
      // confirm the run is STILL live + the player position is readable. We do
      // NOT assert displacement — under SwiftShader the RAF/sim cadence makes
      // it non-deterministic (covered deterministically by the unit specs).
      const before = await page.evaluate(readPlayerPosition);
      expect(before).not.toBeNull();
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(800);
      await page.keyboard.up('KeyD');

      const after = await page.evaluate(readPlayerPosition);
      expect(after).not.toBeNull();
      // The loop survived the interaction (state stays valid; score is sane).
      expect(LIVE_GAME_STATES).toContain(
        await page.evaluate(() => window.__aquascape_debug__?.getGameState()),
      );
      expect(
        (await page.evaluate(() => window.__aquascape_debug__?.getGameScore() ?? -1)) as number,
      ).toBeGreaterThanOrEqual(0);
    });
  }
});
