// Public API for @aquascape/rendering/livestock-renderer-3d.
//
// Three.js renderer for animated livestock — converts an ECS
// `WorldSnapshot` into six instanced fish meshes (one `InstancedMesh`
// per archetype) that the main `renderer-3d` host mounts into the tank.
// Plan Stage 11 F11.1, Wave 3.
//
// CONTRACT (for the Wave 4 integrator in `renderer-3d`)
// -----------------------------------------------------
//   const bundle = buildLivestockMeshes();
//   contentGroup.add(bundle.group);                // once, on attach
//   bundle.syncFromSnapshot(snapshot, time);       // every RAF tick
//   bundle.dispose();                              // once, on detach
//
// `syncFromSnapshot` is allocation-free (all scratch buffers live on the
// bundle); `dispose` releases every geometry + material and is safe to
// call twice.
//
// DEPENDENCY BUDGET
// -----------------
// Allowed: `three`, `@aquascape/domain/fish-anatomy`,
// `@aquascape/domain/livestock-ecs` (types only — `WorldSnapshot`, the
// archetype enum), `@aquascape/domain/geometry` (vec math). NO Angular,
// NgRx, Electron, `@aquascape/rendering/renderer-3d`, `features-*`.

export {
  buildLivestockMeshes,
  type BuildLivestockMeshesOpts,
  type LivestockMeshBundle,
} from './lib/build-livestock-meshes';

export { LIVESTOCK_VERTEX_SHADER, LIVESTOCK_FRAGMENT_SHADER } from './lib/shaders';

/** Engine version marker — bump on any vertex-math change that would
 * invalidate persisted instance positions. (No persistence yet — Stage
 * 11 is transient — but the marker is here so Wave 4 + future stages
 * can compare against a stored value.) */
export const LIVESTOCK_RENDERER_3D_VERSION = '0.1.0';
