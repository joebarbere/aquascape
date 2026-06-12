// Public API for @aquascape/rendering/renderer-3d.
//
// Three.js WebGL implementation of `SceneRenderer`. Plan Stage 10 F10.1.
//
// The 3D renderer is a READ-ONLY viewer in v1: hitTest returns null, no
// selection handles, no participation in the editor's drag/marquee/inspector
// pipeline. The 2D ↔ 3D toolbar toggle that swaps renderers is wired in
// `apps/web` separately; this lib supplies the renderer implementation only.
//
// DEPENDENCY BUDGET
// -----------------
// `domain/scene-model`, `domain/geometry`, `domain/catalog`, `domain/growth-
// sim`, `rendering/renderer-api`. Plus Three.js. NO Angular, NgRx, RxJS,
// Electron, platform-*, features-*, state, ui. The lib is framework-free so
// a host (web canvas, headless export pipeline) can drop it in.

export { Three3DRenderer, type Orbital3DControls } from './three-3d-renderer';
// The single waterline source of truth: the visible water surface sits this
// many mm below the tank rim. The host subtracts it from `tank.height` when
// building the ECS tankAabb so the simulation's "top of water" matches what
// the renderer paints — see the constant's JSDoc.
export { WATER_OFFSET_BELOW_RIM_MM } from './scene-builder/water-mesh';
// Bucket-0 render-target capability gate (3D-fidelity follow-ups). Pure,
// GL-free detection of whether render-target / multi-pass effects (SSAO,
// screen-space refraction) are safe — software-WebGL contexts (SwiftShader
// et al.) blank the canvas on multi-pass pipelines. The renderer exposes the
// probed result via `Three3DRenderer.getRenderTargetEffectsSupported()`.
export {
  detectRenderTargetEffectsSupport,
  SOFTWARE_RENDERER_PATTERN,
  type RenderTargetGlContextLike,
} from './render-target-support';
