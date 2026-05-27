// Tests for BehaviorDebugOverlayComponent — Stage 11 F11.6 Wave 4 +
// F11.7 livestock-movement triage follow-up (richer per-entity state,
// world stats strip, recent mode-transition events).
//
// Scope:
//   - Hidden by default even in dev mode (the chord/flag is off).
//   - Hidden when the toggle is on but the view is 2D.
//   - Hidden when 3D + toggle on but no world has been built (no livestock).
//   - Visible when every gate passes (dev mode + toggle on + 3D + world).
//   - Renders two display lines per fish (pose+motion / drives+hit-tests).
//   - Cap at MAX_ROWS = 8 + "+N more" tail for larger schools.
//   - Counts strip surfaces mode distribution + bubble/sprite/hardscape/flow/sdf state.
//   - Per-fish line 1 shows mode, speed, yaw°, pit°, cad Hz.
//   - Per-fish line 2 shows hunger, fear risk, territory fatigue,
//     nipping cooldown, SDF distance, wall distance, optional decorations.
//   - Mode transitions across consecutive polls surface in the recent-events tail.
//   - Tears down its setInterval on destroy.
//
// We mock `LivestockSimulationService.getWorld()` directly rather than
// wiring the full bitECS pipeline through provideMockStore — the overlay
// is a read-only consumer of the world API + the bitECS slabs, so a fake
// world that returns the needed shapes covers the surface.

import { TestBed } from '@angular/core/testing';

import {
  AnimationPhase,
  Archetype,
  BehaviorMode,
  BEHAVIOR_MODE,
  BodyLength,
  Curiosity,
  FeedingDrive,
  FearState,
  FISH_ARCHETYPE,
  NippingDrive,
  NO_ENTITY_REF,
  NO_INTEREST,
  Orientation,
  Position,
  Territory,
  Velocity,
  type LivestockWorld,
  type WorldSnapshot,
  type TankAabb,
} from '@aquascape/domain/livestock-ecs';
import { ViewModeService } from '@aquascape/features/editor-shell';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import { createWebPlatform } from '@aquascape/platform/platform-web';

import {
  BehaviorDebugOverlayComponent,
  quatToYawPitchDeg,
} from './behavior-debug-overlay.component';
import { BehaviorDebugService } from './behavior-debug.service';
import { LivestockSimulationService } from './livestock-simulation.service';

// ── Fake world ───────────────────────────────────────────────────────────

const DEFAULT_TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

/** Build a `WorldSnapshot` with `count` fish (ids 1..count) and stamp the
 *  bitECS slabs so the overlay's per-entity reads return values we set. */
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

interface StampOpts {
  mode?: number;
  archetype?: number;
  refuge?: number;
  // Motion + pose
  vx?: number;
  vy?: number;
  vz?: number;
  qx?: number;
  qy?: number;
  qz?: number;
  qw?: number;
  // Position + body
  px?: number;
  py?: number;
  pz?: number;
  bodyLengthMm?: number;
  // Animation
  cadenceHz?: number;
  // Drives
  hunger?: number;
  risk?: number;
  fatigue?: number;
  cooldownSec?: number;
  // Curiosity
  interestX?: number;
  dwellRemaining?: number;
  // Territory anchor (read via getEntityTerritoryAnchor, not a slab)
}

/** Stamp the bitECS slabs that the overlay reads directly. Anything
 *  unspecified falls back to a sensible default so tests aren't tripped
 *  up by stale per-eid state from a prior fixture. */
function stampEntity(eid: number, opts: StampOpts): void {
  BehaviorMode.mode[eid] = opts.mode ?? BEHAVIOR_MODE.FORAGE;
  Archetype.id[eid] = opts.archetype ?? FISH_ARCHETYPE.SLIM_TETRA;
  FearState.refugeEid[eid] = opts.refuge ?? NO_ENTITY_REF;
  Velocity.x[eid] = opts.vx ?? 0;
  Velocity.y[eid] = opts.vy ?? 0;
  Velocity.z[eid] = opts.vz ?? 0;
  Orientation.x[eid] = opts.qx ?? 0;
  Orientation.y[eid] = opts.qy ?? 0;
  Orientation.z[eid] = opts.qz ?? 0;
  Orientation.w[eid] = opts.qw ?? 1;
  Position.x[eid] = opts.px ?? 500;
  Position.y[eid] = opts.py ?? 200;
  Position.z[eid] = opts.pz ?? 200;
  BodyLength.mm[eid] = opts.bodyLengthMm ?? 30;
  AnimationPhase.freq[eid] = opts.cadenceHz ?? 4;
  FeedingDrive.hunger[eid] = opts.hunger ?? 0;
  FearState.risk[eid] = opts.risk ?? 0;
  Territory.fatigue[eid] = opts.fatigue ?? 0;
  NippingDrive.cooldownSec[eid] = opts.cooldownSec ?? 0;
  Curiosity.interestX[eid] = opts.interestX ?? NO_INTEREST;
  Curiosity.dwellRemaining[eid] = opts.dwellRemaining ?? 0;
}

interface FakeWorldOpts {
  snapshot: WorldSnapshot;
  anchorByEid?: Map<number, number | null>;
  foodSpriteCount?: number;
  hardscapeCount?: number;
  hasFlowField?: boolean;
  hasSdf?: boolean;
  tickCounter?: number;
  tankAabb?: TankAabb;
}

/** Minimal fake world — only the surfaces the overlay reads. */
function makeFakeWorld(opts: FakeWorldOpts): LivestockWorld {
  const anchors = opts.anchorByEid ?? new Map<number, number | null>();
  const w: Partial<LivestockWorld> = {
    snapshot: () => opts.snapshot,
    getEntityTerritoryAnchor: (eid: number) => anchors.get(eid) ?? null,
    getFoodSpriteCount: () => opts.foodSpriteCount ?? 0,
    getHardscapeCount: () => opts.hardscapeCount ?? 0,
    getBubbleParticleCount: () => opts.snapshot.bubbleCount,
    getFlowField: () => (opts.hasFlowField ? ({} as unknown as never) : null),
    getHardscapeSdf: () => (opts.hasSdf ? null : null), // tests don't need a real SDF — null suppresses SDF rows
    tickCounter: opts.tickCounter ?? 0,
    tankAabb: opts.tankAabb ?? DEFAULT_TANK,
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
function primaryRows(fixture: ReturnType<typeof configure>['fixture']): NodeListOf<HTMLElement> {
  return fixture.nativeElement.querySelectorAll(
    '.behavior-debug__row--primary',
  ) as NodeListOf<HTMLElement>;
}
function detailRows(fixture: ReturnType<typeof configure>['fixture']): NodeListOf<HTMLElement> {
  return fixture.nativeElement.querySelectorAll(
    '.behavior-debug__row--detail',
  ) as NodeListOf<HTMLElement>;
}
function panelText(fixture: ReturnType<typeof configure>['fixture']): string {
  return panelEl(fixture)?.textContent ?? '';
}
function eventRows(fixture: ReturnType<typeof configure>['fixture']): NodeListOf<HTMLElement> {
  return fixture.nativeElement.querySelectorAll(
    '.behavior-debug__event',
  ) as NodeListOf<HTMLElement>;
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
      const world = makeFakeWorld({ snapshot: snap });
      const { fixture } = configure({ world, viewMode: '3d', toggled: false });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      expect(panelEl(fixture)).toBeNull();
    });

    it('is HIDDEN in 2D mode even with the toggle on', () => {
      const snap = buildSnapshot(3);
      const world = makeFakeWorld({ snapshot: snap });
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
      const world = makeFakeWorld({ snapshot: snap });
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      expect(panelEl(fixture)).toBeNull();
    });

    it('is VISIBLE when every gate passes; header shows tick + view, counts strip shows totals', () => {
      const snap = buildSnapshot(2, 7);
      stampEntity(1, { mode: BEHAVIOR_MODE.FORAGE });
      stampEntity(2, { mode: BEHAVIOR_MODE.REFUGE });
      const world = makeFakeWorld({
        snapshot: snap,
        tickCounter: 1234,
        foodSpriteCount: 3,
        hardscapeCount: 4,
        hasFlowField: true,
      });
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      const text = panelText(fixture);
      expect(text).toContain('F11 Behavior Debug');
      expect(text).toContain('tick 1234');
      expect(text).toContain('view 3D');
      expect(text).toContain('2 fish');
      expect(text).toContain('7 bubbles');
      expect(text).toContain('3 sprites');
      expect(text).toContain('4 hs');
      expect(text).toContain('FOR:1 REF:1 PUR:0');
      expect(text).toContain('flow:Y');
      expect(text).toContain('sdf:N');
    });
  });

  describe('per-fish rows — pose + motion (line 1)', () => {
    it('shows mode, archetype, speed, yaw, pitch, and cadence on the primary row', () => {
      const snap = buildSnapshot(1);
      stampEntity(1, {
        mode: BEHAVIOR_MODE.FORAGE,
        archetype: FISH_ARCHETYPE.SLIM_TETRA,
        // Velocity 50 mm/s straight along +X.
        vx: 50,
        vy: 0,
        vz: 0,
        // Identity quaternion → nose (local -X) faces world -X → yaw = 180°.
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        cadenceHz: 4.5,
      });
      const world = makeFakeWorld({ snapshot: snap });
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      const row = primaryRows(fixture)[0]!;
      const t = row.textContent!;
      expect(t).toContain('#1');
      expect(t).toContain('slim-tetra');
      expect(t).toContain('FORAGE');
      expect(t).toContain('v=50mm/s');
      // Identity quat → forward = (-1, 0, 0) → atan2(0, -1) = π → 180°.
      // padSigned places the sign FIRST, then pads internally to column
      // width — so yaw width=4 with body "180" prints "+180" (no internal
      // pad), pitch width=3 with body "0" prints "+ 0" (one internal pad).
      expect(t).toContain('yaw=+180°');
      expect(t).toContain('pit=+ 0°');
      expect(t).toContain('cad=4.5Hz');
    });

    it('pads the yaw column so single- and three-digit values line up', () => {
      const snap = buildSnapshot(1);
      // Quaternion for a 90° rotation about Y. The actual yaw under our
      // convention works out to a value whose absolute round = 90; the
      // formatter prints `+ 90` (sign, internal pad, 90).
      const yaw90 = Math.PI / 2;
      const qy = Math.sin(yaw90 / 2);
      const qw = Math.cos(yaw90 / 2);
      const { yawDeg } = quatToYawPitchDeg(0, qy, 0, qw);
      expect(Math.abs(Math.round(yawDeg))).toBe(90);
      stampEntity(1, { qx: 0, qy, qz: 0, qw });
      const world = makeFakeWorld({ snapshot: snap });
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      const t = primaryRows(fixture)[0]!.textContent!;
      // sign + space + body = 4 chars total — matches the identity-quat row
      // above (which prints "yaw=+180°" with the body filling all three
      // body slots).
      const sign = yawDeg >= 0 ? '+' : '-';
      expect(t).toContain(`yaw=${sign} 90°`);
    });
  });

  describe('per-fish rows — drives + hit-tests (line 2)', () => {
    it('shows hunger, fear risk, territory fatigue, nipping cooldown, sdf=-, wall distance', () => {
      const snap = buildSnapshot(1);
      stampEntity(1, {
        hunger: 0.45,
        risk: 0.12,
        fatigue: 0.31,
        cooldownSec: 1.2,
        px: 500,
        py: 200,
        pz: 200,
        bodyLengthMm: 40,
      });
      // Wall distance: min(500, 500, 200, 200, 200, 200) = 200 (Y faces).
      const world = makeFakeWorld({ snapshot: snap });
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      const t = detailRows(fixture)[0]!.textContent!;
      expect(t).toContain('hun=0.45');
      expect(t).toContain('fea=0.12');
      expect(t).toContain('fat=0.31');
      expect(t).toContain('cd=1.2s');
      expect(t).toContain('sdf=-'); // no SDF registered → dash
      expect(t).toContain('wall=200mm');
    });

    it('decorates with anchor, refuge, curiosity dwell, and body length when active', () => {
      const snap = buildSnapshot(1);
      stampEntity(1, {
        refuge: 77,
        interestX: 250,
        dwellRemaining: 2.4,
        bodyLengthMm: 30,
      });
      const world = makeFakeWorld({
        snapshot: snap,
        anchorByEid: new Map([[1, 42]]),
      });
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      const t = detailRows(fixture)[0]!.textContent!;
      expect(t).toContain('[an=#42 rf=#77 ci=2.4s bl=30mm]');
    });

    it('omits anchor + refuge + curiosity decorations when none are active (no noise on default fish)', () => {
      const snap = buildSnapshot(1);
      stampEntity(1, { bodyLengthMm: 30 });
      const world = makeFakeWorld({ snapshot: snap }); // no anchor map
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      const t = detailRows(fixture)[0]!.textContent!;
      expect(t).not.toContain('an=#');
      expect(t).not.toContain('rf=#');
      expect(t).not.toContain('ci=');
      // bodyLength still surfaces.
      expect(t).toContain('[bl=30mm]');
    });
  });

  describe('row cap + "+N more" tail', () => {
    it('caps row rendering at MAX_ROWS = 8 and shows the elided count', () => {
      const total = 20;
      const snap = buildSnapshot(total);
      for (let eid = 1; eid <= total; eid++) stampEntity(eid, {});
      const world = makeFakeWorld({ snapshot: snap });
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      expect(primaryRows(fixture).length).toBe(8);
      expect(detailRows(fixture).length).toBe(8);
      const tail = fixture.nativeElement.querySelector(
        '.behavior-debug__more',
      ) as HTMLElement | null;
      expect(tail).not.toBeNull();
      expect(tail!.textContent).toContain('+12 more');
    });
  });

  describe('recent mode-transition events', () => {
    it('surfaces transitions detected between consecutive polls', () => {
      const snap = buildSnapshot(2);
      stampEntity(1, { mode: BEHAVIOR_MODE.FORAGE });
      stampEntity(2, { mode: BEHAVIOR_MODE.FORAGE });
      const world = makeFakeWorld({ snapshot: snap });
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      // First poll seeds the prevModes map — no events yet.
      expect(eventRows(fixture).length).toBe(0);
      // Flip entity 1 to REFUGE.
      stampEntity(1, { mode: BEHAVIOR_MODE.REFUGE });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      const evs = eventRows(fixture);
      expect(evs.length).toBe(1);
      expect(evs[0]!.textContent).toContain('#1');
      expect(evs[0]!.textContent).toContain('FORAGE');
      expect(evs[0]!.textContent).toContain('REFUGE');
    });

    it('renders newest events first + caps the visible list at MAX_EVENTS_SHOWN = 5', () => {
      const snap = buildSnapshot(1);
      stampEntity(1, { mode: BEHAVIOR_MODE.FORAGE });
      const world = makeFakeWorld({ snapshot: snap });
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      // Seed.
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      // Alternate FORAGE ↔ REFUGE eight times to push past the 5-row cap.
      const modes = [
        BEHAVIOR_MODE.REFUGE,
        BEHAVIOR_MODE.FORAGE,
        BEHAVIOR_MODE.REFUGE,
        BEHAVIOR_MODE.FORAGE,
        BEHAVIOR_MODE.REFUGE,
        BEHAVIOR_MODE.FORAGE,
        BEHAVIOR_MODE.REFUGE,
        BEHAVIOR_MODE.FORAGE,
      ];
      for (const m of modes) {
        stampEntity(1, { mode: m });
        jest.advanceTimersByTime(70);
        fixture.detectChanges();
      }
      const evs = eventRows(fixture);
      expect(evs.length).toBe(5);
      // Most recent event is rendered FIRST. The last flip was REFUGE → FORAGE.
      const first = evs[0]!.textContent!;
      expect(first).toContain('REFUGE');
      expect(first).toContain('FORAGE');
    });

    it('clears recent events + prevModes when the world identity changes (avoids phantom burst)', () => {
      // Build the first world + run two polls to populate prevModes + emit
      // a transition event.
      const snap = buildSnapshot(1);
      stampEntity(1, { mode: BEHAVIOR_MODE.FORAGE });
      const world1 = makeFakeWorld({ snapshot: snap });
      const { fixture, sim } = configure({ world: world1, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      stampEntity(1, { mode: BEHAVIOR_MODE.REFUGE });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      expect(eventRows(fixture).length).toBe(1);
      // Swap to a brand-new world. The overlay must NOT report a phantom
      // "every fish flipped to FORAGE" event for the new world's first poll.
      const snap2 = buildSnapshot(1);
      stampEntity(1, { mode: BEHAVIOR_MODE.FORAGE });
      const world2 = makeFakeWorld({ snapshot: snap2 });
      sim.setWorld(world2);
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      expect(eventRows(fixture).length).toBe(0);
    });
  });

  describe('teardown', () => {
    it('clears the polling interval on destroy (no further world reads)', () => {
      const snap = buildSnapshot(1);
      stampEntity(1, {});
      const world = makeFakeWorld({ snapshot: snap });
      const { fixture, sim } = configure({ world, viewMode: '3d', toggled: true });
      const getWorldSpy = jest.spyOn(sim, 'getWorld');
      jest.advanceTimersByTime(70);
      const callsBeforeDestroy = getWorldSpy.mock.calls.length;
      expect(callsBeforeDestroy).toBeGreaterThan(0);
      fixture.destroy();
      jest.advanceTimersByTime(500);
      expect(getWorldSpy.mock.calls.length).toBe(callsBeforeDestroy);
    });
  });

  describe('refresh polling', () => {
    it('re-reads the world on every interval tick so freshly-mutated state surfaces', () => {
      const snap = buildSnapshot(1);
      stampEntity(1, { mode: BEHAVIOR_MODE.FORAGE });
      const world = makeFakeWorld({ snapshot: snap });
      const { fixture } = configure({ world, viewMode: '3d', toggled: true });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      expect(primaryRows(fixture)[0]!.textContent).toContain('FORAGE');
      stampEntity(1, { mode: BEHAVIOR_MODE.REFUGE });
      jest.advanceTimersByTime(70);
      fixture.detectChanges();
      expect(primaryRows(fixture)[0]!.textContent).toContain('REFUGE');
    });
  });
});

describe('quatToYawPitchDeg', () => {
  it('returns yaw 180° / pitch 0° for the identity quaternion (nose = world -X)', () => {
    const { yawDeg, pitchDeg } = quatToYawPitchDeg(0, 0, 0, 1);
    expect(Math.round(yawDeg)).toBe(180);
    expect(Math.round(pitchDeg)).toBe(0);
  });

  it('returns yaw 0° for a 180° Y-axis rotation (nose flipped to world +X)', () => {
    // q = (0, sin(π/2), 0, cos(π/2)) = (0, 1, 0, 0).
    const { yawDeg, pitchDeg } = quatToYawPitchDeg(0, 1, 0, 0);
    expect(Math.abs(Math.round(yawDeg))).toBe(0);
    expect(Math.round(pitchDeg)).toBe(0);
  });

  it('returns positive pitch (nose-up) for a quaternion that rotates local -X upward', () => {
    // Local -X tilted upward by 90° requires a rotation about -Z (right-hand
    // rule: rotating (-1, 0, 0) toward (0, +1, 0) is a turn around the -Z
    // axis). Quaternion = (0, 0, -sin(π/4), cos(π/4)).
    const half = Math.PI / 4;
    const qz = -Math.sin(half);
    const qw = Math.cos(half);
    const { pitchDeg } = quatToYawPitchDeg(0, 0, qz, qw);
    // Forward = (0, +1, 0); pitch = asin(1) = 90°.
    expect(Math.round(pitchDeg)).toBe(90);
  });
});
