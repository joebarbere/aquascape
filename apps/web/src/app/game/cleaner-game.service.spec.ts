// Integration tests for CleanerGameService (Stage 16 F16.5).
//
// Drives the REAL cleaner rules pipeline against a REAL livestock-ecs world:
//   - holding the use button near a hardscape surface with the right tool RASPS
//     that surface's targeted per-type algae + raises the cleanliness score,
//   - a tool that doesn't target a present algae type leaves it untouched,
//   - cleaning the tank below the target dispatches `win` (state → won),
//   - the time limit dispatches `lose` when the tank is still dirty,
//   - the tool-select cycles scraper → brush → siphon and flips `siphonActive`,
//   - and a non-game world (no player, no cleaner rules) is unaffected — the
//     determinism boundary holds (rasps only happen in an active game).

import { TestBed } from '@angular/core/testing';

import {
  GameModeService,
  type CleanerRuleParams,
} from '@aquascape/features/game';
import {
  FISH_ARCHETYPE,
  HARDSCAPE_CATEGORY,
  createLivestockWorld,
  type LivestockWorld,
  type TankAabb,
} from '@aquascape/domain/livestock-ecs';

import { CleanerGameService } from './cleaner-game.service';
import { pickPlayerEntity } from './game-activation';
import { WaterChemistryService } from '../water-chemistry.service';

const TANK: TankAabb = { minX: 0, maxX: 2000, minY: 0, maxY: 600, minZ: 0, maxZ: 600 };

// Generous reach, low clean-target so tests reach win quickly + deterministically.
const PARAMS: CleanerRuleParams = {
  reachMm: 200,
  cleanTargetTotal: 0.5,
  timeLimitSec: 5,
  wasteDrainPerSec: 0.05,
};

/**
 * Build a world: the player at `playerPos` (snapshot index 0), then a hardscape
 * rock at `rockPos` (seeded with algae 1.0 total by the rock-category default).
 */
function makeWorld(
  playerPos: { x: number; y: number; z: number },
  rockPos: { x: number; y: number; z: number },
): { world: LivestockWorld; playerEid: number; rockEid: number } {
  const world = createLivestockWorld(0x9eed, { tankAabb: { ...TANK } });
  world.spawnFish({
    archetype: FISH_ARCHETYPE.DEEP_BODIED,
    speciesId: 99,
    bodyLengthMm: 60,
    position: playerPos,
  });
  world.registerHardscape([
    { position: rockPos, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
  ]);
  const playerEid = pickPlayerEntity(world);
  world.setPlayer(playerEid);
  const rockEid = world.getHardscapeEntities()[0]!.eid;
  return { world, playerEid, rockEid };
}

/** Force the active tool to the one whose type matches (scraper/brush/siphon). */
function selectTool(svc: CleanerGameService, type: 'scraper' | 'brush' | 'siphon'): void {
  for (let i = 0; i < 6; i++) {
    if (svc.activeTool()?.type === type) return;
    svc.cycleTool();
  }
}

describe('CleanerGameService', () => {
  let svc: CleanerGameService;
  let game: GameModeService;

  // Stub the chemistry service so the DI chain (WaterChemistryService →
  // LivestockSimulationService → Store) doesn't pull NgRx into this unit test.
  // The cleaner's only call is `applyWaterChange` (the siphon waste dilution),
  // which we count here to assert the siphon ties into chemistry.
  let waterChangeCalls = 0;

  beforeEach(() => {
    waterChangeCalls = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: WaterChemistryService,
          useValue: {
            applyWaterChange: (frac: number) => {
              if (frac > 0) waterChangeCalls += 1;
            },
          },
        },
      ],
    });
    svc = TestBed.inject(CleanerGameService);
    game = TestBed.inject(GameModeService);
  });

  function goLive(): void {
    game.startGame('cleaner');
    game.dispatch({ type: 'start' }); // → playing (live)
  }

  /** Set the held intent so the use button (primary) is down. */
  function holdUse(down: boolean): void {
    game.setIntent({
      move: { x: 0, y: 0, z: 0 },
      actions: { primary: down, secondary: false, pause: false },
    });
  }

  it('resolves the cleaning-tool catalog rows + starts on a non-siphon tool', () => {
    const { world, playerEid } = makeWorld({ x: 100, y: 100, z: 100 }, { x: 1500, y: 0, z: 300 });
    svc.start(world, playerEid, PARAMS);
    expect(svc.activeTool()).not.toBeNull();
    // The first catalog cleaning-tool is a scraper (byKind order) — not a siphon.
    expect(svc.siphonActive()).toBe(false);
  });

  it('cycleTool walks scraper → brush → siphon and flips siphonActive', () => {
    const { world, playerEid } = makeWorld({ x: 100, y: 100, z: 100 }, { x: 1500, y: 0, z: 300 });
    svc.start(world, playerEid, PARAMS);
    selectTool(svc, 'siphon');
    expect(svc.activeTool()?.type).toBe('siphon');
    expect(svc.siphonActive()).toBe(true);
    selectTool(svc, 'brush');
    expect(svc.siphonActive()).toBe(false);
  });

  it('the siphon, use held, dilutes the live chemistry waste (Stage 13 tie-in)', () => {
    const { world, playerEid } = makeWorld(
      { x: 1500, y: 50, z: 300 },
      { x: 1500, y: 0, z: 300 },
    );
    goLive();
    svc.start(world, playerEid, PARAMS);
    selectTool(svc, 'siphon');
    holdUse(true);
    expect(waterChangeCalls).toBe(0);
    svc.frame(0.5);
    // The gravel siphon `removesWaste` → it nudges the chemistry cleaner.
    expect(waterChangeCalls).toBe(1);
  });

  it('a scraper near a rock, use held, rasps green-spot + raises the clean score', () => {
    // Player ON TOP of the rock (within the 200 mm reach). The scraper targets
    // green-spot + diatom (glass surface ⇒ scrapes).
    const { world, playerEid, rockEid } = makeWorld(
      { x: 1500, y: 50, z: 300 },
      { x: 1500, y: 0, z: 300 },
    );
    goLive();
    svc.start(world, playerEid, PARAMS);
    selectTool(svc, 'scraper');
    holdUse(true);

    const before = world.getAlgaeByType(rockEid)!;
    const removed = svc.frame(0.5);
    const after = world.getAlgaeByType(rockEid)!;

    expect(removed).toBeGreaterThan(0);
    // green-spot (a scraper target) dropped; black-beard (NOT a target) held.
    expect(after['green-spot']).toBeLessThan(before['green-spot']);
    expect(after['black-beard']).toBe(before['black-beard']);
    // The clean-% score rose above zero as algae fell.
    expect(game.score().points).toBeGreaterThan(0);
  });

  it('does not rasp when the use button is NOT held', () => {
    const { world, playerEid, rockEid } = makeWorld(
      { x: 1500, y: 50, z: 300 },
      { x: 1500, y: 0, z: 300 },
    );
    goLive();
    svc.start(world, playerEid, PARAMS);
    selectTool(svc, 'scraper');
    holdUse(false);

    const before = world.getAlgaeByType(rockEid)!;
    const removed = svc.frame(0.5);
    const after = world.getAlgaeByType(rockEid)!;
    expect(removed).toBe(0);
    expect(after['green-spot']).toBe(before['green-spot']);
  });

  it('does not rasp when the player is OUT of reach', () => {
    // Rock 1000 mm away — well beyond the 200 mm reach.
    const { world, playerEid, rockEid } = makeWorld(
      { x: 100, y: 100, z: 100 },
      { x: 1500, y: 0, z: 300 },
    );
    goLive();
    svc.start(world, playerEid, PARAMS);
    selectTool(svc, 'scraper');
    holdUse(true);

    const before = world.getAlgaeByType(rockEid)!;
    expect(svc.frame(0.5)).toBe(0);
    expect(world.getAlgaeByType(rockEid)!['green-spot']).toBe(before['green-spot']);
  });

  it('cleaning the tank below the target dispatches win (state → won)', () => {
    const { world, playerEid } = makeWorld(
      { x: 1500, y: 50, z: 300 },
      { x: 1500, y: 0, z: 300 },
    );
    goLive();
    svc.start(world, playerEid, PARAMS);
    selectTool(svc, 'scraper');
    holdUse(true);

    // A scraper only targets green-spot + diatom (half the seeded total). Run
    // enough frames to clear them; then switch to the brush for hair/black-beard
    // so the TOTAL drops under cleanTargetTotal.
    for (let i = 0; i < 40 && game.state() === 'playing'; i++) svc.frame(0.5);
    selectTool(svc, 'brush');
    for (let i = 0; i < 40 && game.state() === 'playing'; i++) svc.frame(0.5);

    expect(game.state()).toBe('won');
  });

  it('the time limit dispatches lose when the tank is still dirty', () => {
    const { world, playerEid } = makeWorld(
      { x: 100, y: 100, z: 100 }, // out of reach → never cleans
      { x: 1900, y: 0, z: 300 },
    );
    goLive();
    svc.start(world, playerEid, PARAMS); // timeLimitSec = 5
    game.tick(5); // elapsed >= limit while still dirty

    svc.frame(1 / 60);
    expect(game.state()).toBe('lost');
  });

  it('does nothing while the run is NOT live (objective freezes the scrub)', () => {
    const { world, playerEid, rockEid } = makeWorld(
      { x: 1500, y: 50, z: 300 },
      { x: 1500, y: 0, z: 300 },
    );
    game.startGame('cleaner'); // objective — NOT live (no `start`)
    svc.start(world, playerEid, PARAMS);
    selectTool(svc, 'scraper');
    holdUse(true);

    const before = world.getAlgaeByType(rockEid)!;
    expect(svc.frame(0.5)).toBe(0);
    expect(world.getAlgaeByType(rockEid)!['green-spot']).toBe(before['green-spot']);
  });
});

describe('CleanerGameService — determinism boundary (no game / no player)', () => {
  it('a world with no cleaner rules running keeps every algae stock (no rasp)', () => {
    const world = createLivestockWorld(0x9eed, { tankAabb: { ...TANK } });
    world.registerHardscape([
      { position: { x: 1000, y: 0, z: 300 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    const rockEid = world.getHardscapeEntities()[0]!.eid;
    const before = world.getAlgaeByType(rockEid)!['green-spot'];
    // No player, no cleaner service started → no rasp loop touches the slabs.
    // (Sim ticks may grow algae via the growth model, but nothing REMOVES it.)
    for (let i = 0; i < 30; i++) world.step(1 / 30);
    expect(world.getAlgaeByType(rockEid)!['green-spot']).toBeGreaterThanOrEqual(before);
  });
});
