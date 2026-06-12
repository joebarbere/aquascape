# `tools/`

Workspace tooling that isn't a lib or app.

- `scaffold-libs.cjs` — one-shot generator that recreates the empty-lib boilerplate
  (project.json, tsconfig.\*.json, jest.config.ts, eslint.config.cjs, README.md,
  src/index.ts) from the canonical list in the script itself. Used during F0.1
  and kept for future additions: append to the `LIBS` array and run
  `node tools/scaffold-libs.cjs`.

## `generate-textures.mjs` — procedural PBR texture baker

Bakes the catalog texture assets (Bucket 2 of the 3D fidelity follow-ups):
**9 texture families × 3 maps = 27 PNGs** at 256×256 into
`libs/domain/catalog/assets/textures/`, named `<family>.albedo.png` (RGB),
`<family>.normal.png` (RGB tangent-space, neutral = 128/128/255, OpenGL +Y-up
convention), `<family>.roughness.png` (**single-channel grayscale** — three.js
reads the green channel of a `roughnessMap`, and grayscale decodes to R=G=B).
The catalog manifests reference these filenames — the names are a fixed
contract. `apps/web/project.json` copies the directory into the build at
`/assets/catalog-textures/` (lazily-fetched static assets; they do **not**
count against the initial-bundle budget; the Electron app loads the same web
dist). Regenerate with:

```bash
pnpm generate:textures            # = node tools/generate-textures.mjs
pnpm generate:textures -- --sheet # also writes a 3×3 albedo contact sheet
                                  # to /tmp/texture-sheet.png for eyeballing
```

Pure math → PNG via `sharp`; no network, no licensed assets. Every map is
derived from a seeded multi-octave fBm height field built on **periodic**
value-noise lattices (integer frequencies, modular wrap) plus per-family
structure (Worley cells with torus distance, anisotropic grain, strata bands,
vein ridges), so every map **tiles seamlessly** — the script asserts edge
continuity of each height field and sanity-asserts per-family mean albedo
luminance, normal-map mean ≈ (128, 128, 212–252), before writing anything.

**Determinism policy:** seeded `splitmix32` PRNG only (one fixed seed per
family — see the `FAMILIES` table in the script); no `Math.random()`, no
`Date`. The script bakes every raw pixel buffer twice from scratch and
PNG-encodes twice, asserting byte-identity both times. Cross-platform PNG
**byte**-identity additionally depends on the sharp/libvips version, so the
committed PNGs are the source of truth and the script is the regeneration
path — same policy as the committed generated AJV validators.

| Family | Intended look |
| --- | --- |
| `stone-gray` | Cool gray seiryu-like stone, darker diagonal strata seams |
| `stone-warm` | Tan/brown stone, cellular pitting (varied pore size/density) |
| `stone-dark` | Very dark basalt, fine vesicular speckle, low albedo variance |
| `wood-bark` | Brown bark, strong anisotropic grain + narrow dark fissures |
| `soil-dark` | Dark brown packed aquasoil granules (jittered cell domes) |
| `sand-fine` | Pale beige, very fine low-contrast speckle, high roughness |
| `gravel-mixed` | Medium rounded pebbles, per-pebble gray/tan/brown mix |
| `leaf-fine` | Mid-green, fine parallel blade striations |
| `leaf-broad` | Deeper green, midrib + branching vein ridges, broad tint drift |

Albedo ramps are deliberately moderate-contrast: the renderer **multiplies**
them over authored catalog colours, so they must modulate, not fight.
