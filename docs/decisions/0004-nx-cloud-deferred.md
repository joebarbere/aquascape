# ADR 0004 — Nx Cloud: deferred

**Status:** Deferred.
**Date:** Stage 0, F0.7.

## Decision

Do **not** enable Nx Cloud in Stage 0. Use GitHub Actions cache for the local Nx cache directory (`.nx/cache`) and pnpm store.

## Rationale

- Stage 0 is pre-public; there's no team yet, so distributed task execution has near-zero payoff against a one-developer affected graph.
- Nx Cloud requires creating an account + storing an access token, which is friction for an open-source project that hasn't decided on a hosting partnership.
- The self-hosted GitHub Actions cache covers the build/test cache restore use case with no third-party dependency.

## Revisit

When the project gains >3 active contributors or when CI wall-clock starts exceeding ~10 min consistently — whichever comes first. The plan §3 calls out "<10 min on PR workflow with warm cache" as the budget; if we breach that, Nx Cloud / Nx Replay become the easiest lever.

## Consequences

- `nx.json` has no `nxCloudAccessToken`. The opt-in is a one-line change when we revisit.
- `.github/workflows/pr.yml` and `main.yml` cache `.nx/cache` and the pnpm store explicitly.
