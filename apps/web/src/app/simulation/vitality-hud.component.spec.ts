// Stage 14 F14.3 — VitalityHudComponent tests.
//
// The HUD is a read-only consumer of the `WorldSnapshot.health`/`.hunger`
// slabs + `world.getPlayerEntity()`, so a fake world that returns a hand-built
// snapshot covers the full surface — no bitECS pipeline needed (mirrors the
// behavior-debug overlay's test strategy). We drive the ~12 Hz poll via fake
// timers and assert: hidden until a live world has fish, school aggregates
// render, the selectable list renders, and clicking a row fills the inspector
// (the click-to-inspect path — a selectable list, not a canvas raycast, since
// 3D hitTest is null). Keyboard + ARIA are asserted on the row buttons.

import { TestBed } from '@angular/core/testing';

import {
  FISH_ARCHETYPE,
  NO_ENTITY_REF,
  type LivestockWorld,
  type WorldSnapshot,
} from '@aquascape/domain/livestock-ecs';

import { LivestockSimulationService } from '../livestock-simulation.service';
import { VitalityHudComponent } from './vitality-hud.component';

/** Build a minimal `WorldSnapshot` carrying the slabs the HUD reads. */
function buildSnapshot(
  health: number[],
  hunger: number[],
  archetypes: number[] = [],
): WorldSnapshot {
  const count = health.length;
  const ids = new Uint32Array(count);
  const arch = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    ids[i] = i + 1; // eids 1..count
    arch[i] = archetypes[i] ?? FISH_ARCHETYPE.SLIM_TETRA;
  }
  return {
    entityCount: count,
    ids,
    position: new Float32Array(count * 3),
    orientation: new Float32Array(count * 4),
    phase: new Float32Array(count),
    archetype: arch,
    scale: new Float32Array(count),
    health: Float32Array.from(health),
    hunger: Float32Array.from(hunger),
    color: new Float32Array(count * 3),
    foodSpriteCount: 0,
    foodSpritePosition: new Float32Array(0),
    foodSpriteType: new Uint8Array(0),
    bubbleCount: 0,
    bubblePosition: new Float32Array(0),
  };
}

/** A fake world exposing only what the HUD calls: `snapshot()` +
 *  `getPlayerEntity()`. */
function fakeWorld(snapshot: WorldSnapshot, playerEid = NO_ENTITY_REF): LivestockWorld {
  return {
    snapshot: () => snapshot,
    getPlayerEntity: () => playerEid,
  } as unknown as LivestockWorld;
}

/** Fake simulation service that hands back a fixed (or null) world. */
function fakeSim(world: LivestockWorld | null): Partial<LivestockSimulationService> {
  return { getWorld: () => world };
}

function setup(world: LivestockWorld | null) {
  TestBed.configureTestingModule({
    imports: [VitalityHudComponent],
    providers: [{ provide: LivestockSimulationService, useValue: fakeSim(world) }],
  });
  const fixture = TestBed.createComponent(VitalityHudComponent);
  fixture.detectChanges();
  return fixture;
}

describe('VitalityHudComponent', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('stays hidden when no world is live', () => {
    const fixture = setup(null);
    jest.advanceTimersByTime(100);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.vit')).toBeNull();
    fixture.destroy();
  });

  it('stays hidden when the world has no fish', () => {
    const fixture = setup(fakeWorld(buildSnapshot([], [])));
    jest.advanceTimersByTime(100);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.vit')).toBeNull();
    fixture.destroy();
  });

  it('renders the school aggregates from the snapshot slabs', () => {
    const fixture = setup(
      fakeWorld(buildSnapshot([1.0, 0.5, 0.2, 0.8], [0.0, 0.75, 0.9, 0.1])),
    );
    jest.advanceTimersByTime(100);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.vit')).not.toBeNull();
    const stats = [...root.querySelectorAll('.vit__stat dd')].map((d) => d.textContent?.trim());
    // avg = (1 + 0.5 + 0.2 + 0.8)/4 = 0.625 → 63%; min = 0.2 → 20%;
    // hungry = 2/4 (hunger 0.75, 0.9) → 50%.
    expect(stats).toEqual(['63%', '20%', '50%']);
    fixture.destroy();
  });

  it('lists every fish with an accessible row label', () => {
    const fixture = setup(
      fakeWorld(buildSnapshot([1.0, 0.3], [0.0, 0.8], [FISH_ARCHETYPE.SLIM_TETRA, FISH_ARCHETYPE.CORY_CYLINDER])),
    );
    jest.advanceTimersByTime(100);
    fixture.detectChanges();

    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.vit__row')];
    expect(rows.length).toBe(2);
    // Keyboard-operable: rows are <button> elements with role=option.
    expect(rows[0]!.tagName).toBe('BUTTON');
    expect(rows[0]!.getAttribute('role')).toBe('option');
    expect(rows[0]!.getAttribute('aria-label')).toContain('Fish 1');
    expect(rows[1]!.getAttribute('aria-label')).toContain('cory');
    expect(rows[1]!.getAttribute('aria-label')).toContain('hungry');
    fixture.destroy();
  });

  it('fills the inspector with the picked fish hearts + hunger on click', () => {
    const fixture = setup(fakeWorld(buildSnapshot([0.5], [0.8])));
    jest.advanceTimersByTime(100);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    // Before selection the inspector shows the empty prompt.
    expect(root.querySelector('.vit__insp-empty')).not.toBeNull();

    (root.querySelector('.vit__row') as HTMLButtonElement).click();
    fixture.detectChanges();

    // 0.5 health → 5 hearts, 2 full + 1 half + 2 empty.
    const hearts = [...root.querySelectorAll('.vit__heart')];
    expect(hearts.length).toBe(5);
    expect(hearts.filter((h) => h.classList.contains('vit__heart--full')).length).toBe(2);
    expect(hearts.filter((h) => h.classList.contains('vit__heart--half')).length).toBe(1);
    // ARIA: the hearts row is labelled with the health percent for SR users.
    expect(root.querySelector('.vit__hearts')?.getAttribute('aria-label')).toBe(
      'Health 50 percent',
    );
    // hunger 0.8 ≥ threshold → "hungry".
    expect(root.querySelector('.vit__meter-val')?.textContent?.trim()).toBe('hungry');
    // The selected row is marked aria-selected.
    expect(root.querySelector('.vit__row')?.getAttribute('aria-selected')).toBe('true');
    fixture.destroy();
  });

  it('labels the marked player fish as "You" in the inspector', () => {
    const fixture = setup(fakeWorld(buildSnapshot([1.0], [0.0]), /* playerEid */ 1));
    jest.advanceTimersByTime(100);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    // The player row shows a star marker.
    expect(root.querySelector('.vit__row-id')?.textContent?.trim()).toBe('★');
    (root.querySelector('.vit__row') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.querySelector('.vit__insp-title')?.textContent).toContain('You');
    fixture.destroy();
  });

  it('updates the inspector live as the picked fish health changes', () => {
    const snap = buildSnapshot([1.0], [0.0]);
    const fixture = setup(fakeWorld(snap));
    jest.advanceTimersByTime(100);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.vit__row') as HTMLButtonElement).click();
    fixture.detectChanges();

    let hearts = [...fixture.nativeElement.querySelectorAll('.vit__heart--full')];
    expect(hearts.length).toBe(5);

    // Sim ticks: the fish's health drops. The poll re-reads the live slab.
    snap.health[0] = 0.0;
    jest.advanceTimersByTime(100);
    fixture.detectChanges();
    hearts = [...fixture.nativeElement.querySelectorAll('.vit__heart--full')];
    expect(hearts.length).toBe(0);
    fixture.destroy();
  });

  it('tears down its poll interval on destroy', () => {
    const clearSpy = jest.spyOn(globalThis, 'clearInterval');
    const fixture = setup(fakeWorld(buildSnapshot([1], [0])));
    fixture.destroy();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
