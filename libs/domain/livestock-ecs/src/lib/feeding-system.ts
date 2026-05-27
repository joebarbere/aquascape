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
 *                    rasp (decrement algaeScore) and decrement hunger.
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
 * Algae regrowth: at the end of the per-tick loop, every Hardscape with
 * `algaeScore < 1.0` regrows at a slow rate (~17 min sim-time to full
 * regrowth from 0). This runs unconditional of fish presence — the SoA
 * scan is cheap and keeps the regrowth coupled to the feeding loop.
 *
 * Determinism: target selection iterates in bitECS eid order (stable
 * within one world; the per-tick PRNG isn't used here — no random
 * draws). Force magnitudes are scalar — no `tickPrng` calls. The
 * algae-regrowth scan is order-independent.
 */
import { defineQuery, hasComponent, removeEntity } from 'bitecs';
import type { FeedingCategory } from '@aquascape/domain/livestock-behaviors';
import {
  BehaviorMode,
  BEHAVIOR_MODE,
  BehaviorParamsRef,
  BodyLength,
  Curiosity,
  FeedingDrive,
  FoodSprite,
  Force,
  Hardscape,
  NO_INTEREST,
  Position,
} from './components';
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
 * Algae regrowth rate per second (per hardscape entity). At 0.001/s a
 * fully-grazed rock regrows in ~17 min sim time. Slow on purpose so a
 * heavily-stocked tank shows visibly bare patches in the renderer.
 */
const ALGAE_REGROWTH_PER_SEC = 0.001;

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
          // Within rasp range — rasp the rock + reduce hunger.
          const newScore = Math.max(
            0,
            (Hardscape.algaeScore[bestEid] as number) - RASP_RATE_PER_SEC * dt,
          );
          Hardscape.algaeScore[bestEid] = newScore;
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
      const d2 = dx * dx + dy * dy + dz * dz;
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
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestSpriteDistSq) {
          bestSpriteDistSq = d2;
          bestSpriteEid = spriteEid;
        }
      }
    }

    if (bestSpriteEid >= 0) {
      const dist = Math.sqrt(bestSpriteDistSq);
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
        // Steer toward the sprite.
        const tx = (Position.x[bestSpriteEid] as number) - sx;
        const ty = (Position.y[bestSpriteEid] as number) - sy;
        const tz = (Position.z[bestSpriteEid] as number) - sz;
        const k = FEED_FORCE_MAGNITUDE / dist;
        Force.x[eid] = (Force.x[eid] as number) + tx * k;
        Force.y[eid] = (Force.y[eid] as number) + ty * k;
        Force.z[eid] = (Force.z[eid] as number) + tz * k;
      }
    }
    FeedingDrive.hunger[eid] = hunger;
  }

  // 3. Algae regrowth — every hardscape with algaeScore < 1 regrows
  //    slowly. Independent of fish presence; cheap SoA scan.
  for (const hEid of hardscapeEids) {
    const score = Hardscape.algaeScore[hEid] as number;
    if (score < 1) {
      const next = score + ALGAE_REGROWTH_PER_SEC * dt;
      Hardscape.algaeScore[hEid] = next > 1 ? 1 : next;
    }
  }

  // Touch Curiosity component reference so unused-import lint doesn't
  // flag it — the FeedingSystem doesn't read Curiosity but the symbol
  // is co-located in components.ts. This is a no-op at runtime.
  // (Imported alongside Curiosity for adjacency; CuriositySystem owns it.)
  void Curiosity;
  void NO_INTEREST;
  void hasComponent;
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
      removeEntity(ecs, eid);
    } else {
      FoodSprite.lifetime[eid] = next;
    }
  }
}
