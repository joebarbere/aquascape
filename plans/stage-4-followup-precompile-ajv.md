# Stage 4 follow-up — precompile AJV validators

**Status:** Planned (tracked as a gating step before any Electron production
build ships)

**Context.** The renderer eagerly imports `coreCatalog` from
`@aquascape/domain/catalog`, which calls `validateCatalogEntry` (AJV) at
module-init time. AJV compiles JSON-Schema validators via `new Function(…)`,
which strict CSP forbids (`script-src` without `'unsafe-eval'`). The same is
true for `validateAquaDocument` whenever the user opens a `.aqua` file.

For the **dev** desktop build (`nx serve desktop`) we ship a relaxed
`DEV_CSP` (see `apps/desktop/src/main/csp.ts`) that adds `'unsafe-eval'` to
`script-src` so the renderer boots and validation works end-to-end. The
strict `ELECTRON_CSP` is still applied for packaged builds — but we don't
have a packaged build yet, so this is a latent problem we must fix before
shipping any production Electron installer.

## What "done" looks like

- `pnpm exec nx build desktop` produces a renderer bundle that boots under
  the **strict** `ELECTRON_CSP` with zero `unsafe-eval` violations.
- `apps/desktop/src/main/csp.ts` no longer exports `DEV_CSP` — `cspFor
  Environment` returns `ELECTRON_CSP` in every environment.
- `cspForEnvironment` is folded back into the single `ELECTRON_CSP`
  constant (or kept as a one-arg helper for future env splits, but with
  the dev variant deleted).
- Both `validateCatalogEntry` and `validateAquaDocument` route through
  **AJV-standalone** compiled functions emitted at build time. AJV stays
  in `devDependencies` (for the codegen step) and is **not** bundled into
  the renderer.

## Approach

AJV 8 ships a `standalone` mode that emits self-contained JS for a compiled
validator (`require('ajv/dist/standalone')`). The emitted module is plain
CommonJS that references `ajv/dist/runtime/*` helpers (none of which use
`new Function`).

1. **Codegen script — `tools/precompile-validators.mjs`.** Loads each
   schema, instantiates an AJV with `{code: {source: true, esm: false}}` +
   `ajv-formats`, compiles, writes `*.generated.cjs`.
   - Output 1: `libs/domain/catalog/src/validator.generated.cjs`
   - Output 2: `libs/domain/document/src/schema/validator.generated.cjs`
   - Both files are **committed** so consumers don't need to run codegen
     to build the libs.

2. **Validator wrappers — `validateCatalogEntry` + `validateAquaDocument`.**
   Drop the `new Ajv(...)` instantiation; `import validate from
   './validator.generated.cjs'` and call directly. Keep the existing
   `{ ok, errors }` result shape so consumers don't change.

3. **Build wire-up.** Add a `precompile-validators` target on
   `domain-catalog` and `domain-document` that runs the codegen script.
   The lib's `build` target depends on it. (Alternatively: a single
   workspace-level `precompile-validators` Nx project. Either is fine.)

4. **Tests.**
   - Existing validator tests pass unchanged (the wrapper API doesn't
     move).
   - New CI step that re-runs the codegen and `git diff --exit-code`s
     against the committed `.generated.cjs` files, so a schema edit
     without a regen fails CI loudly.

5. **Drop the dev carve-out.** Remove `DEV_CSP` from
   `apps/desktop/src/main/csp.ts` and collapse `cspForEnvironment` back
   into the single `ELECTRON_CSP` export. Delete this follow-up file.

## Acceptance

- Boot `pnpm exec nx serve desktop` (with the dev relaxation gone) and the
  renderer shows no CSP violations, no AJV `Refused to evaluate a string as
  JavaScript` errors. Open a `.aqua` file → no CSP violations.
- `nx build desktop` succeeds; a packaged build (via `electron-builder`)
  boots the same renderer.

## Out of scope

- AJV-generated **error messages**. The standalone path emits the same
  shape; no consumer changes needed.
- The web app's runtime CSP. The web `<meta>` tag is informational in dev
  (the Angular dev server emits its own CSP) and the production web build
  isn't gated on this — but switching to precompiled validators benefits
  the web app's production CSP too. Land this fix once, both apps benefit.
