# Aquascape

Open-source aquascaping design tool — Angular web SPA/PWA + Electron desktop, single Nx monorepo.

**Stage:** Stage 0 (Foundation & Walking Skeleton). Workspace scaffold and CI are in place; lib bodies fill in during F0.2–F0.6.

## Quick start

```bash
corepack enable                  # picks up the pinned pnpm
pnpm install
pnpm exec nx graph               # browse the dependency graph
pnpm exec nx run-many -t lint    # lint everything (incl. module-boundary check)
pnpm exec nx run-many -t test    # run all tests
```

## What's here

- `apps/` — `web/`, `web-e2e/`, `desktop/`, `desktop-e2e/`. Empty placeholders until F0.6.
- `libs/domain/` — framework-free TypeScript: `geometry`, `scene-model`, `document`, `catalog`, `growth-sim`.
- `libs/rendering/` — renderer contract + 2D + (later) 3D implementations.
- `libs/features/` — Angular feature libs (editor shell + tools).
- `libs/ui/`, `libs/state/` — design system + NgRx stores.
- `libs/platform/` — platform-api (interface), platform-web, platform-electron (implementations).
- `libs/testing/` — fixtures, builders, mocks.
- `tools/` — workspace tooling (currently: `scaffold-libs.cjs`).
- `docs/decisions/` — architecture decision records (ADRs).
- `plans/` — per-feature implementation plans (one file per F-number).
- `.claude/` — sub-agent definitions and team playbooks.

## Architecture

See [`aquascape-development-plan.md`](./aquascape-development-plan.md) (the spec) and [`CLAUDE.md`](./CLAUDE.md) for the load-bearing decisions.

The architecture's layering is enforced mechanically via Nx tags in every `project.json` + the `@nx/enforce-module-boundaries` rule in `eslint.config.cjs`. A `features/*` lib that tries to import `platform-electron` will fail `nx lint`.

## Document format

The `.aqua` v1 format is defined by [`aqua-document.ts`](./aqua-document.ts) (TypeScript source of truth) and [`aqua-document.schema.json`](./aqua-document.schema.json) (JSON Schema for runtime validation). A worked example lives in [`example.aqua.json`](./example.aqua.json). These files move into `libs/domain/document/` when F1.3 lands.

## License

MIT.
