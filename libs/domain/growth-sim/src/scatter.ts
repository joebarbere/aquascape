/**
 * Deterministic scatter placement inside a polygon for carpet/brush planting.
 *
 * The contract: given identical `(polygon, density, seed)` inputs, return
 * identical `ScatterPoint[]` outputs — across machines and across runs. This
 * is the property that lets a saved document with a scatter patch render
 * identically when reloaded weeks later, without persisting every leaf.
 *
 * Algorithm:
 *  1. Compute the polygon's AABB and its signed area (shoelace).
 *  2. Target count = `density × |area| / 10 000` (density is per 100 cm²;
 *     area in mm²; 100 cm² = 10 000 mm²).
 *  3. Build a stratified grid sized so `cols × rows ≈ target / acceptanceRatio`,
 *     where acceptanceRatio approximates polygon-area / aabb-area. Each cell
 *     gets one jittered candidate (deterministic from `(seed, cell index)`).
 *  4. Accept candidates that fall inside the polygon (ray-cast even-odd).
 *
 * Each accepted point also carries a per-instance jitter scalar and rotation,
 * derived from its own seeded PRNG sub-stream — so a downstream renderer can
 * vary leaf size/orientation without ever calling `Math.random`.
 */

interface Vec2 {
  x: number;
  y: number;
}

export interface ScatterPoint {
  position: Vec2;
  /** Per-instance scale jitter in [0.85, 1.15]. */
  jitter: number;
  /** Per-instance rotation in [0, 2π). */
  rotation: number;
}

/** Signed polygon area via the shoelace formula. Positive = CCW winding. */
export function polygonArea(polygon: ReadonlyArray<Vec2>): number {
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * @param polygon Closed polygon in scene-space mm. ≥3 vertices.
 * @param density Instances per 100 cm² (10 000 mm²). Must be > 0.
 * @param seed Integer seed. Same seed + inputs → same output.
 */
export function scatterInPolygon(
  polygon: ReadonlyArray<Vec2>,
  density: number,
  seed: number,
): ScatterPoint[] {
  if (polygon.length < 3 || density <= 0 || !Number.isFinite(density)) return [];

  const area = Math.abs(polygonArea(polygon));
  if (area <= 0) return [];

  const aabb = boundingBox(polygon);
  const aabbArea = (aabb.maxX - aabb.minX) * (aabb.maxY - aabb.minY);
  if (aabbArea <= 0) return [];

  const targetCount = density * (area / 10_000);
  if (targetCount < 1) {
    // Below one instance per polygon — still attempt one candidate so very-
    // sparse brushes don't render as nothing.
    const rng = mulberry32(hashSeed(seed, 0));
    const x = aabb.minX + (aabb.maxX - aabb.minX) * rng();
    const y = aabb.minY + (aabb.maxY - aabb.minY) * rng();
    if (!pointInPolygon({ x, y }, polygon)) return [];
    return [{ position: { x, y }, jitter: jitterFrom(seed, 0), rotation: rotationFrom(seed, 0) }];
  }

  // Acceptance ratio = polygon / aabb. Inflate grid by 1/ratio so we end up
  // with ~targetCount accepted points after rejection sampling.
  const acceptanceRatio = area / aabbArea;
  const gridCount = Math.ceil(targetCount / Math.max(acceptanceRatio, 0.05));
  const aspect = (aabb.maxX - aabb.minX) / (aabb.maxY - aabb.minY);
  const cols = Math.max(1, Math.round(Math.sqrt(gridCount * aspect)));
  const rows = Math.max(1, Math.ceil(gridCount / cols));

  const cellW = (aabb.maxX - aabb.minX) / cols;
  const cellH = (aabb.maxY - aabb.minY) / rows;

  const out: ScatterPoint[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellIndex = r * cols + c;
      const rng = mulberry32(hashSeed(seed, cellIndex));
      const jx = rng();
      const jy = rng();
      const x = aabb.minX + (c + jx) * cellW;
      const y = aabb.minY + (r + jy) * cellH;
      const p = { x, y };
      if (!pointInPolygon(p, polygon)) continue;
      out.push({
        position: p,
        jitter: jitterFrom(seed, cellIndex),
        rotation: rotationFrom(seed, cellIndex),
      });
    }
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function boundingBox(polygon: ReadonlyArray<Vec2>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Even-odd ray-cast test. Vertices exactly on the boundary count as inside. */
function pointInPolygon(p: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersect =
      pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * 32-bit integer mix (Wang hash style). Splits one `(seed, index)` pair into
 * a deterministic, well-distributed 32-bit value that a per-instance PRNG
 * can be seeded with. Pure integer ops so it's reproducible cross-engine.
 */
function hashSeed(seed: number, index: number): number {
  let h = (seed | 0) ^ Math.imul(index | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

/** Mulberry32: 32-bit PRNG, returns [0, 1). Tiny + deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-instance jitter using its own sub-stream so it's independent of cells. */
function jitterFrom(seed: number, index: number): number {
  const r = mulberry32(hashSeed(seed ^ 0x5bd1e995, index))();
  return 0.85 + r * 0.3; // [0.85, 1.15)
}

function rotationFrom(seed: number, index: number): number {
  const r = mulberry32(hashSeed(seed ^ 0x27d4eb2f, index))();
  return r * Math.PI * 2;
}
