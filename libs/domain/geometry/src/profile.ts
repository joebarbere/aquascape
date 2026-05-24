/**
 * Profile interpolation + deterministic noise helpers.
 *
 * The substrate tool (Stage 2 F2.2) stores a height profile as a small list
 * of control points; the renderer needs a smooth curve between them. We use
 * **centripetal Catmull-Rom** because:
 *   - It interpolates through every control point (no fairing — slopes the
 *     user dragged are the slopes the user gets).
 *   - The centripetal parameterisation avoids the cusps + loops that
 *     uniform Catmull-Rom produces when control points are clustered.
 *   - It's local: moving one control point only affects neighbouring
 *     segments, which matches how users think about sculpting a heightline.
 *
 * `seededHash01(seed, ...)` is a tiny deterministic hash used by the
 * substrate renderer for grain noise. It's NOT cryptographic; the design
 * goal is "the same scene seed produces the same grain pattern across
 * sessions and machines".
 */

import type { Vec2 } from './types';
import { vec2 } from './vec2';

/**
 * Sample a Catmull-Rom spline through `points` at `samples` evenly-spaced
 * positions. The first and last samples coincide with the first and last
 * control points (closed-form: the algorithm duplicates the endpoints).
 *
 * Centripetal parameterisation uses `alpha = 0.5`. The 0 (uniform) and 1
 * (chordal) variants are documented alternatives; centripetal is the safe
 * default and the only variant the substrate tool needs.
 *
 * Throws on fewer than 2 control points (a curve through one point is
 * undefined; the caller's UI should prevent this).
 */
export function sampleCatmullRom(
  points: readonly Vec2[],
  samples: number,
): Vec2[] {
  if (points.length < 2) {
    throw new Error('sampleCatmullRom: need ≥ 2 control points');
  }
  if (samples < 2) {
    throw new Error('sampleCatmullRom: need ≥ 2 samples');
  }

  // Duplicate the endpoints so the spline interpolates the actual ends.
  const p: Vec2[] = [points[0]!, ...points, points[points.length - 1]!];
  const segCount = points.length - 1;
  const out: Vec2[] = [];

  for (let i = 0; i < samples; i++) {
    // Map sample index → spline parameter in [0, segCount].
    const u = (i / (samples - 1)) * segCount;
    // Identify which segment, plus local t in [0, 1].
    const seg = Math.min(Math.floor(u), segCount - 1);
    const t = u - seg;
    const p0 = p[seg]!;
    const p1 = p[seg + 1]!;
    const p2 = p[seg + 2]!;
    const p3 = p[seg + 3]!;
    out.push(centripetal(p0, p1, p2, p3, t));
  }
  return out;
}

/**
 * Centripetal Catmull-Rom interpolation between `p1` and `p2`, with `p0`
 * and `p3` as the surrounding control points. `t` is the local parameter
 * in `[0, 1]`.
 *
 * Implementation uses the Barry-Goldman formulation with t_j knot spacing
 * derived from chord lengths^0.5 (centripetal). For coincident points the
 * fallback returns a lerp — without it we'd divide by zero on duplicate
 * control points, which the substrate UI doesn't strictly forbid.
 */
function centripetal(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);

  // Coincident p1 == p2 → no segment to interpolate; return p1.
  if (t2 - t1 === 0) return vec2(p1.x, p1.y);

  const tt = t1 + (t2 - t1) * t;

  const a1 = lerpScale(p0, p1, t0, t1, tt);
  const a2 = lerpScale(p1, p2, t1, t2, tt);
  const a3 = lerpScale(p2, p3, t2, t3, tt);
  const b1 = lerpScale(a1, a2, t0, t2, tt);
  const b2 = lerpScale(a2, a3, t1, t3, tt);
  return lerpScale(b1, b2, t1, t2, tt);
}

function knot(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Centripetal: alpha = 0.5 → fourth root of squared distance.
  return Math.pow(Math.sqrt(dx * dx + dy * dy), 0.5);
}

function lerpScale(a: Vec2, b: Vec2, ta: number, tb: number, t: number): Vec2 {
  if (tb - ta === 0) return vec2(a.x, a.y);
  const u = (t - ta) / (tb - ta);
  const v = 1 - u;
  return vec2(a.x * v + b.x * u, a.y * v + b.y * u);
}

/**
 * Deterministic hash → fraction in `[0, 1)`. Used by the substrate
 * renderer to scatter grain noise; same seed + same coords → same noise
 * across sessions. NOT cryptographic — collisions are expected and fine
 * for this purpose.
 *
 * Algorithm: 32-bit integer mixing similar to xorshift, normalised at the
 * end. ~3 ns per call; safe to invoke per-pixel inside a renderer loop.
 */
export function seededHash01(seed: number, ...keys: readonly number[]): number {
  let h = seed | 0;
  for (const k of keys) {
    h = (h ^ (k | 0)) * 0x85ebca6b;
    h ^= h >>> 13;
    h = (h * 0xc2b2ae35) | 0;
    h ^= h >>> 16;
  }
  // `>>> 0` reinterprets the int32 bit pattern as a uint32 in [0, 2^32);
  // avoid `& 0xffffffff` here — bitwise AND would coerce back to a signed
  // int32 and break the [0, 1) range guarantee.
  return (h >>> 0) / 0x100000000;
}
