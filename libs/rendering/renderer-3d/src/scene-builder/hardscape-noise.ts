/**
 * Deterministic per-vertex noise displacement for hardscape geometry.
 *
 * `ExtrudeGeometry` produces a flat slab — front face, back face, side
 * walls. A real rock looks irregular. This helper walks every vertex
 * of an `ExtrudeGeometry` and pushes it OUT (or in) along a position-
 * derived radial direction by a small, seeded-pseudo-random amount.
 * The result reads as a rough lump rather than a stamped silhouette.
 *
 * **Seam-watertight displacement (load-bearing).** `ExtrudeGeometry`
 * duplicates vertex positions where the front face, side walls, and back
 * face meet — each face owns its own copy with its own face normal so
 * the slab can light with sharp 90° edges. If we displaced along each
 * vertex's NORMAL (and / or hashed the vertex INDEX), the two coincident
 * vertices at a seam would move in different directions, tearing the
 * surface open ("disconnected edges"). Instead, we:
 *
 *   1. Hash only the QUANTISED POSITION (no vertex index). Two coincident
 *      vertices get the same noise scalar.
 *   2. Displace along the unit vector from the geometry's bounding-box
 *      CENTRE to the vertex position. Two coincident vertices have the
 *      same position, so the same direction.
 *
 * Together: coincident vertices end up at the SAME displaced position,
 * and the surface stays watertight. The sharp edges between faces are
 * preserved because each face's vertex normals are still per-face after
 * the post-displacement `computeVertexNormals()`.
 *
 * **Determinism.** The `SceneRenderer` contract says `render(scene)` is
 * idempotent — two calls produce the same pixels. So the displacement
 * MUST be a pure function of (seed, vertex coordinates). No
 * `Math.random()`, no `Date.now()`, no `crypto.getRandomValues()`.
 *
 * **Hash function.** FNV-1a (32-bit) over `seed` + vertex (x, y, z)
 * quantised to 1 mm. Quantisation prevents tiny floating-point fuzz
 * in the geometry from changing the hash. FNV-1a was chosen because
 * it's already in the codebase (`templates/builtin-templates.ts`) and
 * mixes well enough for visual noise.
 *
 * **Magnitude.** `min(width, height, depth) × 0.07` (7% of the smallest
 * dimension). Enough to read as irregular without making the rock
 * unrecognisable as the catalog shape.
 *
 * **Normals.** Recomputed after displacement so the lit surface tracks
 * the moved vertices. Without this Three.js shades using stale normals.
 *
 * Three.js-dependent (it operates on `BufferGeometry`), but no scene-
 * model coupling.
 */

import type { BufferGeometry } from 'three';

/**
 * Default displacement fraction of the smallest natural dimension. Tuned
 * so rocks read as irregular lumps rather than flat extruded slabs — 7%
 * was too subtle on real catalog rocks; 18% gives pronounced bumps while
 * keeping the silhouette recognisable.
 */
const DEFAULT_DISPLACEMENT_FRACTION = 0.18;
/**
 * Second-octave fraction — adds finer detail at half-magnitude on top of
 * the primary octave. Doubles the perceived surface complexity without
 * pushing the AABB further out (the second octave samples at higher
 * frequency via a different seed mix).
 */
const SECOND_OCTAVE_FRACTION = 0.5;
/** Seed mix for the second octave so it doesn't correlate with the first. */
const SECOND_OCTAVE_SEED_MIX = 0xb5297a4d;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;
/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET = 0x811c9dc5;

/**
 * Derive a 32-bit seed from an object's identity. Same input always
 * yields the same seed; the renderer contract's idempotency guarantee
 * depends on this.
 *
 * Format: `${catalogId}:${objectId}` so two instances of the SAME
 * catalog entry produce DIFFERENT seeds — each rock is unique even when
 * they share a catalog ref. Useful for "I dragged the same rock twice"
 * scenes where seeing two identical-looking lumps would feel wrong.
 */
export function seedFromHardscape(catalogId: string, objectId: string): number {
  return fnv1a32(`${catalogId}:${objectId}`);
}

/**
 * Walk every vertex of `geo` and displace it along its normal by a small,
 * seeded amount.
 *
 * **Pre-condition:** `geo` is an `ExtrudeGeometry` (or any
 * `BufferGeometry` with `position` and `normal` attributes).
 * `computeVertexNormals()` is called BEFORE the walk to make sure
 * normals are present; called AGAIN after the walk to refresh them so
 * lighting reads the displaced surface correctly.
 *
 * **Side effect:** mutates `geo` in place. Returns the same reference
 * for chaining.
 */
export function applyHardscapeNoise(
  geo: BufferGeometry,
  options: {
    seed: number;
    /** Smallest natural dimension in mm — magnitude reference. */
    minNaturalMm: number;
    /** Optional override (used by tests). */
    displacementFraction?: number;
  },
): BufferGeometry {
  const positionAttr = geo.attributes['position'];
  if (positionAttr === undefined) {
    // Defensive: no position attribute on the geometry. Nothing to
    // displace. Return the geometry untouched.
    return geo;
  }

  const fraction = options.displacementFraction ?? DEFAULT_DISPLACEMENT_FRACTION;
  const magnitude = Math.max(0, options.minNaturalMm) * fraction;
  // Zero or negative magnitude → no displacement, but still recompute
  // normals so callers get a consistent post-state.
  if (magnitude <= 0) {
    geo.computeVertexNormals();
    return geo;
  }

  // Geometry's bounding-box centre is the radial origin. Coincident seam
  // vertices share position → share direction → cannot tear apart.
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const cx = bb === null ? 0 : (bb.min.x + bb.max.x) * 0.5;
  const cy = bb === null ? 0 : (bb.min.y + bb.max.y) * 0.5;
  const cz = bb === null ? 0 : (bb.min.z + bb.max.z) * 0.5;

  // Second-octave seed (decorrelated from the first via a fixed mix
  // constant) is sampled at 2× the quantisation grid so it varies on a
  // finer scale than the primary octave. The combined displacement stays
  // bounded by `magnitude × (1 + SECOND_OCTAVE_FRACTION)` (worst case);
  // the primary octave dominates the visible profile.
  const secondSeed = (options.seed ^ SECOND_OCTAVE_SEED_MIX) >>> 0;

  const count = positionAttr.count;
  for (let i = 0; i < count; i++) {
    const vx = positionAttr.getX(i);
    const vy = positionAttr.getY(i);
    const vz = positionAttr.getZ(i);

    // Quantise to 1 mm so tiny float fuzz doesn't change the hash.
    const qx = Math.round(vx);
    const qy = Math.round(vy);
    const qz = Math.round(vz);
    const noise1 = deterministicNoise(options.seed, qx, qy, qz);
    // Second octave samples at half the spacing (× 2 quantisation) so
    // it adds finer surface detail. Position-only hash → still seam-safe.
    const noise2 = deterministicNoise(secondSeed, qx * 2, qy * 2, qz * 2);
    const combinedNoise = noise1 + noise2 * SECOND_OCTAVE_FRACTION;

    // Radial direction from bbox centre. Degenerate vertex AT the centre
    // (length 0) gets no displacement — there's no meaningful direction.
    const dx = vx - cx;
    const dy = vy - cy;
    const dz = vz - cz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len === 0) continue;
    const inv = 1 / len;

    const disp = combinedNoise * magnitude;
    positionAttr.setXYZ(
      i,
      vx + dx * inv * disp,
      vy + dy * inv * disp,
      vz + dz * inv * disp,
    );
  }
  positionAttr.needsUpdate = true;

  // Recompute normals so the displaced surface lights correctly.
  geo.computeVertexNormals();
  return geo;
}

/**
 * 3D deterministic noise in `[-1, 1]`. Input: seed + vertex (x, y, z)
 * quantised to 1 mm. Output: a value mapped from the FNV-1a hash's
 * uint32 output linearly into `[-1, 1)`.
 *
 * Position-only (no vertex index) so coincident seam vertices in
 * `ExtrudeGeometry` get the same noise value — see header.
 */
function deterministicNoise(
  seed: number,
  qx: number,
  qy: number,
  qz: number,
): number {
  let h = mix32(FNV_OFFSET, seed | 0);
  h = mix32(h, qx | 0);
  h = mix32(h, qy | 0);
  h = mix32(h, qz | 0);
  // Map uint32 [0, 2^32) → [-1, 1)
  return (h / 0x80000000) - 1;
}

/** One FNV-1a step over a 32-bit value. */
function mix32(state: number, value: number): number {
  let h = (state ^ ((value >>> 0) & 0xff)) >>> 0;
  h = Math.imul(h, FNV_PRIME) >>> 0;
  h = (h ^ ((value >>> 8) & 0xff)) >>> 0;
  h = Math.imul(h, FNV_PRIME) >>> 0;
  h = (h ^ ((value >>> 16) & 0xff)) >>> 0;
  h = Math.imul(h, FNV_PRIME) >>> 0;
  h = (h ^ ((value >>> 24) & 0xff)) >>> 0;
  h = Math.imul(h, FNV_PRIME) >>> 0;
  return h;
}

/** FNV-1a 32-bit over a string. Returns an unsigned 32-bit integer. */
function fnv1a32(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}
