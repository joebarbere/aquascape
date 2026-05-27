/**
 * F11.6 perf benchmark — the < 4 ms ECS step budget at n=200 fish.
 *
 * To run this benchmark locally:
 *   BENCH=1 pnpm exec nx test domain-livestock-ecs -t perf-bench
 *
 * CI does NOT run this — it's a developer-machine sanity check, and the
 * numbers are machine-dependent (CPU clock, thermal state, background
 * load all swing the result). The hard correctness guarantees — no
 * per-tick allocation, byte-identical determinism — live in the
 * system-level specs + `determinism.spec.ts`. This bench is the
 * end-to-end "yes, the 4 ms budget holds" gate.
 *
 * What it builds:
 *   - 5 species × 40 fish = 200 fish (varying TOP / MID / BOTTOM presets +
 *     two custom presets that exercise the nipping + territorial paths).
 *   - 5 hardscape entries (3 rocks + 2 wood) → CollisionSystem's SDF pass +
 *     auto-anchor for territorial fish.
 *   - 2 air-stone bubble sources → spawn-debt accumulator + lifetime decay.
 *   - 1 baked FlowField from a single filter outflow → FlowFieldSystem
 *     trilinear sample on every tick.
 *   - 8 FoodSprites spawned up-front → FeedingSystem nearest-target search.
 *   - Tank AABB 1000 × 400 × 400 mm (canonical default).
 *
 * Warm-up = 60 ticks (let bitECS' eid allocator stabilize, let fish reach
 * steady-state distribution). Measure = 1000 timed `world.step(SIM_DT)`
 * calls via `performance.now()` deltas.
 *
 * Assertion: p95 tick time ≤ 4 ms.
 */
import {
  BOTTOM_PRESET,
  MID_PRESET,
  TOP_PRESET,
  type ResolvedBehavior,
} from '@aquascape/domain/livestock-behaviors';
import { bakeFlowField } from '@aquascape/domain/fluid-sim';
import {
  createLivestockWorld,
  FISH_ARCHETYPE,
  HARDSCAPE_CATEGORY,
  SIM_DT,
  type LivestockWorld,
  type TankAabb,
} from '../index';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };
const SEED = 0xb16f00d5;
const FISH_PER_SPECIES = 40;
const SPECIES_COUNT = 5;
const TOTAL_FISH = FISH_PER_SPECIES * SPECIES_COUNT; // 200
const WARMUP_TICKS = 60;
const MEASURED_TICKS = 1000;
const P95_BUDGET_MS = 4;

const BENCH_ENABLED = process.env['BENCH'] === '1';
// `describe.skip` keeps `nx test ... --configuration=ci` (and any unguarded
// `nx test domain-livestock-ecs`) fast — no warm-up, no 1000-tick loop.
const bench = BENCH_ENABLED ? describe : describe.skip;

/** Build a fully-populated F11.5 stack world with 200 fish + props. */
function buildWorld(): LivestockWorld {
  const w = createLivestockWorld(SEED, { tankAabb: TANK });

  // ─── Species presets ───────────────────────────────────────────────────
  // Five distinct behaviour rows — one per group so the per-tick path
  // touches TOP / MID / BOTTOM resolver branches, plus a nipping barb
  // variant and a territorial ram variant so the F11.3 systems run with
  // their non-trivial bodies (not just early-out checks).
  const nipperBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
  nipperBehavior.nipping = { groupThreshold: 8, finFraction: 0.4, rate: 0.5 };
  const territorialBehavior: ResolvedBehavior = JSON.parse(JSON.stringify(MID_PRESET));
  territorialBehavior.territory = {
    coreRadius: 80,
    displayRadius: 150,
    aggression: 100,
    fatigueRate: 0.08,
  };

  const handles = [
    w.registerSpeciesBehavior(1, MID_PRESET),
    w.registerSpeciesBehavior(2, TOP_PRESET),
    w.registerSpeciesBehavior(3, BOTTOM_PRESET),
    w.registerSpeciesBehavior(4, nipperBehavior),
    w.registerSpeciesBehavior(5, territorialBehavior),
  ];
  const archetypes = [
    FISH_ARCHETYPE.SLIM_TETRA,
    FISH_ARCHETYPE.HATCHET_WEDGE,
    FISH_ARCHETYPE.CORY_CYLINDER,
    FISH_ARCHETYPE.BARB,
    FISH_ARCHETYPE.DEEP_BODIED,
  ];
  // Preferred Y per band — keep the spawn distribution roughly in the
  // species' depth band so warm-up doesn't burn 60 ticks just rebalancing
  // every fish from the top to the bottom (or vice versa).
  const preferredY = [200, 360, 40, 180, 200];

  // ─── Hardscape (5 entries) ─────────────────────────────────────────────
  // Three rocks + two wood pieces. Wood = preferred refuge for bottom
  // dwellers (BOTTOM_PRESET.fear.coverPreference === 'wood'); rocks +
  // wood both auto-anchor territorial fish + grow algae.
  w.registerHardscape([
    { position: { x: 200, y: 80, z: 150 }, coverScore: 0.5, category: HARDSCAPE_CATEGORY.ROCK },
    { position: { x: 500, y: 90, z: 300 }, coverScore: 0.7, category: HARDSCAPE_CATEGORY.ROCK },
    { position: { x: 800, y: 70, z: 200 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    { position: { x: 350, y: 50, z: 350 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
    { position: { x: 650, y: 60, z: 100 }, coverScore: 0.5, category: HARDSCAPE_CATEGORY.WOOD },
  ]);

  // ─── Flow field (1 filter source) ──────────────────────────────────────
  // Single outflow at the back-right corner, ~200 mL/min. Drives a non-
  // trivial trilinear sample on every fish every tick.
  const flowField = bakeFlowField({
    tankAabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 1000, y: 400, z: 400 } },
    sources: [
      {
        outflowPos: { x: 950, y: 300, z: 200 },
        outflowVec: { x: -1, y: 0, z: 0 },
        intakePos: { x: 950, y: 50, z: 200 },
        flowRate: 200,
      },
    ],
  });
  w.registerFlowField(flowField);
  // NOTE: we intentionally do NOT register a HardscapeSdf bake — the F11.6
  // production path is to leave the SDF null when no rocks need fine-
  // grained collision (the fish-vs-fish separation pass still runs). If a
  // future caveat surfaces an `SDF on every scene` policy, add the bake
  // here. Until then, this matches the typical live scene.

  // ─── Bubble sources (2 air-stones) ─────────────────────────────────────
  w.registerBubbleSources([
    { position: { x: 200, y: 20, z: 100 }, airRateMl: 400 },
    { position: { x: 800, y: 20, z: 300 }, airRateMl: 700 },
  ]);

  // ─── Fish (200) ────────────────────────────────────────────────────────
  // Round-robin across species so warm-up sees a representative mix of
  // schooling neighbours immediately. Spawn positions are spread across
  // the tank with a tiny per-fish offset to avoid coincident positions
  // (which would make the SpatialGrid degenerate). Deterministic offset
  // pattern, no Math.random.
  for (let s = 0; s < SPECIES_COUNT; s++) {
    const handle = handles[s] as number;
    const archetype = archetypes[s] as number;
    const py = preferredY[s] as number;
    for (let i = 0; i < FISH_PER_SPECIES; i++) {
      // Lay each species' fleet out in a rough column inside the tank,
      // staggered along x by ~150 mm per species so they don't all start
      // on top of each other.
      const x = 100 + s * 150 + (i % 8) * 15;
      const z = 100 + Math.floor(i / 8) * 30;
      w.spawnFish({
        archetype,
        speciesId: s + 1,
        bodyLengthMm: 30,
        position: { x, y: py, z },
        behaviorHandleIdx: handle,
      });
    }
  }

  // ─── Food sprites (8) ──────────────────────────────────────────────────
  // Long lifetime so they survive the entire 1000-tick measurement window
  // — FeedingSystem's nearest-target search runs every tick for every
  // hungry fish regardless.
  for (let i = 0; i < 8; i++) {
    w.spawnFoodSprite({ x: 150 + i * 100, y: 350, z: 200 }, 120, 5);
  }

  return w;
}

/** Compute a percentile from a *sorted ascending* sample array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank method — small N here (1000), no need for linear
  // interpolation. `Math.ceil` keeps us slightly conservative which is
  // exactly what a budget gate wants.
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const idx = rank < 0 ? 0 : rank >= sorted.length ? sorted.length - 1 : rank;
  return sorted[idx] as number;
}

bench('F11.6 perf budget — 200 fish, full F11.5 stack', () => {
  // 10-second timeout headroom for the bench loop. Default Jest timeout
  // (5 s) would flake on slower machines or under contention; the bench
  // body is bounded by `MEASURED_TICKS + WARMUP_TICKS` deterministic
  // steps and a single sort, so 60 s is comfortable.
  jest.setTimeout(60_000);

  it(`p95 tick time stays under ${P95_BUDGET_MS} ms`, () => {
    const w = buildWorld();

    // Sanity-check the world is actually populated. If a refactor breaks
    // any of these, the budget assertion below would silently pass on
    // an empty world.
    expect(w.getHardscapeCount()).toBe(5);
    expect(w.getBubbleSourceCount()).toBe(2);
    expect(w.getFoodSpriteCount()).toBe(8);
    expect(w.getFlowField()).not.toBeNull();

    // ─── Warm-up ─────────────────────────────────────────────────────────
    for (let i = 0; i < WARMUP_TICKS; i++) w.step(SIM_DT);

    // ─── Measured loop ───────────────────────────────────────────────────
    // Pre-allocated samples buffer so the measurement loop itself does no
    // allocation. `performance.now()` is the Node-builtin global, available
    // in the jest `node` test environment without import.
    const samples = new Float64Array(MEASURED_TICKS);
    for (let i = 0; i < MEASURED_TICKS; i++) {
      const t0 = performance.now();
      w.step(SIM_DT);
      samples[i] = performance.now() - t0;
    }

    // ─── Stats ───────────────────────────────────────────────────────────
    // Copy into a regular Array so .sort + percentile is the obvious
    // implementation. Float64Array.sort is fine too but this side runs
    // exactly once per bench invocation.
    const arr = Array.from(samples).sort((a, b) => a - b);
    const sum = arr.reduce((acc, v) => acc + v, 0);
    const mean = sum / arr.length;
    const median = percentile(arr, 50);
    const p95 = percentile(arr, 95);
    const p99 = percentile(arr, 99);
    const max = arr[arr.length - 1] as number;

    console.log(
      [
        '',
        `=== F11.6 ECS step bench (n=${TOTAL_FISH} fish, ${MEASURED_TICKS} ticks) ===`,
        `  mean   = ${mean.toFixed(3)} ms`,
        `  median = ${median.toFixed(3)} ms`,
        `  p95    = ${p95.toFixed(3)} ms  (budget ${P95_BUDGET_MS} ms)`,
        `  p99    = ${p99.toFixed(3)} ms`,
        `  max    = ${max.toFixed(3)} ms`,
        '',
      ].join('\n'),
    );

    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  });
});
