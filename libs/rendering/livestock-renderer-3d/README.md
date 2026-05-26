# `@aquascape/rendering/livestock-renderer-3d`

Three.js livestock renderer — converts the ECS snapshot into instanced fish /
shrimp / snail meshes that the main `renderer-3d` scene mounts into the tank.
Plan Stage 11 F11.1.

- **Tags:** `scope:rendering`, `framework:three`, `domain:livestock-renderer-3d`.
- **Stage 11 F11.1 Wave 1 status:** scaffold only — the mesh builders +
  per-frame snapshot uploader land in Wave 4.
- **Decoupling rule:** this lib consumes a **snapshot** of the livestock world
  (a plain typed-array shape defined in `domain/livestock-ecs` Wave 2), never
  the bitECS world handle directly. That keeps the renderer testable without
  spinning up an ECS and lets the ECS swap implementations without touching
  the renderer.
