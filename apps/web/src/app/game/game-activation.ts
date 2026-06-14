// Pure game-activation helpers (Stage 16 F16.1b).
//
// Framework-free + deterministic so they're unit-testable without Angular or
// a renderer. The Angular wiring (AppComponent + GameInputService) calls these
// to (a) pick which fish becomes the player and (b) build the game scene.
//
// DETERMINISM. `pickPlayerEntity` reads the world's post-spawn snapshot in a
// fixed order, so the same seed + same livestock always tags the SAME fish as
// the player. No `Math.random` / `Date.now` here — the player ENTITY is
// deterministic; only the live INPUT velocity (injected elsewhere, through the
// `setPlayerVelocity` seam) is non-deterministic. See
// `docs/caveats/game-modes.md` + `docs/caveats/livestock-ecs.md`.

import type { LivestockWorld } from '@aquascape/domain/livestock-ecs';
import { NO_ENTITY_REF, STARVE_HUNGER_THRESHOLD } from '@aquascape/domain/livestock-ecs';

/**
 * Deterministically choose the player entity from a populated world. We take
 * snapshot index 0 — the first fish spawned (the service walks `scene.livestock`
 * in document order, then `0..quantity-1`), which is stable across cold starts
 * for a given scene. Returns `NO_ENTITY_REF` when the world has no entities
 * (the caller then skips `setPlayer`, leaving a non-game world).
 *
 * The `WorldSnapshot.ids` slab is a Uint32Array of live eids; index 0 is the
 * first allocated fish. The renderer's fish-eye retarget follows
 * `world.getPlayerEntity()`, so tagging this eid is all that's needed for the
 * camera to ride the player.
 */
export function pickPlayerEntity(world: LivestockWorld): number {
  const snap = world.snapshot(0);
  if (snap.entityCount === 0) return NO_ENTITY_REF;
  const eid = snap.ids[0];
  return eid === undefined ? NO_ENTITY_REF : eid;
}

/**
 * Read a given entity's current position out of the world snapshot, or `null`
 * when the eid isn't present. Pure read — used by tests (and could back a
 * debug accessor) to assert the player moved after an input injection +
 * `step()`. `ids` and `position` (stride 3) are parallel slabs.
 */
export function readEntityPosition(
  world: LivestockWorld,
  eid: number,
): { x: number; y: number; z: number } | null {
  const snap = world.snapshot(0);
  for (let i = 0; i < snap.entityCount; i++) {
    if (snap.ids[i] === eid) {
      return {
        x: snap.position[i * 3] ?? 0,
        y: snap.position[i * 3 + 1] ?? 0,
        z: snap.position[i * 3 + 2] ?? 0,
      };
    }
  }
  return null;
}

/** The player's live vitality, read from the world snapshot's Stage 14 slabs. */
export interface PlayerVitals {
  /** `HealthDrive.health` fraction `[0, 1]` (1 when the eid isn't found). */
  readonly health: number;
  /**
   * FULLNESS fraction `[0, 1]` derived from `FeedingDrive.hunger`: `1` when
   * sated (hunger 0), `0` at/above the starve threshold. This is the fish's
   * intrinsic hunger (the survival HUD's food bar); the feeding GAME shows its
   * own game-local meter instead.
   */
  readonly food: number;
}

/**
 * Read the player entity's live `HealthDrive.health` + `FeedingDrive.hunger`
 * from the world snapshot (the Stage 14 vitality slabs, parallel to `ids`) and
 * return them as HUD fractions. Returns full-health / full-food defaults when
 * the eid isn't in the current snapshot (e.g. between a despawn + the next
 * snapshot). Pure read — no world mutation. The per-mode game service calls
 * this each frame and pushes the result onto `GameModeService.setVitality`.
 */
export function readPlayerVitals(world: LivestockWorld, eid: number): PlayerVitals {
  const snap = world.snapshot(0);
  for (let i = 0; i < snap.entityCount; i++) {
    if (snap.ids[i] === eid) {
      const health = snap.health[i] ?? 1;
      const hunger = snap.hunger[i] ?? 0;
      const fullness = 1 - hunger / STARVE_HUNGER_THRESHOLD;
      const food = fullness < 0 ? 0 : fullness > 1 ? 1 : fullness;
      return { health: health < 0 ? 0 : health > 1 ? 1 : health, food };
    }
  }
  return { health: 1, food: 1 };
}
