# `@aquascape/domain/fluid-sim`

Fluid + flow primitives for Stage 11 F11.5 — `FlowField` advection sampled by
the livestock ECS, `BubbleStableFluids2D` (Stam 1999/2003) for bubble motion,
and a sphere-union signed-distance field of hardscape for obstacle avoidance.

- **Tags:** `scope:domain`, `framework:none`, `domain:fluid-sim`.
- **Pure TS.** No Three.js, no bitECS, no Angular, no DOM, no `Math.random` or
  `Date.now`. All three bakes are deterministic: same inputs → byte-identical
  `Float32Array` outputs.
- **Pre-allocation discipline.** `stepBubbleSlice` never allocates — every
  scratch buffer (velocity intermediates, density scratch, pressure,
  divergence) lives on the `BubbleSlice` object so a tank with N air-stones
  can step N slices per ECS tick within budget.

## Surface

| Symbol | What it is |
|---|---|
| `bakeFlowField(opts)` / `sampleFlowField(field, pos)` | 32³ divergence-free velocity grid from filter / pump sources. Gaussian source deposit + Stam-style Gauss-Seidel projection (default 20 iters) → trilinear sampler with clamp-to-edge. |
| `createBubbleSlice(opts)` / `stepBubbleSlice(slice, dt, force?)` | 32×32 vertical Stam 1999 fluid slice. Standard order: addForce → diffuse → project → advect → project (velocity) + diffuse → advect (density). |
| `bakeHardscapeSdf(opts)` / `sampleSdf(sdf, pos)` / `sampleSdfGradient(sdf, pos)` | 64³ Float32 sphere-union SDF. Trilinear sample + central-differences gradient. Out-of-grid samples return a large positive sentinel (~1e6 mm) and a zero gradient so callers can treat OOB as "safely far". |

## References

- Stam, J. (1999) *Stable Fluids*.
- Stam, J. (2003) *Real-Time Fluid Dynamics for Games*.
- `plans/stage-11-animated-livestock.md` §F11.5.
- `docs/research/stage-11-livestock-subsystem.md` §6 — fluid + flow.
