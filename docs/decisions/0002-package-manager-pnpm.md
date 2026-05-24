# ADR 0002 — Package manager: pnpm

**Status:** Accepted.
**Date:** Stage 0, F0.1.

## Context

F0.1 requires a package-manager choice (pnpm / npm / yarn). Plan §3 and the F0.1 spec recommend pnpm.

## Decision

**pnpm**, pinned via `package.json#packageManager`. Workspace declared in `pnpm-workspace.yaml`.

## Rationale

- **Install perf** — content-addressable store + hard links → faster CI installs, smaller disk footprint.
- **Dependency hygiene** — pnpm's strict resolution surfaces phantom deps that npm hides. This is load-bearing for the architecture's layering goals (a feature lib accidentally importing a transitive dep of a sibling won't slip past install).
- **First-class Nx support** — Nx detects pnpm and uses it natively.

## Consequences

- Contributors must have pnpm installed. `.nvmrc` pins Node 20.11.0; pnpm is pinned via `packageManager` so `corepack enable` picks it up automatically.
- CI uses `pnpm/action-setup` with the version derived from `package.json#packageManager`.
- `.npmrc` sets `node-linker=isolated` (default) for the strictest resolution semantics — switch to `hoisted` only if a specific tool can't cope.
