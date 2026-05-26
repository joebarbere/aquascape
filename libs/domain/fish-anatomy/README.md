# `@aquascape/domain/fish-anatomy`

Procedural fish geometry — vertex buffers, UV layout, named vertex groups for
body / caudal / dorsal / anal / pectoral fins so the renderer can deform each
group independently (tail swish, fin flutter). Plan Stage 11 F11.1.

- **Tags:** `scope:domain`, `framework:none`, `domain:fish-anatomy`.
- **Stage 11 F11.1 Wave 1 status:** public `FishGeometryDescriptor` type is
  locked. Builders that produce descriptors per species land in Wave 2.
- Returns plain `Float32Array` / `Uint16Array` buffers — no Three.js, no DOM,
  so the renderer can wrap them in `BufferGeometry` and headless tools (e.g.
  glTF export) can consume the same shape.
