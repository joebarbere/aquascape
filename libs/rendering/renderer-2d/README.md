# `@aquascape/rendering/renderer-2d`

Canvas 2D implementation of `SceneRenderer`. Plan §2.4 / Stage 0 F0.4.

- **Tags:** `scope:rendering`, `framework:none`.
- **May depend on:** `@aquascape/domain/geometry`,
  `@aquascape/domain/scene-model`, `@aquascape/rendering/renderer-api`.
- **Must not depend on:** Angular, NgRx, RxJS, Electron, platform-\*, ui,
  features.

## What's in here (Stage 0)

A single class `Canvas2DRenderer` that implements `SceneRenderer` from
`@aquascape/rendering/renderer-api`. Its Stage 0 responsibility is **only**:

- `attach(surface)` — sizes the canvas backing store for `devicePixelRatio`,
  writes the CSS size, registers `resize` and `(resolution: Xdppx)`
  matchMedia listeners (silently no-ops when no `window` is available, so
  the renderer runs in Node tests and SSR environments).
- `render(scene, viewport)` — clears the backing store, builds the
  world-mm → canvas-pixel transform, draws the tank outline (one
  `strokeRect`), and draws a millimetre grid (10 mm minor lines, 50 mm
  major lines) clipped to the tank interior. Idempotent; immutable in
  `scene`.
- `hitTest(...)` — returns `null`. Real object hit-testing lands in F3.3.
- `dispose()` — removes every listener attached in `attach`, clears the
  canvas, drops references.

## What's NOT in here (deferred)

Marked in code with `// F<stage> will add ...` comments:

- Substrate region rendering (F2.x).
- Hardscape sprites + selection handles (F3.x / F3.3).
- Plant cluster rendering (F4.x — driven by the growth simulation).
- Dirty-region redraw (Stage 3+).
- Composition overlays (F5.3).
- Image export (F6.1).

The Stage 0 build paints a tank and a grid — enough to validate the
contract end-to-end and give the editor shell something to mount.

## Coordinate system

There is **one** coordinate space across the whole project (per
`aqua-document.ts` design rule 2):

- Right-handed; **+x right, +y up, +z back**; mm.
- Origin = tank front-bottom-left interior corner.
- The 2D renderer projects along −z (via `project2D` from
  `@aquascape/domain/geometry`). The 3D renderer (Stage 10) consumes the
  same numbers.

Canvas pixel +y is DOWN. The y-flip happens **once**, inside the world-to-
pixel transform built per render call. The renderer never mutates scene
data to "convert" it to canvas space.

The viewport-to-pixel transform is:

```
p_px = T(canvasCenterPx) · R(-viewport.rotation) · S(zoom·dpr, -zoom·dpr) · T(-viewport.center) · p_world
```

For Stage 0 `viewport.rotation = 0` and the rotation term collapses.
Negative y-scale handles the y-flip. The negative sign on rotation makes
positive `viewport.rotation` a CCW rotation in **world** space (otherwise
the y-flip would visually invert the rotation direction).

After applying this transform, draws use world-mm coordinates directly,
and `ctx.lineWidth = 1 / viewport.zoom` gives a 1-CSS-pixel stroke.

## Test approach

Hand-rolled `FakeCanvas` / `FakeContext2D` in `src/test-canvas.ts`
records every drawing op (including style property writes) onto an
ordered array. Tests assert:

- Backing-store size = `width × dpr × height × dpr`; CSS size in logical
  px; resize listener registered; matchMedia DPR listener registered.
- `render` calls `clearRect` exactly once, then strokes the tank
  rectangle, then strokes the grid in two passes (minor + major) with
  the right line counts for a 360 × 220 tank.
- Idempotency — two consecutive `render` calls produce identical op
  streams (deep-equal).
- Immutability — `scene` is `===` to its `JSON.parse(JSON.stringify(...))`
  snapshot after render.
- `dispose` removes the listeners and clears the canvas.
- DPR — backing-store size scales linearly with DPR, but the WORLD-mm
  draw calls (moveTo / lineTo / rect / strokeRect arguments) are
  identical across DPR.

We deliberately chose this stub-and-count approach over a real-pixel
snapshot. A real snapshot test belongs to F6.1 (image export), where
pixel correctness is the deliverable; for Stage 0 a tank+grid is easily
verified by op-counting and the snapshot harness would add brittleness
without value.

## Stage 0 status

Implemented as part of F0.4. Consumed by the editor shell (F0.6) and by
every later stage that visualises the scene.
