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
  `AddObject`, `RemoveObject`, `MoveObject`, `ReshapeObject`, `Composite`.
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
