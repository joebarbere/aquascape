# Nutrients & additives catalog + dosing

**Type:** Catalog + scene-model + simulation UI.
**Owner:** `catalog-engineer` (the `nutrient` kind + entries) + `scene-model-engineer` (the
`DoseNutrient` Command) + `angular-feature-engineer` (the Dose action-HUD tool + `dose` console command).
**Status:** Not started.

## Goal

A new catalog **kind** of real-world aquarium nutrients/additives (with honest chemical values), plus
a way to dose them in simulation mode — a **"Dose"** button in the lower-center action HUD and a
**`dose` console command** — raising water-chemistry parameters and feeding plant growth.

## Spec reference

Catalog kind pattern (`libs/domain/catalog/`); the simulation console registry
(`apps/web/src/app/simulation/simulation-console.service.ts`) + the fuzzy matcher in
`simulation-scene-ops.ts`; the Stage 15 action HUD
([`stage-15-husbandry-interactions.md`](stage-15-husbandry-interactions.md)) +
`SimulationUiService`; the Stage 13 water chemistry
([`stage-13-aquarium-husbandry.md`](stage-13-aquarium-husbandry.md), ADR-0006 — `Tank.waterChemistry`);
`domain/growth-sim` (shipped) for the plant-vigor link.

## Dependencies

**Requires (for the dosing EFFECT):** Stage 13 (`Tank.waterChemistry` state + readout) and Stage 15
(the `aquascape-simulation-actions` HUD shell). **Independent:** the catalog kind (F-A) + the command
plumbing can land first; the chemistry effect lights up once Stage 13 ships. **Enables:** realistic
fertilising/dosing as part of the husbandry sim + a lever for algae (over-dosing) in Stage 16.

## Scope

### F-A — Catalog `nutrient` kind (additive; catalog `schemaVersion` stays 3)

Extend `CatalogKind` + the `CatalogEntry` union + a `oneOf` branch in `catalog-entry.schema.json`;
manifests under `src/data/nutrients/`; register in `core-catalog.ts`. `NutrientEntry` captures honest
chemistry (never fabricate proprietary ppm):

```
kind: 'nutrient'
category: 'macro-salt' | 'micro-trace' | 'all-in-one' | 'liquid-carbon'
        | 'conditioner' | 'remineralizer' | 'buffer' | 'bacteria'
brand: string
form: 'dry' | 'liquid'
dose: { amount: number; unit: 'g' | 'ml'; perLitres: number }     // the representative dose
contributes?: { no3?; po4?; k?; fe?; mg?; ca?; gh?; kh? }          // ppm / dGH per dose — ONLY when disclosed
disclosed: boolean                                                 // false ⇒ proprietary
affects: ('no3'|'po4'|'k'|'fe'|'traces'|'gh'|'kh'|'ph'
        |'ammoniaDetox'|'carbon'|'bacteriaSeed'|'dechlorinate')[]
formula?: string        // dry salts
source?: string         // citation URL
color: HexColor         // UI swatch
shrimpSafe?: boolean
notes?: string
```

**Seed ~25–30 real entries from the research** (citing `source`), e.g.:
- **Macro dry salts (disclosed EI ppm):** KNO3 (`KNO3`, 0.3 g/10 gal → +4.84 ppm NO3, +3.1 K),
  KH2PO4 (+1.84 ppm PO4), K2SO4 (+11.82 ppm K), MgSO4·7H2O (+1 ppm Mg/g·100 L), CaSO4.
- **Micro/trace:** CSM+B (Fe-EDTA + Mn/Zn/Cu/B/Mo), Fe-DTPA 11% (hard-water-stable).
- **Liquid all-in-ones:** 2Hr APT Complete (disclosed: +4 K, +1.5 N, +0.7 P, +0.4 Mg, +0.03 Fe per
  5 ml/100 L), NilocG Thrive (+6 NO3/+1.1 PO4/+5 K/+0.25 Fe per pump/10 gal), and **proprietary**
  ones flagged `disclosed:false` + qualitative `affects`: Seachem Flourish (Comprehensive/Nitrogen/
  Phosphorus/Potassium/Trace/Iron), Tropica Specialised, Aquarium Co-Op Easy Green, ADA Green
  Brighty, Dennerle S7.
- **Liquid carbon:** Seachem Flourish Excel (`affects:['carbon']`, notes: sensitive-plant caveat).
- **Conditioners / cycling:** Seachem Prime (`affects:['dechlorinate','ammoniaDetox']`), Seachem
  Stability (`affects:['bacteriaSeed']`).
- **Remineralizers / buffers:** Seachem Equilibrium (+1 meq/L GH), SaltyShrimp GH+, Seachem
  Alkaline Buffer (+KH/+pH), Acid Buffer (−pH).

### F-B — `DoseNutrient` Command (scene-model, undo-able)

`doseNutrient(productId, amount, unit)` → resolves the catalog row, computes the parameter deltas
(`contributes × amount / dose.amount` for **disclosed** products; a category-default delta for
**proprietary**), applies them to `Tank.waterChemistry` (Stage 13), and stores the inverse for undo.
Optional small plant-vigor nudge via `growth-sim`. (Depends on the Stage 13 chemistry field.)

### F-C — "Dose" action-HUD tool

A third tool in the Stage 15 `aquascape-simulation-actions` HUD (bottom-center, square rounded
button labelled **Dose**): pick a product (a picker filterable by `category`) → an amount stepper
(1 dose / custom ml or g) → apply (dispatch `DoseNutrient`); show the resulting parameter change from
the Stage 13 readout. Extends `SimulationActionService` + the `SimulationUiService.actionsVisible`
flag (so `hud … actions` toggles it).

### F-D — `dose` console command

`dose list | dose <product> [amount]`, with **fuzzy product matching** (reuse the `matchSpecies`-style
helper in `simulation-scene-ops.ts`) + Tab-completion. Dispatches `DoseNutrient`. Mirrors the
`fish`/`item` command pattern in `simulation-console.service.ts`.

### Out

- Modelling long-term nutrient uptake/decay (that's the Stage 13 `water-sim` model's job — dosing
  just adds the source).
- Substrate root-tabs / substrate fertilisation (this kind is water-column dosing).

## Acceptance criteria

- [ ] `coreCatalog.byKind('nutrient')` returns ~25–30 real products; disclosed ones carry honest ppm,
      proprietary ones carry `disclosed:false` + qualitative `affects`; catalog schema validates; each
      cites a `source`.
- [ ] The Dose HUD tool doses a selected product/amount; the Stage 13 water-chemistry readout rises by
      the expected delta (with Stage 13); `DoseNutrient` undo reverses it.
- [ ] `dose easy-green 2` (fuzzy) doses; `dose list` lists products; Tab-completes `dose`.
- [ ] Dosing a fert nudges plant vigor (growth-sim), visibly over the time slider.

## Testing

- **Unit (≥90% on the catalog/scene-model bits):** schema validation for the `nutrient` kind; the
  `DoseNutrient` delta math + invert (disclosed vs proprietary); the `dose` parser + fuzzy match.
- **Component:** the Dose tool renders + applies; the picker filters by category.
- **E2E (real-GPU loop):** dose a product via the HUD + via `dose`, assert the chemistry readout rises
  (once Stage 13 is in).

## Notes

Honesty rule (carry into the manifests + `docs/caveats/catalog.md`): **do not fabricate proprietary
ppm** — `disclosed:false` + an `affects` list is the correct representation when a manufacturer
doesn't publish per-dose values. The button name is **"Dose"** (the hobby term). Sequencing: F-A is
independent (land anytime); F-B/C/D build on Stage 13 + Stage 15.
