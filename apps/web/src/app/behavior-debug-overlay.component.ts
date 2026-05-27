// Stage 11 F11.6 Wave 4 — dev-only behavior-debug overlay.
// F11.7 livestock-movement triage follow-up (this revision): richer
// per-entity state (orientation, speed, cadence, drives, hit-tests)
// + a recent mode-transition event log, so a future "why is this
// fish doing X?" report can be triaged from a glance at the panel
// instead of a video + a code dive.
//
// A small fixed-position text panel that reads from the live
// `LivestockSimulationService` and renders the per-fish state the F11.2–
// F11.5 behaviour systems are producing. Sections:
//
//   1. Header — tick counter + view mode.
//   2. World stats — entity / bubble / sprite / hardscape counts +
//      BehaviorMode distribution (FOR / REF / PUR) + flow / SDF presence.
//   3. Per-fish rows (up to MAX_ROWS) — two lines per fish:
//        * Line 1 (pose + motion): archetype, mode, speed, yaw, pitch,
//          tail-beat cadence.
//        * Line 2 (drives + hit-tests): hunger, fear risk, territory
//          fatigue, nipping cooldown, SDF distance, wall distance,
//          optional anchor / refuge / curiosity decorations.
//   4. Recent events — last MAX_EVENTS BehaviorMode transitions across
//      every entity, time-ago + eid + from→to. Sourced by diffing the
//      previous poll's mode map against the current — no intrusive
//      event-bus on the world.
//   5. Footer — refresh rate + chord hint.
//
// VISIBILITY GATES (all must hold for the overlay to render)
// ----------------------------------------------------------
//   1. `isDevMode()` — production builds tree-shake the overlay out of the
//      DOM. Mirrors the existing `attachDebugHook` gate; jest runs in
//      dev mode so component tests see the overlay.
//   2. `BehaviorDebugService.enabled()` — toggled by AppComponent's
//      `Ctrl+Shift+D` HostListener (the chord) or, on first boot, by the
//      `?debug-behavior=1` URL parameter (handled in this component's
//      constructor — kept here so AppComponent doesn't grow another URL
//      parsing surface).
//   3. `viewMode === '3d'` — 2D has no behaviour world to inspect; the
//      `LivestockSimulationService.getWorld()` only materialises once the
//      first 3D paint requests it. Hiding in 2D prevents a confusing
//      "0 fish" panel while the simulation is genuinely dormant.
//   4. `world !== null` — empty livestock means no world has been built.
//      We hide rather than show "0 fish" because the panel's point is to
//      narrate live behaviour, not to confirm an empty scene.
//
// POLLING
// -------
// The panel re-reads the world at ~15 Hz (67 ms) via `setInterval` started
// inside `NgZone.runOutsideAngular` so the tick itself doesn't trigger
// change detection. The signal write inside the tick is wrapped in
// `NgZone.run(...)` so Angular re-evaluates the `@if` + bound rows on
// each refresh. ~15 Hz is the lowest update rate that still feels live
// (it's well under the simulation's 30 Hz tick rate, so each refresh
// shows a couple of fresh ECS ticks of evolution) and keeps the GC quiet.
// Mode-transition diffs reuse the same poll cadence: anything that
// flipped in the prior 67 ms shows up on the next refresh.
//
// ENTITY ROW CAP
// --------------
// The panel caps at `MAX_ROWS = 8` entries. A "+N more" tail line shows
// how many entities were elided. Real scenes can carry 50–200 fish; a
// scrolling panel would defeat the "glance to triage" purpose. If a
// future contributor wants per-entity filtering (only REFUGE fish, only
// a species, etc.) we'll add a small filter UI then.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  NgZone,
  OnDestroy,
  OnInit,
  computed,
  inject,
  isDevMode,
  signal,
} from '@angular/core';

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
} from '@aquascape/domain/livestock-ecs';
import { sampleSdf } from '@aquascape/domain/fluid-sim';
import { ViewModeService } from '@aquascape/features/editor-shell';

import { BehaviorDebugService } from './behavior-debug.service';
import { LivestockSimulationService } from './livestock-simulation.service';

/** Refresh rate of the overlay, ms. ~15 Hz keeps GC quiet without
 *  feeling stale. The simulation itself ticks at 30 Hz so each refresh
 *  shows two ticks of evolution. */
const REFRESH_INTERVAL_MS = 67;

/** Max entity rows shown before the "+N more" tail line. Two display
 *  lines per row (pose + drives) so 8 rows ≈ 16 lines. */
const MAX_ROWS = 8;

/** Max recent mode-transition events kept in the ring buffer. The panel
 *  shows the last MAX_EVENTS_SHOWN of these. */
const MAX_EVENTS = 16;
const MAX_EVENTS_SHOWN = 5;

/** URL query param that flips the overlay on at app boot. */
const URL_ENABLE_PARAM = 'debug-behavior';

/** A single rendered row of the per-fish panel. The text is rendered
 *  verbatim across two display lines (the second is indented for
 *  visual grouping). */
interface DebugRow {
  /** ECS entity id — used as ngFor track key + shown in the row prefix. */
  readonly eid: number;
  /** First display line — pose + motion. */
  readonly line1: string;
  /** Second display line — drives + hit-tests. */
  readonly line2: string;
}

/** One mode-transition event detected by diffing consecutive polls. */
interface ModeEvent {
  /** Entity id whose BehaviorMode flipped. */
  readonly eid: number;
  /** Mode the entity left. */
  readonly from: number;
  /** Mode the entity entered. */
  readonly to: number;
  /** Wall-clock ms when the transition was detected (Date.now). */
  readonly detectedAtMs: number;
}

/** Pre-formatted recent-event line. */
interface EventRow {
  readonly key: string;
  readonly text: string;
}

/** A snapshot of overlay state pulled from the live world. */
interface OverlaySnapshot {
  /** Fish entity count from the world snapshot. */
  readonly entityCount: number;
  /** Live bubble particle count. */
  readonly bubbleCount: number;
  /** Live food sprite count. */
  readonly foodSpriteCount: number;
  /** Live hardscape entity count. */
  readonly hardscapeCount: number;
  /** BehaviorMode distribution across all fish. */
  readonly modeCounts: { forage: number; refuge: number; pursue: number };
  /** Whether a FlowField is registered on the world. */
  readonly hasFlowField: boolean;
  /** Whether a HardscapeSdf is registered on the world. */
  readonly hasSdf: boolean;
  /** Simulation tick counter (advances at SIM_HZ inside the renderer's RAF). */
  readonly tickCounter: number;
  readonly viewMode: '2d' | '3d';
  readonly rows: readonly DebugRow[];
  /** How many entities were elided past `MAX_ROWS`. */
  readonly more: number;
  /** Recent mode-transition events, newest first. */
  readonly events: readonly EventRow[];
}

const EMPTY_SNAPSHOT: OverlaySnapshot = {
  entityCount: 0,
  bubbleCount: 0,
  foodSpriteCount: 0,
  hardscapeCount: 0,
  modeCounts: { forage: 0, refuge: 0, pursue: 0 },
  hasFlowField: false,
  hasSdf: false,
  tickCounter: 0,
  viewMode: '2d',
  rows: [],
  more: 0,
  events: [],
};

@Component({
  selector: 'aquascape-behavior-debug-overlay',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (visible()) {
      <aside class="behavior-debug" role="region" aria-label="F11 behavior debug overlay">
        <header class="behavior-debug__header">F11 Behavior Debug · {{ headerText() }}</header>
        <div class="behavior-debug__counts">{{ countsText() }}</div>
        <div class="behavior-debug__rule" aria-hidden="true"></div>
        @for (row of rows(); track row.eid) {
          <div class="behavior-debug__row behavior-debug__row--primary">{{ row.line1 }}</div>
          <div class="behavior-debug__row behavior-debug__row--detail">{{ row.line2 }}</div>
        }
        @if (more() > 0) {
          <div class="behavior-debug__more">… +{{ more() }} more</div>
        }
        @if (events().length > 0) {
          <div class="behavior-debug__rule" aria-hidden="true"></div>
          <div class="behavior-debug__events-header">Recent events</div>
          @for (ev of events(); track ev.key) {
            <div class="behavior-debug__event">{{ ev.text }}</div>
          }
        }
        <div class="behavior-debug__rule" aria-hidden="true"></div>
        <footer class="behavior-debug__footer">
          {{ '[live]' }} · updated ~{{ refreshHz }} Hz · Ctrl+Shift+D to toggle
        </footer>
      </aside>
    }
  `,
  styles: [
    `
      /* Fixed-position floating panel anchored to the bottom-right of the
         viewport. pointer-events:none so the overlay never steals
         clicks from the OrbitControls or the canvas hit-test, even if a
         long row pushes the panel over the canvas edge. */
      .behavior-debug {
        position: fixed;
        bottom: 12px;
        right: 12px;
        max-width: 560px;
        padding: 8px 10px;
        background: rgba(0, 0, 0, 0.78);
        color: #c8e6c9;
        font: 11px / 1.35 'Monaco', 'Menlo', 'Consolas', monospace;
        border-radius: 6px;
        pointer-events: none;
        z-index: 9999;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
      }
      .behavior-debug__header {
        font-weight: 600;
        color: #ffe082;
      }
      .behavior-debug__counts {
        color: #80cbc4;
      }
      .behavior-debug__rule {
        height: 1px;
        background: rgba(200, 230, 201, 0.25);
        margin: 5px 0;
      }
      .behavior-debug__row {
        white-space: pre;
      }
      .behavior-debug__row--detail {
        color: #b0bec5;
      }
      .behavior-debug__more {
        opacity: 0.75;
        font-style: italic;
      }
      .behavior-debug__events-header {
        color: #ffcc80;
      }
      .behavior-debug__event {
        white-space: pre;
        color: #ffe0b2;
      }
      .behavior-debug__footer {
        opacity: 0.65;
        font-size: 10px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BehaviorDebugOverlayComponent implements OnInit, OnDestroy {
  private readonly ngZone = inject(NgZone);
  private readonly livestockSim = inject(LivestockSimulationService);
  private readonly viewMode = inject(ViewModeService);
  private readonly debug = inject(BehaviorDebugService);

  /** Approx refresh frequency in Hz — exposed for the footer string. */
  readonly refreshHz = Math.round(1000 / REFRESH_INTERVAL_MS);

  /** Live snapshot updated by the polling tick. */
  private readonly snapshot = signal<OverlaySnapshot>(EMPTY_SNAPSHOT);

  /** True only when every gate (dev mode, toggle, 3D, live world) passes. */
  readonly visible = computed<boolean>(() => {
    if (!isDevMode()) return false;
    if (!this.debug.enabled()) return false;
    if (this.viewMode.mode() !== '3d') return false;
    return this.snapshot().entityCount > 0;
  });

  readonly headerText = computed<string>(() => {
    const s = this.snapshot();
    return `tick ${s.tickCounter} · view ${s.viewMode.toUpperCase()}`;
  });
  readonly countsText = computed<string>(() => {
    const s = this.snapshot();
    const { forage, refuge, pursue } = s.modeCounts;
    const flow = s.hasFlowField ? 'Y' : 'N';
    const sdf = s.hasSdf ? 'Y' : 'N';
    return (
      `${s.entityCount} fish · ${s.bubbleCount} bubbles · ${s.foodSpriteCount} sprites · ` +
      `${s.hardscapeCount} hs · FOR:${forage} REF:${refuge} PUR:${pursue} · flow:${flow} sdf:${sdf}`
    );
  });
  readonly rows = computed<readonly DebugRow[]>(() => this.snapshot().rows);
  readonly more = computed<number>(() => this.snapshot().more);
  readonly events = computed<readonly EventRow[]>(() => this.snapshot().events);

  /** Polling interval handle. `null` when not actively polling. */
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  /** Previous-tick BehaviorMode map. Diffed each poll to emit transition
   *  events. Reset (cleared) whenever the world identity changes (new
   *  scene / re-spawn). Stays empty until the first poll observes a
   *  live world. */
  private prevModes = new Map<number, number>();
  /** World identity captured on the previous poll. Used to detect when
   *  the simulation service swapped worlds — we drop the stale prevModes
   *  map in that case to avoid spurious "huge transition burst" reports
   *  the first poll after a re-spawn. */
  private prevWorldRef: object | null = null;
  /** Bounded ring buffer of recent mode-transition events, newest at
   *  the END so iteration in reverse produces "most recent first". */
  private recentEvents: ModeEvent[] = [];

  ngOnInit(): void {
    // URL bootstrap: `?debug-behavior=1` flips the toggle on at app start.
    // Done here rather than in the service so the service has no DOM
    // dependency (keeps it test-friendly). We only act on the param when
    // it parses to a truthy value — `?debug-behavior=0` is treated as
    // "leave the flag alone" (the default is off anyway).
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get(URL_ENABLE_PARAM);
        if (raw === '1' || raw === 'true') {
          this.debug.setEnabled(true);
        }
      } catch {
        // URLSearchParams failures on exotic URLs are non-fatal.
      }
    }

    // The polling tick runs outside Angular so the timer itself doesn't
    // trigger change detection. The signal write inside the tick is
    // wrapped in `ngZone.run(...)` so the `@if` + computed signals in the
    // template re-evaluate exactly once per refresh.
    this.ngZone.runOutsideAngular(() => {
      this.intervalHandle = setInterval(() => {
        const snap = this.collectSnapshot();
        this.ngZone.run(() => this.snapshot.set(snap));
      }, REFRESH_INTERVAL_MS);
    });
  }

  ngOnDestroy(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Pull the current world state into an `OverlaySnapshot`. Pure read —
   * never mutates the world or any service. When no world is live (no
   * livestock, or the user is still in 2D so the renderer hasn't asked
   * for one yet) we return `EMPTY_SNAPSHOT`, which keeps `visible()`
   * false even if the chord was pressed.
   */
  private collectSnapshot(): OverlaySnapshot {
    const viewMode = this.viewMode.mode();
    const world = this.livestockSim.getWorld();
    if (world === null) {
      // Drop the transition tracker so the next live world doesn't see
      // a phantom "every fish flipped to FORAGE" burst on its first poll.
      this.prevModes.clear();
      this.prevWorldRef = null;
      return { ...EMPTY_SNAPSHOT, viewMode };
    }

    // World identity check — service may have torn down + rebuilt the
    // world on scene change. Wipe stale per-eid state in that case.
    if (this.prevWorldRef !== world) {
      this.prevModes.clear();
      this.recentEvents.length = 0;
      this.prevWorldRef = world;
    }

    // `snapshot(0)` is what the renderer already calls every frame — so
    // re-using it here adds no new bitECS scan cost beyond the typed-
    // array copy. The `ids` slab is the canonical fish-eid list.
    const snap = world.snapshot(0);
    const totalFish = snap.entityCount;
    const bubbleCount = snap.bubbleCount;
    const foodSpriteCount = world.getFoodSpriteCount();
    const hardscapeCount = world.getHardscapeCount();
    const tickCounter = world.tickCounter;
    const hasFlowField = world.getFlowField() !== null;
    const hasSdf = world.getHardscapeSdf() !== null;

    if (totalFish === 0) {
      return {
        ...EMPTY_SNAPSHOT,
        viewMode,
        bubbleCount,
        foodSpriteCount,
        hardscapeCount,
        tickCounter,
        hasFlowField,
        hasSdf,
      };
    }

    // Walk every fish to compute mode counts + capture mode transitions.
    // O(n) — the same cost as the renderer's per-frame attribute upload,
    // negligible at the 15 Hz overlay refresh.
    const sdfHandle = world.getHardscapeSdf();
    const aabb = world.tankAabb;
    let forage = 0;
    let refuge = 0;
    let pursue = 0;
    const nextModes = new Map<number, number>();
    const newEvents: ModeEvent[] = [];
    const detectedAtMs = Date.now();
    for (let i = 0; i < totalFish; i++) {
      const eid = snap.ids[i] as number;
      const m = (BehaviorMode.mode[eid] as number | undefined) ?? BEHAVIOR_MODE.FORAGE;
      if (m === BEHAVIOR_MODE.REFUGE) refuge += 1;
      else if (m === BEHAVIOR_MODE.PURSUE) pursue += 1;
      else forage += 1;
      nextModes.set(eid, m);
      const prev = this.prevModes.get(eid);
      if (prev !== undefined && prev !== m) {
        newEvents.push({ eid, from: prev, to: m, detectedAtMs });
      }
    }
    this.prevModes = nextModes;
    if (newEvents.length > 0) {
      for (const ev of newEvents) this.recentEvents.push(ev);
      // Trim from the front when over cap — keep newest MAX_EVENTS.
      while (this.recentEvents.length > MAX_EVENTS) this.recentEvents.shift();
    }

    const shown = Math.min(MAX_ROWS, totalFish);
    const rows: DebugRow[] = [];
    for (let i = 0; i < shown; i++) {
      const eid = snap.ids[i] as number;
      rows.push(this.formatEntityRow(world, eid, sdfHandle, aabb));
    }
    const more = totalFish - shown;

    // Format recent events: newest first, render up to MAX_EVENTS_SHOWN.
    const eventRows: EventRow[] = [];
    const startIdx = this.recentEvents.length - 1;
    const limit = Math.max(0, this.recentEvents.length - MAX_EVENTS_SHOWN);
    for (let i = startIdx; i >= limit; i--) {
      const ev = this.recentEvents[i]!;
      const ageSec = Math.max(0, (detectedAtMs - ev.detectedAtMs) / 1000);
      eventRows.push({
        key: `${ev.detectedAtMs}-${ev.eid}-${ev.to}`,
        text: `  ${formatAge(ageSec)}  #${pad(ev.eid, 3)}  ${formatMode(ev.from)} → ${formatMode(ev.to)}`,
      });
    }

    return {
      entityCount: totalFish,
      bubbleCount,
      foodSpriteCount,
      hardscapeCount,
      modeCounts: { forage, refuge, pursue },
      hasFlowField,
      hasSdf,
      tickCounter,
      viewMode,
      rows,
      more,
      events: eventRows,
    };
  }

  /**
   * Format one entity into two display lines. Reads the per-entity bitECS
   * slabs directly — cheaper than walking the snapshot arrays again, and
   * keeps the dev-only concern out of the world's public API.
   */
  private formatEntityRow(
    world: NonNullable<ReturnType<LivestockSimulationService['getWorld']>>,
    eid: number,
    sdfHandle: ReturnType<typeof world.getHardscapeSdf>,
    aabb: typeof world.tankAabb,
  ): DebugRow {
    const archetypeId = (Archetype.id[eid] as number | undefined) ?? FISH_ARCHETYPE.SLIM_TETRA;
    const modeId = (BehaviorMode.mode[eid] as number | undefined) ?? BEHAVIOR_MODE.FORAGE;
    const arch = formatArchetype(archetypeId);
    const mode = formatMode(modeId);

    // ── Pose + motion ────────────────────────────────────────────────
    const vx = (Velocity.x[eid] as number | undefined) ?? 0;
    const vy = (Velocity.y[eid] as number | undefined) ?? 0;
    const vz = (Velocity.z[eid] as number | undefined) ?? 0;
    const speed = Math.hypot(vx, vy, vz);
    const qx = (Orientation.x[eid] as number | undefined) ?? 0;
    const qy = (Orientation.y[eid] as number | undefined) ?? 0;
    const qz = (Orientation.z[eid] as number | undefined) ?? 0;
    const qw = (Orientation.w[eid] as number | undefined) ?? 1;
    const { yawDeg, pitchDeg } = quatToYawPitchDeg(qx, qy, qz, qw);
    const freq = (AnimationPhase.freq[eid] as number | undefined) ?? 0;
    const line1 =
      `#${pad(eid, 3)} ${pad(arch, 14)} ${pad(mode, 6)}` +
      `  v=${pad(speed.toFixed(0) + 'mm/s', 8)}` +
      `  yaw=${padSigned(yawDeg, 4)}°` +
      `  pit=${padSigned(pitchDeg, 3)}°` +
      `  cad=${freq.toFixed(1)}Hz`;

    // ── Drives + hit-tests ───────────────────────────────────────────
    const hunger = (FeedingDrive.hunger[eid] as number | undefined) ?? 0;
    const risk = (FearState.risk[eid] as number | undefined) ?? 0;
    const fatigue = (Territory.fatigue[eid] as number | undefined) ?? 0;
    const cooldown = (NippingDrive.cooldownSec[eid] as number | undefined) ?? 0;

    const px = (Position.x[eid] as number | undefined) ?? 0;
    const py = (Position.y[eid] as number | undefined) ?? 0;
    const pz = (Position.z[eid] as number | undefined) ?? 0;
    const halfBody = ((BodyLength.mm[eid] as number | undefined) ?? 0) * 0.5;
    const wallDist = Math.min(
      px - aabb.minX,
      aabb.maxX - px,
      py - aabb.minY,
      aabb.maxY - py,
      pz - aabb.minZ,
      aabb.maxZ - pz,
    );
    const wallText = `${wallDist.toFixed(0)}mm`;
    const sdfText =
      sdfHandle !== null ? `${sampleSdf(sdfHandle, { x: px, y: py, z: pz }).toFixed(0)}mm` : '-';

    // Optional decorations — only print when meaningful so the row doesn't
    // get visually noisy for fish with neither territory nor refuge nor
    // active curiosity interest.
    const anchor = world.getEntityTerritoryAnchor(eid);
    const refugeRaw = FearState.refugeEid[eid] as number | undefined;
    const refuge = refugeRaw !== undefined && refugeRaw !== NO_ENTITY_REF ? refugeRaw : null;
    const dwell = (Curiosity.dwellRemaining[eid] as number | undefined) ?? 0;
    const interestX = Curiosity.interestX[eid] as number | undefined;
    const curiosityActive = interestX !== undefined && interestX !== NO_INTEREST && dwell > 0;

    const decorations: string[] = [];
    if (anchor !== null) decorations.push(`an=#${anchor}`);
    if (refuge !== null) decorations.push(`rf=#${refuge}`);
    if (curiosityActive) decorations.push(`ci=${dwell.toFixed(1)}s`);
    // Body extent (informational — useful when triaging "fish poking
    // through wall" reports the F11.7 patch addressed):
    if (halfBody > 0) decorations.push(`bl=${(halfBody * 2).toFixed(0)}mm`);

    let line2 =
      `       hun=${hunger.toFixed(2)}` +
      `  fea=${risk.toFixed(2)}` +
      `  fat=${fatigue.toFixed(2)}` +
      `  cd=${cooldown.toFixed(1)}s` +
      `  sdf=${pad(sdfText, 6)}` +
      `  wall=${pad(wallText, 6)}`;
    if (decorations.length > 0) {
      line2 += `  [${decorations.join(' ')}]`;
    }

    return { eid, line1, line2 };
  }
}

// ── Pure formatters ──────────────────────────────────────────────────────

/**
 * Convert a unit quaternion to yaw (rotation about world Y) + pitch
 * (signed angle above/below the XZ plane), expressed in degrees, for
 * the **nose direction** of the fish — i.e. the swim direction.
 *
 * The integrator's pose convention (see `steering-integrator.ts` header):
 *   - Fish geometry has nose at local X=0 and tail at local X=1.
 *   - The swim direction is `rotateByQuat([-1, 0, 0], q)` — local -X
 *     in world space.
 *
 * Yaw is `atan2(forwardZ, forwardX)`. Tank world axes: +X right, +Y up,
 * +Z back, so yaw 0 = nose toward +X (toward screen-right after the
 * apps/web mirror flip; toward the back of the tank in raw world space).
 *
 * Pitch is `asin(forwardY)`. Positive pitch = nose-up. After the F11.7
 * pitch clamp lands, pitch should stay within ±25°.
 */
export function quatToYawPitchDeg(
  qx: number,
  qy: number,
  qz: number,
  qw: number,
): { yawDeg: number; pitchDeg: number } {
  // Nose direction = rotateByQuat([-1, 0, 0], q). Matches the integrator's
  // forward-axis convention (see the F11.7 patch).
  const fx = -(1 + 2 * (-qy * qy - qz * qz));
  const fy = -(2 * (qz * qw + qx * qy));
  const fz = -(2 * (qx * qz - qy * qw));
  // Pitch: asin of the Y component. Clamp the arg in case of float drift
  // past unit length so acos/asin don't return NaN.
  const fyClamped = fy > 1 ? 1 : fy < -1 ? -1 : fy;
  let pitchDeg = (Math.asin(fyClamped) * 180) / Math.PI;
  // The `-(0)` negation in `fz` above produces `-0` for the common
  // identity-quaternion case, which atan2 reads as a different sign than
  // `+0` (`atan2(-0, -1) = -π` vs. `atan2(+0, -1) = +π`). Normalise -0
  // back to 0 so the formatter shows `yaw=+180°` for an identity quat,
  // not `-180°`. Same for pitch's -0 case (identity → `fy = -0` → pitch
  // would render as `-0` without this guard).
  const fzNorm = fz === 0 ? 0 : fz;
  let yawDeg = (Math.atan2(fzNorm, fx) * 180) / Math.PI;
  // Collapse the ±180 ambiguity to +180 so the formatter is stable across
  // float-rounding wobble.
  if (yawDeg <= -180) yawDeg = 180;
  if (pitchDeg === 0) pitchDeg = 0; // promote -0 → +0 for clean display
  return { yawDeg, pitchDeg };
}

function formatMode(modeId: number): string {
  switch (modeId) {
    case BEHAVIOR_MODE.FORAGE:
      return 'FORAGE';
    case BEHAVIOR_MODE.REFUGE:
      return 'REFUGE';
    case BEHAVIOR_MODE.PURSUE:
      return 'PURSUE';
    default:
      return '?';
  }
}

function formatArchetype(id: number): string {
  switch (id) {
    case FISH_ARCHETYPE.SLIM_TETRA:
      return 'slim-tetra';
    case FISH_ARCHETYPE.DEEP_BODIED:
      return 'deep-bodied';
    case FISH_ARCHETYPE.BARB:
      return 'barb';
    case FISH_ARCHETYPE.CORY_CYLINDER:
      return 'cory-cylinder';
    case FISH_ARCHETYPE.EEL:
      return 'eel';
    case FISH_ARCHETYPE.HATCHET_WEDGE:
      return 'hatchet-wedge';
    case FISH_ARCHETYPE.CRAWLER:
      return 'crawler';
    default:
      return '?';
  }
}

/** Format an age-in-seconds as "+1.2s" or "+12.5s" or "+45s+" cap. */
function formatAge(sec: number): string {
  if (sec >= 99) return ' +99s';
  if (sec < 10) return `+${sec.toFixed(1)}s`;
  return ` +${sec.toFixed(0)}s`;
}

/** Right-pad a value to width `w` with spaces. Used for column alignment. */
function pad(v: number | string, w: number): string {
  const s = String(v);
  if (s.length >= w) return s;
  return s + ' '.repeat(w - s.length);
}

/** Left-pad a signed integer-rounded number to width `w` with spaces so the
 *  digit columns line up regardless of the value's sign. e.g. (4, 4) → "  +4",
 *  (-180, 4) → "-180". */
function padSigned(v: number, w: number): string {
  const rounded = Math.round(v);
  const sign = rounded < 0 ? '-' : '+';
  const body = Math.abs(rounded).toString();
  const padded = body.length >= w - 1 ? body : ' '.repeat(w - 1 - body.length) + body;
  return sign + padded;
}
