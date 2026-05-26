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

// Global uniforms.
uniform float uTime;
uniform float uEnvelopeExp;
uniform vec3 uAmbientColor;
uniform vec3 uDirectionalDir;
uniform vec3 uDirectionalColor;

// Varyings consumed by the fragment shader.
varying vec3 vLitColor;
varying vec3 vNormalWorld;

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

  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
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

uniform vec3 uBodyColor;

varying vec3 vLitColor;
varying vec3 vNormalWorld;

void main() {
  // Multiplicative shading — keeps body colour identifiable while still
  // reading the directional key on the lit hemisphere.
  vec3 rgb = uBodyColor * vLitColor;
  gl_FragColor = vec4(rgb, 1.0);
}
`;
