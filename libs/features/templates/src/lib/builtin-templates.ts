// Built-in starter templates. Stage 5 F5.1.
//
// Each template is a regular `AquaDocument` (schema v1) tagged
// `meta.isTemplate = true`. Loading a template into the editor produces an
// untitled editable copy (the template-instantiate path mints a fresh
// `meta.id`, clears `isTemplate`, and resets file association — handled
// by the editor-shell side; this file is pure data).
//
// We bundle four classic Iwagumi / Dutch / Jungle / Beginner starts using
// catalog refs that already exist in `@aquascape/domain/catalog`. They
// are intentionally light (a tank + style + substrate + a handful of
// hardscape / plant placements) — enough to read as the named style at a
// glance, sparse enough to be a starting point rather than a finished
// scene.

import {
  CURRENT_SCHEMA_VERSION,
  type AquaDocument,
} from '@aquascape/domain/document';

/** UI metadata for the template browser — not part of `AquaDocument`. */
export interface TemplateListing {
  /** Stable id used as the dictionary key in the browser. */
  readonly id: string;
  /** Display name shown in the browser tile. */
  readonly name: string;
  /** Short blurb shown under the name. */
  readonly description: string;
  /** The actual document the user instantiates. */
  readonly document: AquaDocument;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** App version stamped into built-in template documents. */
const APP_VERSION = '1.0.0';

/** ISO timestamp shared by every built-in (templates are version-stamped
 *  artefacts; the timestamp marks when this file was authored). */
const TEMPLATE_AUTHORED_AT = '2026-05-25T00:00:00.000Z';

/**
 * Helper to spell out a UUID-shaped string for built-in template ids. The
 * AquaDocument schema validates `meta.id` as a uuid; we use a stable
 * synthetic v4-shaped uuid per slug so the file is byte-identical across
 * builds and reproducible in tests.
 *
 * The math: FNV-1a 32-bit hash → 8 hex chars; repeat 4× over salted
 * variants of the slug to fill the 32 hex digits a v4 needs, then
 * stamp the version (`4`) and variant (`8`) nibbles in the canonical
 * positions.
 */
function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force to unsigned, zero-pad to 8 hex digits.
  return (h >>> 0).toString(16).padStart(8, '0');
}

function templateUuid(slug: string): string {
  const a = fnv1a32(`a:${slug}`);
  const b = fnv1a32(`b:${slug}`);
  const c = fnv1a32(`c:${slug}`);
  const d = fnv1a32(`d:${slug}`);
  // Compose into the 8-4-4-4-12 UUID shape, stamping the v4 version
  // nibble + the RFC 4122 variant (8/9/a/b) nibble.
  const seg2 = b.slice(0, 4);
  const seg3 = `4${b.slice(4, 7)}`; // version 4
  const seg4 = `8${c.slice(0, 3)}`; // variant '8' (binary 10xx)
  const seg5 = `${c.slice(3, 8)}${d.slice(0, 7)}`; // 12 hex chars
  return `${a}-${seg2}-${seg3}-${seg4}-${seg5}`;
}

function makeTransform(x: number, y: number, scale = 1, rotZ = 0): {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  flipX: false;
  flipY: false;
} {
  return {
    position: { x, y, z: 0 },
    rotation: { x: 0, y: 0, z: rotZ },
    scale: { x: scale, y: scale, z: scale },
    flipX: false,
    flipY: false,
  };
}

// ─── Iwagumi — classic three-stone composition in an ADA 60-P ─────────────

const IWAGUMI: AquaDocument = {
  format: 'aquascape',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  meta: {
    id: templateUuid('iwagumi'),
    title: 'Iwagumi (60-P)',
    description:
      'Minimalist Japanese style — three Seiryu stones over a sloped Aqua Soil bed with HC Cuba foreground.',
    author: 'aquascape',
    createdAt: TEMPLATE_AUTHORED_AT,
    updatedAt: TEMPLATE_AUTHORED_AT,
    appVersion: APP_VERSION,
    isTemplate: true,
    tags: ['iwagumi', 'minimalist', 'japanese', 'starter'],
    seed: 1001,
  },
  tank: {
    width: 600,
    height: 300,
    depth: 360,
    glassThickness: 5,
    presetRef: { catalog: 'core', id: 'ada.60-p', version: 1 },
    style: {
      frame: 'rimless',
      waterTint: '#eef6f5',
      background: {
        kind: 'gradient',
        angle: Math.PI / 2,
        stops: [
          { at: 0, color: '#0a1622' },
          { at: 1, color: '#3b6ea5' },
        ],
      },
    },
  },
  substrate: {
    regions: [
      {
        id: templateUuid('iwagumi-substrate'),
        material: { catalog: 'core', id: 'substrate.aquasoil.amazonia', version: 1 },
        fromX: 0,
        toX: 1,
        blend: 0,
        profile: [
          { x: 0, y: 30 },
          { x: 0.55, y: 90 },
          { x: 1, y: 50 },
        ],
      },
    ],
  },
  layers: [
    {
      id: templateUuid('iwagumi-hardscape-layer'),
      name: 'Stones',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'midground',
      objects: [
        {
          kind: 'hardscape',
          id: templateUuid('iwagumi-oyaishi'),
          ref: { catalog: 'core', id: 'rock.seiryu.large', version: 1 },
          category: 'rock',
          transform: makeTransform(330, 130, 1.2),
        },
        {
          kind: 'hardscape',
          id: templateUuid('iwagumi-fukuishi'),
          ref: { catalog: 'core', id: 'rock.seiryu.medium', version: 1 },
          category: 'rock',
          transform: makeTransform(200, 90, 0.9),
        },
        {
          kind: 'hardscape',
          id: templateUuid('iwagumi-soeishi'),
          ref: { catalog: 'core', id: 'rock.seiryu.medium', version: 1 },
          category: 'rock',
          transform: makeTransform(470, 80, 0.7),
        },
      ],
    },
    {
      id: templateUuid('iwagumi-plant-layer'),
      name: 'Foreground',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'foreground',
      objects: [
        {
          kind: 'plant',
          id: templateUuid('iwagumi-hc'),
          ref: { catalog: 'core', id: 'plant.hemianthus.callitrichoides', version: 1 },
          zone: 'foreground',
          transform: makeTransform(300, 50, 1),
          growth: { ageWeeks: 6, vigor: 1 },
          scatter: {
            polygon: [
              { x: 60, y: 20 },
              { x: 540, y: 20 },
              { x: 540, y: 80 },
              { x: 60, y: 80 },
            ],
            density: 60,
            seed: 1002,
          },
        },
      ],
    },
  ],
};

// ─── Dutch — densely planted, no hardscape, 90 cm wide canvas ─────────────

const DUTCH: AquaDocument = {
  format: 'aquascape',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  meta: {
    id: templateUuid('dutch'),
    title: 'Dutch (90-P)',
    description:
      'Dense plant-only style — coloured stem groups in the back, mid-ground textures, no hardscape.',
    author: 'aquascape',
    createdAt: TEMPLATE_AUTHORED_AT,
    updatedAt: TEMPLATE_AUTHORED_AT,
    appVersion: APP_VERSION,
    isTemplate: true,
    tags: ['dutch', 'planted', 'stems', 'starter'],
    seed: 2001,
  },
  tank: {
    width: 900,
    height: 450,
    depth: 450,
    glassThickness: 6,
    presetRef: { catalog: 'core', id: 'ada.90-p', version: 1 },
    style: {
      frame: 'rimless',
      waterTint: '#eef6f5',
      background: { kind: 'color', color: '#0a1622' },
    },
  },
  substrate: {
    regions: [
      {
        id: templateUuid('dutch-substrate'),
        material: { catalog: 'core', id: 'substrate.aquasoil.amazonia', version: 1 },
        fromX: 0,
        toX: 1,
        blend: 0,
        profile: [
          { x: 0, y: 70 },
          { x: 1, y: 70 },
        ],
      },
    ],
  },
  layers: [
    {
      id: templateUuid('dutch-bg-layer'),
      name: 'Background stems',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'background',
      objects: [
        {
          kind: 'plant',
          id: templateUuid('dutch-rotala'),
          ref: { catalog: 'core', id: 'plant.rotala.rotundifolia', version: 1 },
          zone: 'background',
          transform: makeTransform(200, 70, 1),
          growth: { ageWeeks: 8, vigor: 1.1 },
        },
        {
          kind: 'plant',
          id: templateUuid('dutch-ludwigia'),
          ref: { catalog: 'core', id: 'plant.ludwigia.repens', version: 1 },
          zone: 'background',
          transform: makeTransform(500, 70, 1),
          growth: { ageWeeks: 8, vigor: 1.1 },
        },
        {
          kind: 'plant',
          id: templateUuid('dutch-pogo'),
          ref: { catalog: 'core', id: 'plant.pogostemon.stellatus', version: 1 },
          zone: 'background',
          transform: makeTransform(750, 70, 1),
          growth: { ageWeeks: 8, vigor: 1.1 },
        },
      ],
    },
    {
      id: templateUuid('dutch-mid-layer'),
      name: 'Mid ground',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'midground',
      objects: [
        {
          kind: 'plant',
          id: templateUuid('dutch-crypt-wendtii'),
          ref: { catalog: 'core', id: 'plant.cryptocoryne.wendtii', version: 1 },
          zone: 'midground',
          transform: makeTransform(350, 70, 1),
          growth: { ageWeeks: 8, vigor: 1 },
        },
        {
          kind: 'plant',
          id: templateUuid('dutch-staurogyne'),
          ref: { catalog: 'core', id: 'plant.staurogyne.repens', version: 1 },
          zone: 'midground',
          transform: makeTransform(600, 70, 1),
          growth: { ageWeeks: 8, vigor: 1 },
        },
      ],
    },
    {
      id: templateUuid('dutch-fg-layer'),
      name: 'Foreground carpet',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'foreground',
      objects: [
        {
          kind: 'plant',
          id: templateUuid('dutch-monte-carlo'),
          ref: { catalog: 'core', id: 'plant.micranthemum.monte-carlo', version: 1 },
          zone: 'foreground',
          transform: makeTransform(450, 70, 1),
          growth: { ageWeeks: 6, vigor: 1 },
          scatter: {
            polygon: [
              { x: 80, y: 30 },
              { x: 820, y: 30 },
              { x: 820, y: 110 },
              { x: 80, y: 110 },
            ],
            density: 80,
            seed: 2002,
          },
        },
      ],
    },
  ],
};

// ─── Jungle — wild driftwood + dense mixed planting ──────────────────────

const JUNGLE: AquaDocument = {
  format: 'aquascape',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  meta: {
    id: templateUuid('jungle'),
    title: 'Jungle (60-P)',
    description:
      'Wild, low-maintenance look — Spiderwood with Anubias + Java Fern, Crypt understory, Vallisneria background.',
    author: 'aquascape',
    createdAt: TEMPLATE_AUTHORED_AT,
    updatedAt: TEMPLATE_AUTHORED_AT,
    appVersion: APP_VERSION,
    isTemplate: true,
    tags: ['jungle', 'wild', 'low-maintenance', 'starter'],
    seed: 3001,
  },
  tank: {
    width: 600,
    height: 300,
    depth: 360,
    glassThickness: 5,
    presetRef: { catalog: 'core', id: 'ada.60-p', version: 1 },
    style: {
      frame: 'rimless',
      waterTint: '#f4ede0',
      background: { kind: 'color', color: '#1a2418' },
    },
  },
  substrate: {
    regions: [
      {
        id: templateUuid('jungle-substrate'),
        material: { catalog: 'core', id: 'substrate.aquasoil.amazonia', version: 1 },
        fromX: 0,
        toX: 1,
        blend: 0,
        profile: [
          { x: 0, y: 50 },
          { x: 1, y: 60 },
        ],
      },
    ],
  },
  layers: [
    {
      id: templateUuid('jungle-hardscape-layer'),
      name: 'Driftwood',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'midground',
      objects: [
        {
          kind: 'hardscape',
          id: templateUuid('jungle-spider1'),
          ref: { catalog: 'core', id: 'wood.spiderwood.medium', version: 1 },
          category: 'wood',
          transform: makeTransform(250, 140, 1.3),
        },
        {
          kind: 'hardscape',
          id: templateUuid('jungle-spider2'),
          ref: { catalog: 'core', id: 'wood.spiderwood.medium', version: 1 },
          category: 'wood',
          transform: makeTransform(450, 130, 1, 0.3),
        },
      ],
    },
    {
      id: templateUuid('jungle-bg-layer'),
      name: 'Background',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'background',
      objects: [
        {
          kind: 'plant',
          id: templateUuid('jungle-vallis'),
          ref: { catalog: 'core', id: 'plant.vallisneria.spiralis', version: 1 },
          zone: 'background',
          transform: makeTransform(550, 56, 1.1),
          growth: { ageWeeks: 10, vigor: 1.1 },
        },
        {
          kind: 'plant',
          id: templateUuid('jungle-jf'),
          ref: { catalog: 'core', id: 'plant.microsorum.pteropus', version: 1 },
          zone: 'midground',
          transform: makeTransform(300, 53, 1),
          growth: { ageWeeks: 12, vigor: 1 },
        },
        {
          kind: 'plant',
          id: templateUuid('jungle-anubias'),
          ref: { catalog: 'core', id: 'plant.anubias.barteri', version: 1 },
          zone: 'midground',
          transform: makeTransform(420, 54, 1),
          growth: { ageWeeks: 12, vigor: 1 },
        },
      ],
    },
    {
      id: templateUuid('jungle-mid-layer'),
      name: 'Cryps',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'foreground',
      objects: [
        {
          kind: 'plant',
          id: templateUuid('jungle-crypt1'),
          ref: { catalog: 'core', id: 'plant.cryptocoryne.wendtii', version: 1 },
          zone: 'midground',
          transform: makeTransform(150, 51, 1),
          growth: { ageWeeks: 10, vigor: 1 },
        },
        {
          kind: 'plant',
          id: templateUuid('jungle-crypt2'),
          ref: { catalog: 'core', id: 'plant.cryptocoryne.parva', version: 1 },
          zone: 'foreground',
          transform: makeTransform(370, 54, 0.9),
          growth: { ageWeeks: 10, vigor: 1 },
        },
      ],
    },
  ],
};

// ─── Beginner — small tank, easy plants, very forgiving ──────────────────

const BEGINNER: AquaDocument = {
  format: 'aquascape',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  meta: {
    id: templateUuid('beginner'),
    title: 'Beginner (nano)',
    description:
      'Low-tech low-light setup — single piece of driftwood, hardy plants (Anubias, Java Fern, Crypts).',
    author: 'aquascape',
    createdAt: TEMPLATE_AUTHORED_AT,
    updatedAt: TEMPLATE_AUTHORED_AT,
    appVersion: APP_VERSION,
    isTemplate: true,
    tags: ['beginner', 'low-tech', 'easy', 'starter'],
    seed: 4001,
  },
  tank: {
    width: 360,
    height: 220,
    depth: 220,
    glassThickness: 5,
    presetRef: { catalog: 'core', id: 'uns.5n', version: 1 },
    style: {
      frame: 'rimless',
      waterTint: '#eef6f5',
      background: { kind: 'color', color: '#1f2933' },
    },
  },
  substrate: {
    regions: [
      {
        id: templateUuid('beginner-substrate'),
        material: { catalog: 'core', id: 'substrate.gravel.fluorite', version: 1 },
        fromX: 0,
        toX: 1,
        blend: 0,
        profile: [
          { x: 0, y: 30 },
          { x: 1, y: 30 },
        ],
      },
    ],
  },
  layers: [
    {
      id: templateUuid('beginner-wood-layer'),
      name: 'Driftwood',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'midground',
      objects: [
        {
          kind: 'hardscape',
          id: templateUuid('beginner-wood'),
          ref: { catalog: 'core', id: 'wood.malaysian.medium', version: 1 },
          category: 'wood',
          transform: makeTransform(180, 100, 1),
        },
      ],
    },
    {
      id: templateUuid('beginner-plant-layer'),
      name: 'Plants',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'midground',
      objects: [
        {
          kind: 'plant',
          id: templateUuid('beginner-anubias'),
          ref: { catalog: 'core', id: 'plant.anubias.nana-petite', version: 1 },
          zone: 'midground',
          transform: makeTransform(150, 30, 1),
          growth: { ageWeeks: 12, vigor: 1 },
        },
        {
          kind: 'plant',
          id: templateUuid('beginner-jf'),
          ref: { catalog: 'core', id: 'plant.microsorum.pteropus', version: 1 },
          zone: 'midground',
          transform: makeTransform(210, 30, 0.9),
          growth: { ageWeeks: 12, vigor: 1 },
        },
      ],
    },
    {
      id: templateUuid('beginner-fg-layer'),
      name: 'Foreground',
      opacity: 1,
      visible: true,
      locked: false,
      zone: 'foreground',
      objects: [
        {
          kind: 'plant',
          id: templateUuid('beginner-crypt'),
          ref: { catalog: 'core', id: 'plant.cryptocoryne.parva', version: 1 },
          zone: 'foreground',
          transform: makeTransform(80, 30, 1),
          growth: { ageWeeks: 10, vigor: 1 },
        },
      ],
    },
  ],
};

/**
 * The shipped catalog of built-in starter templates. Stable order — the
 * template browser renders them in this sequence so any future addition
 * appends rather than re-orders.
 */
export const BUILTIN_TEMPLATES: ReadonlyArray<TemplateListing> = [
  { id: 'iwagumi', name: IWAGUMI.meta.title, description: IWAGUMI.meta.description ?? '', document: IWAGUMI },
  { id: 'dutch', name: DUTCH.meta.title, description: DUTCH.meta.description ?? '', document: DUTCH },
  { id: 'jungle', name: JUNGLE.meta.title, description: JUNGLE.meta.description ?? '', document: JUNGLE },
  { id: 'beginner', name: BEGINNER.meta.title, description: BEGINNER.meta.description ?? '', document: BEGINNER },
];
