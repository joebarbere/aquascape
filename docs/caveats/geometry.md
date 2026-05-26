# Geometry caveats

**Load this when:** touching `libs/domain/geometry/` — transform composition, polygon sampling, deterministic hashing.

- `composeTransform` / `invertTransform` round-trip via TRS↔matrix and are **exact only for uniform scale**. Non-uniform scale combined with rotation loses information; `flipX` / `flipY` are absorbed into negative scale.
- `sampleCatmullRom` is **centripetal** (`alpha = 0.5`), not uniform — uniform produces cusps + loops on clustered points.
- `seededHash01` must NOT `& 0xffffffff` after `>>> 0` — bitwise AND coerces uint32 back to signed int32 and breaks the `[0, 1)` guarantee. Property test catches it.
