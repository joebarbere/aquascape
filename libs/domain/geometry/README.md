# `@aquascape/domain/geometry`

Framework-free geometry primitives shared by every other domain lib, both
renderers, and the precision-guide overlays. Plan §2.3 / Stage 0 F0.2.

- **Tags:** `scope:domain`, `framework:none`.
- **May depend on:** nothing (root-of-graph domain lib).

## What's in here

`Vec2` / `Vec3` algebra (`add`, `sub`, `mul`, `scale`, `dot`, `cross`,
`length`, `normalize`, `distance`, `lerp`), affine `Transform` ops
(`identityTransform`, `composeTransform`, `invertTransform`,
`applyTransform`), the canonical `project2D` projection used by the 2D
renderer, AABB primitives (`aabbContainsPoint`, `aabbIntersects`,
`aabbFromPoints`, `aabbExpand`, `transformAabb`), 2D hit-tests
(`pointInRect`, `pointInRotatedRect`, `pointInCircle`, `pointInPolygon`),
the golden-ratio / rule-of-thirds composition helpers used by Stage 5
overlays, and snap helpers.

All functions are pure. Inputs are plain `{x, y}` / `{x, y, z}` objects
matching the shapes in `aqua-document.ts`; nothing here mutates an input
and nothing here returns a class instance.

## Load-bearing conventions

### Units

Linear coordinates are **millimetres**. The math is unit-agnostic
numerically, but the public API contract is mm. Pixel conversion is a
renderer concern.

### Coordinates

Right-handed:

- +x → right (tank width)
- +y → up (tank height)
- +z → back (tank depth)
- origin at tank front-bottom-left interior corner.

Rotation positive direction follows the right-hand rule about each axis.
`crossVec3(ex, ey) = ez` is verified by test. The same numbers serve the
2D renderer (which projects along −z) and the future 3D renderer.

### EPSILON contract

A single constant, `EPSILON = 1e-6`, governs every "approximately equal"
comparison in this lib. Use it directly (or via `approxEquals`) — do not
introduce ad-hoc tolerances per call site. Composed-matrix paths
(`composeTransform`, `invertTransform`) may produce errors a few orders of
magnitude larger than `EPSILON` after a full TRS decompose / recompose
round-trip; the lib's own tests use a looser tolerance (≤ 1e-2 in the
worst property test) where appropriate. The renderer and scene-model
should similarly pick a tolerance scaled to the problem rather than
re-define `EPSILON`.

### Inclusive boundary

Hit-tests and AABB containment are **inclusive**: a point exactly on the
edge of a rectangle, the boundary of a circle, or an edge of a polygon
counts as inside. Two AABBs sharing an edge count as intersecting. This
matches user intuition about clicking the visible silhouette of an object
and avoids the asymmetry of "click works on three sides but not the
fourth".

### Empty / degenerate inputs

- `aabbFromPoints([])` **throws**. There is no useful empty-AABB sentinel
  that composes well with `aabbContainsPoint` / `aabbIntersects`; callers
  must guard their inputs.
- `aabbExpand(box, byMm)` with a large negative `byMm` that would invert
  the box returns a degenerate point at the original box's center.
- `normalizeVec2` / `normalizeVec3` of a vector with length below
  `EPSILON` returns the **zero vector** (not NaN, not a throw). Downstream
  code can branch on `length === 0` if a real unit vector is required.
- `invertTransform` of a transform with any zero scale component
  **throws** (the underlying 4x4 matrix is singular).
- `snapToGrid(p, 0)` and `snapToGrid(p, -k)` return `p` unchanged.

## Tests

Jest + `fast-check`. The lib enforces ≥90% coverage in
`jest.config.ts`. Property tests cover the contract-level invariants:

- `compose(t, identity) ≡ t` (applied to a point, within tolerance).
- `compose(t, invert(t))` is the identity (within tolerance) for any
  well-conditioned `t`.
- `project2D` is a left-inverse for any `Vec3` with `z = 0`.
- `aabbContainsPoint(aabbFromPoints(ps), p)` is true for every `p ∈ ps`.
- `crossVec3` is anti-commutative.
