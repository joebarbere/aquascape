// Stage 11 F11.6 Wave 4 — dev-only behavior-debug overlay.
//
// A small fixed-position text panel that reads from the live
// `LivestockSimulationService` and renders the per-fish state the F11.2–
// F11.5 behaviour systems are producing — BehaviorMode (FORAGE / REFUGE /
// PURSUE), territorial anchor eid, refuge eid, archetype. Useful when
// triaging a "why are these fish bunched in the corner?" report without
// reading source.
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
//
// ENTITY ROW CAP
// --------------
// The panel caps at `MAX_ROWS = 10` entries. A "+N more" tail line shows
// how many entities were elided. Real scenes can carry 50–200 fish; a
// scrolling panel would defeat the "glance to triage" purpose. If a
// future contributor wants per-entity filtering (only REFUGE fish, only a
// species, etc.) we'll add a small filter UI then.

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
  Archetype,
  BehaviorMode,
  BEHAVIOR_MODE,
  FearState,
  FISH_ARCHETYPE,
  NO_ENTITY_REF,
} from '@aquascape/domain/livestock-ecs';
import { ViewModeService } from '@aquascape/features/editor-shell';

import { BehaviorDebugService } from './behavior-debug.service';
import { LivestockSimulationService } from './livestock-simulation.service';

/** Refresh rate of the overlay, ms. ~15 Hz keeps GC quiet without
 *  feeling stale. The simulation itself ticks at 30 Hz so each refresh
 *  shows two ticks of evolution. */
const REFRESH_INTERVAL_MS = 67;

/** Max entity rows shown before the "+N more" tail line. */
const MAX_ROWS = 10;

/** URL query param that flips the overlay on at app boot. */
const URL_ENABLE_PARAM = 'debug-behavior';

/** One rendered row of the overlay. */
interface DebugRow {
  /** ECS entity id — used as ngFor track key + shown in the row prefix. */
  readonly eid: number;
  /** Pre-formatted single-line text (the template renders verbatim). */
  readonly text: string;
}

/** A snapshot of overlay state pulled from the live world. */
interface OverlaySnapshot {
  readonly entityCount: number;
  readonly bubbleCount: number;
  readonly viewMode: '2d' | '3d';
  readonly rows: readonly DebugRow[];
  /** How many entities were elided past `MAX_ROWS`. */
  readonly more: number;
}

const EMPTY_SNAPSHOT: OverlaySnapshot = {
  entityCount: 0,
  bubbleCount: 0,
  viewMode: '2d',
  rows: [],
  more: 0,
};

@Component({
  selector: 'aquascape-behavior-debug-overlay',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (visible()) {
      <aside class="behavior-debug" role="region" aria-label="F11 behavior debug overlay">
        <header class="behavior-debug__header">F11 Behavior Debug · {{ summary() }}</header>
        <div class="behavior-debug__rule" aria-hidden="true"></div>
        @for (row of rows(); track row.eid) {
          <div class="behavior-debug__row">{{ row.text }}</div>
        }
        @if (more() > 0) {
          <div class="behavior-debug__more">… +{{ more() }} more</div>
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
        max-width: 380px;
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
      .behavior-debug__rule {
        height: 1px;
        background: rgba(200, 230, 201, 0.25);
        margin: 5px 0;
      }
      .behavior-debug__row {
        white-space: pre;
      }
      .behavior-debug__more {
        opacity: 0.75;
        font-style: italic;
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

  readonly summary = computed<string>(() => {
    const s = this.snapshot();
    return (
      `${s.entityCount} fish · ${s.bubbleCount} bubbles · view: ${s.viewMode.toUpperCase()}`
    );
  });
  readonly rows = computed<readonly DebugRow[]>(() => this.snapshot().rows);
  readonly more = computed<number>(() => this.snapshot().more);

  /** Polling interval handle. `null` when not actively polling. */
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

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
      return { ...EMPTY_SNAPSHOT, viewMode };
    }
    // `snapshot(0)` is what the renderer already calls every frame — so
    // re-using it here adds no new bitECS scan cost beyond the typed-
    // array copy. The `ids` slab is the canonical fish-eid list.
    const snap = world.snapshot(0);
    const totalFish = snap.entityCount;
    const bubbleCount = snap.bubbleCount;
    if (totalFish === 0) {
      return { entityCount: 0, bubbleCount, viewMode, rows: [], more: 0 };
    }
    const shown = Math.min(MAX_ROWS, totalFish);
    const rows: DebugRow[] = [];
    for (let i = 0; i < shown; i++) {
      // `snap.ids` is a Uint32Array view — `!` because we already bounded
      // `i < totalFish ≤ ids.length`. The typed-array indexing returns
      // `number | undefined` under `noUncheckedIndexedAccess` even though
      // the runtime guarantees a number for in-bounds reads.
      const eid = snap.ids[i] as number;
      rows.push({ eid, text: this.formatEntityRow(world, eid) });
    }
    const more = totalFish - shown;
    return { entityCount: totalFish, bubbleCount, viewMode, rows, more };
  }

  /**
   * Format one entity into a single line. Reads BehaviorMode + Archetype
   * from the bitECS slabs directly (cheaper than walking the snapshot
   * arrays again, and avoids surfacing yet another world accessor for a
   * dev-only concern). Territory anchor uses the world's existing
   * `getEntityTerritoryAnchor` accessor so we honour the "null when no
   * Territory component" contract.
   */
  private formatEntityRow(
    world: NonNullable<ReturnType<LivestockSimulationService['getWorld']>>,
    eid: number,
  ): string {
    const archetypeId = (Archetype.id[eid] as number | undefined) ?? FISH_ARCHETYPE.SLIM_TETRA;
    const modeId = (BehaviorMode.mode[eid] as number | undefined) ?? BEHAVIOR_MODE.FORAGE;
    const mode = formatMode(modeId);
    const arch = formatArchetype(archetypeId);
    // Two optional decorations: territory anchor + refuge target. Only
    // print when present (Territory is opt-in per species, refuge is
    // only set while FearSystem has flipped the fish to REFUGE).
    const anchor = world.getEntityTerritoryAnchor(eid);
    const refugeRaw = FearState.refugeEid[eid] as number | undefined;
    const refuge =
      refugeRaw !== undefined && refugeRaw !== NO_ENTITY_REF ? refugeRaw : null;
    let line = `#${pad(eid, 3)} ${pad(arch, 14)} mode=${pad(mode, 6)}`;
    if (anchor !== null) line += `  anchor=#${anchor}`;
    if (refuge !== null) line += `  refuge=#${refuge}`;
    return line;
  }
}

// ── Pure formatters ──────────────────────────────────────────────────────

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
    default:
      return '?';
  }
}

/** Right-pad a value to width `w` with spaces. Used for column alignment. */
function pad(v: number | string, w: number): string {
  const s = String(v);
  if (s.length >= w) return s;
  return s + ' '.repeat(w - s.length);
}
