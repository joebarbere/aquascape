# `@aquascape/rendering/renderer-api`

Renderer interface (`SceneRenderer`) — the single contract both the 2D and
3D renderers implement. Plan §2.4 / Stage 0 F0.4.

- **Tags:** `scope:rendering`, `framework:none`.
- **May depend on:** `@aquascape/domain/geometry`, `@aquascape/domain/scene-model`.
- **Must not depend on:** Angular, NgRx, RxJS, Electron, platform-\*, ui,
  features. (DOM types like `HTMLCanvasElement` are allowed — they're the
  renderer contract's natural vocabulary; `framework:none` means no
  Angular/Electron/NgRx, not "no DOM lib".)

## What lives here

Types only:

- `SceneRenderer` — the contract. `attach(surface)`, `render(scene, viewport)`,
  `hitTest(point, scene, viewport)`, `dispose()`.
- `RenderSurface` — the drawing surface the host hands to a renderer.
  Wraps a `HTMLCanvasElement`, its devicePixelRatio, and its CSS-pixel size.
- `Viewport` — `center` (mm), `zoom` (pixels per mm), `rotation` (radians,
  positive CCW in world space). Stage 0 always passes `rotation = 0`.
- `HitResult` — `objectId` + `layerId`, with an optional `handle` for the
  selection bezel (lands in F3.3).

There is **zero runtime code** in this lib. The compiler enforces the
contract; the lone `index.spec.ts` pins the public type shape via a no-op
assignment so any incompatible change to a public type fails the test
target before it runs.

## Coordinate system reminder

One coordinate space across the whole project:

- Right-handed; **+x right, +y up, +z back**; mm.
- Origin = tank front-bottom-left interior corner.
- The 2D renderer projects along −z (the same `project2D` in
  `@aquascape/domain/geometry`); the 3D renderer (Stage 10) reads the same
  numbers without projecting.

If a feature is tempted to introduce a "2D mm" space distinct from the
3D space, **stop** — that's the wedge that prevents Stage 10 from dropping
in cleanly.

## Renderer contract invariants

- `render(scene, viewport)` is **idempotent** for a given (scene, viewport):
  consecutive calls produce identical pixels. No hidden internal state, no
  time-based animation, no random data.
- `render` **does not mutate** `scene`.
- `hitTest` is **consistent with render**: if a click hits object X, the
  pixel under it was visibly X (or its handles). Stale caches that
  disagree are bugs.
- `dispose` releases **every** resource attached. Tests verify no leak.

## Stage 0 status

Interface only. `renderer-2d` (sibling lib) provides the first
implementation; `renderer-3d` (Stage 10) is the second.
