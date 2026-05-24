// Public API for @aquascape/rendering/renderer-2d.
//
// HTML canvas implementation of SceneRenderer. Plan §2.4 / Stage 0 F0.4.
//
// Features depend on the `SceneRenderer` interface from
// `@aquascape/rendering/renderer-api`; this lib supplies the concrete 2D
// implementation. A web/Electron host instantiates `Canvas2DRenderer`,
// calls `attach(surface)` once, and `render(scene, viewport)` whenever
// the scene or viewport changes.

export { Canvas2DRenderer } from './canvas-2d-renderer';
