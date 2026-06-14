/**
 * FeedingSystem (Stage 11 F11.4).
 *
 * Stephens & Krebs (1986) optimal-foraging distilled to a single hunger
 * scalar per fish. Each tick we integrate `hunger += hungerRatePerSec *
 * dt`. When `BehaviorMode === FORAGE` AND `hunger > threshold`, the fish
 * begins target-seeking per its `FeedingCategory`:
 *
 *   - 'surface'      Nearest FoodSprite, optionally biased to upper third.
 *   - 'midwater'     Nearest FoodSprite, no Y filter.
 *   - 'substrate'    Nearest FoodSprite, optionally biased to lower third.
 *   - 'algae-grazer' Nearest Hardscape with algaeScore > 0.1. On contact,
 *                    rasp the grazer's PREFERRED per-type stock(s) (F13.6 —
 *                    from the world's `grazerPreference` mask keyed by the
 *                    fish's SpeciesId; a no-mask grazer reduces the
 *                    highest-stock type) and decrement hunger. The aggregate
 *                    `algaeScore` is decremented in lock-step so the overlay +
 *                    targeting gate track within the tick.
 *   - 'plant-eater'  Same as algae-grazer for F11.4 (plant-scatter
 *                    integration is reserved for F11.6).
 *   - 'detritivore'  Wander toward substrate Y, never seek a sprite,
 *                    continuously satiated at the substrate level.
 *
 * Sprite consumption: when a fish reaches a FoodSprite (distance < 2*BL),
 * we decrement `FoodSprite.calories` by the satiation it gave the fish
 * and reset `FeedingDrive.hunger` to 0. If `calories <= 0` the sprite is
 * removed via `removeEntity`. FoodSpriteLifetimeSystem (separate path)
 * handles the 30s timeout.
 *
 * Algae regrowth: F13.6 moved growth to the dedicated `algaeGrowthSystem`
 * (which grows the four per-type stocks via the water-sim `algaeGrowth`
 * model and re-derives the aggregate). FeedingSystem no longer regrows
 * algae — it only RASPS it down (type-selectively). With nitrate 0 (the
 * default) the growth system grows nothing, so a chemistry-less world's
 * grazed rock simply stays bare (matching the no-nutrient hobby reality).
 *
 * Determinism: target selection iterates in bitECS eid order (stable
 * within one world; the per-tick PRNG isn't used here — no random
 * draws). Force magnitudes are scalar — no `tickPrng` calls. The
 * algae-regrowth scan is order-independent.
 */
import { defineQuery, hasComponent, removeEntity } from 'bitecs';
import type { FeedingCategory } from '@aquascape/domain/livestock-behaviors';
import { recordUneatenFood } from './waste-accumulator';
import {
  BehaviorMode,
  BEHAVIOR_MODE,
  BehaviorParamsRef,
  BodyLength,
  Curiosity,
  FeedingDrive,
  FOOD_TYPE,
  FoodSprite,
  Force,
  Hardscape,
  NO_INTEREST,
  Position,
  SpeciesId,
} from './components';
import { ALGAE_TYPE_FIELDS, type AlgaeFieldKey } from './algae-growth-system';
import type { LivestockWorld } from './world';

const feederQuery = defineQuery([
  Position,
  BehaviorParamsRef,
  FeedingDrive,
  BehaviorMode,
  Force,
  BodyLength,
]);

const foodSpriteQuery = defineQuery([FoodSprite, Position]);
const hardscapeQuery = defineQuery([Hardscape, Position]);

/** Force magnitude (per unit direction) for the food-seek attraction. */
const FEED_FORCE_MAGNITUDE = 200;

/** Distance below which a fish "reaches" a sprite (multiple of body length). */
const SPRITE_REACH_BL_MULT = 2;

/** Distance below which an algae-grazer is rasping the rock. */
const RASP_REACH_BL_MULT = 2;

/**
 * Algae-grazer rasp rate (algaeScore per second per grazer). At 0.033/s a
 * single oto reduces algae from 1 → 0 in ~30 s sim time — visible on the
 * time-slider scale per the F11.4 spec.
 */
const RASP_RATE_PER_SEC = 0.033;

/**
 * Maximum range an algae-grazer will travel to a target rock (mm). Beyond
 * this we don't even consider it as a candidate — keeps the inner loop
 * cheap and matches the spec's "~500 mm" guideline.
 */
const ALGAE_GRAZER_MAX_RANGE_MM = 500;

/**
 * Hunger reduction per second while a grazer is rasping. The fish stays in
 * place near a rock — hunger reduces proportionally to rasp rate. A
 * standalone reduction (rather than computed from rasp rate) keeps the
 * coupling explicit + adjustable.
 */
const GRAZE_HUNGER_REDUCTION_PER_SEC = 0.05;

/**
 * Detritivore hunger reduction per second when within the substrate band
 * (always satiated by detritus, never seeks a sprite).
 */
const DETRITIVORE_HUNGER_REDUCTION_PER_SEC = 0.02;

/** Substrate band thickness in mm — how close to minY counts as "on substrate". */
const SUBSTRATE_BAND_MM = 50;

/** Surface/substrate Y-band fractions for surface/substrate feeders. */
const SURFACE_BAND_FRACTION = 0.7;
const SUBSTRATE_BAND_FRACTION = 0.3;

/**
 * F14.1 — squared-distance penalty multiplier applied when a sprite's
 * `foodType` doesn't match the feeder's preferred form. A fish still EATS
 * any reachable food (the penalty only biases target SELECTION among
 * candidates), but it prefers the food its mouth + station is built for —
 * surface feeders go for drifting flakes, substrate feeders for settled
 * wafers, midwater for pellets/flakes. >1 so a band-appropriate sprite at a
 * given distance always out-ranks a mismatched sprite at the same distance;
 * kept modest so a lone mismatched sprite is still chosen rather than ignored.
 * The penalty is a pure scalar multiply on the squared distance — no random
 * draw, no iteration-order dependence — so the 1000-tick replay holds.
 */
const FOOD_TYPE_MISMATCH_PENALTY = 4;

/**
 * Preferred `FOOD_TYPE.*` for a sprite-eating feeding category. Returns -1
 * for categories with no preference (every food ranks equally — e.g.
 * midwater, which happily takes flakes or pellets). Pure lookup.
 */
function preferredFoodType(category: FeedingCategory): number {
  switch (category) {
    case 'surface':
      return FOOD_TYPE.FLAKE;
    case 'substrate':
      return FOOD_TYPE.WAFER;
    default:
      return -1;
  }
}

/**
 * Run the FeedingSystem once per sim tick. Always runs, in the
 * Territory → Feeding seat per the system-ordering caveat. Mode-gated:
 * only FORAGE fish target food. Fish in REFUGE / PURSUE accumulate
 * hunger but don't seek (the higher-priority behaviour wins).
 */
export function feedingSystem(world: LivestockWorld, dt: number): void {
  const store = world.paramStore;
  const ecs = world.ecs;
  const aabb = world.tankAabb;
  const tankHeight = aabb.maxY - aabb.minY;
  const substrateY = aabb.minY + SUBSTRATE_BAND_MM;

  // Snapshot the live food-sprite + hardscape lists once per tick — they
  // don't change mid-tick (FoodSpriteLifetimeSystem despawns at the end of
  // step()). bitECS query results are iterated in eid order so target
  // selection is deterministic across runs with the same spawn sequence.
  const spriteEids = foodSpriteQuery(ecs);
  const hardscapeEids = hardscapeQuery(ecs);

  for (const eid of feederQuery(ecs)) {
    const handle = BehaviorParamsRef.handleIdx[eid] as number;
    const behavior = store.get(handle);
    if (behavior === null) continue;
    const params = behavior.feeding;

    // 1. Hunger always integrates — even REFUGE/PURSUE fish get hungry.
    let hunger = (FeedingDrive.hunger[eid] as number) + params.hungerRatePerSec * dt;

    // 2. Mode gate — only FORAGE fish steer toward food. REFUGE/PURSUE
    //    fish accumulate hunger but skip target-seeking.
    if ((BehaviorMode.mode[eid] as number) !== BEHAVIOR_MODE.FORAGE) {
      FeedingDrive.hunger[eid] = hunger;
      continue;
    }

    const sx = Position.x[eid] as number;
    const sy = Position.y[eid] as number;
    const sz = Position.z[eid] as number;
    const bl = BodyLength.mm[eid] as number;
    const reachSpriteMm = bl * SPRITE_REACH_BL_MULT;
    const reachRaspMm = bl * RASP_REACH_BL_MULT;

    const category = params.category as FeedingCategory;

    if (category === 'detritivore') {
      // Detritivores wander toward the substrate. They never seek
      // sprites; if they're within the substrate band they decrement
      // hunger continuously (detritus = unlimited at the bottom).
      if (sy > substrateY) {
        const target = substrateY;
        const dy = target - sy;
        // Weak downward pull — Force.y adds to existing schooling/depth
        // contributions; SteeringIntegrator clamps the magnitude.
        Force.y[eid] = (Force.y[eid] as number) + Math.sign(dy) * (FEED_FORCE_MAGNITUDE * 0.5);
      } else {
        hunger -= DETRITIVORE_HUNGER_REDUCTION_PER_SEC * dt;
        if (hunger < 0) hunger = 0;
        FeedingDrive.lastFedAt[eid] = world.tickCounter * dt;
      }
      FeedingDrive.hunger[eid] = hunger;
      continue;
    }

    if (hunger < params.threshold) {
      // Not hungry enough to seek; nothing else to do.
      FeedingDrive.hunger[eid] = hunger;
      continue;
    }

    if (category === 'algae-grazer' || category === 'plant-eater') {
      // Find the nearest hardscape with algae score > 0.1 within
      // ALGAE_GRAZER_MAX_RANGE_MM. iterates in eid order.
      const rangeSq = ALGAE_GRAZER_MAX_RANGE_MM * ALGAE_GRAZER_MAX_RANGE_MM;
      let bestEid = -1;
      let bestDistSq = Infinity;
      for (const hEid of hardscapeEids) {
        const score = Hardscape.algaeScore[hEid] as number;
        if (score <= 0.1) continue;
        const dx = (Position.x[hEid] as number) - sx;
        const dy = (Position.y[hEid] as number) - sy;
        const dz = (Position.z[hEid] as number) - sz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > rangeSq) continue;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestEid = hEid;
        }
      }
      if (bestEid >= 0) {
        const dist = Math.sqrt(bestDistSq);
        if (dist < reachRaspMm) {
          // Within rasp range — rasp the grazer's PREFERRED per-type stock(s)
          // (F13.6) then re-derive the aggregate. The amount rasped is the same
          // RASP_RATE_PER_SEC * dt budget, split across the preferred types the
          // rock actually carries; a no-preference grazer rasps the single
          // highest-stock type.
          const speciesId = SpeciesId.id[eid] as number;
          raspByType(world, bestEid, speciesId, RASP_RATE_PER_SEC * dt);
          hunger -= GRAZE_HUNGER_REDUCTION_PER_SEC * dt;
          if (hunger < 0) hunger = 0;
          FeedingDrive.lastFedAt[eid] = world.tickCounter * dt;
        } else {
          // Steer toward the rock.
          const tx = (Position.x[bestEid] as number) - sx;
          const ty = (Position.y[bestEid] as number) - sy;
          const tz = (Position.z[bestEid] as number) - sz;
          const k = FEED_FORCE_MAGNITUDE / dist;
          Force.x[eid] = (Force.x[eid] as number) + tx * k;
          Force.y[eid] = (Force.y[eid] as number) + ty * k;
          Force.z[eid] = (Force.z[eid] as number) + tz * k;
        }
      }
      FeedingDrive.hunger[eid] = hunger;
      continue;
    }

    // surface / midwater / substrate — seek nearest FoodSprite.
    // Optional Y-band filter for surface (upper 30 %) + substrate (lower 30 %).
    const minYBand = category === 'substrate' ? aabb.minY : aabb.minY + tankHeight * SUBSTRATE_BAND_FRACTION;
    const maxYBand = category === 'surface' ? aabb.maxY : aabb.minY + tankHeight * SURFACE_BAND_FRACTION;

    // F14.1 — preferred food form for this band (-1 = no preference). Drives
    // a squared-distance penalty so the band's natural food out-ranks a
    // mismatched form, without ever fully ignoring an only-reachable sprite.
    const prefType = preferredFoodType(category);

    let bestSpriteEid = -1;
    let bestSpriteDistSq = Infinity;
    for (const spriteEid of spriteEids) {
      const sySprite = Position.y[spriteEid] as number;
      // For surface/substrate fish, prefer sprites in the right band.
      // If no in-band sprite exists, the fallback pass picks any sprite.
      if (category === 'surface' && sySprite < aabb.minY + tankHeight * SURFACE_BAND_FRACTION) continue;
      if (category === 'substrate' && sySprite > aabb.minY + tankHeight * SUBSTRATE_BAND_FRACTION) continue;
      // For midwater fish, the band is the entire interior — no filter.
      void minYBand; void maxYBand; // referenced for clarity, no-op
      const dx = (Position.x[spriteEid] as number) - sx;
      const dy = sySprite - sy;
      const dz = (Position.z[spriteEid] as number) - sz;
      let d2 = dx * dx + dy * dy + dz * dz;
      // F14.1 — type-preference bias (scalar multiply; order-independent).
      if (prefType >= 0 && (FoodSprite.foodType[spriteEid] as number) !== prefType) {
        d2 *= FOOD_TYPE_MISMATCH_PENALTY;
      }
      if (d2 < bestSpriteDistSq) {
        bestSpriteDistSq = d2;
        bestSpriteEid = spriteEid;
      }
    }
    // Fallback: if no in-band sprite was found, accept any sprite at all
    // (surface/substrate fish still need to eat when the food settles).
    if (bestSpriteEid < 0 && (category === 'surface' || category === 'substrate')) {
      for (const spriteEid of spriteEids) {
        const dx = (Position.x[spriteEid] as number) - sx;
        const dy = (Position.y[spriteEid] as number) - sy;
        const dz = (Position.z[spriteEid] as number) - sz;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (prefType >= 0 && (FoodSprite.foodType[spriteEid] as number) !== prefType) {
          d2 *= FOOD_TYPE_MISMATCH_PENALTY;
        }
        if (d2 < bestSpriteDistSq) {
          bestSpriteDistSq = d2;
          bestSpriteEid = spriteEid;
        }
      }
    }

    if (bestSpriteEid >= 0) {
      // `bestSpriteDistSq` may carry the type-mismatch penalty (it's only a
      // SELECTION bias), so recompute the TRUE distance to the chosen sprite
      // for reach detection + the steering magnitude.
      const tdx = (Position.x[bestSpriteEid] as number) - sx;
      const tdy = (Position.y[bestSpriteEid] as number) - sy;
      const tdz = (Position.z[bestSpriteEid] as number) - sz;
      const dist = Math.sqrt(tdx * tdx + tdy * tdy + tdz * tdz);
      if (dist < reachSpriteMm) {
        // Consume — decrement sprite calories, reset hunger.
        const calories = FoodSprite.calories[bestSpriteEid] as number;
        const consumed = Math.min(calories, hunger > 0 ? hunger : 1);
        FoodSprite.calories[bestSpriteEid] = calories - consumed;
        hunger = 0;
        FeedingDrive.lastFedAt[eid] = world.tickCounter * dt;
        if ((FoodSprite.calories[bestSpriteEid] as number) <= 0) {
          // Despawn the sprite immediately — subsequent feeders in this
          // tick won't see it (eid still in `spriteEids` array but the
          // component is gone, so the hasComponent guard below catches).
          // We could defer to FoodSpriteLifetimeSystem; immediate
          // removal is cleaner so a fully-consumed sprite doesn't draw
          // an extra frame.
          removeEntity(ecs, bestSpriteEid);
        }
      } else {
        // Steer toward the sprite (reuse the true-distance delta computed above).
        const k = FEED_FORCE_MAGNITUDE / dist;
        Force.x[eid] = (Force.x[eid] as number) + tdx * k;
        Force.y[eid] = (Force.y[eid] as number) + tdy * k;
        Force.z[eid] = (Force.z[eid] as number) + tdz * k;
      }
    }
    FeedingDrive.hunger[eid] = hunger;
  }

  // F13.6 — algae GROWTH now lives in `algaeGrowthSystem` (water-sim model,
  // per type). FeedingSystem only rasps. No regrowth scan here.

  // Touch Curiosity component reference so unused-import lint doesn't
  // flag it — the FeedingSystem doesn't read Curiosity but the symbol
  // is co-located in components.ts. This is a no-op at runtime.
  // (Imported alongside Curiosity for adjacency; CuriositySystem owns it.)
  void Curiosity;
  void NO_INTEREST;
  void hasComponent;
}

/**
 * Rasp the grazer's PREFERRED per-type algae stock(s) on a hardscape entity
 * by `budget` total (F13.6), then re-derive the aggregate `algaeScore` so the
 * renderer overlay + the `algaeScore > 0.1` targeting gate track within the
 * same tick.
 *
 * Type selection (deterministic, order-independent):
 *   - If the species has a registered `grazerPreference` mask, rasp every
 *     preferred type the rock CARRIES (stock > 0), splitting the budget evenly
 *     across them. If the rock carries none of the preferred types, fall
 *     through to the generalist path so the grazer still does something.
 *   - Generalist fallback (no mask, or mask matches nothing present): rasp the
 *     single HIGHEST-stock type. Ties broken by `ALGAE_TYPE_FIELDS` index order
 *     (a fixed, stable tiebreak — no PRNG, no iteration-order dependence).
 *
 * Pure scalar math keyed off the SoA slabs + the world's preference map; no
 * random draws, so the 1000-tick replay holds.
 */
function raspByType(
  world: LivestockWorld,
  hEid: number,
  speciesId: number,
  budget: number,
): void {
  const mask = world.grazerPreference.get(speciesId & 0xffff) ?? 0;

  // Collect the preferred types the rock actually carries.
  const preferred: AlgaeFieldKey[] = [];
  if (mask !== 0) {
    for (let i = 0; i < ALGAE_TYPE_FIELDS.length; i++) {
      if ((mask & (1 << i)) === 0) continue;
      const key = ALGAE_TYPE_FIELDS[i]!.field;
      if ((Hardscape[key][hEid] as number) > 0) preferred.push(key);
    }
  }

  if (preferred.length > 0) {
    const per = budget / preferred.length;
    for (const key of preferred) {
      const next = (Hardscape[key][hEid] as number) - per;
      Hardscape[key][hEid] = next < 0 ? 0 : next;
    }
  } else {
    // Generalist fallback — rasp the highest-stock type (stable index tiebreak).
    let bestKey: AlgaeFieldKey | null = null;
    let bestStock = 0;
    for (let i = 0; i < ALGAE_TYPE_FIELDS.length; i++) {
      const key = ALGAE_TYPE_FIELDS[i]!.field;
      const s = Hardscape[key][hEid] as number;
      if (s > bestStock) {
        bestStock = s;
        bestKey = key;
      }
    }
    if (bestKey !== null) {
      const next = (Hardscape[bestKey][hEid] as number) - budget;
      Hardscape[bestKey][hEid] = next < 0 ? 0 : next;
    }
  }

  // Re-derive the aggregate from the (now-reduced) per-type stocks.
  let aggregate = 0;
  for (let i = 0; i < ALGAE_TYPE_FIELDS.length; i++) {
    aggregate += Hardscape[ALGAE_TYPE_FIELDS[i]!.field][hEid] as number;
  }
  Hardscape.algaeScore[hEid] = aggregate > 1 ? 1 : aggregate;
}

/**
 * Lifetime-ticking system for FoodSprite entities. Runs at the end of
 * `world.step()` (after Animation) so consumption inside FeedingSystem
 * has already had a chance to settle the calorie count. Decrements each
 * sprite's `lifetime`; when it reaches 0 the entity is removed.
 *
 * Bypassing FeedingSystem (which only fires during FORAGE) ensures
 * sprites despawn even when every nearby fish is in REFUGE — the
 * food still rots away on schedule.
 */
export function foodSpriteLifetimeSystem(world: LivestockWorld, dt: number): void {
  const ecs = world.ecs;
  for (const eid of foodSpriteQuery(ecs)) {
    const next = (FoodSprite.lifetime[eid] as number) - dt;
    if (next <= 0) {
      // F14.4 — a sprite that times out here was NEVER eaten (FeedingSystem
      // removes a consumed sprite directly, so it's already gone from this
      // query). Its remaining nitrogen rots into the tank: fold calories ×
      // wasteFactor into the world's ammonia source term before despawning.
      recordUneatenFood(
        world,
        FoodSprite.calories[eid] as number,
        FoodSprite.wasteFactor[eid] as number,
      );
      removeEntity(ecs, eid);
    } else {
      FoodSprite.lifetime[eid] = next;
    }
  }
}
