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
  tankPresets,
  type TankPreset,
  type DisplayUnit,
  MIN_DIM_MM,
  MAX_DIM_MM,
  ASPECT_MIN,
  ASPECT_MAX,
} from '@aquascape/features/tank-setup';
```
