# `.github/workflows/`

CI workflows. Plan §3 / Stage 0 F0.7.

## Workflows

- **`pr.yml`** — runs on every PR against `main`. Linux-only for speed. Three jobs:
  - `main` — `nx affected -t lint test build`. The `lint` step includes `@nx/enforce-module-boundaries`, so layering violations fail this job.
  - `coverage` — domain-only coverage with per-lib 90% threshold (enforced via each `jest.config.ts`'s `coverageThreshold`).
  - `document-round-trip` — placeholder. Replaced for real when F1.3 lands.
- **`main.yml`** — runs on push to `main`. OS matrix (`ubuntu-latest`, `macos-latest`, `windows-latest`). Full `nx run-many -t lint test build e2e`.

## Required status checks for branch protection on `main`

When the `main` branch is created, set these as required:

- `nx affected (lint / test / build)` (from `pr.yml#main`)
- `Coverage gate (domain/* ≥90%)` (from `pr.yml#coverage`)
- `document-round-trip (placeholder)` (from `pr.yml#document-round-trip`)

## Concurrency

`pr.yml` cancels in-progress runs for the same PR on new push. `main.yml` does NOT cancel — main builds always complete.

## Caches

- pnpm store, OS-scoped, keyed by `pnpm-lock.yaml`.
- `.nx/cache`, OS-scoped, keyed by `${{ github.sha }}` with prefix restore for cache hits across commits.

## TODO

- **F1.3 — document-round-trip:** replace the placeholder job body with a real `pnpm exec nx test testing -t document-round-trip` invocation. See the TODO comment in `pr.yml`.
- **Stage 1 end:** drop `continue-on-error: true` from the `e2e` step in `main.yml` once Electron e2e is stable on Windows.
- **>3 contributors or >10 min PR runtime:** enable Nx Cloud (ADR 0004).
