// Integration tests for PredatorGameService (Stage 16 F16.4).
//
// Drives the REAL predator rules pipeline against a REAL livestock-ecs world:
//   - a prey within the catch radius is DESPAWNED + the score increments,
//   - reaching the target catches dispatches `win` (state → won),
//   - the time limit dispatches `lose` when the target wasn't met,
//   - marking the player a predator makes prey flee (FearSystem reuse), and
//   - a non-game world (no player, no predator rules) is unaffected — the
//     determinism boundary holds (catches only happen in an active game).

import { TestBed } from '@angular/core/testing';

import { GameModeService, type PredatorRuleParams } from '@aquascape/features/game';
import {
  FISH_ARCHETYPE,
  Predator,
  createLivestockWorld,
  type LivestockWorld,
  type TankAabb,
} from '@aquascape/domain/livestock-ecs';
import { hasComponent } from 'bitecs';

import { PredatorGameService } from './predator-game.service';
import { pickPlayerEntity } from './game-activation';

const TANK: TankAabb = { minX: 0, maxX: 2000, minY: 0, maxY: 600, minZ: 0, maxZ: 600 };

// Generous radius, low target so tests reach win/lose quickly + deterministically.
const PARAMS: PredatorRuleParams = { catchRadiusMm: 60, targetCatches: 2, timeLimitSec: 5 };

/**
 * Build a world: the player at the origin corner, then prey at given offsets.
 * The player is snapshot index 0 (`pickPlayerEntity`).
 */
function makeWorld(
  playerPos: { x: number; y: number; z: number },
  preyPos: ReadonlyArray<{ x: number; y: number; z: number }>,
): { world: LivestockWorld; playerEid: number } {
  const world = createLivestockWorld(0x9eed, { tankAabb: { ...TANK } });
  world.spawnFish({
    archetype: FISH_ARCHETYPE.DEEP_BODIED,
    speciesId: 99,
    bodyLengthMm: 60,
    position: playerPos,
  });
  for (const p of preyPos) {
    world.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: p,
    });
  }
  const playerEid = pickPlayerEntity(world);
  world.setPlayer(playerEid);
  return { world, playerEid };
}

describe('PredatorGameService', () => {
  let svc: PredatorGameService;
  let game: GameModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(PredatorGameService);
    game = TestBed.inject(GameModeService);
  });

  function goLive(): void {
    game.startGame('predator');
    game.dispatch({ type: 'start' }); // → playing (live)
  }

  it('tags the player a predator on start (prey flee via FearSystem reuse)', () => {
    const { world, playerEid } = makeWorld({ x: 100, y: 100, z: 100 }, []);
    svc.start(world, playerEid, PARAMS);
    expect(hasComponent(world.ecs, Predator, playerEid)).toBe(true);
  });

  it('a prey inside the catch radius is despawned + the score increments', () => {
    // One prey 50 mm from the player (inside the 60 mm radius); one 500 mm away.
    const { world, playerEid } = makeWorld({ x: 100, y: 100, z: 100 }, [
      { x: 150, y: 100, z: 100 }, // dist 50 → caught
      { x: 600, y: 100, z: 100 }, // dist 500 → safe
    ]);
    goLive();
    svc.start(world, playerEid, PARAMS);

    const before = world.snapshot(0).entityCount; // player + 2 prey = 3
    expect(before).toBe(3);

    const caught = svc.frame(1 / 60);
    expect(caught).toBe(1);
    expect(game.score().points).toBe(1);
    // The caught prey is gone; the player + the distant prey remain.
    expect(world.snapshot(0).entityCount).toBe(2);
  });

  it('reaching the target catches dispatches win (state → won)', () => {
    const { world, playerEid } = makeWorld({ x: 100, y: 100, z: 100 }, [
      { x: 130, y: 100, z: 100 }, // dist 30 → caught
      { x: 100, y: 130, z: 100 }, // dist 30 → caught
    ]);
    goLive();
    svc.start(world, playerEid, PARAMS); // targetCatches = 2

    svc.frame(1 / 60);
    expect(game.score().points).toBe(2);
    expect(game.state()).toBe('won');
  });

  it('the time limit dispatches lose when the target was not met', () => {
    // No prey in range → no catches. Advance the elapsed clock past the limit
    // via the service's own tick, then run a frame to evaluate the outcome.
    const { world, playerEid } = makeWorld({ x: 100, y: 100, z: 100 }, [
      { x: 1500, y: 500, z: 500 }, // far away, never caught
    ]);
    goLive();
    svc.start(world, playerEid, PARAMS); // timeLimitSec = 5
    game.tick(5); // elapsed = 5 (>= limit) while live

    const caught = svc.frame(1 / 60);
    expect(caught).toBe(0);
    expect(game.state()).toBe('lost');
  });

  it('does nothing while the run is NOT live (objective / paused freeze the hunt)', () => {
    const { world, playerEid } = makeWorld({ x: 100, y: 100, z: 100 }, [
      { x: 130, y: 100, z: 100 }, // would be caught if live
    ]);
    game.startGame('predator'); // objective state — NOT live (no `start`)
    svc.start(world, playerEid, PARAMS);

    const caught = svc.frame(1 / 60);
    expect(caught).toBe(0);
    expect(game.score().points).toBe(0);
    expect(world.snapshot(0).entityCount).toBe(2); // nothing despawned
  });

  it('latches the outcome — does not re-fire win on later frames', () => {
    const { world, playerEid } = makeWorld({ x: 100, y: 100, z: 100 }, [
      { x: 130, y: 100, z: 100 },
      { x: 100, y: 130, z: 100 },
    ]);
    goLive();
    svc.start(world, playerEid, PARAMS);
    svc.frame(1 / 60);
    expect(game.state()).toBe('won');
    // A second frame is a no-op (decided latched) — score stays + no throw.
    expect(svc.frame(1 / 60)).toBe(0);
    expect(game.score().points).toBe(2);
  });
});

describe('PredatorGameService — determinism boundary (no game / no player)', () => {
  it('a world with no predator rules running keeps every prey (no despawn)', () => {
    // The service is never started → no frame loop touches the world. The world
    // ticks like any non-game showcase: every fish survives.
    const world = createLivestockWorld(0x9eed, { tankAabb: { ...TANK } });
    for (let i = 0; i < 5; i++) {
      world.spawnFish({
        archetype: FISH_ARCHETYPE.SLIM_TETRA,
        speciesId: 1,
        bodyLengthMm: 30,
        position: { x: 100 + i * 10, y: 100, z: 100 }, // clustered, but no predator
      });
    }
    const before = world.snapshot(0).entityCount;
    for (let i = 0; i < 60; i++) world.step(1 / 30);
    // No player, no predator, no catch loop → no entity is ever removed.
    expect(world.snapshot(0).entityCount).toBe(before);
  });
});
