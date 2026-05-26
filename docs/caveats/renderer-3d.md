# renderer-3d caveats

**Load this when:** touching `libs/rendering/renderer-3d/`, the 2D ↔ 3D toggle, Three.js scene-builder helpers, or anything that touches `apps/web`'s renderer-swap effect.

## Scope of v1 (Stage 10 F10.1–F10.3)

- **Read-only / simulation-only.** `hitTest()` returns `null` unconditionally. No selection handles in 3D. No participation in the drag / marquee / inspector pipeline. Editing always happens in 2D; flipping to 3D is for visualisation.
- **Future scope NOT in v1:** dynamic lighting (day/night cycle), water simulation (refraction / ripples), animated plants (sway / growth-in-motion), fish behaviours, photorealistic textures, shadows. The scene-builder per-element factoring (`tank-mesh.ts` / `substrate-mesh.ts` / etc.) is the seam those land along — one file per scene-element kind, additive changes.

## Coordinate system

Three.js convention (right-handed, +Y up, looking down −Z) **matches the `.aqua` document exactly** (+x right, +y up, +z back, origin at the tank's front-bottom-left interior corner). The scene-model coords map 1:1 to Three.js world space — no axis flip, no projection juggle. This is the architectural payoff "one scene model, two renderers" was always betting on; don't introduce a coordinate translation layer in the renderer.

## Canvas-context exclusivity (the load-bearing toggle constraint)

**A `<canvas>` element can have only ONE context type for its lifetime.** Once `getContext('2d')` is called, `getContext('webgl')` returns `null` and vice-versa. This is a hard browser invariant. Consequences:

- The 2D ↔ 3D toggle uses **two stacked `<canvas>` elements** with `[hidden]` toggling visibility — never one canvas with a context swap. See `apps/web/src/app/app.component.ts` for the template.
- Both canvases live in the DOM regardless of the active mode. We never destroy them. Re-attaching is cheap; re-creating would lose layout state + force a reflow.
- Pointer listeners (drag/marquee/selection) bind to the **2D canvas only**. The 3D canvas is owned by `OrbitControls` inside `Three3DRenderer` — no app-component listeners on it.

## `Viewport` is 2D-only

The `SceneRenderer.render(scene, viewport, options)` signature is shared, but the `Viewport` (`center` + `zoom` + `rotation` in CSS-pixels-per-mm) is a 2D framing concept. **The 3D renderer ignores `Viewport`** and uses `OrbitControls` as its camera source of truth. Pass through whatever the call site has; the 3D impl picks what it consumes. Documented in `Three3DRenderer.render`'s JSDoc.

Decoration-only `RenderOptions` fields (`overlayOptions` / `wallBackground` / `snapGuides` / `backdropImage` / `selection`) are 2D-only conventions. The 3D renderer ignores them. `catalog` + `previewAgeWeeks` ARE consumed (catalog for material colours, previewAgeWeeks for plant growth scaling — same `plantScale` helper from `@aquascape/domain/growth-sim` the 2D renderer uses).

## Idempotency invariant

`render(scene, viewport)` twice with the same input must produce identical visible WebGL state. The animation tick (RAF loop running `controls.update()` + `renderer.render(scene, camera)`) is solely for OrbitControls damping; the scene graph is rebuilt only when `render()` is called explicitly. **Damping settles to a fixed point** when the user isn't dragging the camera, so idempotency holds across multiple `render()` calls separated by frame ticks.

The rebuild path disposes the previous content group's geometries + materials before creating new ones. Long-running render/dispose cycles are leak-tested at 100 iterations — `renderer.info.memory.{geometries,textures}` must not grow without bound.

## Three.js dispose discipline

Three.js leaks if you don't manually dispose `Geometry`, `Material`, `Texture`. The `disposeNode(root)` helper in `three-3d-renderer.ts` traverses the subtree and calls `.dispose()` on every `Mesh` / `InstancedMesh` geometry + material (handling array materials too) before clearing children. Called in `dispose()` AND in `render()` before swapping the content group.

When adding a new scene-builder file (e.g. a future `fish-mesh.ts`), the returned `Object3D` is expected to be a `Group` whose Meshes / InstancedMeshes own their geometry + material. `disposeNode` walks the tree generically — you don't need to extend it per builder.

## `three/addons/*` import gotcha

The `three/addons/controls/OrbitControls.js` ESM path doesn't resolve under classic node `moduleResolution`. The lib uses `'three/examples/jsm/controls/OrbitControls'` (no `.js`) instead — classic node resolution picks it up from `@types/three/...d.ts` + the matching runtime file. Don't change `moduleResolution` workspace-wide just for this.

**App-side adjustments needed** (already in place; flag if you regress them):

- `apps/web/tsconfig.app.json` carries a path mapping for `three/examples/jsm/controls/OrbitControls` so the esbuild bundle resolves it.
- `apps/web/src/three-orbitcontrols.d.ts` is an ambient `.d.ts` shim so TS doesn't lose the typings.
- `apps/web/jest.config.ts` has a `moduleNameMapper` redirect to the renderer-3d's CJS stub at `libs/rendering/renderer-3d/src/__mocks__/orbit-controls-stub.ts` (Jest's CJS env can't `require()` the real ESM addon).
- `apps/web/project.json` bumped the initial-bundle budget from 1 MB → 2 MB error / 1.5 MB warning to accommodate Three.js (~1.1 MB minified+gzipped).

## Renderer swap effect lifecycle

`apps/web/src/app/app.component.ts` injects both `SCENE_RENDERER_2D` + `SCENE_RENDERER_3D` and reads the active mode from `ViewModeService.mode()` (signal). A `viewModeEffect` (firstRun-guarded — same pattern as `previewTimeEffect` / `overlayOptionsEffect`) fires on every mode change after the initial run:

1. Calls `dispose()` on the renderer that was **previously** active, gated by per-renderer `attached2d` / `attached3d` flags so we never dispose a renderer that was never attached (e.g. the 3D renderer in a cold 2D-only session).
2. Calls `renderCurrent()`, which calls `attach()` on the now-active renderer with its canvas + DPR, then paints.

Swap back later works because both `Canvas2DRenderer` and `Three3DRenderer` reset internal state inside `attach()`. The renderers are providedIn-root singletons — they live for the application's lifetime, but their attached-canvas state is reset on every `attach()`.

## ViewModeService persistence

Persisted under `aquascape.ui.viewMode` via `StorageService`. Same `firstRun`-guarded effect pattern as every other view-only service. **NOT serialised into `.aqua`** — view mode is a per-user UI preference, not document state.

Adding the storage key to the master list in `docs/caveats/app-shell.md`'s "Storage key namespaces" section is required if it isn't already there.

## Toolbar toggle UX

`ViewToggleComponent` is a **segmented two-button control** (`2D` | `3D`), `role="group"` + `aria-label="Canvas view mode"`, each button `aria-pressed` reflecting the active mode. Click on the inactive button → `viewMode.setMode(mode)`. `setMode` is idempotent — clicking "2D" while already in 2D is a no-op (no command emitted, signal identity preserved).

Keyboard shortcut: **`Cmd/Ctrl+Shift+3`** toggles. Like the other shortcuts in the editor-shell, **ignored when the event target is `INPUT` / `TEXTAREA` / `SELECT`** so users typing in numeric fields don't accidentally swap views.

## 3D-mode UI gating

In 3D mode (`viewMode.mode() === '3d'`), hide:
- `<aquascape-selection-inspector>` (no selection in 3D)
- The drag readout pill (no drags in 3D)

**Keep visible:** the time slider (plant growth animation respects `previewAgeWeeks` in 3D too), the sidebar tools (they edit the scene, which 3D reads as-is), the layers panel (same).

The sidebar's snap settings + composition overlays + wall background remain visible but don't affect 3D. That's fine for v1; future work could disable them in 3D mode with a "(2D only)" tooltip.

## Coverage gate

Set to **70% branch / 80% else** in `libs/rendering/renderer-3d/jest.config.ts`. Three.js paths have many defensive guards that aren't naturally exercised. Match the convention `renderer-2d` uses (85% branch, 90% else there — slightly tighter because canvas2d is fully testable without GL).
