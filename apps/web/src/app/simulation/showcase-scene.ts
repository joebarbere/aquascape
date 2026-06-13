// The showcase-demo scene. Stage "app modes".
//
// `createShowcaseScene()` hand-authors a large, richly-populated aquascape
// that the borderless-fullscreen simulation mode loads at startup (see
// `app-mode.ts` + the demo activation in `app.component.ts`). It is a normal
// `Scene` — the same shape the editor produces and both renderers consume —
// so nothing downstream needs to know it came from the demo path.
//
// DETERMINISM. Object/layer ids are stable strings (not minted UUIDs) and
// all positional jitter comes from a seeded `mulberry32`, so two boots
// produce byte-identical scenes. That matters because the livestock sim
// derives its spawn PRNG from `scene.seed` + entity ids — a stable scene
// keeps the 3D shoal reproducible across demo launches.
//
// The tank is a 1500 × 600 × 600 mm (~540 L) six-foot show tank. The
// renderer clamps hardscape/plant/decor AABBs inside the glass, rests decor
// on the substrate, and band-remaps Z by layer zone, so the positions below
// are authoring intent — the 3D scene-builders do the final placement.

import type { Transform } from '@aquascape/domain/geometry';
import {
  asLayerId,
  asObjectId,
  identityTransform,
  type CatalogRef,
  type DecorObject,
  type EquipmentEntry,
  type HardscapeObject,
  type Layer,
  type LivestockEntry,
  type PlantObject,
  type Scene,
} from '@aquascape/domain/scene-model';

/** Deterministic seed for the whole showcase (scatter, jitter, fish spawn). */
const SHOWCASE_SEED = 20_240_613;

const TANK = { width: 1500, height: 600, depth: 600 } as const;

/** A `core`-catalog reference at version 1 (every shipped manifest is v1). */
function ref(id: string): CatalogRef {
  return { catalog: 'core', id, version: 1 };
}

/** Tiny deterministic PRNG so the jitter is reproducible without crypto. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Placement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A transform at a world position with seeded yaw + uniform-scale jitter. */
function placedTransform(p: Placement, rand: () => number): Transform {
  const yaw = (rand() - 0.5) * Math.PI; // ±90° about the vertical axis
  const s = 0.85 + rand() * 0.5; // 0.85×–1.35× uniform scale
  return {
    ...identityTransform(),
    position: { x: p.x, y: p.y, z: p.z },
    rotation: { x: 0, y: yaw, z: 0 },
    scale: { x: s, y: s, z: s },
  };
}

function hardscape(
  p: Placement,
  catalogId: string,
  category: 'rock' | 'wood',
  rand: () => number,
): HardscapeObject {
  return {
    kind: 'hardscape',
    id: asObjectId(`demo-hs-${p.id}`),
    ref: ref(catalogId),
    category,
    transform: placedTransform(p, rand),
  };
}

function plant(
  p: Placement,
  catalogId: string,
  zone: 'foreground' | 'midground' | 'background',
  rand: () => number,
): PlantObject {
  return {
    kind: 'plant',
    id: asObjectId(`demo-pl-${p.id}`),
    ref: ref(catalogId),
    zone,
    growth: { ageWeeks: 26, vigor: 0.9 + rand() * 0.4 },
    transform: placedTransform(p, rand),
  };
}

function decor(p: Placement, catalogId: string, rand: () => number): DecorObject {
  return {
    kind: 'decor',
    id: asObjectId(`demo-dc-${p.id}`),
    ref: ref(catalogId),
    transform: placedTransform(p, rand),
  };
}

/** Spread `count` placements of one species along an x-band with z jitter. */
function band(
  prefix: string,
  count: number,
  x0: number,
  x1: number,
  zMid: number,
  zJitter: number,
  y: number,
  rand: () => number,
): Placement[] {
  const out: Placement[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = x0 + (x1 - x0) * t + (rand() - 0.5) * 60;
    const z = zMid + (rand() - 0.5) * 2 * zJitter;
    out.push({ id: `${prefix}-${i}`, x, y, z });
  }
  return out;
}

/**
 * Build the showcase demo scene. Pure + deterministic — every call returns
 * an identical scene (same ids, same jitter), so it is safe to call from the
 * activation path and from tests.
 */
export function createShowcaseScene(): Scene {
  const rand = mulberry32(SHOWCASE_SEED);

  // ── Hardscape — two stone mounds framing a central driftwood sweep ──────
  const rocks: HardscapeObject[] = [
    hardscape({ id: 'l1', x: 350, y: 90, z: 380 }, 'rock.seiryu.large', 'rock', rand),
    hardscape({ id: 'l2', x: 250, y: 70, z: 300 }, 'rock.seiryu.medium', 'rock', rand),
    hardscape({ id: 'l3', x: 460, y: 70, z: 430 }, 'rock.ohko.medium', 'rock', rand),
    hardscape({ id: 'l4', x: 300, y: 60, z: 250 }, 'rock.pagoda.medium', 'rock', rand),
    hardscape({ id: 'r1', x: 1140, y: 90, z: 360 }, 'rock.seiryu.large', 'rock', rand),
    hardscape({ id: 'r2', x: 1240, y: 70, z: 300 }, 'rock.seiryu.medium', 'rock', rand),
    hardscape({ id: 'r3', x: 1030, y: 70, z: 430 }, 'rock.black-lava.medium', 'rock', rand),
    hardscape({ id: 'r4', x: 1190, y: 60, z: 250 }, 'rock.elephant-skin.medium', 'rock', rand),
    hardscape({ id: 'c1', x: 760, y: 60, z: 460 }, 'rock.snow-mountain.medium', 'rock', rand),
  ];
  const wood: HardscapeObject[] = [
    hardscape({ id: 'w1', x: 700, y: 120, z: 360 }, 'wood.manzanita.large', 'wood', rand),
    hardscape({ id: 'w2', x: 860, y: 100, z: 320 }, 'wood.redmoor.medium', 'wood', rand),
    hardscape({ id: 'w3', x: 560, y: 90, z: 300 }, 'wood.spiderwood.medium', 'wood', rand),
    hardscape({ id: 'w4', x: 960, y: 110, z: 400 }, 'wood.bonsai.medium', 'wood', rand),
    hardscape({ id: 'w5', x: 440, y: 80, z: 470 }, 'wood.malaysian.medium', 'wood', rand),
  ];

  // ── Decor — a handful of classic ornaments dotted around the floor ──────
  const decorPieces: DecorObject[] = [
    decor({ id: 'galleon', x: 1300, y: 80, z: 450 }, 'decor.sunken-galleon', rand),
    decor({ id: 'chest', x: 180, y: 60, z: 240 }, 'decor.treasure-chest', rand),
    decor({ id: 'column', x: 770, y: 80, z: 500 }, 'decor.greek-column', rand),
    decor({ id: 'moai', x: 1050, y: 80, z: 170 }, 'decor.moai', rand),
    decor({ id: 'amphora', x: 520, y: 60, z: 190 }, 'decor.amphora', rand),
  ];

  // ── Background — tall stems across the rear glass ───────────────────────
  const bgSpecies: Array<[string, number]> = [
    ['plant.vallisneria.spiralis', 7],
    ['plant.rotala.rotundifolia', 7],
    ['plant.ludwigia.repens', 6],
    ['plant.limnophila.sessiliflora', 6],
    ['plant.pogostemon.stellatus', 5],
    ['plant.hygrophila.polysperma', 5],
    ['plant.myriophyllum.mattogrossense', 5],
    ['plant.ammannia.gracilis', 4],
  ];
  const background: PlantObject[] = bgSpecies.flatMap(([id, n], si) =>
    band(`bg${si}`, n, 90, 1410, 540, 40, 110, rand).map((p) => plant(p, id, 'background', rand)),
  );

  // ── Midground — leafy epiphytes nestled around the hardscape ────────────
  const midSpecies: Array<[string, number]> = [
    ['plant.anubias.barteri', 6],
    ['plant.bucephalandra.kedagang', 6],
    ['plant.cryptocoryne.wendtii', 6],
    ['plant.microsorum.pteropus', 5],
    ['plant.staurogyne.repens', 5],
    ['plant.pogostemon.helferi', 4],
  ];
  const midground: PlantObject[] = midSpecies.flatMap(([id, n], si) =>
    band(`mg${si}`, n, 200, 1300, 350, 110, 95, rand).map((p) => plant(p, id, 'midground', rand)),
  );

  // ── Foreground carpets — scatter-filled front strip ─────────────────────
  const carpetSpecies: Array<[string, number, number]> = [
    // [catalogId, density, zBack] — three overlapping carpet swaths.
    ['plant.eleocharis.acicularis', 38, 230],
    ['plant.micranthemum.monte-carlo', 34, 170],
    ['plant.glossostigma.elatinoides', 32, 120],
  ];
  const carpet: PlantObject[] = carpetSpecies.map(([id, density, zBack], i) => ({
    kind: 'plant',
    id: asObjectId(`demo-carpet-${i}`),
    ref: ref(id),
    zone: 'foreground',
    growth: { ageWeeks: 20, vigor: 1 },
    transform: {
      ...identityTransform(),
      position: { x: TANK.width / 2, y: 80, z: zBack / 2 },
    },
    scatter: {
      // Footprint polygon in tank XZ-mm: a wide band across the front floor.
      polygon: [
        { x: 90, y: 50 },
        { x: TANK.width - 90, y: 50 },
        { x: TANK.width - 90, y: zBack },
        { x: 90, y: zBack },
      ],
      density,
      seed: SHOWCASE_SEED + i,
    },
  }));

  const layers: Layer[] = [
    {
      id: asLayerId('demo-layer-background'),
      name: 'Background Plants',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'background',
      objects: background,
    },
    {
      id: asLayerId('demo-layer-hardscape'),
      name: 'Hardscape',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'midground',
      objects: [...rocks, ...wood],
    },
    {
      id: asLayerId('demo-layer-decor'),
      name: 'Decor',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'midground',
      objects: decorPieces,
    },
    {
      id: asLayerId('demo-layer-midground'),
      name: 'Midground Plants',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'midground',
      objects: midground,
    },
    {
      id: asLayerId('demo-layer-carpet'),
      name: 'Carpet',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'foreground',
      objects: carpet,
    },
  ];

  // ── Livestock — four mid-water schooling shoals ────────────────────────
  const livestock: LivestockEntry[] = [
    ['livestock.fish.neon-tetra', 36],
    ['livestock.fish.cardinal-tetra', 28],
    ['livestock.fish.ember-tetra', 22],
    ['livestock.fish.harlequin-rasbora', 22],
  ].map(([id, quantity]) => ({
    id: `demo-ls-${(id as string).split('.').pop()}`,
    ref: ref(id as string),
    quantity: quantity as number,
  }));

  // ── Equipment — lights span the rim; filter + air drive flow + bubbles ──
  const equipment: EquipmentEntry[] = [
    { id: 'demo-eq-light-kessil', ref: ref('equipment.light.kessil-a360x-tuna-sun') },
    { id: 'demo-eq-light-twinstar', ref: ref('equipment.light.twinstar-600s') },
    { id: 'demo-eq-light-ada', ref: ref('equipment.light.ada-solar-rgb') },
    { id: 'demo-eq-filter', ref: ref('equipment.filter.eheim-pro-4-plus-350') },
    { id: 'demo-eq-air', ref: ref('equipment.filter.aquaneat-triple-sponge') },
    { id: 'demo-eq-heater', ref: ref('equipment.heater.fluval-e300') },
    { id: 'demo-eq-co2', ref: ref('equipment.co2.co2art-se-pressurised') },
  ];

  return {
    tank: {
      width: TANK.width,
      height: TANK.height,
      depth: TANK.depth,
      glassThickness: 12,
      waterLevelMm: 575,
      style: {
        frame: 'rimless',
        waterTint: '#e9f6f8',
        background: {
          kind: 'gradient',
          angle: Math.PI / 2,
          stops: [
            { at: 0, color: '#06243a' },
            { at: 1, color: '#3f86b0' },
          ],
        },
      },
    },
    substrate: {
      regions: [
        {
          id: 'demo-substrate-main',
          material: ref('substrate.aquasoil.amazonia'),
          fromX: 0,
          toX: 1,
          blend: 0,
          // Gently mounded toward the back third — classic nature-aquarium slope.
          profile: [
            { x: 0, y: 70 },
            { x: 0.25, y: 95 },
            { x: 0.5, y: 120 },
            { x: 0.75, y: 100 },
            { x: 1, y: 80 },
          ],
        },
      ],
    },
    layers,
    seed: SHOWCASE_SEED,
    livestock,
    equipment,
  };
}
