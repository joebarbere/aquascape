# renderer-3d caveats

**Load this when:** touching `libs/rendering/renderer-3d/`, the 2D ↔ 3D toggle, Three.js scene-builder helpers, or anything that touches `apps/web`'s renderer-swap effect.

## Scope of v1 (Stage 10 F10.1–F10.3)

- **Read-only / simulation-only.** `hitTest()` returns `null` unconditionally. No selection handles in 3D. No participation in the drag / marquee / inspector pipeline. Editing always happens in 2D; flipping to 3D is for visualisation.
- **Shipped since v1:** dynamic lighting (day/night cycle — F11.7 Wave 3), an animated water surface + plant sway (F11.7), ECS-driven animated fish (F11.1+), and — as of the **fidelity pass** — filmic tone mapping + colour management, image-based lighting (IBL), soft shadows, and physically-based transmissive glass (see "Lighting, tone mapping, IBL & shadows" below).
- **Still deferred:** water refraction (needs a render-target pre-pass), post-processing (bloom / SSAO — the EffectComposer pipeline isn't wired yet; it needs the `three/examples/jsm/postprocessing/*` ESM-addon dance like OrbitControls), photorealistic albedo/normal textures. The scene-builder per-element factoring (`tank-mesh.ts` / `substrate-mesh.ts` / etc.) is the seam those land along — one file per scene-element kind, additive changes.
- **Shipped in the fidelity pass:** caustics (below), and **flow-coupled plant sway** — `RenderOptions.flowField` (the host's `LivestockSimulationService.getFlowField()`) scales each plant's sway amplitude by the local current magnitude at its base (`flowAmpAt` → `uFlowAmp` / `aFlowAmp`). Opt-in: with no field every factor is 1.0 and the sway matches the pre-fidelity constant. Amplitude coupling (not frequency) — reads the same, one-multiplier shader change.

## ECS-driven livestock content group (Stage 11 F11.1)

`render()` builds the content group from scratch every call (see "Hardscape + plant placement pipeline" below). For livestock that contract changed: the `LivestockMeshBundle` is built **once**, cached on the renderer (`this.livestockBundle`), and only its `bundle.group` gets re-added to each freshly-built content group. The geometries + ShaderMaterial are expensive to construct (six BufferGeometries + a GLSL compile), so we don't reconstruct them on every `render()`.

- The bundle is detached from `currentContent` **before** `disposeNode` walks the content tree, so the dispose pass doesn't release the bundle's geometries.
- `RenderOptions.livestockWorld` is the contract surface. When present, `render()` lazily builds the bundle, the RAF tick steps the world + syncs the snapshot, and `dispose()` releases the bundle.
- The RAF loop's fixed-dt accumulator (sim 30 Hz / render 60 Hz with 4-step catch-up cap) is the load-bearing piece — full details in [`livestock-ecs.md`](livestock-ecs.md).
- The bundle's `Group` is mirrored along with everything else by `applyDocToWorldMirror` — per-instance attributes work correctly through a negative-determinant world matrix because Three.js flips `gl.frontFace` per-mesh.

If you change the dispose discipline here, update both files in the same PR. The two files share a single invariant: every GPU resource attached must be released, no exceptions.

## Animated water surface (Stage 11 F11.7)

`scene-builder/water-mesh.ts` builds a single `THREE.Mesh` — `PlaneGeometry(tank.width, tank.depth, 16, 16)` rotated −π/2 about X, positioned at `(tank.width / 2, tank.height − 5 mm, tank.depth / 2)` — i.e. 5 mm below the interior rim. The vertex shader displaces Y by two stacked sine bands:

- **Swell:** `sin(x · 0.008 + t · 0.5) · 1.2` → ≤ 1.2 mm
- **Ripple A:** `sin(z · 0.04 + t · 2.0) · 0.6` → ≤ 0.6 mm
- **Ripple B:** `cos(x · 0.06 − t · 1.7) · 0.2` → ≤ 0.2 mm

Total amplitude is BOUNDED at the GLSL source level — the three coefficients sum to 2.0, and a regression test (`water-mesh.spec.ts` → "amplitude coefficients sum to 2.0") parses them out and asserts the sum so a future tweak that pushes above the plan's 2 mm ceiling fails the test. **Don't break the cap** — at higher amplitudes the surface silhouette fights the substrate profile and pokes past the glass rim.

Material: `ShaderMaterial` with `transparent: true`, `depthWrite: false`, `side: DoubleSide` (so a camera below the surface sees it from underneath). `renderOrder = 1` places it in the transparent pass AFTER opaque content so fish + plants below stay visible through it. The fragment shader does a cheap fake-sun specular highlight from the perturbed normal — no refraction (single-pass shader can't sample its own framebuffer) and no caustics.

Cached on the renderer (`this.waterMesh: WaterMeshHandle | null`, tagged by `WxHxD`). Tank resize disposes + rebuilds. RAF tick calls `waterMesh.updateTime(performance.now() / 1000)` every frame; the handle no-ops after dispose so a stale tick is safe. Same detach-before-`disposeNode` discipline as the livestock bundle — the cached mesh must be removed from `currentContent` before the rebuild walker disposes the tree, otherwise the shared geometry + material would be GPU-disposed every render.

**Caustics: shipped (fidelity pass).** See "Animated caustics" below — the `onBeforeCompile` patch the F11.7 note worried about turned out clean: a procedural (no-texture) caustic injected into the substrate + hardscape `MeshStandardMaterial`s.

**Refraction: still deferred.** A proper screen-space refraction of the *water surface* needs an extra render-target pre-pass (a single-pass shader can't sample the framebuffer it's writing to). The now-transmissive **glass** (PR1) already supplies the dominant refraction read of the tank contents, so water-surface refraction is low incremental value for the render-target cost; revisit if demand surfaces.

**Post-processing bloom: deferred (infrastructure + validation).** `EffectComposer` + `UnrealBloomPass` would make the water specular + bubble highlights glow, but it needs the `three/examples/jsm/postprocessing/*` ESM addons wired through tsconfig path-maps + jest stubs (the OrbitControls dance × 4 modules) AND careful tone-mapping integration (OutputPass vs the renderer's ACES) that wants visual validation in a real browser. Tracked as a follow-up; the render loop's single `renderer.render(scene, camera)` is the seam it slots into (guard a `composer.render()` behind `instanceof WebGLRenderer`, fall back to the direct call for the headless stub).

## Animated caustics (fidelity pass)

`scene-builder/caustics.ts` patches the substrate + hardscape `MeshStandardMaterial`s (via `onBeforeCompile`) to add a dancing underwater caustic highlight — the strongest "this is underwater" cue the render has.

- **Procedural, not a sampled texture.** A small layered-sine `aqCaustic(worldXZ, t)` function in the fragment shader — no texture upload, no addon, no RNG. Sampled in WORLD space (the vertex patch captures `vCausticWorld` + `vCausticUp` itself rather than relying on `<worldpos_vertex>`, which only emits under certain material defines) so the pattern is anchored to the tank, not sliding across surfaces as the camera orbits.
- **Modulated** by `clamp(worldNormal.y)` (light comes from above → up-facing faces catch it) and a mild depth factor, added as a cool highlight AFTER the standard pipeline (`<dithering_fragment>`) like the plant emissive boost.
- **Collected like plant sway.** The builders stash each patched material on `group.userData[CAUSTIC_MATERIALS_KEY]`; the renderer flattens substrate + hardscape lists into `this.causticMaterials`, advances `uCausticTime` every RAF tick (same wall clock as the water + sway), and scales `uCausticStrength` by the day-night `directionalIntensity` per render so caustics fade out at night. Determinism holds: the only time-varying input is `uTime`. Materials are owned by their meshes (disposed by `disposeNode`); `causticMaterials` is a non-owning view cleared on rebuild + dispose.

## Lighting, tone mapping, IBL & shadows (fidelity pass)

The renderer's realism baseline is four compounding renderer-side changes — **all core `three`, no `examples/jsm` addons**, so no tsconfig/jest addon wiring was needed.

- **Tone mapping + colour management.** `defaultRendererFactory` sets `renderer.toneMapping = ACESFilmicToneMapping` (exposure `1.1`) + `renderer.outputColorSpace = SRGBColorSpace`. ACES rolls off the water specular + bubble highlights instead of clipping to flat white. These are set in the FACTORY (on the real `WebGLRenderer`); the headless test stub never sees them.
- **IBL environment.** `scene-builder/environment.ts` builds a deterministic equirectangular gradient `DataTexture` (sky→horizon→floor); the renderer PMREM-filters it (`PMREMGenerator`) and assigns `scene.environment` + `scene.environmentIntensity = ENV_INTENSITY` (0.35). This is what gives `MeshStandard`/`MeshPhysical` materials something to reflect. **Guarded behind `renderer instanceof WebGLRenderer`** — `PMREMGenerator` needs a GL context, so the node test stub skips it. `buildEnvEquirectTexture()` itself is pure + unit-tested (no GL). Both the source `DataTexture` and the PMREM product texture are disposed on teardown (`envSourceTexture` / `envTexture`).
- **Soft shadows.** `renderer.shadowMap.enabled = true` + `PCFSoftShadowMap` (factory). The directional key light (`lighting.ts`) now `castShadow = true` with an **orthographic** shadow camera framed to the tank AABB (`±maxDim` frustum, near/far bracketing the light→tank distance). `normalBias` is scaled to the millimetre scene (`maxDim × 0.002` ≈ 1.2 mm on a 600 mm tank) to defeat acne on the steep extruded faces. Substrate `receiveShadow` (no cast — slab self-shadow reads as noise); hardscape + plants `castShadow` + `receiveShadow`. **Plant sway doesn't propagate to the shadow** — the shadow depth pass uses Three's default depth material, not the `onBeforeCompile`-patched colour material — an accepted mismatch at typical sway amplitude.
- **Real glass.** `tank-mesh.ts`'s glass box is now `MeshPhysicalMaterial` (`transmission: 1`, `ior: 1.45`, low `roughness`, `FrontSide`, `depthWrite: false`). The old `MeshBasicMaterial` low-opacity tint was a workaround for having **no environment** to refract through; now that the IBL env exists, real transmissive glass reads as wet glass with a Fresnel rim. A faint `BackSide` inner-sheen shell (`aquascape:tank/glass-sheen`, 5 % opacity, parented to the glass mesh) keeps the tank's silhouette legible at grazing angles where a perfectly clear pane would vanish. `attenuationDistance` is left at ∞ so the contents seen through the glass don't darken.

**Why ambient + hemisphere were pulled back** (0.7→0.45, 0.4→0.3): strong uniform fill flattens the very shadows we now cast and washes out the directional key. The IBL env supplies most of the soft fill the old over-bright ambient was compensating for.

## Hardscape + plant placement pipeline (Stage 10 v1.1)

For every hardscape rock and single-specimen plant the position runs through four steps **in this exact order** — they're independent but composable, so changing the order changes the visible result:

1. **Layer zone → world Z.** When the containing layer has a `zone` (`foreground` | `midground` | `background`), `computeZonedZ(scene, objectId, layerId)` linearly remaps the object's `transform.position.z` into the band's third of `tank.depth` (foreground = `[0, depth/3]`, etc.). Min-max remap preserves the relative ordering of objects within the band — two foreground rocks that were close in 2D stay close in 3D. Pass-through when zone is undefined OR the band would degenerate (n=1 in layer).
2. **Tank clamp.** `clampToScene(position, halfExtents, scene)` clamps X and Z so the object's scaled AABB (post-flip absolute scale) fits inside the tank interior. Oversized objects (half-extent exceeds tank's half-dimension) get centred instead — the clamp can't help and the centre is the least-wrong answer.
3. **Substrate Y snap.** `mesh.position.y = substrateHeightAt(scene, clampedX)` after the geometry's local origin has been pre-translated to the silhouette's bottom edge.
4. **Hardscape noise (rocks only).** `applyHardscapeNoise(geometry, { seed, minNaturalMm })` displaces every vertex along the unit vector from the geometry's bounding-box CENTRE to the vertex position, by `magnitude × noise(seed, qx, qy, qz)` (quantised position-only hash). Primary magnitude = `min(naturalSize) × 0.18`; a second octave at `0.5 ×` primary magnitude (different seed mix, double-frequency sampling) adds finer surface detail so rocks don't read as smooth blobs. Seed = `fnv1a32(catalogId + ':' + objectId)` — two instances of the same catalog entry produce different shapes; the same instance always produces the same shape. `geometry.computeVertexNormals()` runs AFTER displacement so the displaced surface lights correctly (without the post-pass Three.js shades using stale normals). **Seam-watertight invariant (load-bearing):** `ExtrudeGeometry` duplicates positions where the front face, side walls, and back face meet — each face owns its own copy with its own face normal so the slab can light with sharp 90° edges. Hashing the vertex INDEX *or* displacing along per-face NORMALS makes those duplicated vertices move independently and the rock develops visible cracks ("disconnected edges"). Position-only hash + radial-from-centroid direction → coincident vertices share both inputs → they land at the same post-displacement position → surface stays watertight. Regression covered by `hardscape-noise.spec.ts` → "keeps the surface watertight at seams".

**Why deterministic noise:** the `SceneRenderer.render` contract requires idempotency. Repeated calls with the same scene must produce identical output. Random noise per render would violate that AND would mean rocks look different every time the user reopens the doc.

**Plants don't get noise.** Adding noise to a leafy silhouette makes plants read as crinkled paper, not foliage. Plants get the zone + clamp + substrate-snap steps and stop there.

## Substrate / glass-wall inset (Z-fighting fix)

The substrate's extruded shape originally went all the way to the tank interior walls (bottom edge at `y=0`, extrusion from `z=0` to `z=tankDepth`, x-range `0` to `tankWidth`), so up to FIVE of its outer faces were coplanar with the glass box's inner faces. Even with `depthWrite: false` on the transparent glass, the rasterisation produced a flashing pixelated pattern that settled into a stable pixelated pattern once the camera stopped moving — classic Z-fighting between coplanar opaque-vs-transparent surfaces in front of the camera.

`substrate-mesh.ts` insets the substrate by `GLASS_INSET_MM = 0.5` on each side it would otherwise touch: shape bottom edge at `y = inset`, extrusion `depth = tankDepth - 2 × inset`, mesh `position.z = inset`, and `x0` / `x1` clipped to `[inset, tankWidth - inset]` only when the region reaches the wall. 0.5 mm is smaller than a sub-pixel at any orbit distance and large enough to defeat depth-buffer precision noise. The visible substrate TOP profile is unchanged, so `substrateHeightAt(...)` (used by hardscape + plant Y-snap) still matches what the user sees. Don't remove the inset; if the substrate ever flickers again, this is the first place to check.

## Object placement diverges from 2D (deliberately)

In v1 the 3D view re-interprets two pieces of the document differently than the 2D renderer does, because the 2D conventions are "front-elevation projection" conceits that don't read in 3D.

- **`transform.position.y` is IGNORED for hardscape + single-specimen plants.** In 2D it's the silhouette centre on the canvas. In 3D the renderer snaps Y to the substrate height at the object's X (via `substrate-height.ts`'s `substrateHeightAt(scene, worldX)`), and the mesh's local origin is pre-translated to the bottom of the silhouette so the rock / plant base actually rests on the substrate. Without this, rocks float mid-tank with their centre at whatever Y the 2D layout happened to record, which reads as "broken physics".
- **Scatter polygons are read as top-down floor patches, not front-elevation clusters.** Each scatter instance's `position.x` stays as world X (left-right), but `position.y` becomes world Z (front-back depth). World Y is sampled from the substrate at the instance's X. This makes Hemianthus / Eleocharis / Monte Carlo carpets read as actual carpets in 3D instead of floating walls of leaves.
- **Plant rotation in scatter patches spins around Y (vertical) instead of Z.** The instance's `rotation` angle rotates the leafy cluster around its stem instead of tipping it sideways.

These divergences live entirely inside the scene-builder helpers. The 2D renderer + the saved `.aqua` document are untouched.

## Coordinate system — document vs Three.js (the X-mirror)

Both the `.aqua` document and Three.js use a right-handed, +Y-up coordinate system, but they disagree on **what +Z means**:

| | Document | Three.js |
|---|---|---|
| +X | right | right |
| +Y | up | up |
| +Z | **back of tank** | **toward the viewer** (default camera at +Z looking down −Z) |

Both are right-handed — but the two right-handed systems differ by an X-axis flip when one viewer is reconciled to the other. The 3D renderer places the camera in front of the tank (world `−Z`) looking at world `+Z`. Three.js `lookAt`-derived basis then has `_x = up × _z = (−1, 0, 0)` in world coords — so screen-right points at **world −X**. A doc point on the right of the tank (high `+X`) lands on screen LEFT.

Fix: the renderer wraps both the content and lighting groups in a `scale.x = -1, position.x = tank.width` transform (`applyDocToWorldMirror` in `three-3d-renderer.ts`). This reflects the scene about its X-midplane, so:

- doc `+X` (right side of tank) → world `−X` → screen `+X` (right). ✓
- doc `−X` (left side of tank) → world `+X` → screen `−X` (left). ✓

Three.js `WebGLRenderer` detects the negative-determinant world matrix per-mesh and flips `gl.frontFace` accordingly, so winding-order / culling is correct without per-material side adjustments.

**Why a mirror instead of negating Z everywhere?** A mirror is one transform on two groups; negating Z would require updating every builder (camera, tank, substrate, hardscape, plants, lighting) and every helper that consumes world Z (`computeZonedZ`, `clampToScene`, `substrateHeightAt`). The mirror is contained.

**Don't remove the mirror.** Regression covered by `three-3d-renderer.spec.ts` → "doc → world X-mirror" describe block. If the symptom comes back ("plant on the right in 2D shows up on the left in 3D"), this is the first place to check.

## Canvas pair: `[hidden]` needs CSS help

The 2D and 3D canvas elements both carry the `.scene-canvas` class. Under Angular view encapsulation, `.scene-canvas` is rewritten to an attribute selector with specificity (0,2,0) — **higher than the UA stylesheet's `[hidden] { display: none; }` rule** (0,1,0). So setting `el.hidden = true` via the `[hidden]` Angular binding does NOTHING visible — both canvases stay `display: block` and stack vertically inside `.app-canvas-host`. `overflow: hidden` on the host clips the second canvas below the visible area; the user only ever sees the first one. This is the bug behind "I switch to 3D and see only the (now blank, because renderer2d was disposed) 2D canvas".

**Fix** (in `apps/web/src/app/app.component.ts` component CSS):

```css
.scene-canvas {
  position: absolute;
  inset: 0;
  /* ... */
}
.scene-canvas[hidden] {
  display: none !important;
}
```

Both canvases are now absolutely positioned (they overlap perfectly inside the host), and the explicit `[hidden]` rule with `!important` defeats the encapsulated `.scene-canvas` selector. Don't change one without the other — absolute positioning prevents flow stacking even when `[hidden]` doesn't apply, and the `!important` rule guarantees `[hidden]` does the right thing in case absolute positioning is reverted.

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

## `attach()` is idempotent on the same canvas (load-bearing)

**`WebGLRenderer.dispose()` permanently destroys the canvas's GL context.** Under the hood it calls `WEBGL_lose_context.loseContext()`; once a canvas's GL context is lost, the next `canvas.getContext('webgl2')` returns a lost context that renders nothing. This is a one-way trip on every browser that implements the extension (which is all of them).

The host (`apps/web/src/app/app.component.ts`) calls `attach()` on every `renderCurrent()` — matching the `Canvas2DRenderer`'s contract where attach-dispose-attach is cheap. So `Three3DRenderer.attach()` must NOT actually dispose-and-recreate when called repeatedly with the same canvas. Instead: if `surface.canvas === this.surface.canvas`, only sync size + DPR + aspect on the existing renderer and bail. Full re-init runs only when the canvas itself changes (which never happens in the current host — both canvas elements live for the app's lifetime — but is still the correct contract).

The first incarnation of `attach()` had `if (this.surface !== null) { this.dispose(); }` at the top. That made the first render in 3D work, but the second `renderCurrent()` call disposed the renderer + lost the GL context + the user saw a blank canvas. Regression test: `re-attaching to the SAME canvas does NOT dispose + reinit (preserves GL context)` in `three-3d-renderer.spec.ts`.

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
