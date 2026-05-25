// Scene-summary aggregation + formatters. Stage 6 F6.2.
//
// Turn a `Scene` (+ catalog) into a shape suitable for export as Markdown
// or JSON: tank dimensions, water + substrate volume, plant list grouped
// by catalog ref, hardscape list grouped by catalog ref, layer count.
// Carpet plants (scatter polygons) report instance count derived from
// `density` (1 instance per `density² / 1000` mm² of polygon area —
// matches the renderer's deterministic placement).
//
// Pure: no DOM, no Angular, no signal reads. Consumers (the export
// dialog) call `summarizeScene(scene, catalog) → SceneSummary` then
// `formatSummaryMarkdown(summary)` / `formatSummaryJson(summary)`.

import type { Catalog, HardscapeEntry, PlantEntry } from '@aquascape/domain/catalog';
import type { CatalogRef, PlantObject, Scene } from '@aquascape/domain/scene-model';

import { computeVolumeBreakdown, type VolumeBreakdown } from './volume';

// ─── Public shape ─────────────────────────────────────────────────────────

export interface SceneSummary {
  readonly tank: {
    readonly widthMm: number;
    readonly heightMm: number;
    readonly depthMm: number;
  };
  readonly volume: VolumeBreakdown;
  /** Plants grouped by catalog ref. `count` is the visual instance count
   *  (1 for single-specimen, derived for scatter patches). */
  readonly plants: ReadonlyArray<SummaryItem>;
  /** Hardscape pieces grouped by catalog ref. `count` = number of objects. */
  readonly hardscape: ReadonlyArray<SummaryItem>;
  /** Number of visible layers. */
  readonly layerCount: number;
  /** Sum of `plants[i].count`. */
  readonly totalPlantInstances: number;
  /** Sum of `hardscape[i].count`. */
  readonly totalHardscapePieces: number;
}

export interface SummaryItem {
  readonly catalogId: string;
  /** Display name from the catalog. Falls back to the catalog id when unresolved. */
  readonly name: string;
  /** Count visible in the scene. */
  readonly count: number;
}

// ─── Aggregation ──────────────────────────────────────────────────────────

export function summarizeScene(scene: Scene, catalog: Catalog | null): SceneSummary {
  const plantCounts = new Map<string, number>();
  const hardscapeCounts = new Map<string, number>();
  let layerCount = 0;

  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    layerCount++;
    for (const obj of layer.objects) {
      if (obj.kind === 'plant') {
        const key = catalogRefKey(obj.ref);
        const inc = plantInstanceCount(obj);
        plantCounts.set(key, (plantCounts.get(key) ?? 0) + inc);
      } else if (obj.kind === 'hardscape') {
        const key = catalogRefKey(obj.ref);
        hardscapeCounts.set(key, (hardscapeCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const plants = sortedItems(plantCounts, (id) => lookupName(catalog, id, 'plant'));
  const hardscape = sortedItems(hardscapeCounts, (id) =>
    lookupName(catalog, id, 'hardscape'),
  );

  return {
    tank: {
      widthMm: scene.tank.width,
      heightMm: scene.tank.height,
      depthMm: scene.tank.depth,
    },
    volume: computeVolumeBreakdown(scene),
    plants,
    hardscape,
    layerCount,
    totalPlantInstances: plants.reduce((s, p) => s + p.count, 0),
    totalHardscapePieces: hardscape.reduce((s, h) => s + h.count, 0),
  };
}

function catalogRefKey(ref: CatalogRef): string {
  return `${ref.catalog}/${ref.id}@${ref.version}`;
}

/**
 * Instance count for a plant object: 1 for a single-specimen, OR the
 * polygon area × density² ÷ 1000 for a scatter patch (deterministic
 * proxy for the renderer's stratified placement).
 */
function plantInstanceCount(plant: PlantObject): number {
  if (plant.scatter === undefined) return 1;
  const area = polygonAreaMm2(plant.scatter.polygon);
  if (area <= 0) return 0;
  const density = plant.scatter.density;
  return Math.max(1, Math.round((area * density * density) / 1_000_000));
}

function polygonAreaMm2(polygon: ReadonlyArray<{ x: number; y: number }>): number {
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function sortedItems(
  counts: Map<string, number>,
  nameFor: (catalogId: string) => string,
): SummaryItem[] {
  return [...counts.entries()]
    .map(([key, count]) => {
      // Extract the catalog id (the middle of `catalog/id@version`).
      const id = key.split('/')[1]?.split('@')[0] ?? key;
      return { catalogId: id, name: nameFor(id), count };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function lookupName(
  catalog: Catalog | null,
  catalogId: string,
  kind: 'plant' | 'hardscape',
): string {
  if (catalog === null) return catalogId;
  const entry = catalog.get({ catalog: 'core', id: catalogId });
  if (entry === null || entry === undefined) return catalogId;
  // Both PlantEntry + HardscapeEntry carry a `name` field.
  if ((kind === 'plant' && entry.kind === 'plant') || (kind === 'hardscape' && entry.kind === 'hardscape')) {
    return (entry as PlantEntry | HardscapeEntry).name;
  }
  return catalogId;
}

// ─── Formatters ───────────────────────────────────────────────────────────

/**
 * Render a summary as Markdown — suitable for pasting into a forum / blog
 * / shopping list. Numbers are formatted with sensible precision (litres
 * to 1 decimal, gallons to 1 decimal, dimensions as integers).
 */
export function formatSummaryMarkdown(summary: SceneSummary): string {
  const lines: string[] = [];
  lines.push('# Aquascape layout summary');
  lines.push('');
  lines.push('## Tank');
  lines.push('');
  lines.push(
    `- Dimensions: ${formatInt(summary.tank.widthMm)} × ${formatInt(summary.tank.heightMm)} × ${formatInt(summary.tank.depthMm)} mm`,
  );
  lines.push(
    `- Gross volume: ${formatLitres(summary.volume.grossLitres)} (${formatGallons(summary.volume.grossGallons)})`,
  );
  lines.push(
    `- Substrate volume: ${formatLitres(summary.volume.substrateLitres)}`,
  );
  lines.push(
    `- Water volume (after substrate): ${formatLitres(summary.volume.waterLitres)} (${formatGallons(summary.volume.waterGallons)})`,
  );
  lines.push('');
  lines.push('## Hardscape');
  lines.push('');
  if (summary.hardscape.length === 0) {
    lines.push('_None._');
  } else {
    for (const item of summary.hardscape) {
      lines.push(`- **${item.name}** × ${item.count}`);
    }
    lines.push('');
    lines.push(`Total pieces: ${summary.totalHardscapePieces}`);
  }
  lines.push('');
  lines.push('## Plants');
  lines.push('');
  if (summary.plants.length === 0) {
    lines.push('_None._');
  } else {
    for (const item of summary.plants) {
      lines.push(`- **${item.name}** × ${item.count}`);
    }
    lines.push('');
    lines.push(`Total plant instances: ${summary.totalPlantInstances}`);
  }
  lines.push('');
  lines.push('## Layers');
  lines.push('');
  lines.push(`Visible layers: ${summary.layerCount}`);
  lines.push('');
  return lines.join('\n');
}

/** Render a summary as a pretty-printed JSON string. */
export function formatSummaryJson(summary: SceneSummary): string {
  return JSON.stringify(summary, null, 2);
}

function formatInt(value: number): string {
  return Math.round(value).toString();
}
function formatLitres(value: number): string {
  return `${value.toFixed(1)} L`;
}
function formatGallons(value: number): string {
  return `${value.toFixed(1)} US gal`;
}
