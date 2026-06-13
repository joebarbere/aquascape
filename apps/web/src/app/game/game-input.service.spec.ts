// Integration tests for GameInputService (Stage 16 F16.1b).
//
// Drives the REAL input pipeline end-to-end — a synthetic `keydown` →
// `keysToIntent` → `GameModeService.playerVelocity` (which runs the pure
// `intentToVelocity`) → the velocity sink → a REAL livestock-ecs world's
// `setPlayerVelocity`. After one `world.step()` the marked player has MOVED,
// proving the seam is wired (the DoD's "synthetic key maps to a non-zero
// player velocity through the real pipeline").
//
// We don't rely on a real rAF — `GameInputService.step(nowMs)` does exactly
// what the rAF body does (minus rescheduling), so the test drives frames
// deterministically.

import { TestBed } from '@angular/core/testing';

import { GameModeService } from '@aquascape/features/game';
import {
  FISH_ARCHETYPE,
  createLivestockWorld,
  type LivestockWorld,
  type TankAabb,
} from '@aquascape/domain/livestock-ecs';

import { GameInputService } from './game-input.service';
import { pickPlayerEntity, readEntityPosition } from './game-activation';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

function makeWorld(): { world: LivestockWorld; playerEid: number } {
  const world = createLivestockWorld(0xfa11, { tankAabb: { ...TANK } });
  world.spawnFish({
    archetype: FISH_ARCHETYPE.SLIM_TETRA,
    speciesId: 1,
    bodyLengthMm: 30,
    position: { x: 500, y: 200, z: 200 },
  });
  const playerEid = pickPlayerEntity(world);
  world.setPlayer(playerEid);
  return { world, playerEid };
}

describe('GameInputService', () => {
  let svc: GameInputService;
  let game: GameModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(GameInputService);
    game = TestBed.inject(GameModeService);
  });

  afterEach(() => {
    svc.stop();
  });

  it('a held movement key produces a non-zero player velocity while live', () => {
    let captured: { x: number; y: number; z: number } | null = null;
    game.startGame('predator');
    game.dispatch({ type: 'start' }); // → playing (live)
    svc.start((x, y, z) => {
      captured = { x, y, z };
    });

    // Synthetic keydown — KeyD = strafe +x (DEFAULT_KEY_BINDINGS).
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(svc.heldCodesForTest().has('KeyD')).toBe(true);

    svc.step(16);

    expect(captured).not.toBeNull();
    // predator player speed is 260 mm/s; pure x strafe.
    expect(captured!.x).toBeGreaterThan(0);
    expect(captured!.y).toBe(0);
    expect(captured!.z).toBe(0);
  });

  it('releases the key → velocity returns to zero', () => {
    let captured: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
    game.startGame('predator');
    game.dispatch({ type: 'start' });
    svc.start((x, y, z) => {
      captured = { x, y, z };
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    svc.step(16);
    expect(captured.x).toBeGreaterThan(0);

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
    svc.step(32);
    expect(captured).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('freezes the player (zero velocity) when the run is NOT live', () => {
    let captured: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 };
    game.startGame('predator'); // → objective (not live; no `start`)
    svc.start((x, y, z) => {
      captured = { x, y, z };
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    svc.step(16);
    expect(captured).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('moves a real marked player through one world.step() (full seam)', () => {
    const { world, playerEid } = makeWorld();
    const before = readEntityPosition(world, playerEid)!;

    game.startGame('predator');
    game.dispatch({ type: 'start' });
    svc.start((x, y, z) => world.setPlayerVelocity(x, y, z));

    // Hold +x, push one frame to inject the velocity, then step the sim.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    svc.step(16);
    world.step(1 / 30);

    const after = readEntityPosition(world, playerEid)!;
    // The player integrated the injected +x velocity → moved right.
    expect(after.x).toBeGreaterThan(before.x);
  });

  it('clears held keys on window blur (no phantom held key)', () => {
    game.startGame('predator');
    game.dispatch({ type: 'start' });
    svc.start(() => undefined);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(svc.heldCodesForTest().has('KeyD')).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(svc.heldCodesForTest().has('KeyD')).toBe(false);
  });

  it('stop() detaches listeners — later keydowns are ignored', () => {
    game.startGame('predator');
    game.dispatch({ type: 'start' });
    svc.start(() => undefined);
    svc.stop();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    expect(svc.heldCodesForTest().has('KeyD')).toBe(false);
  });
});
