/**
 * Overhead equipment lighting — one SpotLight + visible fixture mesh per
 * `category: 'light'` equipment entry attached to the scene.
 *
 * The document's `EquipmentEntry` carries no per-instance position (the
 * F11.5 `flow` precedent: the catalog row owns world-space data), so
 * fixtures are AUTO-POSITIONED: n light fixtures are distributed evenly
 * along the tank's width axis, hung `FIXTURE_GAP_ABOVE_RIM_MM` above the
 * glass rim at the tank's depth midline — where a real pendant / clip LED
 * bar sits. Each fixture aims straight down at the substrate.
 *
 * Light parameters come from the catalog row's optional `light` block
 * (`lumens` / `colorTempK` / `beamAngleDeg` / `fixtureLengthMm`); every
 * field has a renderer-side default so manifests authored before the block
 * existed still produce a sensible warm-white bar.
 *
 * Determinism: pure function of `(scene.equipment, catalog, tank dims)` —
 * no RNG, no time. Idempotency holds.
 *
 * Perf: SpotLights are per-fragment cost in every lit shader, so the
 * number of REAL lights is capped at `MAX_EQUIPMENT_SPOTLIGHTS`. Fixtures
 * beyond the cap still draw their housing mesh (the user sees the
 * hardware they attached) but contribute no light. Spot shadows are OFF —
 * the single directional key (lighting.ts) stays the only shadow caster.
 */

import type { Catalog, EquipmentEntry as CatalogEquipmentEntry } from '@aquascape/domain/catalog';
import type { Scene } from '@aquascape/domain/scene-model';
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, SpotLight } from 'three';

/** Renderer default when the catalog row publishes no lumen figure. */
export const DEFAULT_LIGHT_LUMENS = 1200;
/** Renderer default CCT — cool-white "planted tank" daylight. */
export const DEFAULT_COLOR_TEMP_K = 6500;
/** Renderer default full beam spread (degrees). Typical bare LED panel. */
export const DEFAULT_BEAM_ANGLE_DEG = 110;
/** Hard cap on REAL SpotLights (per-fragment shader cost). */
export const MAX_EQUIPMENT_SPOTLIGHTS = 4;

/** Air gap between the glass rim and the hanging fixture's underside (mm). */
export const FIXTURE_GAP_ABOVE_RIM_MM = 60;
/** Fixture housing thickness (mm) — slim LED-bar profile. */
const FIXTURE_THICKNESS_MM = 16;
/** Fixture housing depth as a fraction of tank depth. */
const FIXTURE_DEPTH_FRACTION = 0.3;
/** Default fixture length as a fraction of the tank width per fixture slot. */
const FIXTURE_DEFAULT_LENGTH_FRACTION = 0.8;

/**
 * SpotLight intensity per 1000 lumens, with `decay = 0`. The scene is in
 * millimetres, so physically-correct candela-with-inverse-square decay
 * would attenuate to nothing across a ~400 mm tank; `decay = 0` keeps the
 * spot a simple multiplier the way the rig's directional key is, and this
 * constant maps published lumen figures onto that scale. Tuned against
 * headless captures so one mid-range fixture (~1500 lm) reads clearly
 * brighter than the editorial rig without blowing out the substrate.
 */
const SPOT_INTENSITY_PER_KILOLUMEN = 0.55;
/** Clamp bounds for a single spot's base intensity. */
const SPOT_INTENSITY_MIN = 0.25;
const SPOT_INTENSITY_MAX = 2.2;
/** Spot penumbra — soft edge so the light pool doesn't read as a stage spot. */
const SPOT_PENUMBRA = 0.45;
/** Fixture housing colour (dark anodised aluminium). */
const FIXTURE_HOUSING_COLOR = 0x2b2e34;
/** Emissive intensity of the fixture's glowing underside at full level. */
const FIXTURE_EMISSIVE_INTENSITY = 0.85;

/**
 * Handle over the built fixtures group. `setLevel` scales every spot's
 * intensity + every fixture's emissive glow by the day-night directional
 * level so attached lights dim with the cycle (and read "off" at night).
 */
export interface EquipmentLightsHandle {
  readonly group: Group;
  /** Number of REAL SpotLights built (post-cap). Exposed for tests. */
  readonly spotCount: number;
  /** Scale spot intensity + fixture emissive by `level` (clamped [0, 1]). */
  setLevel(level: number): void;
  /** Release every geometry / material / shadow resource. Idempotent. */
  dispose(): void;
}

/**
 * Convert a correlated colour temperature in Kelvin to an sRGB colour.
 * Tanner Helland's blackbody approximation, clamped to [1000, 20000] K —
 * accurate to a few percent across the aquarium-light range and entirely
 * deterministic.
 */
export function kelvinToColor(kelvin: number): Color {
  const k = Math.min(20000, Math.max(1000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (k <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(k) - 161.1195681661;
    b = k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(k - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(k - 60, -0.0755148492);
    b = 255;
  }
  const clamp01 = (v: number): number => Math.min(255, Math.max(0, v)) / 255;
  return new Color(clamp01(r), clamp01(g), clamp01(b));
}

/** Resolved per-fixture parameters after catalog lookup + defaulting. */
interface FixtureParams {
  lumens: number;
  colorTempK: number;
  beamAngleDeg: number;
  fixtureLengthMm: number | null;
}

/**
 * Collect the scene's attached light-category equipment, resolved against
 * the catalog. Entries whose catalog row is missing or not a light are
 * skipped. Document order — load-bearing for the deterministic left-to-
 * right fixture layout.
 */
function collectLightFixtures(scene: Scene, catalog: Catalog | undefined): FixtureParams[] {
  const out: FixtureParams[] = [];
  if (catalog === undefined) return out;
  for (const eq of scene.equipment ?? []) {
    const row = catalog.get(eq.ref);
    if (row === null || row.kind !== 'equipment') continue;
    const eqRow = row as CatalogEquipmentEntry;
    if (eqRow.category !== 'light') continue;
    out.push({
      lumens: eqRow.light?.lumens ?? DEFAULT_LIGHT_LUMENS,
      colorTempK: eqRow.light?.colorTempK ?? DEFAULT_COLOR_TEMP_K,
      beamAngleDeg: eqRow.light?.beamAngleDeg ?? DEFAULT_BEAM_ANGLE_DEG,
      fixtureLengthMm: eqRow.light?.fixtureLengthMm ?? null,
    });
  }
  return out;
}

/**
 * Cache tag for the renderer's rebuild-on-change check. Covers everything
 * the build consumes: tank dims + the ordered light-equipment refs. The
 * catalog row content is keyed by `ref@version` (catalog data is static
 * for the renderer's lifetime).
 */
export function equipmentLightsTag(scene: Scene): string {
  const refs = (scene.equipment ?? [])
    .map((e) => `${e.ref.catalog}/${e.ref.id}@${e.ref.version}`)
    .join(',');
  return `${scene.tank.width}x${scene.tank.height}x${scene.tank.depth}|${refs}`;
}

/**
 * Build the overhead equipment-lights group, or `null` when the scene has
 * no attached light-category equipment (the renderer then skips the group
 * entirely — zero cost, identical to the pre-feature render).
 */
export function buildEquipmentLights(
  scene: Scene,
  catalog: Catalog | undefined,
): EquipmentLightsHandle | null {
  const fixtures = collectLightFixtures(scene, catalog);
  if (fixtures.length === 0) return null;

  const tank = scene.tank;
  const group = new Group();
  group.name = 'aquascape:equipment-lights';

  const spots: Array<{ light: SpotLight; baseIntensity: number }> = [];
  const fixtureMaterials: MeshStandardMaterial[] = [];
  const n = fixtures.length;
  const slotWidth = tank.width / n;
  const fixtureY = tank.height + FIXTURE_GAP_ABOVE_RIM_MM;
  const fixtureZ = tank.depth / 2;

  fixtures.forEach((fx, i) => {
    const cx = slotWidth * (i + 0.5);
    const color = kelvinToColor(fx.colorTempK);

    // Visible fixture housing — a slim LED bar hung above the rim. The
    // emissive channel glows in the light's colour so the fixture reads
    // as "on" even though emissive surfaces don't themselves cast light.
    const length = Math.min(
      fx.fixtureLengthMm ?? slotWidth * FIXTURE_DEFAULT_LENGTH_FRACTION,
      slotWidth * 0.95,
    );
    const housingGeo = new BoxGeometry(
      Math.max(20, length),
      FIXTURE_THICKNESS_MM,
      Math.max(20, tank.depth * FIXTURE_DEPTH_FRACTION),
    );
    const housingMat = new MeshStandardMaterial({
      color: FIXTURE_HOUSING_COLOR,
      roughness: 0.55,
      metalness: 0.4,
      emissive: color,
      emissiveIntensity: FIXTURE_EMISSIVE_INTENSITY,
    });
    const housing = new Mesh(housingGeo, housingMat);
    housing.name = `aquascape:equipment-lights/fixture-${i}`;
    housing.position.set(cx, fixtureY, fixtureZ);
    group.add(housing);
    fixtureMaterials.push(housingMat);

    // The actual light — capped; fixtures beyond the cap keep their
    // housing but contribute no per-fragment lighting cost.
    if (spots.length >= MAX_EQUIPMENT_SPOTLIGHTS) return;
    const baseIntensity = Math.min(
      SPOT_INTENSITY_MAX,
      Math.max(SPOT_INTENSITY_MIN, (fx.lumens / 1000) * SPOT_INTENSITY_PER_KILOLUMEN),
    );
    const halfAngleRad = (Math.min(170, Math.max(10, fx.beamAngleDeg)) / 2) * (Math.PI / 180);
    const spot = new SpotLight(color, baseIntensity, 0, halfAngleRad, SPOT_PENUMBRA, 0);
    spot.name = `aquascape:equipment-lights/spot-${i}`;
    spot.position.set(cx, fixtureY, fixtureZ);
    spot.target.position.set(cx, 0, fixtureZ);
    spot.castShadow = false;
    group.add(spot);
    group.add(spot.target);
    spots.push({ light: spot, baseIntensity });
  });

  let disposed = false;
  return {
    group,
    spotCount: spots.length,
    setLevel(level: number): void {
      if (disposed) return;
      const l = Math.min(1, Math.max(0, level));
      for (const s of spots) s.light.intensity = s.baseIntensity * l;
      for (const m of fixtureMaterials) m.emissiveIntensity = FIXTURE_EMISSIVE_INTENSITY * l;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      group.traverse((node) => {
        const mesh = node as Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      for (const s of spots) s.light.dispose();
      group.clear();
    },
  };
}
