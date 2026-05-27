// Tests for BehaviorDebugOverlayComponent — Stage 11 F11.6 Wave 4.
//
// Scope:
//   - Hidden by default even in dev mode (the chord/flag is off).
//   - Hidden when the toggle is on but the view is 2D.
//   - Hidden when 3D + toggle on but no world has been built (no livestock).
//   - Visible when every gate passes (dev mode + toggle on + 3D + world).
//   - Renders one row per fish, capped at MAX_ROWS with a "+N more" tail.
//   - Tears down its setInterval on destroy.
//
// We mock `LivestockSimulationService.getWorld()` directly rather than
// wiring the full bitECS pipeline through provideMockStore — the overlay
// is purely a read-only consumer of the world's `snapshot(0)` +
// `getEntityTerritoryAnchor`, so a fake world that returns those two
// shapes covers the surface.

import { TestBed } from '@angular/core/testing';

import {
  Archetype,
  BehaviorMode,
  BEHAVIOR_MODE,
  FISH_ARCHETYPE,
  FearState,
  NO_ENTITY_REF,
  type LivestockWorld,
  type WorldSnapshot,
} from '@aquascape/domain/livestock-ecs';
import { ViewModeService } from '@aquascape/features/editor-shell';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import { createWebPlatform } from '@aquascape/platform/platform-web';

import { BehaviorDebugOverlayComponent } from './behavior-debug-overlay.component';
import { BehaviorDebugService } from './behavior-debug.service';
import { LivestockSimulationService } from './livestock-simulation.service';

// ── Fake world ───────────────────────────────────────────────────────────

/** Build a `WorldSnapshot` with `count` fish (ids 1..count) and stamp the
 *  bitECS slabs so the overlay's per-entity reads (`BehaviorMode.mode[eid]`,
 *  `Archetype.id[eid]`, `FearState.refugeEid[eid]`) return the values we set. */
function buildSnapshot(count: number, bubbles = 0): WorldSnapshot {
  const ids = new Uint32Array(count);
  for (let i = 0; i < count; i++) ids[i] = i + 1;
  return {
    entityCount: count,
    ids,
    position: new Float32Array(count * 3),
    orientation: new Float32Array(count * 4),
    phase: new Float32Array(count),
    archetype: new Uint8Array(count),
    scale: new Float32Array(count),
    foodSpriteCount: 0,
    foodSpritePosition: new Float32Array(0),
    bubbleCount: bubbles,
    bubblePosition: new Float32Array(bubbles * 3),
  };
}

/** Stamp the bitECS slabs that the overlay reads directly. */
function stampEntity(
  eid: number,
  opts: { mode?: number; archetype?: number; refuge?: number },
): void {
  if (opts.mode !== undefined) BehaviorMode.mode[eid] = opts.mode;
  if (opts.archetype !== undefined) Archetype.id[eid] = opts.archetype;
  if (opts.refuge !== undefined) FearState.refugeEid[eid] = opts.refuge;
  else if (FearState.refugeEid[eid] === undefined) {
    // Default: no refuge (sentinel). Keeps existing tests' assumptions
    // stable when an earlier test left a slot dirty.
    FearState.refugeEid[eid] = NO_ENTITY_REF;
  }
}

/** Minimal fake world — only the surfaces the overlay reads. Other fields
 *  are typed as `unknown as` placeholders since the overlay never touches
 *  them. */
function makeFakeWorld(snapshot: WorldSnapshot, anchorByEid: Map<number, number | null> = new Map()):
  LivestockWorld {
  const w: Partial<LivestockWorld> = {
    snapshot: () => snapshot,
    getEntityTerritoryAnchor: (eid: number) => anchorByEid.get(eid) ?? null,
  };
  return w as LivestockWorld;
}

/** Stub for LivestockSimulationService — returns the fake world (or null). */
class FakeLivestockSim {
  private world: LivestockWorld | null = null;
  setWorld(w: LivestockWorld | null): void {
    this.world = w;
  }
  getWorld(): LivestockWorld | null {
    return this.world;
  }
}

// ── Fixture helper ───────────────────────────────────────────────────────

function configure(
  opts: { world?: LivestockWorld | null; viewMode?: '2d' | '3d'; toggled?: boolean } = {},
) {
  const sim = new FakeLivestockSim();
  sim.setWorld(opts.world ?? null);
  // ViewModeService injects STORAGE_SERVICE for persistence; the in-memory
  // web platform is the lightest fake that satisfies it without leaking
  // jsdom side-effects across tests.
  const platform = createWebPlatform();
  TestBed.configureTestingModule({
    imports: [BehaviorDebugOverlayComponent],
    providers: [
      { provide: LivestockSimulationService, useValue: sim },
      { provide: STORAGE_SERVICE, useValue: platform.storageService },
    ],
  });
  const fixture = TestBed.createComponent(BehaviorDebugOverlayComponent);
  const debug = TestBed.inject(BehaviorDebugService);
  const viewMode = TestBed.inject(ViewModeService);
  if (opts.viewMode === '3d') viewMode.setMode('3d');
  if (opts.toggled === true) debug.setEnabled(true);
  fixture.detectChanges();
  return { fixture, sim, debug, viewMode };
}

function panelEl(fixture: ReturnType<typeof configure>['fixture']): HTMLElement | null {
  return fixture.nativeElement.querySelector('.behavior-debug') as HTMLElement | null;
}

// ── Specs ────────────────────────────────────────────────────────────────

describe('BehaviorDebugOverlayComponent', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  describe('visibility gates', () => {
    it('is HIDDEN by default (toggle off) even with a live world in 3D', () => {
      const snap = buildSnapshot(3);
      const world = makeFakeWorld(snap);
      const { fixture } = configure({ world, viewMode: '3d', toggled: false });
      // Run the first interval tick so the snapshot signal would fire if
      // not gated by `debug.enabled()`.
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      expect(panelEl(fixture)).toBeNull();
    });

    it('is HIDDEN in 2D mode even with the toggle on', () => {
      const snap = buildSnapshot(3);
      const world = makeFakeWorld(snap);
      const { fixture } = configure({ world, viewMode: '2d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      expect(panelEl(fixture)).toBeNull();
    });

    it('is HIDDEN when 3D + toggle on but no world has been built', () => {
      const { fixture } = configure({ world: null, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      expect(panelEl(fixture)).toBeNull();
    });

    it('is HIDDEN when world exists but reports 0 entities (empty livestock)', () => {
      const snap = buildSnapshot(0);
      const world = makeFakeWorld(snap);
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      expect(panelEl(fixture)).toBeNull();
    });

    it('is VISIBLE when every gate passes (dev + toggle + 3D + live world with fish)', () => {
      const snap = buildSnapshot(2);
      stampEntity(1, { mode: BEHAVIOR_MODE.FORAGE, archetype: FISH_ARCHETYPE.SLIM_TETRA });
      stampEntity(2, { mode: BEHAVIOR_MODE.REFUGE, archetype: FISH_ARCHETYPE.BARB });
      const world = makeFakeWorld(snap);
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      const panel = panelEl(fixture);
      expect(panel).not.toBeNull();
      expect(panel!.textContent).toContain('F11 Behavior Debug');
      expect(panel!.textContent).toContain('2 fish');
    });
  });

  describe('rendered rows', () => {
    it('renders one row per fish with archetype + mode + refuge decoration', () => {
      const snap = buildSnapshot(3);
      stampEntity(1, {
        mode: BEHAVIOR_MODE.FORAGE,
        archetype: FISH_ARCHETYPE.SLIM_TETRA,
        refuge: NO_ENTITY_REF,
      });
      stampEntity(2, {
        mode: BEHAVIOR_MODE.REFUGE,
        archetype: FISH_ARCHETYPE.BARB,
        // refuge eid 99 — must surface in the row text as `refuge=#99`.
        refuge: 99,
      });
      stampEntity(3, {
        mode: BEHAVIOR_MODE.PURSUE,
        archetype: FISH_ARCHETYPE.CORY_CYLINDER,
        refuge: NO_ENTITY_REF,
      });
      const world = makeFakeWorld(snap);
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      const rows = fixture.nativeElement.querySelectorAll(
        '.behavior-debug__row',
      ) as NodeListOf<HTMLElement>;
      expect(rows.length).toBe(3);
      expect(rows[0]!.textContent).toContain('#1');
      expect(rows[0]!.textContent).toContain('slim-tetra');
      expect(rows[0]!.textContent).toContain('FORAGE');
      expect(rows[1]!.textContent).toContain('REFUGE');
      expect(rows[1]!.textContent).toContain('refuge=#99');
      expect(rows[2]!.textContent).toContain('PURSUE');
      expect(rows[2]!.textContent).toContain('cory-cylinder');
    });

    it('decorates the row with the territory anchor when getEntityTerritoryAnchor returns one', () => {
      const snap = buildSnapshot(1);
      stampEntity(1, {
        mode: BEHAVIOR_MODE.FORAGE,
        archetype: FISH_ARCHETYPE.DEEP_BODIED,
        refuge: NO_ENTITY_REF,
      });
      const world = makeFakeWorld(snap, new Map([[1, 77]]));
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      const row = fixture.nativeElement.querySelector(
        '.behavior-debug__row',
      ) as HTMLElement;
      expect(row.textContent).toContain('anchor=#77');
    });

    it('caps row rendering at 10 + shows "+N more" tail for larger schools', () => {
      const total = 25;
      const snap = buildSnapshot(total);
      for (let eid = 1; eid <= total; eid++) {
        stampEntity(eid, {
          mode: BEHAVIOR_MODE.FORAGE,
          archetype: FISH_ARCHETYPE.SLIM_TETRA,
          refuge: NO_ENTITY_REF,
        });
      }
      const world = makeFakeWorld(snap);
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      const rows = fixture.nativeElement.querySelectorAll(
        '.behavior-debug__row',
      ) as NodeListOf<HTMLElement>;
      expect(rows.length).toBe(10);
      const tail = fixture.nativeElement.querySelector(
        '.behavior-debug__more',
      ) as HTMLElement | null;
      expect(tail).not.toBeNull();
      expect(tail!.textContent).toContain('+15 more');
    });
  });

  describe('teardown', () => {
    it('clears the polling interval on destroy (no further world reads)', () => {
      const snap = buildSnapshot(1);
      stampEntity(1, {
        mode: BEHAVIOR_MODE.FORAGE,
        archetype: FISH_ARCHETYPE.SLIM_TETRA,
      });
      const world = makeFakeWorld(snap);
      const { fixture, sim } = configure({ world, viewMode: '3d', toggled: true });
      // After init, the component-owned interval is scheduled. We can't
      // count it precisely (NgZone schedules its own timers under jsdom,
      // which inflates `getTimerCount()`), so we instead spy on the
      // sim's `getWorld` and assert it stops being called after destroy.
      const getWorldSpy = jest.spyOn(sim, 'getWorld');
      jest.advanceTimersByTime(70);
      const callsBeforeDestroy = getWorldSpy.mock.calls.length;
      expect(callsBeforeDestroy).toBeGreaterThan(0);
      fixture.destroy();
      // Advance well past several refresh intervals — the destroyed
      // component must not poll any more.
      jest.advanceTimersByTime(500);
      expect(getWorldSpy.mock.calls.length).toBe(callsBeforeDestroy);
    });
  });

  describe('refresh polling', () => {
    it('re-reads the world on every interval tick so freshly-mutated state surfaces', () => {
      const snap = buildSnapshot(1);
      stampEntity(1, {
        mode: BEHAVIOR_MODE.FORAGE,
        archetype: FISH_ARCHETYPE.SLIM_TETRA,
        refuge: NO_ENTITY_REF,
      });
      const world = makeFakeWorld(snap);
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      let row = fixture.nativeElement.querySelector(
        '.behavior-debug__row',
      ) as HTMLElement;
      expect(row.textContent).toContain('FORAGE');

      // Flip the mode out-of-band (FearSystem would normally do this).
      stampEntity(1, { mode: BEHAVIOR_MODE.REFUGE });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      row = fixture.nativeElement.querySelector(
        '.behavior-debug__row',
      ) as HTMLElement;
      expect(row.textContent).toContain('REFUGE');
    });
  });
});
