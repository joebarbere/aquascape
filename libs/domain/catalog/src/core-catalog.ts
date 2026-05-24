/**
 * Bundled core catalog. Each entry is a JSON manifest file under
 * `./data/<kind>/<id>.json`; this module collects them, runs the validating
 * loader, and exposes the result as a frozen `Catalog` ready for app boot.
 *
 * Why bundle at build time rather than fetch at runtime?
 * - The Stage-2 app needs a known-good catalog before the canvas paints;
 *   waiting on `fetch('/catalog.json')` would force a loading state.
 * - The Electron build is fully offline-capable per Plan §1; bundling
 *   removes a network dependency.
 * - Each manifest is a separate file (community-friendly: one PR = one
 *   entry) but the bundle is a single compiled-in array (cheap, hashable).
 *
 * Validation runs at load time (i.e. once, lazily on first import). Manifest
 * bugs that slip past the build script's `tools/validate-catalog.mjs`
 * sanity check still surface as `core-catalog.loadResult.errors` here —
 * the loader never silently drops invalid entries.
 *
 * Community catalogs (Stage 8) will plug in via the same `loadCatalog` API
 * with `catalog: 'community:<slug>'` namespacing.
 */

import rockOhko from './data/hardscape/rock-ohko.json';
import rockSeiryuLarge from './data/hardscape/rock-seiryu-large.json';
import rockSeiryuMedium from './data/hardscape/rock-seiryu-medium.json';
import woodMalaysian from './data/hardscape/wood-malaysian.json';
import woodManzanita from './data/hardscape/wood-manzanita.json';
import woodSpiderwood from './data/hardscape/wood-spiderwood.json';
import aquaSoilAmazonia from './data/substrates/aqua-soil-amazonia.json';
import blackPeaGravel from './data/substrates/black-pea-gravel.json';
import fluorite from './data/substrates/fluorite.json';
import silicaSand from './data/substrates/silica-sand.json';
import tropicaAquasoil from './data/substrates/tropica-aquasoil.json';
import whiteSand from './data/substrates/white-sand.json';
import { loadCatalog, type CatalogLoadResult } from './loader';

/** Raw manifest array — exposed so tests + tools can re-load it deliberately. */
export const CORE_CATALOG_MANIFESTS: readonly unknown[] = [
  // Substrates (Stage 2 F2.1)
  aquaSoilAmazonia,
  tropicaAquasoil,
  silicaSand,
  whiteSand,
  blackPeaGravel,
  fluorite,
  // Hardscape (Stage 3 F3.5)
  rockSeiryuLarge,
  rockSeiryuMedium,
  rockOhko,
  woodSpiderwood,
  woodManzanita,
  woodMalaysian,
];

/**
 * Pre-validated core catalog result. Computed once at module import.
 * `errors` should be `[]` in a healthy build — the value is here so a CI
 * check or a runtime smoke-test can flag drift.
 */
export const CORE_CATALOG_RESULT: CatalogLoadResult = loadCatalog(CORE_CATALOG_MANIFESTS);

/** The validated core catalog. Frozen via the loader's index. */
export const coreCatalog = CORE_CATALOG_RESULT.catalog;
