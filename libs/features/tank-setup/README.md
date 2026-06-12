# `@aquascape/features/tank-setup`

Tank size presets + custom dimensions UI. Plan Stage 1 F1.1.

**Tags:** `scope:feature`.

## Stage 1 status (F1.1 Phase B)

`TankSetupComponent` (Angular 18 standalone, `OnPush`, signal-aware) ships:

- **Preset picker** grouped by brand (ADA / Standard) inside an
  accessible `role="radiogroup"`. Selecting a preset dispatches
  `setTankDimensions(...)` and stamps `tank.presetRef`.
- **Custom dimensions form** (Reactive Forms) — W × H × D, validated
  100 mm ≤ each ≤ 3 000 mm. Submitting clears `presetRef`.
- **cm / in / mm toggle** with `aria-pressed`; persisted via
  `StorageService` under `tank-setup.units`.
- **Aspect-ratio warning** (non-blocking) for W/H outside `[0.3, 4.0]`,
  surfaced in an `aria-live="polite"` region.
- Internal form state is always integer mm — display conversion happens
  on input/blur, not in storage.

## Water fill

`WaterFillComponent` (embedded in the panel next to the dimension picker)
authors `Tank.waterLevelMm` — the water-surface height above the interior
floor:

- **Numeric input + mm | gal toggle.** US gallons are display-only:
  `gal = width × depth × levelMm / 1e6 L ÷ 3.78541`; input in gallons is
  converted → clamped → rounded → dispatched as integer mm. Gallons show
  1 decimal; mm is an integer. Unit choice persists under
  `tank-setup.water-fill-unit`.
- **Shows the EFFECTIVE level** via `effectiveWaterLevelMm(tank)`, so an
  untouched document displays its default fill (`height − 25 mm`) instead
  of an empty box. A badge indicates **Auto** (derived) vs **Custom**
  (authored); the **Auto** button dispatches `setWaterLevel(null)` to
  clear back to the default.
- **Commit on blur/Enter**, clamped UI-side to `[1, tank.height]` (the
  domain command rejects out-of-range rather than clamping). Dispatch
  goes through the shared Command pipeline
  (`SceneActions.dispatchCommand(setWaterLevel(...))`) — fully
  undo/redo-able.
- Labelled input, `role="group"` unit toggle with `aria-pressed`, and an
  `aria-label`led Auto affordance.

## Out of scope

- The 8-preset table is inline (`./src/lib/tank-presets.ts`) with a
  `TODO(F2.4)` to migrate to the catalog manifest when domain/catalog
  ships.
- Glass / water tint / background styling — F1.2.
- Persistence to `.aqua` — F1.3.

## Public API

```ts
import {
  TankSetupComponent,
  WaterFillComponent,
  tankPresets,
  type TankPreset,
  type DisplayUnit,
  type WaterFillUnit,
  MIN_DIM_MM,
  MAX_DIM_MM,
  MIN_WATER_LEVEL_MM,
  LITRES_PER_US_GALLON,
  ASPECT_MIN,
  ASPECT_MAX,
} from '@aquascape/features/tank-setup';
```
