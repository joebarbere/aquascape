# `@aquascape/domain/water-sim`

Deterministic aquarium water-chemistry simulation engine. Plan Stage 13 F13.1 (ADR-0006).

- **Tags:** `scope:domain`, `framework:none`.
- Pure TypeScript: no Angular, no DOM, no `Date.now()`, no `Math.random()`. Time is an input.
- Models the nitrogen cycle (ammonia → nitrite → nitrate), tank cycling, pH drift, and algae growth.

See [`docs/caveats/water-sim.md`](../../../docs/caveats/water-sim.md) and
[`docs/architecture/water-sim.md`](../../../docs/architecture/water-sim.md).
