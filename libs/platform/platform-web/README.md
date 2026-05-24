# `@aquascape/platform/platform-web`

Web browser implementation of `@aquascape/platform/platform-api`. **Stage 0 ships in-memory stubs** — every byte is held in a `Map` inside the renderer. F1.4 / F1.5 swap the bodies for File System Access API + IndexedDB integrations; the public surface stays the same.

- **Tags:** `scope:platform-web`.
- **Boundary rule:** may depend only on `scope:domain`, `scope:platform-api`, and itself. Features cannot import this lib; only `apps/*` may.

## Surface

`createWebPlatform(): Platform` is the only thing app composition roots need.
The individual service classes (`InMemoryFileService`, `StubDialogService`,
`InMemoryStorageService`, `InMemoryRenderExportService`) are exported for
tests and bespoke wiring.

## Stub behaviour

- **FileService.openDocument** returns the most recently saved document
  rather than always-`null`. This lets features drive a real round-trip
  without a real picker. Real implementations may legitimately resolve to
  `null` when the user cancels — feature code must handle both cases.
- **FileService.save\*** mints sequential mem-doc ids; bytes are defensively
  copied in and out of the store so neither side can mutate the other.
- **DialogService.confirm** returns `true` by default. Destructive flows
  under test should mock this with `false` to cover the cancel branch.
- **StorageService** deep-clones values via `structuredClone` to mirror the
  fresh-object behaviour IndexedDB will provide in F1.5.
- **RenderExportService.exportPng** returns `{ path: 'memory://exports/<name>' }`
  in lieu of a real file URI.

## Verifying the module-boundary rule

Boundary lint blocks features from importing this lib. To convince yourself
locally, temporarily add `import {} from '@aquascape/platform/platform-web';`
to `libs/features/editor-shell/src/index.ts` and run
`pnpm exec nx lint editor-shell` — you'll see an
`@nx/enforce-module-boundaries` violation. Revert immediately.
