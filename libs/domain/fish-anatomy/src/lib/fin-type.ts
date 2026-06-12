/**
 * Per-vertex fin-type codes (3D fidelity pass — per-fin animation).
 *
 * Every vertex in a `FishGeometryDescriptor` carries one of these codes in
 * the `finType` buffer (one float per vertex) so the renderer's vertex
 * shader can apply an independent low-amplitude flutter per fin on top of
 * the carangiform spine wave. Mirrors the `FISH_ARCHETYPE` const-object
 * pattern in `@aquascape/domain/livestock-ecs`.
 *
 * Stored as floats (not ints) because the renderer uploads the buffer as a
 * GLSL `attribute float` — vertex attributes are float-typed in WebGL 1.
 *
 * The CAUDAL code exists for completeness / future per-fin material passes,
 * but the shader deliberately leaves the caudal driven by the carangiform
 * wave alone — it already receives the largest displacement at s ≈ 1.
 */
export const FIN_TYPE = {
  BODY: 0,
  CAUDAL: 1,
  DORSAL: 2,
  ANAL: 3,
  PECTORAL: 4,
} as const;

/** Union of the valid `finType` vertex codes. */
export type FinTypeCode = (typeof FIN_TYPE)[keyof typeof FIN_TYPE];
