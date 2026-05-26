/**
 * Substrate mesh builder — Stage 10 F10.1.
 *
 * Each `SubstrateRegion` becomes one extruded mesh: a 2D profile (Catmull-
 * Rom-sampled top edge + flat bottom edge + back closure) extruded along
 * the tank's depth (Z) so the substrate spans front-to-back.
 *
 * v1 is intentionally simple: uniform front-to-back fall-off — i.e. the
 * back of the substrate sits at the same height as the front along the same
 * fractional x. A future stage can support per-region back-profile data
 * for slopes that vary front-to-back.
 *
 * Material colour comes from the substrate catalog entry. When no catalog
 * is provided (headless tests / loader stub), we fall back to a sandy
 * brown that matches `SUBSTRATE_FALLBACK_FILL` in renderer-2d.
 */

import type { Catalog, SubstrateEntry } from '@aquascape/domain/catalog';
import { sampleCatmullRom } from '@aquascape/domain/geometry';
import type { CatalogRef, Scene, SubstrateRegion } from '@aquascape/domain/scene-model';
import { Group, Mesh, MeshStandardMaterial, Shape, ExtrudeGeometry } from 'three';

/** Catalog-miss / catalog-omitted fallback colour. */
const FALLBACK_COLOR = '#7b6a4a';
/** Roughness for substrate material. Substrate is grainy, not glossy. */
const ROUGHNESS = 0.95;
/** Max profile sample count — bounds the geometry cost on very wide regions. */
const MAX_PROFILE_SAMPLES = 400;
/** Min profile sample count — keeps tiny regions visibly smooth. */
const MIN_PROFILE_SAMPLES = 8;

/**
 * Build a group of substrate meshes, one mesh per region. Empty regions
 * (zero width or no profile) are skipped silently.
 */
export function buildSubstrateMeshes(scene: Scene, catalog: Catalog | undefined): Group {
  const group = new Group();
  group.name = 'aquascape:substrate';
  const tankW = scene.tank.width;
  const tankD = scene.tank.depth;
  if (tankW <= 0 || tankD <= 0) return group;

  for (const region of scene.substrate.regions) {
    const mesh = buildRegionMesh(region, tankW, tankD, catalog);
    if (mesh !== null) group.add(mesh);
  }
  return group;
}

/**
 * Build a single region as an extruded shape. The shape lives in the XY
 * plane (front face of the tank) and we extrude it along Z (depth).
 */
function buildRegionMesh(
  region: SubstrateRegion,
  tankWidthMm: number,
  tankDepthMm: number,
  catalog: Catalog | undefined,
): Mesh | null {
  const x0 = region.fromX * tankWidthMm;
  const x1 = region.toX * tankWidthMm;
  const widthMm = x1 - x0;
  if (widthMm <= 0) return null;

  const samples = Math.min(
    MAX_PROFILE_SAMPLES,
    Math.max(MIN_PROFILE_SAMPLES, Math.round(widthMm)),
  );
  const profile = sampleCatmullRom(region.profile, samples);
  if (profile.length === 0) return null;

  const shape = new Shape();
  shape.moveTo(x0, 0);
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i]!;
    const x = x0 + p.x * widthMm;
    const y = Math.max(0, p.y);
    shape.lineTo(x, y);
  }
  shape.lineTo(x1, 0);
  shape.closePath();

  const geo = new ExtrudeGeometry(shape, {
    depth: tankDepthMm,
    bevelEnabled: false,
    steps: 1,
  });

  const color = resolveSubstrateColor(region.material, catalog);
  const mat = new MeshStandardMaterial({ color, roughness: ROUGHNESS });
  const mesh = new Mesh(geo, mat);
  mesh.name = `aquascape:substrate/${region.id}`;
  // ExtrudeGeometry along +Z starts at z=0 — no positional offset needed
  // since the world origin already sits at the tank's front-bottom-left.
  return mesh;
}

function resolveSubstrateColor(ref: CatalogRef, catalog: Catalog | undefined): string {
  if (catalog === undefined) return FALLBACK_COLOR;
  const entry = catalog.get({ catalog: ref.catalog, id: ref.id });
  if (entry === null || entry.kind !== 'substrate') return FALLBACK_COLOR;
  return (entry as SubstrateEntry).color;
}
