# `tools/`

Workspace tooling that isn't a lib or app.

- `scaffold-libs.cjs` — one-shot generator that recreates the empty-lib boilerplate
  (project.json, tsconfig.\*.json, jest.config.ts, eslint.config.cjs, README.md,
  src/index.ts) from the canonical list in the script itself. Used during F0.1
  and kept for future additions: append to the `LIBS` array and run
  `node tools/scaffold-libs.cjs`.
