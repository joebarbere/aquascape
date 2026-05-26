# Growth-sim caveats

**Load this when:** touching `libs/domain/growth-sim/` — plant scale curve, scatter PRNG, or any consumer that depends on deterministic placement across machines.

- `plantScale` curve: logistic, `progress = 1 - exp(-DECAY × age / W)` with `DECAY = -ln(1 - GROWTH_CURVE_TARGET) ≈ 4.605` so a plant reaches `0.99 × (1 - sizeAtZero)` at `age = weeksToMature`. **Vigor > 1 legitimately renders > 1× catalog size — by design.** Defensive guards: negative ages → 0, non-finite `sizeAtZero` → 0, `weeksToMature ≤ 0` → falls back to 1.
- `scatterInPolygon` Mulberry32 PRNG sub-streams (jitter, rotation) are **stable regardless of cell index** — load-bearing for documents reloading identically across machines.
