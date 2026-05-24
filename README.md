# Aquascape

Open-source aquascaping design tool — Angular web SPA/PWA + Electron desktop, single Nx monorepo.

**Status:** Stage 0 complete + Stage 1 in progress (F1.1 + F1.2 shipped). Both apps boot: `apps/web` (Angular 18 standalone, ESBuild `application` builder) renders the tank — sized, styled, and re-rendered live as the user drives the sidebar — via `renderer-2d`; `apps/desktop` (hand-rolled Electron 33 per [ADR-0001](./docs/decisions/0001-electron-tooling.md), `electron-builder` for packaging) loads that same web bundle behind the non-negotiable security posture (context isolation, sandbox, no `nodeIntegration`, no remote module, typed preload bridge, CSP enforced via HTTP header). Stage 1 continues next at `domain/document` (F1.3) — moving `aqua-document.ts` into a real loader + `Migration` chain — and file ops (F1.4–F1.6). The 11-stage roadmap is in [`aquascape-development-plan.md`](./aquascape-development-plan.md) §4.

## Quick start

```bash
corepack enable                              # picks up the pinned pnpm
pnpm install

pnpm exec nx serve web                       # Angular dev server on http://localhost:4200
pnpm exec nx serve desktop                   # web dev-server + Electron in parallel
pnpm exec nx build desktop                   # builds web + main + preload → dist/apps/desktop/

pnpm exec nx graph                           # browse the dependency graph
pnpm exec nx run-many -t lint                # module-boundary lint over every project
pnpm exec nx run-many -t test                # full unit-test suite
pnpm exec nx test <project> --configuration=ci   # with coverage + 90% threshold gate
```

## What's here

Implemented so far:

- `apps/web/` — Angular 18 standalone shell, `OnPush`, `ResizeObserver`-driven redraw. Runtime `selectPlatform()` binds `platform-api` tokens to `platform-electron` under Electron, `platform-web` in the browser. Two-pane layout: canvas + `<aquascape-tank-setup>` sidebar. Scene reads from the NgRx store via `selectScene`.
- `apps/desktop/` — Electron main + sandboxed preload + shared IPC contract, three-tsconfig layout. `buildWebPreferences()` is the security-flag source of truth (unit-tested literally, field-by-field). Stage-0 IPC bridge ships one channel: `ping → pong`.
- `libs/domain/geometry/` — Vec2/3, Transform, AABB, hit-test, golden-ratio + thirds, snap helpers.
- `libs/domain/scene-model/` — `Scene`/`Layer`/`SceneObject` types + plain discriminated-union `Command` records + bounded immutable `History`. Commands: layer CRUD/reorder, object add/remove/move/reshape, composite, `SetTankDimensions` (with object position clamping + restore-on-undo envelope), and `SetTankStyle` (whole-style replacement with hex / gradient validation).
- `libs/rendering/renderer-api/` + `libs/rendering/renderer-2d/` — `SceneRenderer` interface + `Canvas2DRenderer`. Draws background (color / gradient / none; image stubbed for F6.3) → grid → tank outline → water tint → frame overlay. DPR-aware, idempotent, listener-clean on dispose. `hitTest` returns `null` until F3.3.
- `libs/platform/{platform-api, platform-web, platform-electron}/` — interfaces (with an Angular `InjectionToken` sub-entry) + in-memory stubs. The Electron stub routes through an `ElectronTransport` seam ready for F1.4 to plug in real IPC.
- `libs/state/` — first NgRx feature (`scene`): generic `dispatchCommand` → effect → `applyCommandSucceeded({ scene, history })`, `commandRejected({ reason, message })`, undo/redo actions, plus a metadata-only `setTankPresetRef` side-edit that bypasses the Command pipeline. `provideSceneStore()` composes the feature into the composition root.
- `libs/features/tank-setup/` — Angular standalone component. Preset picker (ADA Mini-S / Mini-M / 60-P / 90-P / 120-P + standard US 10/20H/40B gallons), custom W×H×D form with cm/in/mm toggle (storage is integer mm; the toggle is display-only), aspect-ratio warning outside [0.3, 4.0], plus a styling subpanel: frame picker (Rimless / Black-rimmed / Braced labels mapped to the schema enum), water tint hex + presets, background tabs (None / Solid / Gradient / Image-disabled-for-F6.3). Angle is exposed in degrees in the UI and converted to radians on dispatch.

Empty placeholders (stage-gated implementation):

- `libs/domain/{document, catalog, growth-sim}/` — Stages 1 (F1.3), 2, 4.
- `libs/rendering/renderer-3d/` — Stage 10.
- `libs/features/{editor-shell, substrate-tool, hardscape-tool, planting-tool, layers-panel, templates, export, livestock-equipment}/` — Stages 1–7.
- `libs/ui/`, `libs/testing/` — populated as the features that need them land.
- `apps/web-e2e/`, `apps/desktop-e2e/` — Playwright + Playwright-Electron specs from Stage 1 onward.

Shared infrastructure:

- `tools/` — workspace tooling: `scaffold-libs.cjs` (lib scaffolder), `validate-example.mjs` (AJV-based check that `example.aqua.json` validates against `aqua-document.schema.json`; F1.3 will subsume it).
- `docs/decisions/` — four foundational ADRs (Electron tooling, pnpm, Jest coverage, Nx Cloud deferral).
- `plans/` — per-feature implementation plans (one `F<X.Y>` file per feature, grouped by stage).
- `.claude/` — nine project sub-agent definitions (`scene-model-engineer`, `renderer-engineer`, `electron-platform-engineer`, `angular-feature-engineer`, etc.) plus team playbooks.
- `.github/workflows/` — PR workflow (nx affected lint + test + build, plus a coverage gate that runs `domain` + `rendering` + `platform-{web,electron}` + `state` + every implemented `features-*` lib with `--configuration=ci` so the per-lib 90% thresholds fire) and a main workflow (full ubuntu/macos/windows matrix).

## Architecture

See [`aquascape-development-plan.md`](./aquascape-development-plan.md) (the spec) and [`CLAUDE.md`](./CLAUDE.md) for the load-bearing decisions and the Stage 0 deliverables reference. Highlights:

- **One scene model, two renderers.** `domain/scene-model` is framework-free. `renderer-2d` ships now; `renderer-3d` (Three.js, Stage 10) drops in over the same `SceneRenderer` interface and the *same* canonical 3D coordinates already stored in `.aqua` documents. This is the abstraction the plan's payoff is bet on.
- **Every mutation is a `Command`** with `apply` / `invert`. Undo/redo, persistence, and future collaboration all build on this single primitive — the UI never mutates the scene directly.
- **One feature codebase, two apps.** Features depend on `platform-api` (interface) — never a concrete platform. `apps/web` injects `platform-web`; `apps/desktop` injects `platform-electron`. The same Angular feature libs power both shells.
- **Layering is mechanical.** Nx tags in every `project.json` + `@nx/enforce-module-boundaries` in `eslint.config.cjs` enforce plan §2.2. A `features/*` lib that tries to import `platform-electron` fails `nx lint`.

## Document format

The `.aqua` v1 format is defined by [`aqua-document.ts`](./aqua-document.ts) (TypeScript source of truth) and [`aqua-document.schema.json`](./aqua-document.schema.json) (JSON Schema for runtime validation). A worked example lives in [`example.aqua.json`](./example.aqua.json). v1 is still in flight — F1.2 added a `gradient` variant to `TankStyle.background` and the example was updated to showcase it. **Once F1.3 ships the loader + `Migration` chain, v1 is locked**: any further additions require a Migration entry. These files move into `libs/domain/document/` when F1.3 lands.

## License

MIT.
