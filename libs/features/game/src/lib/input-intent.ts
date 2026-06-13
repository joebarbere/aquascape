// Input-intent layer (Stage 16 F16.1).
//
// The abstraction that separates "what the player wants to do" from "which
// device produced it". Features consume an `InputIntent` — a normalised move
// vector + a set of action flags — never raw keyboard / gamepad events. Two
// backends can produce the SAME intent shape:
//
//   - the keyboard backend (`keysToIntent`, shipped in F16.1), and
//   - a future W3C Gamepad-API backend (the separate "game-controller support"
//     plan plugs in here — it maps Standard-mapping axes/buttons + a
//     non-standard fallback into this same `InputIntent` and the game shell is
//     none the wiser).
//
// PURE + framework-free. No DOM, no Angular, no `navigator.getGamepads()`. The
// Angular `GameInputService` (the app/feature layer) owns the actual keyboard
// listener + the rAF gamepad poll; it feeds raw state into these pure mappers.
// Keeping the mapping pure makes both backends unit-testable against one
// `InputIntent` contract.

/**
 * A device-independent statement of player intent for one frame.
 *
 * `move` is a 3D vector in the player's intent space, each component in
 * `[-1, 1]`:
 *   - `x` — strafe / surge along the tank width (+ = right toward +x).
 *   - `y` — ascend / descend (+ = up).
 *   - `z` — forward / back into the tank depth (+ = into the screen, toward +z).
 *
 * The magnitude is the throttle (an analogue stick reads its deflection;
 * a keyboard reads 0 or ±1 per axis). The mapping to a world velocity (mm/s)
 * is done by `intentToVelocity`, which clamps the magnitude to ≤ 1 so a
 * diagonal keyboard press isn't faster than a cardinal one.
 *
 * `actions` are momentary action flags — true while the corresponding control
 * is held this frame. The set is intentionally small + game-agnostic in F16.1;
 * the individual game modes (16.2–16.5) interpret them (e.g. `primary` =
 * drop food in feeding, lunge in predator).
 */
export interface InputIntent {
  readonly move: { readonly x: number; readonly y: number; readonly z: number };
  readonly actions: {
    /** Primary action — held while the main action control is down. */
    readonly primary: boolean;
    /** Secondary action — a modifier / alternate control. */
    readonly secondary: boolean;
    /** Pause / menu request (Esc / Start). The shell turns this into a state event. */
    readonly pause: boolean;
  };
}

/** The neutral intent — no movement, no actions. */
export const NEUTRAL_INTENT: InputIntent = {
  move: { x: 0, y: 0, z: 0 },
  actions: { primary: false, secondary: false, pause: false },
};

/**
 * A snapshot of which logical controls are currently held. The keyboard
 * backend builds this from a held-key `Set`; a future gamepad backend would
 * build the same shape from button states. Kept separate from `InputIntent`
 * so the device-binding (which physical key/button maps to which logical
 * control) lives in ONE place per backend.
 */
export interface HeldControls {
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
  readonly forward: boolean;
  readonly back: boolean;
  readonly primary: boolean;
  readonly secondary: boolean;
  readonly pause: boolean;
}

/** All-false held-controls — the resting state. */
export const NO_CONTROLS_HELD: HeldControls = {
  left: false,
  right: false,
  up: false,
  down: false,
  forward: false,
  back: false,
  primary: false,
  secondary: false,
  pause: false,
};

/**
 * The default keyboard binding: which `KeyboardEvent.code` values map to which
 * logical control. `code` (physical key, layout-independent) is used rather
 * than `key` so WASD works on AZERTY / Dvorak too. Arrow keys mirror WASD for
 * movement; Space / Shift are the actions; Escape is pause.
 *
 * Exported so the app layer can show a key-binding hint and so tests can drive
 * the exact codes.
 */
export const DEFAULT_KEY_BINDINGS: Readonly<Record<keyof HeldControls, readonly string[]>> = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  forward: ['KeyE', 'PageUp'],
  back: ['KeyQ', 'PageDown'],
  primary: ['Space'],
  secondary: ['ShiftLeft', 'ShiftRight'],
  pause: ['Escape'],
};

/**
 * Resolve a set of held `KeyboardEvent.code` strings into the logical
 * `HeldControls` shape, using `DEFAULT_KEY_BINDINGS` (or a caller-supplied
 * binding map). Pure — the Angular service maintains the live `Set<string>`
 * of currently-down codes and calls this each frame.
 */
export function keysToHeldControls(
  heldCodes: ReadonlySet<string>,
  bindings: Readonly<Record<keyof HeldControls, readonly string[]>> = DEFAULT_KEY_BINDINGS,
): HeldControls {
  const anyHeld = (codes: readonly string[]): boolean => codes.some((c) => heldCodes.has(c));
  return {
    left: anyHeld(bindings.left),
    right: anyHeld(bindings.right),
    up: anyHeld(bindings.up),
    down: anyHeld(bindings.down),
    forward: anyHeld(bindings.forward),
    back: anyHeld(bindings.back),
    primary: anyHeld(bindings.primary),
    secondary: anyHeld(bindings.secondary),
    pause: anyHeld(bindings.pause),
  };
}

/**
 * Collapse opposed control pairs into a normalised `InputIntent`. Holding
 * both `left` and `right` cancels to 0 on that axis (no jitter). This is the
 * single mapper both the keyboard backend and a future gamepad backend feed —
 * the gamepad would skip `keysToHeldControls` and build `HeldControls`
 * (or directly a `move` vector) from analogue axes, but converge on the same
 * `InputIntent` here.
 */
export function heldControlsToIntent(held: HeldControls): InputIntent {
  const axis = (neg: boolean, pos: boolean): number => (pos ? 1 : 0) - (neg ? 1 : 0);
  return {
    move: {
      x: axis(held.left, held.right),
      y: axis(held.down, held.up),
      z: axis(held.back, held.forward),
    },
    actions: {
      primary: held.primary,
      secondary: held.secondary,
      pause: held.pause,
    },
  };
}

/**
 * Keyboard convenience: held codes → `InputIntent` in one call. The app layer's
 * `GameInputService` calls this each frame with its live held-code set.
 */
export function keysToIntent(
  heldCodes: ReadonlySet<string>,
  bindings: Readonly<Record<keyof HeldControls, readonly string[]>> = DEFAULT_KEY_BINDINGS,
): InputIntent {
  return heldControlsToIntent(keysToHeldControls(heldCodes, bindings));
}

/**
 * Map an `InputIntent`'s move vector to a world-space velocity (mm/s) for the
 * player fish, suitable for `LivestockWorld.setPlayerVelocity`. This is the
 * input → velocity mapping the spec calls out.
 *
 * Behaviour:
 *   - The move vector's magnitude is clamped to ≤ 1 BEFORE scaling, so a
 *     diagonal keyboard press (|move| = √2) isn't faster than a cardinal one.
 *   - The clamped vector is scaled by `speedMmPerSec`.
 *   - A zero move vector yields a zero velocity (the player stops dead — the
 *     game loop wants direct control, not momentum, for F16.1; per-mode
 *     inertia can layer on later).
 *
 * Coordinate note: `move` axes are already aligned with the canonical doc
 * coordinate axes (x = width, y = up, z = depth), so no rotation is applied
 * here. A future fish-eye-relative control scheme (steer relative to the
 * camera's heading) would compose a rotation before this call.
 */
export function intentToVelocity(
  intent: InputIntent,
  speedMmPerSec: number,
): { x: number; y: number; z: number } {
  const { x, y, z } = intent.move;
  const mag = Math.hypot(x, y, z);
  if (mag === 0) return { x: 0, y: 0, z: 0 };
  // Clamp the magnitude to 1 so diagonals aren't faster than cardinals.
  const scale = (mag > 1 ? 1 / mag : 1) * speedMmPerSec;
  return { x: x * scale, y: y * scale, z: z * scale };
}
