// Pure view-model for the demo HUD. Kept separate from the component so the
// "all details of the tank" derivation is unit-testable without rendering.

import { coreCatalog } from '@aquascape/domain/catalog';
import { effectiveWaterLevelMm, type Scene } from '@aquascape/domain/scene-model';

/** Catalog id → display name, for resolving refs to human-readable labels. */
const NAME_BY_ID = new Map(coreCatalog.entries.map((e) => [e.id, e.name]));

const ML_PER_US_GALLON = 3785.411784;

function nameFor(id: string): string {
  return NAME_BY_ID.get(id) ?? id;
}

export interface HudStockRow {
  readonly name: string;
  readonly quantity: number;
}

export interface SimulationHudModel {
  readonly tankDimsMm: string;
  readonly volumeText: string;
  readonly frame: string;
  readonly waterLevelMm: number;
  readonly substrate: string;
  readonly layerCount: number;
  readonly hardscapeCount: number;
  readonly plantCount: number;
  readonly decorCount: number;
  readonly livestock: readonly HudStockRow[];
  readonly livestockTotal: number;
  readonly equipment: readonly string[];
  readonly seed: number;
}

/**
 * Derive the HUD model from a scene. Counts object kinds, resolves catalog
 * names, and computes the filled volume from the effective water level
 * (`width × depth × waterLevel`, the same footprint the tank-setup gallons
 * readout uses).
 */
export function buildSimulationHudModel(scene: Scene): SimulationHudModel {
  let hardscapeCount = 0;
  let plantCount = 0;
  let decorCount = 0;
  for (const layer of scene.layers) {
    for (const object of layer.objects) {
      if (object.kind === 'hardscape') hardscapeCount++;
      else if (object.kind === 'plant') plantCount++;
      else if (object.kind === 'decor') decorCount++;
    }
  }

  const waterLevelMm = effectiveWaterLevelMm(scene.tank);
  const volumeMl = (scene.tank.width * scene.tank.depth * waterLevelMm) / 1000;
  const litres = Math.round(volumeMl / 1000);
  const gallons = Math.round(volumeMl / ML_PER_US_GALLON);

  const substrateNames = [...new Set(scene.substrate.regions.map((r) => nameFor(r.material.id)))];

  const livestock = (scene.livestock ?? []).map((l) => ({
    name: nameFor(l.ref.id),
    quantity: l.quantity,
  }));
  const livestockTotal = livestock.reduce((n, l) => n + l.quantity, 0);

  return {
    tankDimsMm: `${scene.tank.width} × ${scene.tank.depth} × ${scene.tank.height} mm`,
    volumeText: `${litres} L · ${gallons} US gal`,
    frame: scene.tank.style.frame,
    waterLevelMm,
    substrate: substrateNames.join(', ') || '—',
    layerCount: scene.layers.length,
    hardscapeCount,
    plantCount,
    decorCount,
    livestock,
    livestockTotal,
    equipment: (scene.equipment ?? []).map((e) => nameFor(e.ref.id)),
    seed: scene.seed,
  };
}
