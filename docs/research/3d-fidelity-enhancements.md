# 3D fidelity — enhanced recommendations (grounded in headless captures)

**Load this when:** planning further `renderer-3d` / `livestock-renderer-3d` realism work. Unlike the earlier (pre-visual) recommendations, these are ranked by what the rendered output **actually looks like** — captured headlessly via Playwright + SwiftShader (see the CLAUDE.md "Visual validation with Playwright" note).

## What the render actually looks like today (after the fidelity pass)

Captured a planted "Jungle" scene (substrate + hardscape + layered plants + a tetra school) in 3D and inspected it wide + zoomed. The lighting/glass/caustics/bloom/day-night work well. The **shape + material reads** are the weak points, in priority order:

1. **The substrate is a pure black void.** Dark aquasoil (`#2a2520`) under tank light crushes to flat black — it reads as "the bottom of the tank is missing," not as soil. This is the single most damaging issue: it drags the whole image dark and removes the floor the scene should sit on.
2. **Plants are flat cardboard cut-outs.** Each plant is ONE extruded silhouette, so from any off-axis angle (and especially the tall Vallisneria ribbon) it's obviously a 2D card with depth = a thin slab. No volume → "low-poly paper diorama."
3. **Hardscape reads as smooth chocolate blobs.** The per-vertex noise gives a lumpy silhouette but the material is a single flat colour with no surface grain, roughness variation, or crevice darkening, so rocks look like molded plastic.
4. **Nothing is grounded.** No ambient occlusion / contact shadow, so rocks + plants don't "sit" on the substrate — the contact line is hard and they read as floating.

## Recommendations, ranked by observed impact

### A. Fix the "black void + cardboard" reads (do these first — biggest wins)

1. **Substrate grain + tonal lift.** Add a deterministic per-fragment grain/sparkle to the substrate fragment shader (same `onBeforeCompile` pattern as caustics) so the dark soil reads as *granular* — thousands of tiny tonal variations + a faint top-facing lift — instead of a flat void. Cheap, no geometry change. **(Implemented.)**
2. **Cross-plane plant geometry.** Replace the single extruded silhouette with **2–3 intersecting vertical silhouette planes** (a `+` / `*` cross-section) so a plant has volume + reads as foliage from any angle, not a card. Keep the sway shader + scatter instancing; only `buildSilhouetteGeometry` changes. **(Implemented.)**
3. **Hardscape surface texture.** A multi-octave 3D value-noise on the rock albedo (crevices darker, faces lighter) so rocks read as stone, not smooth plastic. Same `onBeforeCompile` seam as substrate/caustics — **no addon**. **(Implemented — promoted from B4 ahead of SSAO; validated on the Iwagumi Seiryu-stone scene, which now reads as real mottled rock.)**

### B. Surface richness (next)

4. **SSAO.** Add an `SSAOPass` to the (already-wired) EffectComposer to darken crevices + ground objects on the substrate. The composer seam is ready (one `addPass`); it needs the `SSAOPass` ESM addon wired (path-map + ambient shim + Jest stub, like the bloom passes) and a perf/size gate (it adds passes — heavy under software WebGL). Sequence it AFTER the substrate lift so it deepens contact shadows without re-crushing the floor to black. **(Deferred — next on the ready seam.)**
5. **Catalog-driven albedo/normal textures.** The honest long-term fix for plants + hardscape + fish — author texture maps per catalog entry. Larger (catalog schema + asset pipeline + loader); the procedural passes above buy most of the realism in the meantime.
6. **Fish detail.** Per-instance colour/pattern (the renderer shares one body colour per archetype today) + per-fin secondary motion. Needs a per-instance colour attribute on the snapshot.

### C. Water + scene (lower priority given the transmissive glass already refracts)

7. **Screen-space water-surface refraction.** Render the opaque scene to a target, sample it in the water shader with a normal-offset for true "looking through the surface" distortion. The transmissive glass already gives the dominant refraction, so this is polish; it needs an extra render target threaded around the EffectComposer.
8. **Scenic backdrop / environment.** The flat pale-blue background reads as a void behind the glass; a subtle gradient or blurred room backdrop would seat the tank in a space.
9. **Caustics intensity + on the water surface itself**, and **flow-coupled sway frequency** (today only amplitude couples to flow).

## Validation

Every item above is validatable headlessly: `pnpm exec nx serve web`, then a Playwright script (SwiftShader flags) that builds a planted scene, switches to 3D, orbits, and screenshots the canvas for a `Read`. Compare against the baseline captures. The implemented A-tier items were each confirmed this way before commit.
