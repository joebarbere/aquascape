/**
 * Render-target capability gate — 3D-fidelity follow-ups, Bucket 0.
 *
 * WHY THIS EXISTS
 * ---------------
 * The SSAO attempt rendered a fully BLANK canvas under SwiftShader (the
 * software-WebGL path both the Playwright e2e suite and the headless visual
 * loop run on — see `docs/caveats/e2e.md` → "Render-target / multi-pass
 * post-processing can BLANK the canvas under SwiftShader"). Single-target
 * passes (the shipped UnrealBloomPass) work fine; depth/normal/MRT-heavy
 * passes (SSAO, screen-space refraction) do not. Future render-target
 * effects must therefore SELF-DISABLE on software WebGL instead of blanking
 * the view — this module is the detection seam they gate on.
 *
 * THE CONTRACT (the Bucket-0 seam)
 * --------------------------------
 * When an SSAO / screen-space-refraction / any other extra-render-target
 * pass is added to the composer, its construction MUST be conditional on
 * `Three3DRenderer.getRenderTargetEffectsSupported()`, falling back to the
 * plain RenderPass → bloom → OutputPass path. Bloom itself stays UNGATED —
 * it is single-target and validated working under SwiftShader.
 *
 * DETECTION HEURISTICS
 * --------------------
 *  (a) **Software-renderer detection.** The `WEBGL_debug_renderer_info`
 *      extension's `UNMASKED_RENDERER_WEBGL` string is matched against
 *      `SOFTWARE_RENDERER_PATTERN` (SwiftShader / llvmpipe / softpipe /
 *      "software", case-insensitive). ANGLE-on-SwiftShader strings — e.g.
 *      `"ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …))"` — contain
 *      "SwiftShader" and are caught by the same pattern.
 *  (b) **Depth-texture availability.** WebGL2 contexts have depth textures
 *      natively (detected structurally via the WebGL2-only `texImage3D`
 *      method, so the check works against unit-test stubs without a real
 *      `WebGL2RenderingContext` global); WebGL1 needs the
 *      `WEBGL_depth_texture` extension.
 *
 * Result = NOT-software AND depth-texture-available. **Defensive bias:**
 * anything we cannot prove — a null/undefined context, a missing or blocked
 * `WEBGL_debug_renderer_info` extension, a non-string renderer value, a
 * throwing `getExtension` / `getParameter` — resolves to `false`
 * (unsupported). A false negative costs one optional effect; a false
 * positive costs a blank canvas.
 *
 * Pure + GL-free: the function only reads from the minimal
 * `RenderTargetGlContextLike` interface, so it's unit-testable with plain
 * object stubs in the node jest env.
 */

/**
 * Renderer strings that identify a SOFTWARE WebGL implementation. Matched
 * case-insensitively against `UNMASKED_RENDERER_WEBGL`. Exported so tests
 * and future capability probes share one source of truth.
 */
export const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|softpipe|software/i;

/**
 * The minimal GL-context surface the detection reads. Structurally
 * compatible with both `WebGLRenderingContext` and `WebGL2RenderingContext`
 * (what `WebGLRenderer.getContext()` returns), and trivially stubbable in
 * unit tests — no real GL needed.
 */
export interface RenderTargetGlContextLike {
  /** `getExtension(name)` — returns the extension object or `null`. */
  getExtension(name: string): unknown;
  /** `getParameter(pname)` — used to read `UNMASKED_RENDERER_WEBGL`. */
  getParameter(pname: number): unknown;
  /**
   * WebGL2-only method, used as a STRUCTURAL WebGL2 marker (an
   * `instanceof WebGL2RenderingContext` check would break in node test
   * envs where the global doesn't exist). Optional: absent on WebGL1.
   */
  texImage3D?: unknown;
}

/** Shape of the `WEBGL_debug_renderer_info` extension object. */
interface DebugRendererInfoLike {
  UNMASKED_RENDERER_WEBGL: number;
}

/**
 * Decide whether render-target / multi-pass post-processing effects (SSAO,
 * screen-space refraction, …) are safe on the given GL context. See the
 * module header for the heuristics + the defensive-bias rationale.
 *
 * @param gl the context from `WebGLRenderer.getContext()`, or a stub.
 * @returns `true` only when the context is provably hardware-accelerated
 *          AND depth textures are available; `false` for everything else
 *          (software renderers, missing/blocked extensions, throwing
 *          contexts, null/undefined input).
 */
export function detectRenderTargetEffectsSupport(
  gl: RenderTargetGlContextLike | null | undefined,
): boolean {
  if (gl === null || gl === undefined) return false;
  try {
    // (a) Software-renderer detection. A missing/blocked debug-info
    // extension means we cannot PROVE hardware — treat as unsupported.
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info') as
      | DebugRendererInfoLike
      | null
      | undefined;
    if (debugInfo === null || debugInfo === undefined) return false;
    const rendererString = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    if (typeof rendererString !== 'string') return false;
    if (SOFTWARE_RENDERER_PATTERN.test(rendererString)) return false;

    // (b) Depth-texture availability. WebGL2 has it natively; WebGL1 needs
    // the extension.
    const isWebGl2 = typeof gl.texImage3D === 'function';
    if (isWebGl2) return true;
    const depthExt = gl.getExtension('WEBGL_depth_texture');
    return depthExt !== null && depthExt !== undefined;
  } catch {
    // A context that throws on basic queries is in no state to drive
    // multi-pass rendering.
    return false;
  }
}
