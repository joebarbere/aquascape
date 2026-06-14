// Stage 14 F14.3 — pure view-model for the fish-vitality HUD + inspector.
//
// Kept separate from the components so the school-aggregate math (avg / min
// health, % hungry) and the per-fish "hearts" mapping are unit-testable
// without rendering. The HUD/inspector read the `WorldSnapshot.health` +
// `WorldSnapshot.hunger` slabs (per-fish, [0,1] health, [0,∞) hunger,
// parallel to `ids`) — NO renderer per-instance / vertex-attribute change
// (the fish shader sits at the 16-attribute ANGLE ceiling; vitality is
// HUD-surfaced — see docs/caveats/livestock-ecs.md).

/**
 * Hunger level at/above which a fish counts as "hungry" for the HUD's
 * "% hungry" aggregate + the inspector badge. Matches the sim's feeding
 * `threshold` (every preset uses 0.7 — the level at which a FORAGE fish
 * actively seeks food, see `livestock-behaviors` presets), so the HUD's
 * notion of "hungry" lines up with the fish that are out looking for food.
 * Single source of truth — the HUD aggregate + the inspector both read it.
 */
export const HUNGRY_THRESHOLD = 0.7;

/**
 * Tolerance for the hungry comparison. The snapshot `hunger` slab is a
 * `Float32Array`, so a fish whose hunger lands exactly on the sim's f64
 * `threshold` (0.7) reads back as `f32(0.7) ≈ 0.69999998` — fractionally
 * BELOW 0.7. Without a tolerance a fish sitting right at the seek-threshold
 * would flicker out of the "hungry" count. One f32 ULP at 0.7 is ~6e-8; a
 * 1e-4 epsilon is comfortably larger than the rounding error yet far below
 * any meaningful hunger step, so it only absorbs the representation gap.
 */
const HUNGRY_EPSILON = 1e-4;

/**
 * Number of discrete "hearts" (pips) the inspector renders for a fish's
 * health. Health is a [0,1] fraction; we map it to N filled hearts so the
 * readout reads like a classic game vitality bar. Game modes (Stage 16)
 * reuse `healthToHearts` for the player fish, so the pip count lives here.
 */
export const HEART_COUNT = 5;

/** A single heart pip state for the inspector's hearts row. */
export type HeartState = 'full' | 'half' | 'empty';

/** School-level vitality aggregates derived from the snapshot slabs. */
export interface VitalityAggregate {
  /** Number of fish the aggregate covers (snapshot `entityCount`). */
  readonly count: number;
  /** Mean health across the school, [0,1]. 0 for an empty school. */
  readonly avgHealth: number;
  /** Lowest single-fish health, [0,1]. 0 for an empty school. */
  readonly minHealth: number;
  /** Count of fish at/above {@link HUNGRY_THRESHOLD} hunger. */
  readonly hungryCount: number;
  /** Fraction of the school that is hungry, [0,1]. 0 for an empty school. */
  readonly hungryFraction: number;
}

/**
 * Whether a hunger value counts as "hungry" — at/above {@link HUNGRY_THRESHOLD}
 * within {@link HUNGRY_EPSILON} (which absorbs the f32-slab representation gap
 * at exactly the threshold). Single source of truth for the aggregate + the
 * per-fish badge.
 */
export function isHungry(hunger: number): boolean {
  return hunger >= HUNGRY_THRESHOLD - HUNGRY_EPSILON;
}

/** The empty-school aggregate (no live fish). */
export const EMPTY_VITALITY: VitalityAggregate = {
  count: 0,
  avgHealth: 0,
  minHealth: 0,
  hungryCount: 0,
  hungryFraction: 0,
};

/**
 * Compute the school-level vitality aggregate from the snapshot's parallel
 * `health` + `hunger` slabs. Both slabs are length `count` and share the
 * fish order of `ids`. Pure — no snapshot retention (the caller may pass a
 * pooled view; we only read).
 *
 * Defensive: only the first `count` entries are read (the pooled slabs can
 * be longer than the live entity count), and `count` is clamped to the
 * shorter slab so a malformed pair never reads past the buffer.
 */
export function computeVitalityAggregate(
  health: ArrayLike<number>,
  hunger: ArrayLike<number>,
  count: number,
): VitalityAggregate {
  const n = Math.max(0, Math.min(count, health.length, hunger.length));
  if (n === 0) return EMPTY_VITALITY;

  let sum = 0;
  let min = Infinity;
  let hungry = 0;
  for (let i = 0; i < n; i++) {
    const h = health[i] ?? 0;
    sum += h;
    if (h < min) min = h;
    if (isHungry(hunger[i] ?? 0)) hungry += 1;
  }

  return {
    count: n,
    avgHealth: sum / n,
    minHealth: min,
    hungryCount: hungry,
    hungryFraction: hungry / n,
  };
}

/**
 * Map a [0,1] health fraction to {@link HEART_COUNT} heart pips. Each heart
 * is worth `1 / HEART_COUNT` of the bar; a fish that lands mid-heart shows a
 * half pip. Out-of-range input is clamped. Shared by the inspector and the
 * Stage-16 game player-vitality readout.
 */
export function healthToHearts(health: number, hearts: number = HEART_COUNT): HeartState[] {
  const clamped = health < 0 ? 0 : health > 1 ? 1 : health;
  // Filled hearts in halves: round to the nearest half-heart so a fish at
  // exactly one full heart's worth reads as a clean full pip.
  const halves = Math.round(clamped * hearts * 2);
  const out: HeartState[] = [];
  for (let i = 0; i < hearts; i++) {
    const heartHalves = halves - i * 2;
    if (heartHalves >= 2) out.push('full');
    else if (heartHalves === 1) out.push('half');
    else out.push('empty');
  }
  return out;
}

/**
 * Human label for a `FISH_ARCHETYPE.*` code. Mirrors the behavior-debug
 * overlay's formatter but lives here so the inspector + list share it (and
 * unit-test it). Unknown codes fall back to a neutral "fish".
 */
const ARCHETYPE_LABELS: Record<number, string> = {
  0: 'tetra',
  1: 'deep-bodied',
  2: 'barb',
  3: 'cory',
  4: 'eel',
  5: 'hatchet',
  6: 'crawler',
};

/** Resolve a `FISH_ARCHETYPE.*` code to a display label. */
export function archetypeLabel(archetype: number): string {
  return ARCHETYPE_LABELS[archetype] ?? 'fish';
}

/** Severity band for a health fraction — drives the HUD/inspector colour. */
export type VitalityBand = 'healthy' | 'stressed' | 'critical';

/** Classify a [0,1] health fraction into a colour band. */
export function vitalityBand(health: number): VitalityBand {
  if (health < 0.34) return 'critical';
  if (health < 0.67) return 'stressed';
  return 'healthy';
}

/** A single fish's vitality readout for the inspector + the selectable list. */
export interface FishVitality {
  /** ECS entity id (snapshot `ids[i]`). Stable track key + selection key. */
  readonly eid: number;
  /** Snapshot index `i` — the row in the parallel slabs. */
  readonly index: number;
  /** Health fraction, [0,1]. */
  readonly health: number;
  /** Hunger accumulator, [0,∞). */
  readonly hunger: number;
  /** True when `hunger >= HUNGRY_THRESHOLD`. */
  readonly hungry: boolean;
  /** Health hearts for the inspector / list mini-readout. */
  readonly hearts: HeartState[];
  /** Colour band for the health value. */
  readonly band: VitalityBand;
  /** Archetype code (`FISH_ARCHETYPE.*`) for a label. */
  readonly archetype: number;
  /** True when this is the marked player fish (`world.getPlayerEntity()`). */
  readonly isPlayer: boolean;
}

/**
 * Build a single fish's vitality readout from the snapshot slabs at index
 * `i`. `playerEid` is the marked player (or a sentinel that never matches);
 * `archetype` is read from the snapshot's `archetype` slab. Pure — used by
 * both the inspector and (per Stage 16) the game player-vitality panel, so
 * the player and a tapped fish render through the SAME code path.
 */
export function fishVitalityAt(
  eid: number,
  index: number,
  health: number,
  hunger: number,
  archetype: number,
  playerEid: number,
): FishVitality {
  return {
    eid,
    index,
    health,
    hunger,
    hungry: isHungry(hunger),
    hearts: healthToHearts(health),
    band: vitalityBand(health),
    archetype,
    isPlayer: eid === playerEid,
  };
}
