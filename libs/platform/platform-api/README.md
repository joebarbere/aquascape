# `@aquascape/platform/platform-api`

Platform abstraction **interfaces** only. No implementation. Plan §2.5 / Stage 0 F0.5.

- **Tags:** `scope:platform-api`, `framework:none`.
- **Boundary rule:** may depend only on `scope:domain` and itself.

## Surface

Exported from `@aquascape/platform/platform-api`:

- `FileService` — `openDocument`, `saveDocument`, `saveDocumentAs`.
- `DialogService` — `confirm`, `alert`.
- `StorageService` — `get<T>`, `set<T>`, `remove`.
- `RenderExportService` — `exportPng`.
- `Platform` — bundle returned by each concrete platform's factory.
- Supporting result types: `OpenDocumentResult`, `SaveDocumentResult`, `ExportPngResult`.

## Angular sub-entry

`@aquascape/platform/platform-api/angular` exports Angular `InjectionToken`s
(`FILE_SERVICE`, `DIALOG_SERVICE`, `STORAGE_SERVICE`, `RENDER_EXPORT_SERVICE`).
Kept separate so the framework-free interface file never imports
`@angular/core`. Angular feature libs and app composition roots import this
sub-entry; nothing else does.

## Capability contract

Methods that cannot complete (user cancel, capability unavailable) return
`null`. Callers handle that single absence path; they never need to
distinguish "cancel" from "stub can't service yet" from "no document open".
