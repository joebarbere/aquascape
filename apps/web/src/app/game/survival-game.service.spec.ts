// Integration tests for SurvivalGameService (Stage 16 F16.2).
//
// Drives the REAL survival rules pipeline against a REAL livestock-ecs world:
//   - a predator inside the catch radius loses the run (state → lost),
//   - surviving to the time limit wins (state → won),
//   - stamina drains while a predator is in threat range,
//   - the player's real health/food is pushed to the HUD vitality, and
//   - a non-game world (no player, no survival rules) is unaffected — the
//     determinism boundary holds (no entity is mutated outside an active game).

import { TestBed } from '@angular/core/testing';

import { GameModeService, type SurvivalRuleParams } from '@aquascape/features/game';
import {
  FISH_ARCHETYPE,
  Predator,
  createLivestockWorld,
  type LivestockWorld,
  type TankAabb,
} from '@aquascape/domain/livestock-ecs';
import { addComponent, hasComponent } from 'bitecs';

import { SurvivalGameService } from './survival-game.service';
import { pickPlayerEntity } from './game-activation';

const TANK: TankAabb = { minX: 0, maxX: 2000, minY: 0, maxY: 600, minZ: 0, maxZ: 600 };

// Generous radii, short clock so tests reach win/lose quickly + deterministically.
const PARAMS: SurvivalRuleParams = {
  catchRadiusMm: 100,
  threatRadiusMm: 300,
  staminaDrainPerSec: 0.5,
  staminaRecoverPerSec: 0.25,
  timeLimitSec: 5,
};

/**
 * Build a world: the player (index 0), then non-player fish at given offsets.
 * The caller tags whichever it wants as a predator (so we control the threat
 * geometry precisely rather than relying on the auto-promotion).
 */
function makeWorld(
  playerPos: { x: number; y: number; z: number },
  otherPos: ReadonlyArray<{ x: number; y: number; z: number }>,
): { world: LivestockWorld; playerEid: number; others: number[] } {
  const world = createLivestockWorld(0x5eed, { tankAabb: { ...TANK } });
  world.spawnFish({
    archetype: FISH_ARCHETYPE.SLIM_TETRA,
    speciesId: 1,
    bodyLengthMm: 30,
    position: playerPos,
  });
  const others: number[] = [];
  for (const p of otherPos) {
    others.push(
      world.spawnFish({
        archetype: FISH_ARCHETYPE.DEEP_BODIED,
        speciesId: 2,
        bodyLengthMm: 60,
        position: p,
      }),
    );
  }
  const playerEid = pickPlayerEntity(world);
  world.setPlayer(playerEid);
  return { world, playerEid, others };
}

describe('SurvivalGameService', () => {
  let svc: SurvivalGameService;
  let game: GameModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(SurvivalGameService);
    game = TestBed.inject(GameModeService);
  });

  function goLive(): void {
    game.startGame('survival');
    game.dispatch({ type: 'start' }); // → playing (live)
  }

  it('the player is PREY — it is NOT tagged a predator', () => {
    const { world, playerEid } = makeWorld({ x: 100, y: 100, z: 100 }, [
      { x: 800, y: 100, z: 100 },
    ]);
    svc.start(world, playerEid, PARAMS);
    expect(hasComponent(world.ecs, Predator, playerEid)).toBe(false);
  });

  it('promotes existing fish to hunters when the scene has no predators', () => {
    const { world, playerEid, others } = makeWorld({ x: 100, y: 100, z: 100 }, [
      { x: 800, y: 100, z: 100 },
      { x: 900, y: 100, z: 100 },
    ]);
    svc.start(world, playerEid, PARAMS);
    // At least one non-player fish is now a predator (the threat).
    const taggedOthers = others.filter((e) => hasComponent(world.ecs, Predator, e));
    expect(taggedOthers.length).toBeGreaterThan(0);
    // Leaving the game demotes them again (no lingering scary fish).
    svc.stop();
    for (const e of others) expect(hasComponent(world.ecs, Predator, e)).toBe(false);
  });

  it('loses when a predator is within the catch radius', () => {
    const { world, playerEid, others } = makeWorld({ x: 100, y: 100, z: 100 }, [
      { x: 150, y: 100, z: 100 }, // 50 mm away → inside catch radius
    ]);
    addComponent(world.ecs, Predator, others[0]);
    goLive();
    svc.start(world, playerEid, PARAMS);

    const decided = svc.frame(1 / 60);
    expect(decided).toBe(true);
    expect(game.state()).toBe('lost');
  });

  it('drains stamina while a predator is in threat range', () => {
    const { world, playerEid, others } = makeWorld({ x: 100, y: 100, z: 100 }, [
      { x: 350, y: 100, z: 100 }, // 250 mm → outside catch (100) but inside threat (300)
    ]);
    addComponent(world.ecs, Predator, others[0]);
    goLive();
    svc.start(world, playerEid, PARAMS);

    expect(svc.staminaForTest()).toBe(1);
    svc.frame(1); // 1 s threatened → drains 0.5
    expect(svc.staminaForTest()).toBeCloseTo(0.5);
    // Still alive (caught requires the catch radius; stamina > 0).
    expect(game.state()).toBe('playing');
  });

  it('wins on surviving to the time limit', () => {
    const { world, playerEid, others } = makeWorld({ x: 100, y: 100, z: 100 }, [
      { x: 1800, y: 500, z: 500 }, // far away — never a threat
    ]);
    addComponent(world.ecs, Predator, others[0]);
    goLive();
    svc.start(world, playerEid, PARAMS); // timeLimitSec = 5
    game.tick(5); // elapsed = 5 (>= limit) while live

    const decided = svc.frame(1 / 60);
    expect(decided).toBe(true);
    expect(game.state()).toBe('won');
  });

  it('pushes the player real vitality to the HUD (not the placeholder)', () => {
    const { world, playerEid, others } = makeWorld({ x: 100, y: 100, z: 100 }, [
      { x: 1800, y: 500, z: 500 },
    ]);
    addComponent(world.ecs, Predator, others[0]);
    goLive();
    svc.start(world, playerEid, PARAMS);
    svc.frame(1 / 60);
    const v = game.vitality();
    expect(v.isPlaceholder).toBe(false);
    expect(v.stamina).not.toBeNull();
  });

  it('does nothing while the run is NOT live', () => {
    const { world, playerEid, others } = makeWorld({ x: 100, y: 100, z: 100 }, [
      { x: 150, y: 100, z: 100 },
    ]);
    addComponent(world.ecs, Predator, others[0]);
    game.startGame('survival'); // objective — not live (no start)
    svc.start(world, playerEid, PARAMS);

    expect(svc.frame(1 / 60)).toBe(false);
    expect(game.state()).toBe('objective');
  });
});

describe('SurvivalGameService — determinism boundary (no game / no player)', () => {
  it('a world with no survival rules running keeps every fish (no mutation)', () => {
    const world = createLivestockWorld(0x5eed, { tankAabb: { ...TANK } });
    for (let i = 0; i < 5; i++) {
      world.spawnFish({
        archetype: FISH_ARCHETYPE.SLIM_TETRA,
        speciesId: 1,
        bodyLengthMm: 30,
        position: { x: 100 + i * 10, y: 100, z: 100 },
      });
    }
    const before = world.snapshot(0).entityCount;
    for (let i = 0; i < 60; i++) world.step(1 / 30);
    expect(world.snapshot(0).entityCount).toBe(before);
  });
});
