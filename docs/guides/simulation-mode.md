# Simulation mode & the launch-mode system

Aquascape can boot into different **launch modes** — profiles that change how
the app presents itself. Today there are two:

| Mode         | What it is                                                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normal`     | The full editor (the default). What you get if you launch the app with no mode flag.                                                                                                                                                                    |
| `simulation` | A borderless-fullscreen **showcase**: the 3D view, a packed sample tank, and on-screen HUDs + a developer console for tweaking the scene live. Built for kiosks, screenshots, recordings, and quick demos. The built-in scene is the `demo` simulation. |

> **Looking for the internals / gotchas?** This page is the user + author guide.
> The load-bearing implementation rules live in
> [`docs/caveats/app-modes.md`](../caveats/app-modes.md).

---

## Launching simulation mode

There are three ways in, depending on where you're running:

| Where                    | How                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Desktop (Electron)**   | `aquascape --mode simulation` (packaged). In dev: append `--mode simulation` to the electron invocation, e.g. `DEV_SERVER_URL=http://localhost:4200 electron dist/apps/desktop/main/src/main/main.js --mode simulation`. |
| **Browser / dev server** | Visit `http://localhost:4200/?mode=simulation` (works under `nx serve web`, in any browser, and in e2e).                                                                                                                 |
| **At runtime (desktop)** | Use the **Mode** application menu → **Simulation** (and **Normal Editor** to switch back).                                                                                                                               |

The desktop launch (`--mode simulation`) opens a **frameless, fullscreen** window. A
runtime switch via the menu can't remove the window frame (Electron fixes that
at window creation), so a menu-entered simulation is fullscreen-but-framed.

---

## What you see in simulation mode

A full-bleed **3D render** of a large showcase tank (a 1500 × 600 × 600 mm /
~518 L six-foot show tank — hardscape, multi-layer planting, decor, and four
mid-water schooling shoals), with the editor chrome stripped away and three
overlays:

### 1. Info HUD — top-right (read-only)

- A live **date / clock**.
- A **performance strip**: FPS · frame time · live entity count · bubble count, sampled twice a second.
- The **tank spec**: dimensions, volume (L + US gal), frame, water line, substrate, and object counts.
- The **livestock manifest** (species × quantity) and the **equipment list**.

### 2. Control HUD — top-left (interactive)

Point-and-click controls that mutate the live scene:

- **Lighting** slider (day ↔ night).
- **Water level** slider.
- **Livestock** rows with `−` / `+` quantity steppers and `✕` remove, plus an **Add species** dropdown.
- **Add items**: `+ Rock`, `+ Wood`, `+ Plant`, `+ Decor` (each drops a random one in).
- **Reset scene**.

### 3. The console — bottom-left (the CLI) ⌨️

A **Quake-style developer console**. See the next section.

Every change made through the control HUD or the console flows through the same
NgRx + Command pipeline the editor uses, so the **3D renderer and the fish
simulation react immediately** (add a fish → the shoal re-spawns with the new
count; add a rock → it appears and the fish treat it as cover).

---

## The console (CLI)

> The console is the most powerful way to drive simulation mode — it does everything
> the control HUD does, plus HUD show/hide, and is keyboard-only.

### Opening & closing

| Key                      | Action                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| **`~`** (backtick/tilde) | Toggle the console open/closed. Works whether it's open or shut. |
| **Esc**                  | Close the console (a second Esc then exits simulation mode).     |
| **Enter**                | Run the typed command.                                           |
| **↑ / ↓**                | Walk your command history.                                       |
| **Tab**                  | Complete the command name.                                       |

The console slides up from the bottom-left, auto-focuses its input, and keeps
its output log + history for the whole session (it doesn't reset when you close
and reopen).

### Command reference

Grammar is simple: `command [args…]`, whitespace-separated. Run `help` any time.

| Command | Usage                                                         | What it does                                                                 |
| ------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `help`  | `help [command]`                                              | List all commands, or show usage for one.                                    |
| `clear` | `clear`                                                       | Clear the console output.                                                    |
| `close` | `close`                                                       | Close the console (same as `~` / Esc).                                       |
| `hud`   | `hud <show\|hide\|toggle> <info\|controls\|clock\|perf\|all>` | Show / hide / toggle HUD surfaces (or sub-elements).                         |
| `light` | `light <midnight\|dawn\|day\|dusk\|0..1>`                     | Set the day/night phase (word or a 0–1 fraction).                            |
| `water` | `water <mm\|auto>`                                            | Set the water level in mm, or `auto` for the default fill.                   |
| `fish`  | `fish list`                                                   | List the stocked species + quantities.                                       |
|         | `fish add <species> [qty]`                                    | Add a species (default qty 5). `<species>` is fuzzy — a name or id fragment. |
|         | `fish remove <species>`                                       | Remove a stocked species.                                                    |
|         | `fish set <species> <qty>`                                    | Set a stocked species' quantity (0 removes it).                              |
| `item`  | `item add <rock\|wood\|plant\|decor>`                         | Drop a random catalog item of that kind into the tank.                       |
| `reset` | `reset`                                                       | Reload the pristine showcase scene.                                          |
| `sim`   | `sim save <name>`                                             | Save the **current** scene as a named simulation (overwrites if it exists).  |
|         | `sim load <name>`                                             | Load a saved simulation. `sim load demo` loads the built-in showcase.        |
|         | `sim list`                                                    | List simulations (the built-in `demo` + your saved ones).                    |
|         | `sim delete <name>`                                           | Delete a saved simulation.                                                   |

### Saving your own simulations

`demo` is the **built-in** simulation — the showcase scene you start in. It's
always loadable (`sim load demo`) and can't be overwritten or deleted. To make
your own, `sim save <name>` snapshots **whatever the tank looks like right
now** — so the workflow is: tweak the scene (with the control HUD or the
`fish` / `item` / `water` / `light` commands), then bank it:

```text
> fish set neon 80
> item add wood
> water 560
> light dusk
> sim save sunset-jungle      # snapshot the current scene
> reset                        # back to the showcase default
> sim load sunset-jungle      # ...and bring your version back
> sim list                    # see everything you've saved
```

Saved simulations are **persisted** (IndexedDB in the browser/PWA, an on-disk JSON
store on the desktop) and survive restarts — build up a library and load them
in later sessions. Names may contain spaces; `sim save` over an existing name
updates it.

**Fuzzy species matching:** `fish add neon`, `fish add neon-tetra`, and
`fish add livestock.fish.neon-tetra` all resolve to the same species. If a token
matches several (e.g. `fish add tetra`), the console lists the candidates so you
can disambiguate.

### Examples

```text
> help
> fish add cardinal 24        # add 24 cardinal tetras
> fish set neon 50            # bump neon tetras to 50
> fish remove harlequin       # remove the harlequin rasboras
> item add rock               # drop in a random rock
> water 540                   # raise the water line to 540 mm
> light dusk                  # warm, low evening light
> hud hide controls           # hide the left control panel
> hud toggle perf             # flip the FPS strip on the info HUD
> hud hide all                # hide every HUD for a clean capture
> hud show all                # bring them back
> reset                       # start over from the showcase default
```

---

## Exiting simulation mode

**Esc** is the exit key, and what it does depends on how you got into simulation mode:

| You launched…                            | Esc…                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `--mode simulation` kiosk (desktop)      | **Quits the app** — there's nothing to return to.                                               |
| Entered simulation via the **Mode** menu | **Returns to the editor** (and exits fullscreen).                                               |
| `?mode=simulation` in a browser tab      | Tries to close the tab; if the browser refuses, reveals the editor with the scene still loaded. |

(If the console is open, the first Esc closes it; the second does the above.)

On the desktop the **main process owns Esc** so it works even if the renderer is
busy. Quitting a kiosk uses `app.quit()` (not just closing the window) so it
fully exits on every platform.

---

## How the mode system works (architecture)

A quick map; the full rules + gotchas are in
[`docs/caveats/app-modes.md`](../caveats/app-modes.md).

```
aquascape --mode simulation
  └─ main: parseAppMode()                         apps/desktop/src/main/app-mode.ts
       ├─ frameless fullscreen BrowserWindow      apps/desktop/src/main/main.ts
       └─ webPreferences.additionalArguments      → forwards the mode to the preload
            └─ preload: window.aquascape.mode      apps/desktop/src/preload/preload.ts
                 └─ renderer: resolveAppMode()      apps/web/src/app/app-mode.ts  (also reads ?mode=)
                      └─ AppComponent.enterSimulationMode(): load showcase + force 3D + HUDs + console
```

- **Mode flag transport** is `webPreferences.additionalArguments` (the
  canonical way to hand a value to a sandboxed preload) — **not** a new IPC
  channel, and the security-asserted `buildWebPreferences` is left untouched.
- **Runtime switching** (the Mode menu) pushes the new mode main → renderer over
  the `app.mode.set` channel; the preload re-exposes it as a narrow `onSetMode`
  subscription the renderer wires to enter/leave the showcase.
- **The showcase scene** (`createShowcaseScene()`) is deterministic — stable ids
  - a seeded PRNG — so every launch is byte-identical and the fish simulation
    reproduces exactly.
- **HUD/console code** lives in `apps/web/src/app/simulation/`:
  `simulation-hud.component` (info), `simulation-controls.component` (controls),
  `simulation-console.component` + `simulation-console.service` (the CLI),
  `simulation-ui.service` (HUD/console visibility), `simulation-scene-ops.ts` (shared scene
  mutations), `simulation-perf.service` (the perf sampler), `simulation-clock.ts`.

### Adding a console command

1. Add an entry to the `commands` array in
   [`simulation-console.service.ts`](../../apps/web/src/app/simulation/simulation-console.service.ts)
   with `{ name, summary, usage, run(args) }`.
2. `run` returns `ConsoleLine[]` (use the `out(...)` / `err(...)` helpers).
   Mutate the scene via `this.dispatch(<command>)` (the scene-model command
   factories), drive lighting via `this.dayNight`, or toggle HUDs via `this.ui`.
3. It shows up in `help` and Tab-completion automatically.
4. Add a case to `simulation-console.service.spec.ts`.
