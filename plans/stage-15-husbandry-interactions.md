# Stage 15 — Simulation action HUD (feeding + water-change tools)

**Stage:** 15 — Husbandry interactions (the hands-on action HUD).
**Owner:** `angular-feature-engineer` (HUD + tool state machine) + `renderer-engineer`
(`SiphonTool` + canvas→tank raycast) + `scene-model-engineer` (the water-change Command wiring).
**Status:** Not started.

## Goal

A **lower-middle action HUD** in simulation mode — a row of **square, rounded-border tool buttons**
that drive hands-on husbandry: a **feeding** tool (pick a food, place the drop) and a multi-step
**water-change** tool (pick replacement-water params → place/move a siphon → siphon out → siphon in).

## Spec reference

Builds on Stage 13 (the `WaterChange` Command + chemistry deltas + `food`/`water-test-kit` catalog
kinds) and Stage 14 (typed-food spawn). The `SiphonTool` built here is reused by Stage 16's cleaner
mode (F16.5). Sits alongside the existing simulation HUDs (`apps/web/src/app/simulation/` — info /
controls / console) and uses `SimulationUiService` for visibility.

## Dependencies

**Requires:** Stage 13 F13.5 (water-change Command + replacement-water params) + F13.4 (`food` kind);
Stage 14 F14.1 (typed-food drop). **Enables:** Stage 16 F16.5 (cleaner mode reuses `SiphonTool` +
the OUT/IN suction mechanic).

## Layout

A new `aquascape-simulation-actions` HUD pinned **bottom-center** (distinct from the top-left control
HUD, top-right info HUD, bottom-left console). Square buttons with rounded borders; selecting one
enters that tool's mode (a small inline panel + a 3D canvas interaction). Visibility via a new
`SimulationUiService.actionsVisible` flag and a `hud … actions` console target. A `SimulationActionService`
owns the active-tool state machine (idle → tool-selected → sub-step).

## Substages

### F15.1 — Feeding tool
Button → food-type picker (catalog `food`) → **position-to-drop**: click/drag on the 3D canvas to
choose the XZ drop point (a new canvas→tank **raycast helper** in renderer-3d), then drop typed
`FoodSprite`(s) there via the Stage 14 typed-spawn API — replacing the random-scatter feed with
placed feeding. A drop-preview marker follows the cursor.

### F15.2 — Water-change tool (multi-step flow)
A guided flow in the action panel:
1. **Replacement params** — small form (temperature / pH / hardness) for the new water.
2. **Place + move siphon** — a draggable 3D **siphon nozzle** placed in the tank (placement/move
   modelled on a hardscape drag; a `SiphonTool` Object3D + tool state). The nozzle reads the local
   region (for waste/algae proximity).
3. **Siphon OUT** — drain animation; water level drops; ammonia/nitrite/**nitrate** reduced
   proportional to the volume removed (drives the Stage 13 `WaterChange` Command + chemistry).
4. **Siphon IN** — add the replacement water; level rises; chemistry lerps toward the chosen params.
OUT then IN = a real partial water change; each step is undo-able via the Command pipeline.

## Acceptance criteria

- [ ] The action HUD shows bottom-center with square rounded buttons; `hud hide actions` /
      `hud show actions` toggle it (and it auto-shows in simulation mode).
- [ ] Feeding: pick a food, click in the tank, food drops at that point and fish find it.
- [ ] Water change: set params, place the siphon, siphon OUT lowers nitrate + water level, siphon IN
      restores level and shifts chemistry toward the replacement; undo reverses the change.
- [ ] The `SiphonTool` is a reusable component (consumed by Stage 16 cleaner with no fork).

## Testing

- **Unit:** the tool state machine transitions; the canvas→tank raycast math; the OUT/IN volume →
  chemistry delta mapping.
- **Component:** the action HUD renders + the buttons enter tool modes; the water-change form
  dispatches the Command.
- **E2E (real-GPU loop):** click feeding → drop → assert fish converge; run a water change → assert
  the chemistry readout (Stage 13) drops nitrate.

## Notes

Keep the `SiphonTool` in renderer-3d (a scene-builder module) so both this HUD and the Stage 16
cleaner game mode share one implementation. The action-HUD positioning + the new `actions` visibility
flag extend the simulation HUD/console contract documented in `docs/caveats/app-modes.md` and the
simulation-mode guide.
