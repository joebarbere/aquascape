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
// Livestock — fish (Stage 7 F7.1; Stage 11 F11.6 expansion)
import livestockAncistrusCirrhosus from './data/livestock/ancistrus-cirrhosus.json';
import livestockApistogrammaCacatuoides from './data/livestock/apistogramma-cacatuoides.json';
import livestockBettaSplendens from './data/livestock/betta-splendens.json';
import livestockCarnegiellaStrigata from './data/livestock/carnegiella-strigata.json';
import livestockCorydorasAeneus from './data/livestock/corydoras-aeneus.json';
import livestockCorydorasPygmaeus from './data/livestock/corydoras-pygmaeus.json';
import livestockHyphessobryconAmandae from './data/livestock/hyphessobrycon-amandae.json';
import livestockHypostomusPlecostomus from './data/livestock/hypostomus-plecostomus.json';
import livestockMikrogeophagusRamirezi from './data/livestock/mikrogeophagus-ramirezi.json';
import livestockNeonTetra from './data/livestock/neon-tetra.json';
import livestockOtocinclusVittatus from './data/livestock/otocinclus-vittatus.json';
import livestockPangioKuhlii from './data/livestock/pangio-kuhlii.json';
import livestockParacheirodonAxelrodi from './data/livestock/paracheirodon-axelrodi.json';
import livestockPterophyllumScalare from './data/livestock/pterophyllum-scalare.json';
import livestockPuntigrusTetrazona from './data/livestock/puntigrus-tetrazona.json';
import livestockPuntiusTitteya from './data/livestock/puntius-titteya.json';
import livestockSymphysodonAequifasciatus from './data/livestock/symphysodon-aequifasciatus.json';
import livestockTrichogasterLalius from './data/livestock/trichogaster-lalius.json';
import livestockTrichopodusLeerii from './data/livestock/trichopodus-leerii.json';
import livestockTrigonostigmaHeteromorpha from './data/livestock/trigonostigma-heteromorpha.json';
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
import equipmentNicrewClassicLedPlus24 from './data/equipment/nicrew-classicled-plus-24.json';
import equipmentFinnexPlanted247Klc24 from './data/equipment/finnex-planted-247-klc-24.json';
import equipmentAdaSolarRgb from './data/equipment/ada-solar-rgb.json';
import equipmentKessilA360xTunaSun from './data/equipment/kessil-a360x-tuna-sun.json';
import equipmentOnfFlatOnePlus60 from './data/equipment/onf-flat-one-plus-60.json';
import equipmentCurrentSatellitePlusPro24 from './data/equipment/current-satellite-plus-pro-24.json';
// Equipment — CO2
import equipmentCo2artSePressurised from './data/equipment/co2art-se-pressurised.json';
import equipmentAdaPollenGlassDiffuser from './data/equipment/ada-pollen-glass-diffuser.json';
// Decor — 3D-modelled classic ornaments (generic resin-ornament archetypes)
import decorAmphora from './data/decor/decor-amphora.json';
import decorAnchor from './data/decor/decor-anchor.json';
import decorCannon from './data/decor/decor-cannon.json';
import decorCastle from './data/decor/decor-castle.json';
import decorDiverHelmet from './data/decor/decor-diver-helmet.json';
import decorGreekColumn from './data/decor/decor-greek-column.json';
import decorMoai from './data/decor/decor-moai.json';
import decorSkull from './data/decor/decor-skull.json';
import decorSunkenGalleon from './data/decor/decor-sunken-galleon.json';
import decorTreasureChest from './data/decor/decor-treasure-chest.json';
// Nutrients & additives + dosing (F-A) — dry salts / all-in-one liquids /
// liquid carbon / conditioners / remineralizers / buffers / bacteria.
// Macro salts (disclosed EI stoichiometry)
import nutrientMacroKno3 from './data/nutrients/macro-kno3.json';
import nutrientMacroKh2po4 from './data/nutrients/macro-kh2po4.json';
import nutrientMacroK2so4 from './data/nutrients/macro-k2so4.json';
import nutrientMacroMgso4 from './data/nutrients/macro-mgso4.json';
import nutrientMacroCaso4 from './data/nutrients/macro-caso4.json';
// Macro liquids (Seachem Flourish single-macro line — proprietary)
import nutrientMacroFlourishNitrogen from './data/nutrients/macro-flourish-nitrogen.json';
import nutrientMacroFlourishPhosphorus from './data/nutrients/macro-flourish-phosphorus.json';
import nutrientMacroFlourishPotassium from './data/nutrients/macro-flourish-potassium.json';
// Micro / trace
import nutrientMicroCsmb from './data/nutrients/micro-csmb.json';
import nutrientMicroFeDtpa from './data/nutrients/micro-fe-dtpa.json';
import nutrientMicroFlourishComprehensive from './data/nutrients/micro-flourish-comprehensive.json';
import nutrientMicroFlourishTrace from './data/nutrients/micro-flourish-trace.json';
import nutrientMicroFlourishIron from './data/nutrients/micro-flourish-iron.json';
// All-in-one liquids
import nutrientAioAptComplete from './data/nutrients/aio-apt-complete.json';
import nutrientAioNilocgThrive from './data/nutrients/aio-nilocg-thrive.json';
import nutrientAioEasyGreen from './data/nutrients/aio-easy-green.json';
import nutrientAioTropicaSpecialised from './data/nutrients/aio-tropica-specialised.json';
import nutrientAioAdaGreenBrighty from './data/nutrients/aio-ada-green-brighty.json';
import nutrientAioDennerleS7 from './data/nutrients/aio-dennerle-s7.json';
// Liquid carbon
import nutrientCarbonFlourishExcel from './data/nutrients/carbon-flourish-excel.json';
import nutrientCarbonApiCo2Booster from './data/nutrients/carbon-api-co2-booster.json';
// Conditioners
import nutrientConditionerPrime from './data/nutrients/conditioner-prime.json';
import nutrientConditionerApiTapWater from './data/nutrients/conditioner-api-tap-water.json';
// Bacteria / cycling
import nutrientBacteriaStability from './data/nutrients/bacteria-stability.json';
import nutrientBacteriaTetraSafestart from './data/nutrients/bacteria-tetra-safestart.json';
// Remineralizers
import nutrientReminEquilibrium from './data/nutrients/remin-equilibrium.json';
import nutrientReminSaltyshrimpGhPlus from './data/nutrients/remin-saltyshrimp-gh-plus.json';
import nutrientReminSaltyshrimpGhKhPlus from './data/nutrients/remin-saltyshrimp-gh-kh-plus.json';
// Buffers
import nutrientBufferAlkaline from './data/nutrients/buffer-alkaline.json';
import nutrientBufferAcid from './data/nutrients/buffer-acid.json';
// Food (Stage 13 F13.4 — husbandry sim) — flake / pellet / wafer / live
import foodFlakeTetramin from './data/food/flake-tetramin.json';
import foodFlakeOmegaOneColor from './data/food/flake-omega-one-color.json';
import foodPelletHikariMicro from './data/food/pellet-hikari-micro.json';
import foodPelletBugBites from './data/food/pellet-bug-bites.json';
import foodPelletFluvalShrimp from './data/food/pellet-fluval-shrimp.json';
import foodWaferHikariAlgae from './data/food/wafer-hikari-algae.json';
import foodWaferRepashySoilentGreen from './data/food/wafer-repashy-soilent-green.json';
import foodLiveFrozenBloodworms from './data/food/live-frozen-bloodworms.json';
import foodLiveBabyBrineShrimp from './data/food/live-baby-brine-shrimp.json';
// Algae (Stage 13 F13.4) — the four husbandry types (match water-sim AlgaeType)
import algaeGreenSpot from './data/algae/green-spot.json';
import algaeHair from './data/algae/hair.json';
import algaeBlackBeard from './data/algae/black-beard.json';
import algaeDiatom from './data/algae/diatom.json';
// Water test kits (Stage 13 F13.4) — real kits with published readable ranges
import testKitApiFreshwaterMaster from './data/water-test-kit/api-freshwater-master.json';
import testKitApiAmmonia from './data/water-test-kit/api-ammonia.json';
import testKitSalifertNitrate from './data/water-test-kit/salifert-nitrate.json';
import testKitJblTestlab from './data/water-test-kit/jbl-testlab.json';
import testKitApi5in1Strips from './data/water-test-kit/api-5in1-strips.json';
import testKitJblCo2DropChecker from './data/water-test-kit/jbl-co2-drop-checker.json';
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
  // Livestock — fish (Stage 7 F7.1; Stage 11 F11.6 expansion)
  livestockNeonTetra,
  livestockBettaSplendens,
  livestockCorydorasPygmaeus,
  livestockApistogrammaCacatuoides,
  // Stage 11 F11.6 — common-species expansion (16 added, total fish = 20)
  livestockParacheirodonAxelrodi,
  livestockHyphessobryconAmandae,
  livestockTrigonostigmaHeteromorpha,
  livestockPuntiusTitteya,
  livestockPuntigrusTetrazona,
  livestockCarnegiellaStrigata,
  livestockTrichogasterLalius,
  livestockTrichopodusLeerii,
  livestockPterophyllumScalare,
  livestockSymphysodonAequifasciatus,
  livestockMikrogeophagusRamirezi,
  livestockPangioKuhlii,
  livestockCorydorasAeneus,
  livestockOtocinclusVittatus,
  livestockAncistrusCirrhosus,
  livestockHypostomusPlecostomus,
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
  equipmentNicrewClassicLedPlus24,
  equipmentFinnexPlanted247Klc24,
  equipmentAdaSolarRgb,
  equipmentKessilA360xTunaSun,
  equipmentOnfFlatOnePlus60,
  equipmentCurrentSatellitePlusPro24,
  // Equipment — CO2
  equipmentCo2artSePressurised,
  equipmentAdaPollenGlassDiffuser,
  // Decor — 3D-modelled classic ornaments
  // Wrecks
  decorTreasureChest,
  decorSunkenGalleon,
  decorDiverHelmet,
  decorAnchor,
  decorCannon,
  // Ruins
  decorGreekColumn,
  decorMoai,
  decorAmphora,
  // Bones
  decorSkull,
  // Structures
  decorCastle,
  // Nutrients & additives + dosing (F-A) — 30 real products across 8 categories
  // Macro salts (disclosed EI stoichiometry)
  nutrientMacroKno3,
  nutrientMacroKh2po4,
  nutrientMacroK2so4,
  nutrientMacroMgso4,
  nutrientMacroCaso4,
  // Macro liquids (proprietary Seachem Flourish single-macro line)
  nutrientMacroFlourishNitrogen,
  nutrientMacroFlourishPhosphorus,
  nutrientMacroFlourishPotassium,
  // Micro / trace
  nutrientMicroCsmb,
  nutrientMicroFeDtpa,
  nutrientMicroFlourishComprehensive,
  nutrientMicroFlourishTrace,
  nutrientMicroFlourishIron,
  // All-in-one liquids
  nutrientAioAptComplete,
  nutrientAioNilocgThrive,
  nutrientAioEasyGreen,
  nutrientAioTropicaSpecialised,
  nutrientAioAdaGreenBrighty,
  nutrientAioDennerleS7,
  // Liquid carbon
  nutrientCarbonFlourishExcel,
  nutrientCarbonApiCo2Booster,
  // Conditioners
  nutrientConditionerPrime,
  nutrientConditionerApiTapWater,
  // Bacteria / cycling
  nutrientBacteriaStability,
  nutrientBacteriaTetraSafestart,
  // Remineralizers
  nutrientReminEquilibrium,
  nutrientReminSaltyshrimpGhPlus,
  nutrientReminSaltyshrimpGhKhPlus,
  // Buffers
  nutrientBufferAlkaline,
  nutrientBufferAcid,
  // Food (Stage 13 F13.4) — 9 foods: 2 flake + 3 pellet + 2 wafer + 2 live
  foodFlakeTetramin,
  foodFlakeOmegaOneColor,
  foodPelletHikariMicro,
  foodPelletBugBites,
  foodPelletFluvalShrimp,
  foodWaferHikariAlgae,
  foodWaferRepashySoilentGreen,
  foodLiveFrozenBloodworms,
  foodLiveBabyBrineShrimp,
  // Algae (Stage 13 F13.4) — the four husbandry types (match water-sim AlgaeType)
  algaeGreenSpot,
  algaeHair,
  algaeBlackBeard,
  algaeDiatom,
  // Water test kits (Stage 13 F13.4) — 6 kits across liquid / strip / drop-checker
  testKitApiFreshwaterMaster,
  testKitApiAmmonia,
  testKitSalifertNitrate,
  testKitJblTestlab,
  testKitApi5in1Strips,
  testKitJblCo2DropChecker,
];

/**
 * Pre-validated core catalog result. Computed once at module import.
 * `errors` should be `[]` in a healthy build — the value is here so a CI
 * check or a runtime smoke-test can flag drift.
 */
export const CORE_CATALOG_RESULT: CatalogLoadResult = loadCatalog(CORE_CATALOG_MANIFESTS);

/** The validated core catalog. Frozen via the loader's index. */
export const coreCatalog = CORE_CATALOG_RESULT.catalog;
