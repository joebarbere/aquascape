# ADR 0003 — Coverage tool: Jest + Istanbul

**Status:** Accepted.
**Date:** Stage 0, F0.7.

## Decision

Use Jest's built-in Istanbul coverage. Reporters: `text`, `text-summary`, `html`, `lcov`, `json-summary`.

## Rationale

- Already wired by `@nx/jest`; no extra tooling.
- `lcov` integrates with Codecov / Coveralls if we add them post-v1.
- `json-summary` is what the CI gate parses to enforce ≥90% on `domain/*`.
- Per-lib `coverageThreshold` (in each `jest.config.ts`) gives local parity with CI: contributors see the threshold fail before pushing.

## Consequences

- Domain libs (`libs/domain/*`) carry a 90% `coverageThreshold` block in their `jest.config.ts`. Non-domain libs do not — they're held to a lower bar in the CI workflow.
- The CI `coverage` job runs `nx run-many -t test --configuration=ci --projects='tag:scope:domain'` so the gate is data-driven by tags, not a hand-maintained list.

## Revisit

If profiling shows Istanbul is a meaningful share of CI time (>20%), switch domain libs to V8 coverage (`--coverage-provider=v8`); the LCOV output is compatible.
