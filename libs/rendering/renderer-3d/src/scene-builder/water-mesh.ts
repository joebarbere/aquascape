/**
 * Animated water surface — Stage 11 F11.7.
 *
 * A single horizontal `PlaneGeometry` at the waterline. The vertex shader
 * displaces Y by two stacked sine wave bands (low-frequency swell + high-
 * frequency ripple) with total amplitude pinned to ≤ 2 mm so the surface
 * silhouette never pokes past the glass rim or fights the substrate /
 * hardscape AABBs. The fragment shader paints a pale blue-white tint with
 * a cheap fake-sun specular highlight derived from the perturbed normal.
 *
 * SURFACE CAUSTIC SHIMMER (fidelity follow-up, Bucket 3)
 * ------------------------------------------------------
 * The fragment shader layers a procedural caustic term — the same
 * layered-sine flavour as `aqCaustic` in `caustics.ts`, sampled in world
 * XZ via `vWorldPosition` and time-driven via the existing `uTime` — on
 * top of the base tint + specular, brightening colour AND alpha where the
 * filaments peak so wave crests catch a bright rim shimmer. The added
 * alpha is CAPPED (see `WATER_CAUSTIC_ALPHA_CAP` in the shader source) so
 * the surface never turns opaque — fish + plants below stay visible. A
 * `uCausticStrength` uniform (default 1) scales the whole term; the host
 * renderer writes the day-night `directionalIntensity` into it per render
 * (same scaling as the substrate/hardscape `setCausticIntensity`) so the
 * shimmer fades out at night.
 *
 * WHAT'S NOT HERE (deferred):
 *   - **Refraction.** A single-pass shader can't sample the framebuffer
 *     it's writing to. A proper refraction approximation would require a
 *     screen-space pre-pass (extra render target), which is out of scope
 *     for v1 — and any future attempt must gate on the renderer's
 *     `getRenderTargetEffectsSupported()` (Bucket 0). The fragment's
 *     specular highlight + caustic shimmer + alpha ramp is the visual
 *     scope we ship.
 *
 * INVARIANTS
 * ----------
 * - Amplitude is BOUNDED at the GLSL source level. The numeric constants
 *   (1.2 + 0.6 + 0.2 = 2.0) are checked by a unit test; if you tune the
 *   coefficients, the test catches a regression that pushes above 2 mm.
 * - `updateTime(timeSec)` + `setCausticStrength(v)` are the ONLY runtime
 *   inputs. The shader is otherwise pure — same (time, strength) + same
 *   vertex → same screen pixel, so the renderer's idempotency contract
 *   holds (strength is a pure function of `RenderOptions.dayNightLookup`).
 * - `dispose()` is idempotent: it nulls its geometry + material handles
 *   after the first call and second + subsequent calls no-op.
 */

import type { Scene } from '@aquascape/domain/scene-model';
import {
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  type IUniform,
} from 'three';

/**
 * Vertical offset (mm) BELOW the tank's interior rim where the water plane
 * sits. 5 mm matches the plan's spec — small enough to read as "full
 * tank", large enough to leave room for the ≤ 2 mm wave amplitude without
 * the silhouette touching the rim.
 */
const WATER_OFFSET_BELOW_RIM_MM = 5;

/**
 * Tessellation along each axis. 16 segments is enough for the longest wave
 * (~125 mm wavelength on the X-swell band) to look smooth on typical tank
 * widths (300–1500 mm), and small enough that the per-vertex shader cost
 * stays under a frame's overhead budget. Don't crank this higher — the
 * waves are LOW frequency by design (low amplitude clamp).
 */
const WATER_SEGMENTS = 16;

/**
 * Vertex shader source. Two stacked sine bands displace Y:
 *  - Swell:    sin(x·0.008 + t·0.5) · 1.2          → ≤ 1.2 mm
 *  - Ripple A: sin(z·0.04  + t·2.0) · 0.6          → ≤ 0.6 mm
 *  - Ripple B: cos(x·0.06  − t·1.7) · 0.2          → ≤ 0.2 mm
 *  Sum ≤ 2.0 mm — within the plan's amplitude budget.
 *
 * Normal perturbation comes from analytic derivatives of the swell + main
 * ripple bands so the fragment shader can cheaply fake a sun-glint
 * highlight without a separate normal-map texture.
 */
const VERTEX_SHADER = /* glsl */ `
uniform float uTime;
varying vec3 vWorldPosition;
varying vec3 vNormal;

void main() {
  vec3 pos = position;
  // Two stacked sine bands. Low-frequency swell (~0.5 Hz, longer wavelength)
  // + high-frequency ripple (~2 Hz, shorter wavelength). Amplitude pinned to
  // <= 2 mm total so the silhouette doesn't fight substrate / hardscape AABBs.
  float swell = sin(pos.x * 0.008 + uTime * 0.5) * 1.2;     // <= 1.2 mm
  float ripple = sin(pos.z * 0.04 + uTime * 2.0) * 0.6 +    // <= 0.6 mm
                 cos(pos.x * 0.06 - uTime * 1.7) * 0.2;     // <= 0.2 mm
  pos.y += swell + ripple;                                  // <= 2.0 mm total

  // Approximate normal perturbation from finite differences of the wave fns.
  float swellDx = cos(pos.x * 0.008 + uTime * 0.5) * 0.008 * 1.2;
  float rippleDz = cos(pos.z * 0.04 + uTime * 2.0) * 0.04 * 0.6;
  vNormal = normalize(vec3(-swellDx, 1.0, -rippleDz));

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

/**
 * Fragment shader. Pale blue base tint + a cheap fake-sun specular
 * highlight derived from the perturbed vertex normal, plus a procedural
 * caustic shimmer (fidelity follow-up). Alpha ramps with the specular +
 * caustic peaks so wave crests read slightly brighter — but the caustic
 * alpha contribution is CAPPED so the surface never paints over fish +
 * plants below.
 *
 * `aqWaterCaustic` is the same layered-sine flavour as `aqCaustic` in
 * `caustics.ts` (slightly different scale so the surface filaments don't
 * read as a copy of the floor pattern), sampled in WORLD XZ via
 * `vWorldPosition` so the shimmer is anchored to the tank, not the camera.
 * `uCausticStrength` (default 1) is written per render by the host from
 * the day-night `directionalIntensity` so the shimmer fades at night.
 */
const FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uCausticStrength;
varying vec3 vWorldPosition;
varying vec3 vNormal;

// Procedural layered-sine caustic — same flavour as aqCaustic in the
// substrate/hardscape patch (caustics.ts), world-anchored + time-driven.
float aqWaterCaustic(vec2 p, float t) {
  vec2 a = p * 0.03;
  float v = sin(a.x + t * 1.3) * sin(a.y - t * 1.1);
  v += sin(a.x * 1.7 - t * 0.9 + 1.3) * sin(a.y * 1.3 + t * 1.7);
  v = v * 0.25 + 0.5;
  return pow(clamp(v, 0.0, 1.0), 3.0);
}

// Cap on the caustic's ADDED alpha — keeps the surface translucent (base
// alpha behaviour stays recognisable; the surface must never turn opaque).
const float WATER_CAUSTIC_ALPHA_CAP = 0.12;

void main() {
  // Base water color: pale blue-white, low alpha.
  vec3 baseColor = vec3(0.55, 0.75, 0.92);
  // Specular highlight from a fake sun direction.
  vec3 sunDir = normalize(vec3(0.3, 1.0, 0.2));
  float spec = pow(max(0.0, dot(vNormal, sunDir)), 32.0);
  // Caustic shimmer where the filaments peak. Subtle by design.
  float caus = aqWaterCaustic(vWorldPosition.xz, uTime) * uCausticStrength;
  vec3 color = baseColor + vec3(spec * 0.4) + caus * vec3(0.30, 0.36, 0.42);
  // Soft surface — alpha ramps up at the rim for a subtle limbus effect;
  // caustic peaks brighten alpha too, capped so the surface stays sheer.
  float alpha = 0.20 + spec * 0.35 + min(caus * 0.25, WATER_CAUSTIC_ALPHA_CAP);
  gl_FragColor = vec4(color, alpha);
}
`;

/**
 * Handle returned by `buildWaterMesh`. The `mesh` is the THREE.Mesh to
 * parent into the renderer's content group. `updateTime(t)` writes the
 * `uTime` uniform from the RAF tick — the only per-frame state on the
 * water. `dispose()` releases the geometry + material; idempotent.
 */
export interface WaterMeshHandle {
  /** The animated water surface mesh. Parent into the content group. */
  readonly mesh: Mesh;
  /** Write `t` (seconds) to the shader's `uTime` uniform. */
  updateTime(timeSec: number): void;
  /**
   * Scale the surface caustic shimmer (`uCausticStrength`, default 1).
   * The host renderer writes the day-night `directionalIntensity` here
   * once per render — same scaling as the substrate/hardscape
   * `setCausticIntensity` — so the shimmer fades out at night. Clamped
   * at 0; no-op after `dispose()` (same RAF-race defence as
   * `updateTime`).
   */
  setCausticStrength(v: number): void;
  /** Release geometry + material. Idempotent. */
  dispose(): void;
}

/**
 * Build the animated water surface for the given scene.
 *
 * Geometry: a tessellated `PlaneGeometry(tank.width, tank.depth)` rotated
 * to lie horizontal at `y = tank.height - 5` mm. The plane is centred on
 * `(tank.width / 2, tank.depth / 2)` so it fills the tank's interior
 * footprint.
 *
 * Material: a `ShaderMaterial` with the vertex/fragment shaders above.
 * Drawn with `transparent: true`, `depthWrite: false`, `side: DoubleSide`
 * so a camera below the surface still sees the underside.
 */
export function buildWaterMesh(scene: Scene): WaterMeshHandle {
  const tank = scene.tank;
  const geometry = new PlaneGeometry(tank.width, tank.depth, WATER_SEGMENTS, WATER_SEGMENTS);

  // uniforms are mutable — the RAF tick writes `uTime.value` directly via
  // `updateTime`. We keep a reference to the uniform record so dispose
  // can null it out (defensive — Three.js doesn't require it, but it
  // makes the disposed state observable for the idempotency test).
  const uTime: IUniform<number> = { value: 0 };
  // Caustic shimmer strength — default 1 (noon). The host scales it by the
  // day-night directional intensity per render; see `setCausticStrength`.
  const uCausticStrength: IUniform<number> = { value: 1 };
  const material = new ShaderMaterial({
    uniforms: { uTime, uCausticStrength },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'aquascape:water-surface';
  // Plane geometry is authored in the XY plane by default; rotate -π/2
  // about X to lay it flat in the XZ plane (Y up).
  mesh.rotation.x = -Math.PI / 2;
  // Position the plane's centre at (tank.width/2, height-5, tank.depth/2)
  // — 5 mm below the interior rim. The substrate's bottom sits at y=0,
  // so this is "just below the rim" for any reasonable tank height.
  mesh.position.set(tank.width / 2, tank.height - WATER_OFFSET_BELOW_RIM_MM, tank.depth / 2);
  // Render AFTER opaque content (substrate / hardscape / plants) so
  // depth-sort within the transparent bucket lands the water on top.
  // `depthWrite: false` means the water doesn't occlude fish + plants
  // behind it; renderOrder = 1 lets Three.js batch it last in its
  // transparent-pass sort. Selectable here without disturbing the
  // livestock bundle (renderOrder = 0 default).
  mesh.renderOrder = 1;

  let disposed = false;
  return {
    mesh,
    updateTime(timeSec: number): void {
      if (disposed) return;
      uTime.value = timeSec;
    },
    setCausticStrength(v: number): void {
      if (disposed) return;
      uCausticStrength.value = Math.max(0, v);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    },
  };
}
