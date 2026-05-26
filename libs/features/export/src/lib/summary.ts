// Scene-summary aggregation + formatters. Stage 6 F6.2, extended for
// Stage 7 F7.4 (setup sheet — livestock + equipment + stocking warnings).
//
// Turn a `Scene` (+ catalog) into a shape suitable for export as Markdown
// or JSON: tank dimensions, water + substrate volume, plant list grouped
// by catalog ref, hardscape list grouped by catalog ref, layer count,
// livestock inventory with per-species stats, equipment inventory with
// per-item stats, and the live stocking-guidance warnings. Carpet plants
// (scatter polygons) report instance count derived from `density` (1
// instance per `density² / 1000` mm² of polygon area — matches the
// renderer's deterministic placement).
//
// Pure: no DOM, no Angular, no signal reads, no NgRx. Consumers (the
// export dialog) call `summarizeScene(scene, catalog) → SceneSummary`
// then `formatSummaryMarkdown(summary)` / `formatSummaryJson(summary)`.
// The stocking rules engine in `@aquascape/domain/stocking` is called
// inline by `summarizeScene` so the setup sheet shows the warnings the
// user sees in the sidebar — no need for an extra parameter.

import type {
  Catalog,
  EquipmentEntry as CatalogEquipmentEntry,
  HardscapeEntry,
  LivestockEntry as CatalogLivestockEntry,
  PlantEntry,
} from '@aquascape/domain/catalog';
import type {
  CatalogRef,
  EquipmentEntry,
  LivestockEntry,
  PlantObject,
  Scene,
} from '@aquascape/domain/scene-model';
import { evaluateStocking, type StockingWarning } from '@aquascape/domain/stocking';

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
  /** Livestock inventory (F7.4) — one row per species with per-species stats. */
  readonly livestock: ReadonlyArray<LivestockSummaryItem>;
  /** Sum of `livestock[i].quantity`. */
  readonly totalLivestock: number;
  /** Equipment inventory (F7.4) — one row per piece with per-item stats. */
  readonly equipment: ReadonlyArray<EquipmentSummaryItem>;
  /** Sum of `equipment[i].wattage` over entries that publish a wattage. */
  readonly totalWattage: number;
  /** Stocking-guidance warnings from `domain/stocking`. Empty when the scene has no livestock or no rule fires. */
  readonly stockingWarnings: ReadonlyArray<StockingWarningSummaryItem>;
}

export interface SummaryItem {
  readonly catalogId: string;
  /** Display name from the catalog. Falls back to the catalog id when unresolved. */
  readonly name: string;
  /** Count visible in the scene. */
  readonly count: number;
}

export interface LivestockSummaryItem {
  /** Entry id from `Scene.livestock`. Stable across re-summarise. */
  readonly entryId: string;
  readonly catalogId: string;
  /** Display name from the catalog. Falls back to the catalog id when unresolved. */
  readonly name: string;
  readonly quantity: number;
  /** Catalog stats — copied through so the setup sheet can render them
   *  without re-resolving the catalog. `null` fields surface as "—" in
   *  the Markdown formatter when the catalog entry is missing or doesn't
   *  publish that stat. */
  readonly group: 'fish' | 'shrimp' | 'snail' | null;
  readonly adultSizeMm: number | null;
  readonly temperament: 'peaceful' | 'semi-aggressive' | 'aggressive' | null;
  readonly temperatureRangeC: { readonly min: number; readonly max: number } | null;
  readonly pHRange: { readonly min: number; readonly max: number } | null;
  readonly schoolingMin: number | null;
  readonly bioloadClass: 'low' | 'medium' | 'high' | null;
}

export interface EquipmentSummaryItem {
  /** Entry id from `Scene.equipment`. Stable across re-summarise. */
  readonly entryId: string;
  readonly catalogId: string;
  /** Display name from the catalog. Falls back to the catalog id when unresolved. */
  readonly name: string;
  readonly category: 'filter' | 'heater' | 'light' | 'co2' | null;
  readonly subcategory: string | null;
  readonly wattage: number | null;
  readonly flowRateLph: number | null;
  readonly coverageLitres: { readonly min: number | null; readonly max: number | null } | null;
  readonly note: string | null;
  /** Settings as the entry stores them; `null` when the entry has none. */
  readonly settings: Record<string, number | string | boolean> | null;
}

export interface StockingWarningSummaryItem extends StockingWarning {
  /** Display names of `relatedEntryIds`, resolved against the catalog. Same order. */
  readonly relatedEntryNames: ReadonlyArray<string>;
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

  const livestock = summarizeLivestock(scene.livestock ?? [], catalog);
  const equipment = summarizeEquipment(scene.equipment ?? [], catalog);
  const stockingWarnings = summarizeStockingWarnings(scene, catalog);

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
    livestock,
    totalLivestock: livestock.reduce((s, l) => s + l.quantity, 0),
    equipment,
    totalWattage: equipment.reduce((s, e) => s + (e.wattage ?? 0), 0),
    stockingWarnings,
  };
}

function summarizeLivestock(
  entries: ReadonlyArray<LivestockEntry>,
  catalog: Catalog | null,
): LivestockSummaryItem[] {
  return entries.map((entry): LivestockSummaryItem => {
    const cat = lookupLivestock(catalog, entry.ref.id);
    return {
      entryId: entry.id,
      catalogId: entry.ref.id,
      name: cat?.name ?? entry.ref.id,
      quantity: entry.quantity,
      group: cat?.group ?? null,
      adultSizeMm: cat?.adultSize ?? null,
      temperament: cat?.temperament ?? null,
      temperatureRangeC:
        cat !== null && cat !== undefined
          ? { min: cat.temperatureRange.minC, max: cat.temperatureRange.maxC }
          : null,
      pHRange:
        cat !== null && cat !== undefined
          ? { min: cat.pHRange.min, max: cat.pHRange.max }
          : null,
      schoolingMin: cat?.schoolingMin ?? null,
      bioloadClass: cat?.bioloadClass ?? null,
    };
  });
}

function summarizeEquipment(
  entries: ReadonlyArray<EquipmentEntry>,
  catalog: Catalog | null,
): EquipmentSummaryItem[] {
  return entries.map((entry): EquipmentSummaryItem => {
    const cat = lookupEquipment(catalog, entry.ref.id);
    return {
      entryId: entry.id,
      catalogId: entry.ref.id,
      name: cat?.name ?? entry.ref.id,
      category: cat?.category ?? null,
      subcategory: cat?.subcategory ?? null,
      wattage: cat?.wattage ?? null,
      flowRateLph: cat?.flowRateLph ?? null,
      coverageLitres:
        cat?.coverageLitres !== undefined
          ? { min: cat.coverageLitres.min ?? null, max: cat.coverageLitres.max ?? null }
          : null,
      note: entry.note ?? null,
      settings: entry.settings ?? null,
    };
  });
}

function summarizeStockingWarnings(
  scene: Scene,
  catalog: Catalog | null,
): StockingWarningSummaryItem[] {
  // Catalog can be null (legacy callers); the rules engine needs a catalog
  // to resolve livestock refs. Without one, no warnings can be evaluated —
  // surface as empty rather than throw.
  if (catalog === null) return [];
  const warnings = evaluateStocking(scene, catalog);
  const livestockById = new Map<string, LivestockEntry>();
  for (const entry of scene.livestock ?? []) {
    livestockById.set(entry.id, entry);
  }
  return warnings.map((w): StockingWarningSummaryItem => {
    const names = w.relatedEntryIds.map((id) => {
      const entry = livestockById.get(id);
      if (entry === undefined) return id;
      const cat = lookupLivestock(catalog, entry.ref.id);
      return cat?.name ?? entry.ref.id;
    });
    return { ...w, relatedEntryNames: names };
  });
}

function lookupLivestock(
  catalog: Catalog | null,
  catalogId: string,
): CatalogLivestockEntry | null {
  if (catalog === null) return null;
  const entry = catalog.get({ catalog: 'core', id: catalogId });
  if (entry === null || entry === undefined) return null;
  return entry.kind === 'livestock' ? (entry as CatalogLivestockEntry) : null;
}

function lookupEquipment(
  catalog: Catalog | null,
  catalogId: string,
): CatalogEquipmentEntry | null {
  if (catalog === null) return null;
  const entry = catalog.get({ catalog: 'core', id: catalogId });
  if (entry === null || entry === undefined) return null;
  return entry.kind === 'equipment' ? (entry as CatalogEquipmentEntry) : null;
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

  // ── Livestock (F7.4) ─────────────────────────────────────────────────
  if (summary.livestock.length > 0) {
    lines.push('## Livestock');
    lines.push('');
    for (const item of summary.livestock) {
      const stats: string[] = [];
      if (item.group !== null) stats.push(item.group);
      if (item.adultSizeMm !== null) stats.push(`${formatInt(item.adultSizeMm)} mm`);
      if (item.temperament !== null) stats.push(item.temperament);
      if (item.bioloadClass !== null) stats.push(`bioload: ${item.bioloadClass}`);
      const statsSuffix = stats.length > 0 ? ` _(${stats.join(', ')})_` : '';
      lines.push(`- **${item.name}** × ${item.quantity}${statsSuffix}`);
      const tempLine =
        item.temperatureRangeC !== null
          ? `Temp ${item.temperatureRangeC.min}–${item.temperatureRangeC.max} °C`
          : null;
      const phLine =
        item.pHRange !== null
          ? `pH ${item.pHRange.min}–${item.pHRange.max}`
          : null;
      const schoolLine =
        item.schoolingMin !== null && item.schoolingMin > 1
          ? `Schools in groups of ${item.schoolingMin}+`
          : null;
      const subBullets = [tempLine, phLine, schoolLine].filter((v): v is string => v !== null);
      for (const sub of subBullets) {
        lines.push(`  - ${sub}`);
      }
    }
    lines.push('');
    lines.push(`Total individuals: ${summary.totalLivestock}`);
    lines.push('');
  }

  // ── Equipment (F7.4) ─────────────────────────────────────────────────
  if (summary.equipment.length > 0) {
    lines.push('## Equipment');
    lines.push('');
    for (const item of summary.equipment) {
      const stats: string[] = [];
      if (item.category !== null) stats.push(item.category);
      if (item.subcategory !== null) stats.push(item.subcategory);
      if (item.wattage !== null) stats.push(`${item.wattage} W`);
      if (item.flowRateLph !== null) stats.push(`${item.flowRateLph} L/h`);
      const statsSuffix = stats.length > 0 ? ` _(${stats.join(', ')})_` : '';
      lines.push(`- **${item.name}**${statsSuffix}`);
      if (item.coverageLitres !== null) {
        const min = item.coverageLitres.min;
        const max = item.coverageLitres.max;
        const range =
          min !== null && max !== null
            ? `${min}–${max} L`
            : max !== null
              ? `up to ${max} L`
              : min !== null
                ? `${min} L+`
                : null;
        if (range !== null) lines.push(`  - Recommended for ${range}`);
      }
      if (item.note !== null) {
        lines.push(`  - Note: ${item.note}`);
      }
      if (item.settings !== null && Object.keys(item.settings).length > 0) {
        const pairs = Object.entries(item.settings)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join(', ');
        lines.push(`  - Settings: ${pairs}`);
      }
    }
    lines.push('');
    if (summary.totalWattage > 0) {
      lines.push(`Total wattage (published): ${summary.totalWattage} W`);
      lines.push('');
    }
  }

  // ── Stocking guidance (F7.4) ─────────────────────────────────────────
  if (summary.stockingWarnings.length > 0) {
    lines.push('## Stocking guidance');
    lines.push('');
    for (const w of summary.stockingWarnings) {
      const icon = w.severity === 'error' ? '❌' : w.severity === 'warning' ? '⚠️' : 'ℹ️';
      lines.push(`- ${icon} **${w.message}**`);
      lines.push(`  - ${w.explanation}`);
      if (w.relatedEntryNames.length > 0) {
        lines.push(`  - Affects: ${w.relatedEntryNames.join(', ')}`);
      }
    }
    lines.push('');
  }

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
