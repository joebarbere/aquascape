// Public API for @aquascape/domain/fish-anatomy.
//
// Procedural fish geometry — vertex / index / UV buffers plus named vertex
// groups (body, caudal, dorsal, anal, pectoral) so the renderer can deform
// each group independently (tail swish, fin flutter). Plan Stage 11 F11.1.
//
// WAVE 2a — six archetype builders + species-to-archetype mapper.
//
// DEPENDENCY BUDGET
// -----------------
// Pure TS only. Returns plain typed-array buffers so a Three.js consumer
// wraps them in `BufferGeometry` and a future glTF export pipeline consumes
// the same descriptors directly. NO Three.js, Angular, DOM, NgRx, Electron.
// The `framework:none` tag enforces this.

/**
 * Vertex buffers + index buffer + UV layout + named vertex groups for one
 * fish species. Each `groups` entry is a `[indexStart, indexCount]` pair
 * (the same shape Three.js `BufferGeometry.addGroup` consumes) so a fin
 * material can paint only its triangles without re-walking the buffer.
 *
 * `spineUv` carries one `(s, 0)` pair per vertex giving its position
 * along the head→tail spine in `[0, 1]`. The carangiform vertex shader
 * reads `spineUv.x` to compute the per-vertex sinusoid; the second
 * channel is reserved for future per-vertex tuning (e.g., dampening near
 * the head).
 */
export type FishGeometryDescriptor = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  spineUv: Float32Array;
  groups: {
    body: [number, number];
    caudal: [number, number];
    dorsal: [number, number];
    anal: [number, number];
    pectoral: [number, number];
  };
};

/**
 * Engine version marker. Bump whenever a builder's silhouette changes in
 * a way that would invalidate persisted instance positions or shader
 * vertex math. Consumers can compare this against a stored value to
 * decide whether to invalidate caches.
 */
export const FISH_ANATOMY_VERSION = '0.1.0';

// ─── Archetype builders ───────────────────────────────────────────────────
export {
  buildSlimTetraGeometry,
  buildDeepBodiedGeometry,
  buildBarbGeometry,
  buildCoryCylinderGeometry,
  buildEelGeometry,
  buildHatchetWedgeGeometry,
  buildCrawlerGeometry,
} from './lib/archetypes';

// ─── Species → archetype mapping ──────────────────────────────────────────
export {
  archetypeForSpecies,
  type FishArchetypeId,
  type SpeciesMappingHints,
} from './lib/archetype-for-species';
