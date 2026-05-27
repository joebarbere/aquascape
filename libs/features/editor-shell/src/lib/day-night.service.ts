// Stage 11 F11.7 Wave 1 — DayNightService.
//
// Drives the day-night cycle the 3D renderer's ambient lighting + background
// tint consumes (Wave 3) and the editor-shell `DayNightControlComponent`
// scrubs (Wave 5). Lives in `libs/features/editor-shell/` (moved out of
// `apps/web/` in Wave 5) so the UI control + apps/web's render-options
// wiring can both consume the same singleton without crossing the
// `apps → libs` boundary.
//
// CONTRACT
// --------
//  - `phase()` is normalised to [0, 1) — 0 = midnight, 0.25 = dawn,
//    0.50 = noon, 0.75 = dusk. Wraps modulo 1; `setPhase(1.7)` → 0.7,
//    `setPhase(-0.2)` → 0.8.
//  - `mode()` is 'manual' | 'real-time' | 'equipment'. Default 'manual'.
//  - `lookup()` is a computed signal — interpolates the four keypoint colors
//    + scalars at the current phase. Channel-wise lerp for hex colors, plain
//    linear lerp for scalars. The four keypoints (see table in the F11.7
//    plan) anchor the cycle; values between keypoints lerp by normalised
//    segment position.
//  - `tick(dt)` advances phase by `dt / DAY_SECONDS` ONLY when
//    `mode() === 'real-time'`. Manual + equipment modes ignore tick (Wave 5
//    drives them through `setPhase` + photoperiod schedules respectively).
//
// DETERMINISM
// -----------
//  No PRNG, no Date.now() inside the lookup ramp. Same `phase()` → same
//  `lookup()` every call; safe for snapshot tests + screenshot diffs.

import { Injectable, Signal, computed, signal } from '@angular/core';

export type DayNightMode = 'manual' | 'real-time' | 'equipment';

export interface DayNightLookup {
  /** Ambient light color, hex string (e.g. '#2c3a5a' at midnight, '#fff5e0' at noon). */
  ambientColor: string;
  /** Directional light intensity multiplier, [0, 1] (0 at midnight, 1 at noon). */
  directionalIntensity: number;
  /** Background tint hex (THREE.Scene.background applied to this). */
  backgroundTint: string;
  /**
   * Emissive boost for plants at night, [0, 0.5] (0 by default, higher near
   * midnight so dark scenes don't go featureless).
   */
  emissiveBoost: number;
}

/** Seconds in a 24 h day. `tick(dt)` divides by this in real-time mode. */
const DAY_SECONDS = 86_400;

/** Keypoint values anchoring the day-night ramp. Phase 1.0 wraps back to 0.0. */
interface Keypoint {
  readonly phase: number;
  readonly ambient: RGB;
  readonly directional: number;
  readonly background: RGB;
  readonly emissive: number;
}

interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** The four anchor points of the cycle (see F11.7 plan, Wave 1 table). */
const KEYPOINTS: readonly Keypoint[] = [
  {
    phase: 0.0,
    ambient: hexToRgb('#0a1430'),
    directional: 0.05,
    background: hexToRgb('#0a1430'),
    emissive: 0.4,
  },
  {
    phase: 0.25,
    ambient: hexToRgb('#7a6a4e'),
    directional: 0.55,
    background: hexToRgb('#3a4060'),
    emissive: 0.1,
  },
  {
    phase: 0.5,
    ambient: hexToRgb('#fff5e0'),
    directional: 1.0,
    background: hexToRgb('#a4c7e8'),
    emissive: 0.0,
  },
  {
    phase: 0.75,
    ambient: hexToRgb('#a87344'),
    directional: 0.45,
    background: hexToRgb('#3a3030'),
    emissive: 0.1,
  },
];

@Injectable({ providedIn: 'root' })
export class DayNightService {
  /** Internal writable phase signal (private; expose read-only `phase` below). */
  private readonly _phase = signal<number>(0.5);
  /** Internal writable mode signal (private; expose read-only `mode` below). */
  private readonly _mode = signal<DayNightMode>('manual');

  /**
   * Normalised cycle phase in [0, 1):
   *   0.00 = midnight (lights off, deep blue background)
   *   0.25 = dawn (warm tint ramping up)
   *   0.50 = noon (full directional, neutral background)
   *   0.75 = dusk (warm tint ramping down)
   * Wraps modulo 1.
   */
  readonly phase: Signal<number> = this._phase.asReadonly();

  readonly mode: Signal<DayNightMode> = this._mode.asReadonly();

  /** Computed lookup — Wave 3 reads this via `.lookup()`. */
  readonly lookup: Signal<DayNightLookup> = computed(() => interpolate(this._phase()));

  /** Set the cycle phase. Wraps modulo 1 so out-of-range inputs are safe. */
  setPhase(p: number): void {
    this._phase.set(wrapPhase(p));
  }

  /** Set the cycle mode. Wave 3 / Wave 5 hand back the user's selection. */
  setMode(m: DayNightMode): void {
    this._mode.set(m);
  }

  /**
   * Advance the cycle by `dt` seconds. Only effective when `mode()` is
   * `'real-time'` — manual + equipment modes leave the phase unchanged so
   * the user's slider / the photoperiod schedule remain authoritative.
   *
   * 1 real second = 1 sim second by default (`dt / DAY_SECONDS`). A future
   * multiplier (e.g. "compress a day into 5 minutes") slots in here without
   * changing the caller.
   */
  tick(dt: number): void {
    if (this._mode() !== 'real-time') return;
    this._phase.set(wrapPhase(this._phase() + dt / DAY_SECONDS));
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

/** Wrap an arbitrary number into the half-open interval [0, 1). */
function wrapPhase(p: number): number {
  // `((p % 1) + 1) % 1` handles negative inputs without an `if` branch:
  // -0.2 % 1 = -0.2 → +1 = 0.8 → % 1 = 0.8.
  const wrapped = ((p % 1) + 1) % 1;
  // Edge case: exactly 1.0 after the second modulo (e.g. p = 1, -1) lands
  // back on 0 thanks to JS modulo semantics; nothing extra to do.
  return wrapped;
}

/** Linearly interpolate the keypoint table at `phase` ∈ [0, 1). */
function interpolate(phase: number): DayNightLookup {
  const p = wrapPhase(phase);

  // Find the segment [lo, hi] enclosing `p`. The table is sorted by phase;
  // we wrap from the last keypoint back to the first by treating midnight
  // as phase 1.0 within the dusk→midnight segment.
  //
  // `noUncheckedIndexedAccess` typing requires non-null assertions on the
  // KEYPOINTS reads — every index in this function is bounded by the
  // table's length so the values are always defined.
  let lo = KEYPOINTS[KEYPOINTS.length - 1]!;
  let hi = KEYPOINTS[0]!;
  // For the wrap segment [0.75, 1.0], segLo = 0.75 + 0 = 0.75, segHi = 1.0.
  let segLo = lo.phase;
  let segHi = 1;

  for (let i = 0; i < KEYPOINTS.length - 1; i += 1) {
    const cur = KEYPOINTS[i]!;
    const next = KEYPOINTS[i + 1]!;
    if (p >= cur.phase && p < next.phase) {
      lo = cur;
      hi = next;
      segLo = lo.phase;
      segHi = hi.phase;
      break;
    }
  }
  // If no in-table segment matched, `p` is in the wrap segment (≥ 0.75)
  // and the initial lo/hi already point to (dusk, midnight-next-day).

  // Normalised position within the segment, in [0, 1]. The keypoint table
  // guarantees `segHi > segLo` (no two keypoints share a phase), so no
  // div-by-zero guard is required here.
  const t = (p - segLo) / (segHi - segLo);

  return {
    ambientColor: rgbToHex(lerpRgb(lo.ambient, hi.ambient, t)),
    directionalIntensity: lerp(lo.directional, hi.directional, t),
    backgroundTint: rgbToHex(lerpRgb(lo.background, hi.background, t)),
    emissiveBoost: lerp(lo.emissive, hi.emissive, t),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  };
}

/** Internal `#rrggbb` → RGB. Only called with the keypoint constants below. */
function hexToRgb(hex: string): RGB {
  const v = hex.slice(1);
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function rgbToHex(rgb: RGB): string {
  const r = clampByte(rgb.r);
  const g = clampByte(rgb.g);
  const b = clampByte(rgb.b);
  return `#${byteHex(r)}${byteHex(g)}${byteHex(b)}`;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function byteHex(n: number): string {
  return n.toString(16).padStart(2, '0');
}
