# `@aquascape/domain/document`

`.aqua` v1 schema, (de)serialization, validation, migrations, and marshaling
between the on-disk `AquaDocument` and the in-memory `Scene`.

- Plan reference: §2.7 / Stage 1 F1.3.
- Tags: `scope:domain`, `framework:none`.

## What lives here

- `aqua-document.ts` — canonical TypeScript schema (the single source of truth).
- `schema/aqua-document.schema.json` — JSON Schema Draft 2020-12 mirror, used
  by `validateAquaDocument` at runtime. Authors of the format change both
  files together.
- `validator.ts` — AJV 2020 + `ajv-formats`, compiled once at module load.
- `migrations.ts` — `Migration` interface + `runMigrations` chain walker.
  v1 is the baseline: `AQUA_MIGRATIONS` is empty. v2 will prepend a
  `{ from: 1, to: 2, migrate }` entry; documents in the wild keep loading.
- `container.ts` — `.aqua` ZIP read/write via [`fflate`](https://github.com/101arrowz/fflate)
  (zero deps, pure JS, sync, works in node + browser + Electron renderer).
  `isZipContainer(bytes)` does the `PK\x03\x04` magic sniff so bare-JSON
  `.aqua` files also load.
- `serialize.ts` — `loadAquaDocument(input)` (returns a discriminated
  `LoadResult`, never throws on bad payloads), `serializeAquaDocument(doc)`,
  `packAquaDocument(doc, { assets?, thumbnail? })`.
- `marshal.ts` — `documentToScene(doc) -> { scene, envelope }` and
  `sceneToDocument(scene, envelope) -> AquaDocument`. `livestock` /
  `equipment` live on the `scene` (so commands can mutate them); the envelope
  carries the document's `meta` and any optional `extensions` so load → edit →
  save is lossless (the editor only mutates `scene`; on save the original
  envelope is reattached unchanged — this is the concrete mechanism for the
  "don't drop what you don't understand" rule).

## v1 is locked

Now that F1.3 has shipped, **every change to the format requires a `Migration`
entry**. Modify `aqua-document.ts`, `schema/aqua-document.schema.json`, and
the in-memory mirror in `libs/domain/scene-model/src/types.ts` together,
then append a `{ from: N, to: N+1, migrate }` to `AQUA_MIGRATIONS` and a
round-trip test in `libs/testing` that exercises v(N) → v(N+1).
