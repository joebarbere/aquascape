# `@aquascape/domain/scene-model`

The heart of Aquascape. Owns the in-memory `Scene` model, the `Command`
primitive every editor mutation flows through, pure selectors, and the
undo/redo history. Plan §2.3 / Stage 0 F0.3.

- **Tags:** `scope:domain`, `framework:none`.
- **May depend on:** `@aquascape/domain/geometry`.
- **Must not depend on:** Angular, DOM, Electron, NgRx, RxJS, or any
  non-domain library.

## What lives here

- `Scene`, `Layer`, `SceneObject` (HardscapeObject / PlantObject / DecorObject),
  `Tank`, `Substrate` — plain serializable interfaces over plain objects.
  Shapes mirror the on-disk `aqua-document.ts` minus the
  `format` / `schemaVersion` / `meta` envelope; the marshaling layer in
  `libs/domain/document/` (F1.3) wraps/unwraps that envelope.
  `TankStyle.background` is a discriminated union over
  `'color' | 'image' | 'gradient' | 'none'`; the `'gradient'` variant carries
  an `angle` in radians (0 = left→right, π/2 = bottom→top) and ≥ 2
  `{ at, color }` stops.
- Branded `ObjectId` / `LayerId` over UUID v4. `newObjectId()` / `newLayerId()`
  factories use `crypto.randomUUID()` by default; swap via `setIdFactory()`
  for tests.
- Pure selectors: `getObjectById`, `getObjectWithLayer`, `getLayerById`,
  `getActiveLayer`, `iterateObjects` (render order: layer ascending, then
  object ascending — visibility/opacity is _not_ applied; the renderer
  decides what to skip).
- `Command` discriminated union + `applyCommand(scene, command)` and
  `invertCommand(scene, command)` free functions.
- Concrete commands: `Noop`, `AddLayer`, `RemoveLayer`, `RenameLayer`,
  `SetLayerOpacity`, `SetLayerVisibility`, `SetLayerLocked`, `ReorderLayers`,
  `AddObject`, `RemoveObject`, `MoveObject`, `ReshapeObject`,
  `SetTankDimensions`, `SetTankStyle`, `Composite`.
- Builder functions (`addLayer`, `moveObject`, …) — pure ergonomics over the
  union members. Hand-rolled records work identically.
- `History` (`createHistory({ bound? })`) with `push` / `undo` / `redo`.
  Pure immutable. New push after undo truncates the redo stack.
  Bounded; oldest entries drop deterministically.

## Design choices

### Command shape — (b) discriminated union + free functions

Commands are **plain objects** with a `kind` discriminator. `applyCommand`
and `invertCommand` are free functions that switch on `kind`. The F0.3 spec
sketched an interface-with-methods `Command { apply, invert }`; we chose
this variant because it makes the JSON round-trip trivial (no class
registry needed) and keeps the command stream easy to inspect, log, and
later replay or transmit. The semantic contract — pure, invertible,
serializable — is identical.

### Locked-layer guard — typed result

`applyCommand` returns a `CommandResult` discriminated union:

```ts
{ ok: true; scene: Scene }
| { ok: false; reason: 'locked' | 'not-found' | 'invalid'; message: string }
```

Object-level commands (`AddObject`, `RemoveObject`, `MoveObject`,
`ReshapeObject`) targeting a locked layer return
`{ ok: false, reason: 'locked', … }` and the original scene is left
unchanged. **Lock guards content, not layer metadata** — `RenameLayer`,
`SetLayerOpacity`, `SetLayerVisibility`, `SetLayerLocked` (toggle) are NOT
blocked by `locked`. `RemoveLayer` is treated as a structural operation and
is also not currently lock-protected; the higher-level UI is expected to
confirm.

### `ReorderLayers` semantics — full id permutation

`ReorderLayersCommand.order` is the **complete** new ordering as a
`LayerId[]`. It must be a permutation of the current layer ids (same set,
no duplicates, no missing). Anything else is rejected with
`reason: 'invalid'`. This makes a drag-and-drop reorder a single command,
and inversion trivially captures the previous full ordering.

### `MoveObject` — absolute position

`MoveObjectCommand` carries the **absolute** target world position, not a
delta. Inversion is trivial (capture the previous absolute position from
the scene), and absolute commands are idempotent if replayed.

### `SetTankDimensions` — structural with clamp + inverse envelope

`SetTankDimensionsCommand` updates `scene.tank.{width,height,depth}` and
clamps every `SceneObject.transform.position` per-axis into the new
interior AABB (`x ∈ [0,width]`, `y ∈ [0,height]`, `z ∈ [0,depth]`).
**Nothing is deleted** — even objects whose centre lands exactly on a face
of the new tank stay in the scene; the clamp keeps them tangent.

It is treated as a **structural global operation**, alongside `RemoveLayer`
and `ReorderLayers`: the locked-layer guard does NOT apply, so an object
on a locked layer still gets clamped when the tank shrinks around it.

`scene.tank.style`, `scene.tank.glassThickness` and `scene.tank.presetRef`
are intentionally untouched. The UI layer (F1.1 phase B) clears `presetRef`
explicitly when a user types custom dimensions, because Stage 0 has no
catalog loader to verify whether the new dimensions still match the
preset.

The domain layer applies a loose physical-sanity range only: each
dimension must be finite, > 0, and ≤ 10 000 mm
(`SET_TANK_DIMENSIONS_MAX_MM`). The Angular form in F1.1 phase B applies
the tighter 100–3000 mm product range.

#### The `inverse` envelope

`SetTankDimensionsCommand` carries an optional `inverse` field that
`invertCommand` populates:

```ts
inverse?: {
  previousDimensions: { width: number; height: number; depth: number };
  restoredPositions: Record<string, { x: number; y: number; z: number }>;
};
```

A command built freshly from the UI omits `inverse`. A command built by
`invertCommand` carries it, and `applyCommand` uses `restoredPositions`
to write back original object positions instead of clamping them. This
is the mechanism that makes `apply ∘ invert = id` work even when
shrinking and then undoing — without it, undo would re-clamp the
already-clamped positions and lose the originals.

`restoredPositions` is populated for **every** object in the scene, not
just those that would be clamped. Simple + correct beats clever +
sparse for v1; the cost is a small map keyed by object id.

#### Substrate profile points

`SubstrateRegion.profile` uses normalised x (fraction of region width),
so it adapts to width changes automatically. Profile-point `y` (mm from
tank floor) that exceeds the new `height` is **not yet clamped** —
there's a `TODO(F2.x)` in the apply handler. No substrate-editing UI
exists today that could produce a profile point taller than the tank.

### `SetTankStyle` — whole-style replacement with deep validation

`SetTankStyleCommand` carries a full replacement `TankStyle`. It is **not**
a per-field patch: the entire `frame` / `frameColor` / `waterTint` /
`background` record is replaced atomically. The UI in F1.2 phase D
dispatches the whole styling-panel state as one command; inversion is
trivial (snapshot the previous style); and whole-replacement sidesteps
the question of how to "patch out" union members of `background` when
switching between variants.

It is a **structural global operation** — the locked-layer guard does
NOT apply (same convention as `SetTankDimensions` and `ReorderLayers`).
Tank `width`/`height`/`depth`/`glassThickness`/`presetRef` are NOT
touched.

`applyCommand` validates every field before storing:

- `frame` must be one of `rimless` / `framed` / `braced`.
- `frameColor` / `waterTint`, when present, must match `#RRGGBB` or
  `#RRGGBBAA` (case-insensitive). Three-digit shorthand and CSS color
  names are rejected — the on-disk shape stays canonical.
- `background.kind === 'color'`: `color` must be a valid hex.
- `background.kind === 'gradient'`: `angle` finite; `stops.length ≥ 2`;
  each stop's `color` is a valid hex; each `at` is finite and in
  `[0, 1]`; stops are sorted **non-strictly ascending** by `at` (equal
  `at` values are legal — they encode a hard-stop band).
- `background.kind === 'image'`: `asset.id` and `asset.uri` are
  non-empty strings. Asset bytes are not validated here; that's the
  loader's job.

**Inverse revalidation policy: always validate.** `applyCommand` does
not short-circuit validation when an `inverse.previousStyle` envelope is
present. The cost is microseconds (a handful of regex tests) and the
always-on path keeps the apply switch simple and catches latent bugs
upstream.

`SetTankStyleCommand.inverse?.previousStyle` is populated by
`invertCommand` and absent on freshly-built commands from the UI.
Storage uses `structuredClone` so the captured snapshot is independent
of any caller reference.

### Mutation discipline

Every `apply` path produces a fresh `Scene` via spread/`structuredClone` on
the affected paths. No in-place mutation; no clever structural sharing yet
— premature in v1.

## Round-trip guarantees (property tests)

- `JSON.parse(JSON.stringify(scene))` deep-equals `scene` on randomly
  generated scenes.
- `JSON.parse(JSON.stringify(command))` deep-equals `command` on randomly
  generated commands.
- For any command `c` and scene `s` that accepts it:
  `applyCommand(applyCommand(s, c).scene, invertCommand(s, c)).scene` deep-
  equals `s`.
- History invariant: after any sequence of `push` / `undo` / `redo`, the
  scene equals the result of replaying the live (non-undone) commands from
  the empty scene.

## Stage 0 status

Implemented as part of F0.3. The 2D renderer (F0.4) consumes the `Scene`
type exported by this lib via `SceneRenderer.render(scene, viewport)`.
