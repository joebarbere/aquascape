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

// Hardscape — rocks
import rockBlackLava from './data/hardscape/rock-black-lava.json';
import rockElephantSkin from './data/hardscape/rock-elephant-skin.json';
import rockFrodo from './data/hardscape/rock-frodo.json';
import rockIota from './data/hardscape/rock-iota.json';
import rockOhko from './data/hardscape/rock-ohko.json';
import rockPagoda from './data/hardscape/rock-pagoda.json';
import rockPetrifiedWood from './data/hardscape/rock-petrified-wood.json';
import rockPolarIce from './data/hardscape/rock-polar-ice.json';
import rockSeiryuLarge from './data/hardscape/rock-seiryu-large.json';
import rockSeiryuMedium from './data/hardscape/rock-seiryu-medium.json';
import rockSnowMountain from './data/hardscape/rock-snow-mountain.json';
import rockTexasHoley from './data/hardscape/rock-texas-holey.json';
// Hardscape — wood
import woodBonsai from './data/hardscape/wood-bonsai.json';
import woodCholla from './data/hardscape/wood-cholla.json';
import woodMalaysian from './data/hardscape/wood-malaysian.json';
import woodManzanita from './data/hardscape/wood-manzanita.json';
import woodMopani from './data/hardscape/wood-mopani.json';
import woodRedmoor from './data/hardscape/wood-redmoor.json';
import woodSpiderwood from './data/hardscape/wood-spiderwood.json';
// Plants — foreground (carpets)
import plantEleocharis from './data/plants/eleocharis-acicularis.json';
import plantGlossostigma from './data/plants/glossostigma-elatinoides.json';
import plantHemianthus from './data/plants/hemianthus-callitrichoides.json';
import plantMarsilea from './data/plants/marsilea-hirsuta.json';
import plantMonteCarlo from './data/plants/monte-carlo.json';
import plantSagittaria from './data/plants/sagittaria-subulata.json';
import plantUtricularia from './data/plants/utricularia-graminifolia.json';
// Plants — midground
import plantAnubiasBarteri from './data/plants/anubias-barteri.json';
import plantAnubiasNanaPetite from './data/plants/anubias-nana-petite.json';
import plantBucephalandra from './data/plants/bucephalandra.json';
import plantCryptocoryneParva from './data/plants/cryptocoryne-parva.json';
import plantCryptocoryneWendtii from './data/plants/cryptocoryne-wendtii.json';
import plantHydrocotyle from './data/plants/hydrocotyle-tripartita.json';
import plantHygrophilaPinnatifida from './data/plants/hygrophila-pinnatifida.json';
import plantJavaFern from './data/plants/microsorum-pteropus.json';
import plantJavaFernTrident from './data/plants/microsorum-pteropus-trident.json';
import plantPogostemonHelferi from './data/plants/pogostemon-helferi.json';
import plantRiccia from './data/plants/riccia-fluitans.json';
import plantStaurogyne from './data/plants/staurogyne-repens.json';
// Plants — background
import plantAmmannia from './data/plants/ammannia-gracilis.json';
import plantHygrophilaPolysperma from './data/plants/hygrophila-polysperma.json';
import plantLimnophila from './data/plants/limnophila-sessiliflora.json';
import plantLudwigia from './data/plants/ludwigia-repens.json';
import plantMyriophyllum from './data/plants/myriophyllum-mattogrossense.json';
import plantPogostemonStellatus from './data/plants/pogostemon-stellatus.json';
import plantRotala from './data/plants/rotala-rotundifolia.json';
import plantVallisneriaNana from './data/plants/vallisneria-nana.json';
import plantVallisneriaSpiralis from './data/plants/vallisneria-spiralis.json';
// Substrates (Stage 2)
import aquaSoilAmazonia from './data/substrates/aqua-soil-amazonia.json';
import blackPeaGravel from './data/substrates/black-pea-gravel.json';
import fluorite from './data/substrates/fluorite.json';
import silicaSand from './data/substrates/silica-sand.json';
import tropicaAquasoil from './data/substrates/tropica-aquasoil.json';
import whiteSand from './data/substrates/white-sand.json';
// Livestock — fish (Stage 7 F7.1)
import livestockApistogrammaCacatuoides from './data/livestock/apistogramma-cacatuoides.json';
import livestockBettaSplendens from './data/livestock/betta-splendens.json';
import livestockCorydorasPygmaeus from './data/livestock/corydoras-pygmaeus.json';
import livestockNeonTetra from './data/livestock/neon-tetra.json';
// Livestock — shrimp
import livestockCaridinaCantonensis from './data/livestock/caridina-cantonensis.json';
import livestockNeocaridinaDavidi from './data/livestock/neocaridina-davidi.json';
// Livestock — snails
import livestockNeritinaNatalensis from './data/livestock/neritina-natalensis.json';
import livestockPlanorbellaDuryi from './data/livestock/planorbella-duryi.json';
// Equipment — filters (Stage 7 F7.3)
import equipmentEheimPro4Plus350 from './data/equipment/eheim-pro-4-plus-350.json';
import equipmentFluval207 from './data/equipment/fluval-207.json';
import equipmentAquaclear50 from './data/equipment/aquaclear-50.json';
import equipmentAquaneatTripleSponge from './data/equipment/aquaneat-triple-sponge.json';
// Equipment — heaters
import equipmentFluvalE300 from './data/equipment/fluval-e300.json';
import equipmentEheimJager200 from './data/equipment/eheim-jager-200.json';
import equipmentCobaltNeoTherm100 from './data/equipment/cobalt-neo-therm-100.json';
// Equipment — lights
import equipmentTwinstar600s from './data/equipment/twinstar-600s.json';
import equipmentChihirosWrgbIIPro60 from './data/equipment/chihiros-wrgb-ii-pro-60.json';
import equipmentFluvalPlant336W from './data/equipment/fluval-plant-3-36w.json';
// Equipment — CO2
import equipmentCo2artSePressurised from './data/equipment/co2art-se-pressurised.json';
import equipmentAdaPollenGlassDiffuser from './data/equipment/ada-pollen-glass-diffuser.json';
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
  // Hardscape — rocks (Stage 3 F3.5 + library expansion)
  rockSeiryuLarge,
  rockSeiryuMedium,
  rockOhko,
  rockFrodo,
  rockPagoda,
  rockBlackLava,
  rockTexasHoley,
  rockElephantSkin,
  rockPetrifiedWood,
  rockPolarIce,
  rockIota,
  rockSnowMountain,
  // Hardscape — wood
  woodSpiderwood,
  woodManzanita,
  woodMalaysian,
  woodMopani,
  woodCholla,
  woodBonsai,
  woodRedmoor,
  // Plants — foreground / carpets (Stage 4 F4.1 + library expansion)
  plantEleocharis,
  plantMonteCarlo,
  plantGlossostigma,
  plantHemianthus,
  plantMarsilea,
  plantSagittaria,
  plantUtricularia,
  // Plants — midground
  plantCryptocoryneWendtii,
  plantCryptocoryneParva,
  plantBucephalandra,
  plantAnubiasNanaPetite,
  plantAnubiasBarteri,
  plantJavaFern,
  plantJavaFernTrident,
  plantStaurogyne,
  plantPogostemonHelferi,
  plantHygrophilaPinnatifida,
  plantHydrocotyle,
  plantRiccia,
  // Plants — background
  plantVallisneriaNana,
  plantVallisneriaSpiralis,
  plantRotala,
  plantLimnophila,
  plantLudwigia,
  plantPogostemonStellatus,
  plantHygrophilaPolysperma,
  plantAmmannia,
  plantMyriophyllum,
  // Livestock — fish (Stage 7 F7.1)
  livestockNeonTetra,
  livestockBettaSplendens,
  livestockCorydorasPygmaeus,
  livestockApistogrammaCacatuoides,
  // Livestock — shrimp
  livestockNeocaridinaDavidi,
  livestockCaridinaCantonensis,
  // Livestock — snails
  livestockNeritinaNatalensis,
  livestockPlanorbellaDuryi,
  // Equipment (Stage 7 F7.3)
  // Equipment — filters
  equipmentEheimPro4Plus350,
  equipmentFluval207,
  equipmentAquaclear50,
  equipmentAquaneatTripleSponge,
  // Equipment — heaters
  equipmentFluvalE300,
  equipmentEheimJager200,
  equipmentCobaltNeoTherm100,
  // Equipment — lights
  equipmentTwinstar600s,
  equipmentChihirosWrgbIIPro60,
  equipmentFluvalPlant336W,
  // Equipment — CO2
  equipmentCo2artSePressurised,
  equipmentAdaPollenGlassDiffuser,
];

/**
 * Pre-validated core catalog result. Computed once at module import.
 * `errors` should be `[]` in a healthy build — the value is here so a CI
 * check or a runtime smoke-test can flag drift.
 */
export const CORE_CATALOG_RESULT: CatalogLoadResult = loadCatalog(CORE_CATALOG_MANIFESTS);

/** The validated core catalog. Frozen via the loader's index. */
export const coreCatalog = CORE_CATALOG_RESULT.catalog;
