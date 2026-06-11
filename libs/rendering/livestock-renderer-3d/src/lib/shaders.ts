/**
 * GLSL shaders for the Stage 11 F11.1 livestock renderer.
 *
 * The vertex shader implements carangiform locomotion (Gates 2001;
 * Liu & Hu 2010) — a sine wave travels nose-to-tail along the spine of
 * each instance, with the amplitude ramping from `ampHead` near the nose
 * to `ampTail` at the caudal tip via a power-curve envelope:
 *
 *   s         = spineUv.x ∈ [0, 1]              // 0 at nose, 1 at tail tip
 *   amp(s)    = ampHead + (ampTail - ampHead) * pow(s, envelopeExp)
 *   φ(s, t)   = 2π * (t * freq − s) + phaseOffset
 *   displaced = position + vec3(0, 0, amp(s) * sin(φ(s, t)))
 *
 * The displacement is along the local +Z axis because the canonical 3D
 * coordinate system is right-handed with +X right / +Y up / +Z back —
 * lateral undulation along a head-on-+X spine is a +/− Z motion. The
 * per-instance quaternion then rotates the displaced + scaled vertex
 * into world space and `instancePosition` translates it.
 *
 * Lighting is a tiny Lambert-on-normal approximation against one
 * directional + one ambient term passed as uniforms (matches
 * `scene-builder/lighting.ts`'s shape without importing it — keeping
 * `livestock-renderer-3d` independent of `renderer-3d`).
 *
 * Fidelity pass — the fragment shader adds a grazing-angle FRESNEL SHEEN
 * (tinted cool blue-green, hue-shifted with the fresnel) plus a subtle
 * procedural scale shimmer along the spine UV, so bodies read as wet,
 * scale-catching fish rather than flat-shaded clay. The sheen only ever
 * brightens the silhouette rim (it's keyed off the view angle), and the
 * shimmer modulates the sheen — never the base albedo — so it can't wash
 * the fish out. No per-instance data needed; it works off the existing
 * view-space normal + spine UV.
 *
 * We use `ShaderMaterial` (not `MeshStandardMaterial`) because the
 * carangiform deformation needs per-vertex access to `spineUv` and
 * `instancePhase` — patching that into a Standard material via
 * `onBeforeCompile` would tangle this lib with three's internal chunk
 * graph. F11.7 may upgrade to PBR; not now.
 *
 * Both `position` / `normal` / `uv` are supplied automatically by three's
 * shader-chunk wiring (declared in the prefix any `ShaderMaterial`
 * receives). We add `spineUv` as a custom attribute. The five
 * `instance*` attributes are flagged as instanced via
 * `InstancedBufferAttribute`.
 */

/**
 * Vertex shader source. Two named `// CARANGIFORM` comment blocks are
 * load-bearing — the regex-based shader-source test asserts on them so a
 * silent rewrite that drops the documented formula trips a regression.
 */
export const LIVESTOCK_VERTEX_SHADER = /* glsl */ `
precision highp float;

#define PI 3.141592653589793

// Custom vertex attribute (per-vertex; standard 'position', 'normal',
// 'uv' are supplied by three's shader prefix).
attribute vec2 spineUv;

// Per-instance attributes (one value per InstancedMesh instance).
attribute vec3 instancePosition;
attribute vec4 instanceQuat;
attribute float instanceScale;
attribute float instancePhase;
attribute float instanceTailBeatFreq;
attribute float instanceAmpHead;
attribute float instanceAmpTail;
// Fidelity pass — per-instance body colour (linear-ish RGB). Lets two species
// sharing one archetype (e.g. neon vs cardinal tetra) read distinct.
attribute vec3 instanceColor;

// Global uniforms.
uniform float uTime;
uniform float uEnvelopeExp;
uniform vec3 uAmbientColor;
uniform vec3 uDirectionalDir;
uniform vec3 uDirectionalColor;

// Varyings consumed by the fragment shader.
varying vec3 vLitColor;
varying vec3 vNormalWorld;
// Fidelity pass — view-space normal + view direction for the fresnel
// iridescent sheen, and the spine UV for the procedural scale shimmer.
varying vec3 vViewNormal;
varying vec3 vViewDir;
varying vec2 vSpineUv;
// Per-instance body colour passed through to the fragment stage.
varying vec3 vInstColor;

// Rotate vector v by unit quaternion q = (x, y, z, w). Standard
// Rodrigues-via-quaternion form: v + 2 * q.xyz x (q.xyz x v + q.w * v).
vec3 rotateByQuat(vec3 v, vec4 q) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

void main() {
  // ── CARANGIFORM SPINE DEFORMATION ───────────────────────────────────
  float s = spineUv.x;
  float amp = instanceAmpHead + (instanceAmpTail - instanceAmpHead) * pow(s, uEnvelopeExp);
  float phase = 2.0 * PI * (uTime * instanceTailBeatFreq - s) + instancePhase;
  vec3 displaced = position + vec3(0.0, 0.0, amp * sin(phase));
  // ── /CARANGIFORM ────────────────────────────────────────────────────

  // Per-instance transform: scale → rotate (quat) → translate (pos).
  vec3 scaled = displaced * instanceScale;
  vec3 rotated = rotateByQuat(scaled, instanceQuat);
  vec3 worldPos = rotated + instancePosition;

  // Same rotation on the normal (uniform scale → no inverse-transpose
  // needed; quaternion is orthonormal).
  vec3 nRot = normalize(rotateByQuat(normal, instanceQuat));
  vNormalWorld = nRot;

  // Cheap Lambert + ambient. uDirectionalDir is the direction TOWARD the
  // light source (already normalized on the CPU side).
  float ndotl = max(dot(nRot, uDirectionalDir), 0.0);
  vLitColor = uAmbientColor + uDirectionalColor * ndotl;

  // Fidelity pass — view-space basis for the fresnel sheen. modelViewMatrix
  // carries view x model(mirror); worldPos is the instance vertex in the
  // mesh local frame, so mvPosition is the view-space position and
  // mat3(modelViewMatrix) * nRot the view-space normal (uniform scale, so
  // no inverse-transpose needed).
  vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
  vViewDir = normalize(-mvPosition.xyz);
  vViewNormal = normalize(mat3(modelViewMatrix) * nRot);
  vSpineUv = spineUv;
  vInstColor = instanceColor;

  gl_Position = projectionMatrix * mvPosition;
}
`;

/**
 * Fragment shader. The body colour is supplied as a uniform; lighting
 * is precomputed in the vertex stage and interpolated. Cheap, but
 * legible — F11.6 will plug per-fin colours via material-index groups
 * (the geometry already records them).
 */
export const LIVESTOCK_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

#define PI 3.141592653589793

uniform vec3 uBodyColor;

varying vec3 vLitColor;
varying vec3 vNormalWorld;
varying vec3 vViewNormal;
varying vec3 vViewDir;
varying vec2 vSpineUv;
varying vec3 vInstColor;

void main() {
  // Per-instance body colour drives the shading (the uBodyColor uniform is
  // the build-time default, kept for the no-snapshot path). Multiplicative
  // shading keeps the colour identifiable while reading the directional key.
  vec3 rgb = vInstColor * vLitColor;

  // ── IRIDESCENT SHEEN (fidelity pass) ────────────────────────────────
  // A grazing-angle fresnel term gives the body the wet, scale-catching
  // sheen real fish have — strongest at the silhouette edge, absent
  // face-on. We tint it cool blue-green and shift the hue slightly with
  // the fresnel so it reads iridescent rather than as a flat rim light.
  float fres = pow(1.0 - clamp(dot(normalize(vViewNormal), normalize(vViewDir)), 0.0, 1.0), 3.0);
  vec3 sheen = mix(vec3(0.30, 0.55, 0.85), vec3(0.55, 0.85, 0.70), fres);
  // Subtle high-frequency scale shimmer along the body, modulating the
  // sheen (never the base albedo) so a wrong-orientation read can't wash
  // the fish out — it only ever brightens the already-grazing rim.
  float scales = 0.5 + 0.5 * sin(vSpineUv.x * 60.0) * sin(vSpineUv.y * 24.0);
  rgb += fres * sheen * (0.18 + 0.10 * scales);
  // ── /IRIDESCENT SHEEN ───────────────────────────────────────────────

  gl_FragColor = vec4(rgb, 1.0);
}
`;

// ─── Food sprite billboard shaders (F11.4 Wave 4) ────────────────────────

/**
 * Vertex shader for food-sprite billboards.
 *
 * The instanced quad lives in object space with corner positions at
 * (±half, ±half, 0). To make every sprite face the camera regardless of
 * orbit, we transform the per-instance world-space position to view-space
 * first, then add the quad's local `position.xy` directly in view-space
 * (where +X is screen-right and +Y is screen-up). This is the classic
 * "view-space billboard" trick — cheaper than rebuilding a basis on the
 * CPU each frame, and stable under any camera orientation.
 *
 * The load-bearing line is `mvPosition.xy += position.xy` — the spec
 * regex-checks for it, so a silent rewrite that drops the billboard
 * behaviour trips a regression.
 */
export const LIVESTOCK_FOOD_VERTEX_SHADER = /* glsl */ `
precision highp float;

attribute vec3 instancePosition;

varying vec2 vQuadUv;

void main() {
  // The quad's local positions are (±half, ±half, 0). UV runs 0..1.
  vQuadUv = uv;

  // ── BILLBOARD ──────────────────────────────────────────────────────
  // Translate the instance's anchor into view-space; then offset by the
  // quad's local X/Y so the resulting quad sits perpendicular to the
  // camera no matter where the camera is.
  vec4 mvPosition = modelViewMatrix * vec4(instancePosition, 1.0);
  mvPosition.xy += position.xy;
  // ── /BILLBOARD ─────────────────────────────────────────────────────

  gl_Position = projectionMatrix * mvPosition;
}
`;

/**
 * Fragment shader for food-sprite billboards.
 *
 * Warm-tan body colour with a soft circular alpha falloff so the quad
 * reads as a flake / pellet rather than a hard square. UV → distance
 * from centre (0.5, 0.5); inside `coreRadius` is fully opaque, between
 * `coreRadius` and `edgeRadius` fades to 0 via smoothstep; outside is
 * discarded.
 */
export const LIVESTOCK_FOOD_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec3 uFoodColor;

varying vec2 vQuadUv;

void main() {
  // Distance from the quad's centre, scaled so the disc fits the quad.
  float d = distance(vQuadUv, vec2(0.5, 0.5)) * 2.0;
  // Soft circular falloff: opaque inside 0.6, alpha → 0 by 1.0.
  float alpha = 1.0 - smoothstep(0.6, 1.0, d);
  if (alpha <= 0.001) discard;
  gl_FragColor = vec4(uFoodColor, alpha);
}
`;

// ─── Bubble billboard shaders (F11.5 Wave 5) ─────────────────────────────

/**
 * Vertex shader for bubble billboards.
 *
 * Identical billboard math to the food sprite — the per-instance world
 * anchor is converted to view-space and the quad's local `position.xy`
 * is added directly so the resulting quad always faces the camera. The
 * load-bearing line is `mvPosition.xy += position.xy` (the spec
 * regex-checks for it).
 *
 * We keep this as a separate constant rather than aliasing the food
 * shader so future bubble-specific tweaks (e.g. per-instance scale /
 * upward jitter via a uniform) have a clean home.
 */
export const LIVESTOCK_BUBBLE_VERTEX_SHADER = /* glsl */ `
precision highp float;

attribute vec3 instancePosition;

varying vec2 vQuadUv;

void main() {
  vQuadUv = uv;

  // ── BILLBOARD ──────────────────────────────────────────────────────
  vec4 mvPosition = modelViewMatrix * vec4(instancePosition, 1.0);
  mvPosition.xy += position.xy;
  // ── /BILLBOARD ─────────────────────────────────────────────────────

  gl_Position = projectionMatrix * mvPosition;
}
`;

/**
 * Fragment shader for bubble billboards.
 *
 * Blue-white body colour (`~#e0f4ff`) with a soft circular alpha
 * falloff. A small highlight biased toward the top of the disc gives
 * the silhouette a "sphere catching the key light" read so it parses
 * as a bubble rather than a generic disc. Both the body tint and the
 * highlight peak are load-bearing — the spec regex-checks for the
 * `0.85`, `0.95`, `1.00` tone and the `vec2(0.5, 0.65)` highlight
 * anchor.
 */
export const LIVESTOCK_BUBBLE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vQuadUv;

void main() {
  // Soft circular silhouette: opaque-ish near the centre, soft falloff
  // toward the rim. smoothstep edges chosen so the disc fills most of
  // the quad without a hard cutout.
  float d = distance(vQuadUv, vec2(0.5));
  float alpha = smoothstep(0.55, 0.35, d);
  if (alpha < 0.05) discard;

  // Off-centre highlight (slightly above geometric centre) → reads as
  // the top of a sphere catching the key light.
  float highlight = smoothstep(0.25, 0.05, distance(vQuadUv, vec2(0.5, 0.65)));
  vec3 color = mix(vec3(0.85, 0.95, 1.00), vec3(1.0), highlight * 0.4);
  gl_FragColor = vec4(color, alpha * 0.85);
}
`;
