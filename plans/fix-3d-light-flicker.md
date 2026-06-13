# Fix — 3D light flicker while orbiting

**Type:** Bug fix (renderer-3d).
**Owner:** `renderer-engineer`.
**Status:** Not started.

## Goal

Eliminate the visible light/brightness flicker that appears while orbiting the 3D camera
(mouse click-and-drag) in 3D / simulation / fish-eye views.

## Context

The day-night lighting is mutated **per `render()` call** — `Three3DRenderer` calls
`applyDayNightLookup(options.dayNightLookup, scene)` (mutating `AmbientLight.color` +
`DirectionalLight.intensity` + `Scene.background`) and `setCausticIntensity(...)` inside `render()`
(`libs/rendering/renderer-3d/src/three-3d-renderer.ts`). Meanwhile the renderer's own RAF tick paints
continuously with whatever lighting the last `render()` left in place.

During an orbit, OrbitControls' `change` event triggers **event-driven** `render()` calls from
`apps/web/src/app/app.component.ts` (`renderCurrent()` + the viewport/day-night effects). The most
likely flicker cause: `renderCurrent()` builds `RenderOptions` with a **spread that DROPS
`dayNightLookup` when it is null** — so some interaction frames apply day-night lighting and others
reset it to renderer defaults, alternating frame-to-frame as RAF paints in between. A secondary
amplifier is `uCausticStrength` snapping to a new directional level on each `render()` while the
caustic `uTime` advances independently in the RAF tick.

## Approach (recommended)

Make lighting application **single-sourced + idempotent**, and never silently drop the lookup:

1. **Never omit `dayNightLookup` on a 3D render.** In `renderCurrent()`, pass an explicit neutral
   lookup (full daylight / no tint) instead of omitting the field when the service value is null, so
   every render path applies the *same* lighting rather than flipping between "apply" and "renderer
   default".
2. **Apply lighting once per frame from the latest options, in the RAF tick** — not re-applied on
   every event-driven `render()`. Cache the last lookup on the renderer; the tick applies it
   (idempotent: no-op when unchanged). This decouples lighting from the cadence of interaction
   re-renders.
3. **Smooth caustic intensity:** move `setCausticIntensity` next to `updateCausticTime` in the tick
   and lerp `uCausticStrength` toward the target over a few frames, so a directional-level change
   fades instead of snapping.
4. (Optional) **Coalesce OrbitControls `change` re-renders** so a fast spin doesn't fire
   `renderCurrent()` 60×/s — the RAF tick is already painting every frame.

## Scope

**In:** the lighting/caustic application path + the `renderCurrent()` options spread. **Out:** any
change to the day-night *values* (the `DayNightService` ramp is correct); SSAO/bloom tuning.

## Acceptance criteria

- [ ] No perceptible brightness flicker while orbiting in 3D, simulation, or fish-eye views — at
      any day-night phase (especially dawn/dusk where directional intensity is mid-range).
- [ ] Day-night scrub still updates lighting smoothly; no regression to caustics/water/sway timing.
- [ ] No extra full-scene rebuilds introduced (lighting still mutated in place per the renderer-3d
      dispose/rebuild discipline).

## Testing

- **Real-GPU Playwright loop** (`tools/demo/validate-3d.mjs` + `docs/caveats/e2e.md` → "Real-GPU
  validation loop"): a regression spec that orbits, captures two consecutive frames mid-drag, and
  asserts the mean-channel brightness delta is below a small floor.
- **Manual:** orbit at dawn/dusk and during a day-night scrub; confirm steady lighting.
- **Unit:** if the neutral-lookup helper is extracted, a small test that a null service value yields a
  neutral (non-omitted) lookup.

## Notes

The exact root cause should be reconfirmed against `three-3d-renderer.ts` first; the dual-path /
dropped-`dayNightLookup` hypothesis is the strongest from exploration but the fix (single-source the
lighting in the tick) is robust to either the dropped-field or the caustic-snap variant. Update
`docs/caveats/renderer-3d.md` with the "lighting is applied once per frame from cached options" rule.
