# `@aquascape/domain/livestock-ecs`

bitECS-backed Entity-Component-System world for animated livestock (Stage 11 F11.1).

- **Tags:** `scope:domain`, `framework:none`, `domain:livestock-ecs`.
- **Stage 11 F11.1 Wave 1 status:** scaffold only — components, systems, and the
  snapshot interface land in Wave 2. The renderer (`rendering/livestock-renderer-3d`)
  consumes a yet-to-be-defined ECS snapshot shape, never this lib directly, so
  the ECS implementation stays swappable.
