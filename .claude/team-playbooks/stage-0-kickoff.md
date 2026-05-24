# Stage 0 kickoff — provided for completeness; sub-agents preferred

> **Recommendation:** For Stage 0 specifically, use the sub-agent pattern (the main session dispatches `Task(subagent_type=…)` calls in sequence) rather than spawning a team. The reasoning is at the bottom of this file. The kickoff prompt is included here for the case where you want the team experience anyway.

---

## Kickoff prompt (paste into an interactive Claude Code session)

```text
Start an agent team to execute Stage 0 of the Aquascape development plan
(see ./aquascape-development-plan.md §"Stage 0 — Foundation & Walking Skeleton").

The goal is a walking skeleton: an empty editor rendering a tank on a canvas
in both the web and Electron apps, with CI green and module-boundary
enforcement in place.

Spawn these teammates from the sub-agent definitions in .claude/agents/:

  1. nx-workspace-engineer  — LEAD. Scaffolds the Nx monorepo per plan §2.1,
     wires module-boundary tags per plan §2.2, configures CI (lint, unit,
     build, affected graph, OS matrix) per plan §3. Owns F0.1 and F0.7.
     Blocks everyone else until the workspace exists.

  2. scene-model-engineer   — Implements domain/geometry (Vec2, transforms,
     AABB, hit-test primitives, golden-ratio/rule-of-thirds helpers) and
     domain/scene-model (Scene, Layer, SceneObject, Command interface,
     undo/redo stack). Owns F0.2 and F0.3. Starts as soon as the workspace
     lands; must coordinate with renderer-engineer on the Scene/Layer shape
     before F0.4 begins.

  3. renderer-engineer      — Implements renderer-api (the SceneRenderer
     interface) and the minimal renderer-2d that draws a tank rectangle
     and grid. Owns F0.4. Depends on scene-model's Scene/Viewport types.

  4. electron-platform-engineer — Implements platform-api (the interface
     library) plus stub platform-web and platform-electron (in-memory) and
     wires apps/desktop's Electron main + preload with the secure defaults
     (context isolation on, sandbox on, typed preload bridge). Owns F0.5
     and the Electron half of F0.6.

  5. angular-feature-engineer — Wires apps/web (the canvas-host shell that
     attaches renderer-2d to a canvas element). Owns the web half of F0.6.

  6. test-engineer         — Writes the Stage 0 tests per plan §"Stage 0
     Testing": geometry math unit tests, command apply/invert + undo/redo
     ordering tests, and E2E specs that boot web and Electron and verify
     a tank is visible plus the IPC handshake works.

Coordination contract:

  - nx-workspace-engineer goes first. No other teammate touches code
    until the workspace and module-boundary tags are in place.
  - scene-model-engineer and renderer-engineer must negotiate the
    SceneRenderer interface and the Scene/Viewport types together before
    renderer-2d implementation begins. Surface the agreed types to the
    rest of the team via the shared task list.
  - electron-platform-engineer and angular-feature-engineer can work in
    parallel once the workspace exists; they meet at the apps/desktop
    integration where Electron loads the web build.
  - test-engineer writes tests in parallel as each lib lands. The Stage 0
    milestone is gated on the e2e specs passing in both apps.

Definition of Done for the milestone:

  - `nx graph` shows the expected dependency graph from plan §2.1.
  - `nx affected -t lint test build` passes on a fresh clone.
  - Module-boundary lint blocks a deliberate violation in a test PR.
  - `apps/web` and `apps/desktop` both boot to a window showing a tank.
  - Update CLAUDE.md's "Development commands" section with the real
    commands that now exist.

When the team is done, the lead session reports back with: the commit(s)
created, the test results, and any deviations from the plan that warrant
flagging.
```

---

## Why sub-agents are the better default for Stage 0

1. **The critical path is single-threaded.** Nothing else can happen until the Nx workspace exists (F0.1). After that, the fan-out is well-defined and small (3–4 parallel lanes). You don't need teammates pinging each other to discover that; the plan already says it.

2. **The interfaces are dictated by the plan, not negotiated.** `SceneRenderer`, the layering rules, the platform abstraction, the directory structure — all spec'd in `aquascape-development-plan.md` §2. Teams shine when there's genuine ambiguity to resolve. Stage 0 has very little.

3. **Determinism matters most at the foundation.** Every later stage builds on what Stage 0 produces. You want the result to land in the _exact_ shape the plan calls for. The main session dispatching specialist sub-agents with deliberate prompts gives you more control than a self-coordinating team.

4. **Agent teams are still experimental.** Anchoring a fresh project's foundation on an experimental harness feature is the wrong place to take that risk. The sub-agents are stable, committed to the repo, and reproducible across contributors.

5. **Cost.** Team coordination has token overhead — multiple sessions, message passing, task-list maintenance. Stage 0 is mostly mechanical scaffolding where that overhead buys nothing.

### When teams _do_ shine in this project

Save the team pattern for stages where multiple specialists must agree on a fresh contract:

- **Stage 4 — Planting + growth-sim + layers.** Four areas have to align on the growth API, scatter contract, layer semantics, and seeding scheme simultaneously. See [`stage-4-planting-and-growth.md`](stage-4-planting-and-growth.md).
- **Stage 9 — AI render providers.** Designing one `RenderProvider` interface that fits both a local on-device model and a hosted bring-your-own-key API, with secure key handling in Electron and a stub-friendly Angular panel, is exactly the kind of cross-functional design problem a team handles well.
- **Stage 10 — 3D renderer adoption test.** The renderer-engineer ⇄ scene-model-engineer ⇄ aqua-document-guardian negotiation is the final exam for the architecture's abstractions. Worth a team to flush out any leakage.
