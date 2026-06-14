// Integration tests for FeedingGameService (Stage 16 F16.3).
//
// Drives the REAL feeding rules pipeline against a REAL livestock-ecs world:
//   - food near the player is EATEN (despawned) + the meter fills + score++,
//   - filling the meter to the target wins (state → won),
//   - food drops appear over time,
//   - the player's real health + the game meter are pushed to the HUD, and
//   - a non-game world (no player, no feeding rules) is unaffected — the
//     determinism boundary holds (no despawn / drop outside an active game).

import { TestBed } from '@angular/core/testing';

import { GameModeService, type FeedingRuleParams } from '@aquascape/features/game';
import {
  FISH_ARCHETYPE,
  FOOD_TYPE,
  createLivestockWorld,
  type LivestockWorld,
  type TankAabb,
} from '@aquascape/domain/livestock-ecs';

import { FeedingGameService } from './feeding-game.service';
import { pickPlayerEntity } from './game-activation';

const TANK: TankAabb = { minX: 0, maxX: 2000, minY: 0, maxY: 600, minZ: 0, maxZ: 600 };

// Generous eat radius + a low target so tests reach win quickly.
const PARAMS: FeedingRuleParams = {
  eatRadiusMm: 100,
  fillPerBite: 0.5,
  drainPerSec: 0,
  targetFill: 0.9,
  timeLimitSec: 30,
  scorePerBite: 1,
  overeatPenalty: 1,
};

function makeWorld(playerPos: { x: number; y: number; z: number }): {
  world: LivestockWorld;
  playerEid: number;
} {
  const world = createLivestockWorld(0x6eed, { tankAabb: { ...TANK } });
  world.spawnFish({
    archetype: FISH_ARCHETYPE.SLIM_TETRA,
    speciesId: 1,
    bodyLengthMm: 30,
    position: playerPos,
  });
  const playerEid = pickPlayerEntity(world);
  world.setPlayer(playerEid);
  return { world, playerEid };
}

describe('FeedingGameService', () => {
  let svc: FeedingGameService;
  let game: GameModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(FeedingGameService);
    game = TestBed.inject(GameModeService);
  });

  function goLive(): void {
    game.startGame('feeding');
    game.dispatch({ type: 'start' });
  }

  it('eats food near the player: despawns it, fills the meter, scores', () => {
    const { world, playerEid } = makeWorld({ x: 100, y: 100, z: 100 });
    // Drop a sprite right on the player + one far away.
    world.spawnFoodSprite({ x: 120, y: 100, z: 100 }, 30, 1, FOOD_TYPE.FLAKE); // 20 mm → eaten
    world.spawnFoodSprite({ x: 900, y: 100, z: 100 }, 30, 1, FOOD_TYPE.FLAKE); // 800 mm → safe
    goLive();
    svc.start(world, playerEid, PARAMS);

    const before = world.getFoodSpriteCount();
    expect(before).toBe(2);

    const eaten = svc.frame(1 / 60);
    expect(eaten).toBe(1);
    expect(game.score().points).toBe(1);
    expect(svc.fillForTest()).toBeCloseTo(0.5);
    // The eaten sprite is gone; the distant one remains (plus any auto-drops).
    expect(world.getFoodSpriteCount()).toBeGreaterThanOrEqual(1);
  });

  it('filling the meter to the target wins (state → won)', () => {
    const { world, playerEid } = makeWorld({ x: 100, y: 100, z: 100 });
    // Two sprites on the player → 2 bites × 0.5 = 1.0 ≥ target 0.9.
    world.spawnFoodSprite({ x: 110, y: 100, z: 100 }, 30, 1, FOOD_TYPE.FLAKE);
    world.spawnFoodSprite({ x: 120, y: 100, z: 100 }, 30, 1, FOOD_TYPE.FLAKE);
    goLive();
    svc.start(world, playerEid, PARAMS);

    svc.frame(1 / 60);
    expect(svc.fillForTest()).toBeGreaterThanOrEqual(PARAMS.targetFill);
    expect(game.state()).toBe('won');
  });

  it('drops food automatically over time', () => {
    const { world, playerEid } = makeWorld({ x: 1900, y: 100, z: 100 }); // player in a corner
    goLive();
    svc.start(world, playerEid, PARAMS);
    // The first frame drops (dropTimer seeded at the interval).
    svc.frame(1 / 60);
    expect(world.getFoodSpriteCount()).toBeGreaterThan(0);
  });

  it('pushes the player real health + the meter to the HUD (not placeholder)', () => {
    const { world, playerEid } = makeWorld({ x: 1900, y: 100, z: 100 });
    goLive();
    svc.start(world, playerEid, PARAMS);
    svc.frame(1 / 60);
    const v = game.vitality();
    expect(v.isPlaceholder).toBe(false);
    expect(v.stamina).toBeNull(); // feeding has no stamina bar
  });

  it('does nothing while the run is NOT live', () => {
    const { world, playerEid } = makeWorld({ x: 100, y: 100, z: 100 });
    world.spawnFoodSprite({ x: 110, y: 100, z: 100 }, 30, 1, FOOD_TYPE.FLAKE);
    game.startGame('feeding'); // objective — not live
    svc.start(world, playerEid, PARAMS);

    expect(svc.frame(1 / 60)).toBe(0);
    expect(world.getFoodSpriteCount()).toBe(1); // no eat, no drop
    expect(game.score().points).toBe(0);
  });
});

describe('FeedingGameService — determinism boundary (no game / no player)', () => {
  it('a world with no feeding rules running spawns/despawns no food', () => {
    const world = createLivestockWorld(0x6eed, { tankAabb: { ...TANK } });
    world.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 100, y: 100, z: 100 },
    });
    for (let i = 0; i < 60; i++) world.step(1 / 30);
    // No feeding service started → no drops appear from the game loop.
    expect(world.getFoodSpriteCount()).toBe(0);
  });
});
