# Game-controller (gamepad) support

**Type:** Input (apps/web + renderer-3d).
**Owner:** `angular-feature-engineer` (the input service + routing) + `renderer-engineer` (camera mapping).
**Status:** Not started.

## Goal

Broad game-controller support — drive the 3D camera, the game-mode player fish, and basic UI with a
gamepad, covering the common controllers (Xbox / DualShock·DualSense / Switch Pro / generic) via the
W3C Standard Gamepad mapping, with a graceful fallback for non-standard pads.

## Spec reference

The Web Gamepad API (browser + Electron Chromium renderer). Drives the existing `Orbital3DControls`
camera seam (`libs/rendering/renderer-3d/src/three-3d-renderer.ts`) and the **planned** Stage 16
player-velocity seam ([`stage-16-game-modes.md`](stage-16-game-modes.md) F16.1, which already calls
for "keyboard/gamepad → velocity"). Mirrors the existing keyboard `@HostListener`s in
`apps/web/src/app/app.component.ts`.

## Dependencies

**Requires:** nothing new (the camera seam is shipped). **Enables:** Stage 16 player control (this is
the input device that feeds it). Today there is **no Gamepad API usage anywhere** and no central
input service — input is scattered across HostListeners + OrbitControls.

## Scope

### In

- **`GamepadService`** (`apps/web/src/app/input/gamepad.service.ts`, `providedIn:'root'`):
  - `gamepadconnected` / `gamepaddisconnected` window events + **per-frame `navigator.getGamepads()`
    polling** (gamepad state must be polled, not event-driven) on the existing render RAF or its own
    loop.
  - Normalize to a `GamepadState` via the **Standard mapping** (16 buttons + 4 axes): face buttons
    (A/B/X/Y), bumpers, triggers, D-pad, sticks (+ clicks), start/select. Apply **deadzones**, **edge
    detection** (`justPressed`/`justReleased`), and a configurable **sensitivity/invert**.
  - **Broad support:** handle `gamepad.mapping === 'standard'` precisely; fall back to a sane
    raw-axes/buttons default when `mapping` is empty (non-standard pads) so they're still usable.
  - Optional **haptics** via `gamepad.vibrationActuator` (feedback for game modes).
- **Context routing** (keyed off `ViewModeService` + the app/game mode):
  - **3D / simulation (orbit):** right stick → `Orbital3DControls.rotateBy`, left stick → `panBy`,
    triggers/bumpers → `zoomBy`, a face button → `resetView`.
  - **Fish-eye / game modes:** left stick → player movement (feeds the Stage 16 player-velocity
    injection); face buttons → game actions.
  - **UI:** a button toggles the console; D-pad/buttons navigate (parity with the keyboard HostListeners).
- A small **"controller connected"** indicator + a minimal settings affordance (deadzone / invert-Y).

### Out

- On-screen remapping UI (a later add — ship the Standard mapping + a config object first).
- Steam Input / vendor SDKs — the Web Gamepad API is enough for broad coverage.

## Acceptance criteria

- [ ] Connecting a controller is detected (indicator shows); a standard pad orbits + zooms the 3D
      camera (sticks/triggers) and resets the view (a button).
- [ ] In a game mode (Stage 16), the left stick moves the player fish (camera follows).
- [ ] A non-standard pad still moves the camera via the raw-axes fallback (no crash).
- [ ] Deadzones suppress stick drift; `justPressed` fires once per press (no key-repeat unless held).
- [ ] Works in both the browser and the Electron desktop build.

## Testing

- **Unit:** the pure mapping + deadzone + edge-detect helpers against synthetic `Gamepad` objects
  (button arrays + axes); the context-routing selector (mode → action set).
- **Manual:** with a real controller in web + Electron (Playwright can't readily emulate gamepads —
  mark this manual; the pure helpers carry the automated coverage).

## Notes

Keep the raw polling + mapping in a small pure module so it's testable without the browser; the
service is the thin Angular wrapper. Document the gamepad→player-velocity contract alongside the
Stage 16 determinism seam (`docs/caveats/livestock-ecs.md` / the game-modes caveat) — controller
input is "live input into the deterministic world", same class as keyboard. A new
`docs/caveats/input.md` (or a section in app-shell) captures the routing + deadzone defaults.
