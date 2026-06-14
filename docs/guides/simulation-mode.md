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
- A live **water-chemistry** block (Stage 13 F13.3 / F13.5b): a **cycle badge** (uncycled / cycling / cycled) + a **test-kit readout** — the classic colour-chart for ammonia · nitrite · nitrate · pH, each row showing the value, a colour swatch on the kit's chart scale (API Freshwater Master ranges), and a **safe / caution / danger** verdict. These advance in real time as the chemistry tick runs (see "The live nitrogen cycle" below).
- The **livestock manifest** (species × quantity) and the **equipment list**.

### 2. Control HUD — top-left (interactive)

Point-and-click controls that mutate the live scene:

- **Lighting** slider (day ↔ night).
- **Water level** slider.
- **Water change** (Stage 13 F13.5b): `Change 25%` / `Change 50%` buttons. A water change dispatches the undoable `WaterChange` Command (mutating `Tank.waterChemistry` when the tank tracks it) **and** dilutes the **live runtime** `WaterState` via `WaterChemistryService.applyWaterChange` — the same pure `applyWaterChange` helper the command uses, so the live ammonia/nitrate drop immediately and fish health responds. (A water change dilutes the water column only; the bacterial colony lives on surfaces, so cycling is **not** reset.)
- **Livestock** rows with `−` / `+` quantity steppers and `✕` remove, plus an **Add species** dropdown.
- **Add items**: `+ Rock`, `+ Wood`, `+ Plant`, `+ Decor` (each drops a random one in).
- **Dose nutrient**: a category filter, a nutrient picker (with a colour swatch), an amount stepper (pre-filled with the product's representative dose), and a **Dose** button. Picks from the ~30 real `nutrient` catalog products. **Recorded only** — the dose is appended to the scene's dose log via the `DoseNutrient` command; the actual water-chemistry effect is deferred pending `domain/water-sim` (Stage 13).
- **Reset scene**.

### 3. Vitality HUD — left-middle (read-only, click-to-inspect)

Stage 14 F14.3. Surfaces the fish school's **vitality** straight from the live
simulation (the per-fish `health` + `hunger` the F14.2 vitality system drives):

- **School summary**: **avg health**, **min health**, and **% hungry** —
  recomputed ~12× a second. "Hungry" means a fish at/above the feeding
  seek-threshold (the level at which a fish actively goes looking for food), so
  the count tracks the fish that are out foraging. The stats turn amber/red as
  health drops.
- **Selectable fish list**: one row per fish (id · archetype · health % · a ⚠
  hunger flag). The marked **player fish** (game modes) shows a ★.
- **Click-to-inspect**: click (or focus + Enter/Space) a row to inspect that
  fish — its **health hearts** (a 5-pip ♥ readout off the [0,1] health scale)
  and a **hunger meter**. The inspector updates live as the picked fish's
  vitality changes.

> **Why a list, not a click-on-the-fish?** The 3D view is read-only — the
> renderer's `hitTest` returns null and it doesn't expose its live camera, so
> there's no reliable canvas raycast to a fish. The selectable list is the
> deterministic, keyboard-operable picker; the inspector itself is
> camera-independent, so a future canvas picker could feed the same selection.
> Per-fish **floating health bars are deliberately NOT used** — the fish shader
> sits at the GPU's 16-vertex-attribute ceiling, so vitality is HUD-surfaced
> rather than a per-instance attribute (see `docs/caveats/livestock-ecs.md`).

Hide it with `hud hide vitality` (or `hud hide all`).

### The live nitrogen cycle (Stage 13 F13.3)

Simulation mode runs a **live water-chemistry tick** (`WaterChemistryService`) that
advances the deterministic [`domain/water-sim`](../architecture/water-sim.md) model
over the showcase's time axis. It closes the husbandry loop end-to-end:

> **feed → waste → ammonia → fish health**

Each tick reads the world's waste source term (`world.getWasteSourceN()` — a per-fish
baseline **plus** decay from uneaten food you drop with "Feed tank"), advances the
nitrogen cycle (ammonia → nitrite → nitrate), and pushes the resulting water quality
back into the simulation so **fish health responds** (the vitality HUD reflects it):
overfeed a fresh, uncycled tank and ammonia climbs, stressing the fish; let a stocked
tank run and the bacterial filter establishes, ammonia + nitrite fall to safe, and the
**cycle badge** moves uncycled → cycling → cycled while **nitrate accumulates** (the
husbandry signal a **water change** resets — see below).

A **water change** (the `Change 25%` / `Change 50%` control-HUD buttons or the
`water change <pct>` console verb — Stage 13 F13.5b) dilutes the live water column:
ammonia / nitrite / nitrate drop in proportion to the fraction replaced, and the test-kit
readout + the vitality response follow immediately. Cycling is **not** reset — the
nitrifying bacteria live on surfaces (filter media, substrate), not in the water, so the
colony + the cycling clock are preserved (an honest aquarium fact baked into the shared
`applyWaterChange` helper).

**Time is accelerated** so cycling is visible in **minutes, not weeks**: the ~6-week
hobby cycle window elapses in ~2 real minutes. The acceleration is presentational — the
model stays honest per simulated week, and the run is deterministic from the scene
`seed` (same seed + same tick count ⇒ same chemistry).

> In the **editor** (not simulation mode) the same model is driven by the **time
> slider** instead: scrub weeks 0–52 to preview the cycle ahead of time, surfaced by a
> minimal cycle badge beside the slider **and** the full **Water test** panel in the
> right rail — the test-kit colour-chart readout (ammonia / nitrite / nitrate / pH) plus
> a water-change control that dispatches the undoable `WaterChange` Command. Same model,
> same seed — one previews, the other ticks live.

### 4. Action HUD — bottom-center (hands-on husbandry tools)

Stage 15. A row of **square, rounded-border tool buttons** pinned to the lower
middle of the view — the hands-on husbandry surface. It's a `role="toolbar"`
(arrow-key navigable, each button a labelled toggle); selecting a tool opens its
inline panel above the bar.

**Feeding tool (F15.1):**

1. Click **Feed** → a **food-type picker** appears (the catalog `food` entries —
   each with a colour swatch, name, and form: flake / pellet / wafer / live).
2. Pick a food → the picker is replaced by a **"Click the tank to drop …"**
   prompt, and a small ring **drop-preview marker** follows your cursor over the
   3D canvas.
3. **Click the 3D canvas** → typed food drops at that exact point. The click
   pixel is ray-cast to the substrate floor (`raycastTankPoint`), so the food
   lands where you aimed; the fish find it and feed. Keep clicking to drop more.
4. **Change** (in the prompt) returns to the picker; **Esc** cancels the tool
   (a second Esc then exits simulation mode).

This is the **precise** feed — drop food exactly where you want it. The quick
**Feed tank** scatter on the control HUD (random surface drops) is unchanged for
a fast top-up.

**Water-change tool (F15.2):**

A guided **4-step** flow in the same bar — a real partial water change:

1. Click **Water change** → a **replacement-water form** appears (temperature /
   pH / hardness for the new water). Adjust the fields, then **Next: place
   siphon**.
2. **Place the siphon** → a draggable **siphon nozzle** mounts in the 3D view.
   **Drag on the 3D canvas** to position it near the surface; the drag pixel is
   ray-cast to the **water plane** (`raycastTankPoint({ plane: 'water' })`) and
   the nozzle follows. Placing it enables the OUT button.
3. **Siphon out** → the nozzle's drain mode lights up; the **water level drops**
   (`SetWaterLevel`) and ammonia / nitrite / **nitrate** dilute toward clean
   source water. You can watch the test-kit **nitrate** reading fall in the
   info HUD.
4. **Siphon in fresh water** → the nozzle's fill mode lights up; the **level
   rises back** to where it was and the chemistry **lerps toward the
   replacement** params you chose. **Done** closes the tool.

OUT then IN = a real partial water change. Each step dispatches the undoable
`WaterChange` Command **and** drives the live runtime
(`WaterChemistryService.applyWaterChange`), both reusing the single
`applyWaterChange` dilution helper — so the readout + fish respond immediately
and **undo reverses** the level + chemistry mutations. A water change dilutes the
water column only; the bacterial colony lives on surfaces, so cycling is **not**
reset. The siphon nozzle is the renderer's shared `SiphonTool` (the Stage 16
cleaner mode reuses it, no fork). **Esc** cancels the tool (a second Esc exits
simulation mode), parking the nozzle.

Hide the bar with `hud hide actions` (or `hud hide all`).

### 5. The console — bottom-left (the CLI) ⌨️

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

| Command | Usage                                                                   | What it does                                                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `help`  | `help [command]`                                                        | List all commands, or show usage for one.                                                                                                                                                                       |
| `clear` | `clear`                                                                 | Clear the console output.                                                                                                                                                                                       |
| `close` | `close`                                                                 | Close the console (same as `~` / Esc).                                                                                                                                                                          |
| `hud`   | `hud <show\|hide\|toggle> <info\|controls\|clock\|perf\|vitality\|actions\|all>` | Show / hide / toggle HUD surfaces (or sub-elements). `actions` is the bottom-center husbandry tool bar.                                                                                                          |
| `light` | `light <midnight\|dawn\|day\|dusk\|0..1>`                               | Set the day/night phase (word or a 0–1 fraction).                                                                                                                                                               |
| `water` | `water <mm\|auto>`                                                      | Set the water level in mm, or `auto` for the default fill.                                                                                                                                                      |
|         | `water test`                                                            | Print the test-kit readout (ammonia · nitrite · nitrate · pH + safe/caution/danger band).                                                                                                                       |
|         | `water change <pct>`                                                    | Water change of `<pct>` % (default 25). Dispatches the undoable `WaterChange` Command **and** dilutes the live runtime (one `applyWaterChange` helper). `change` / `test` / `auto` Tab-complete.                |
| `fish`  | `fish list`                                                             | List the stocked species + quantities.                                                                                                                                                                          |
|         | `fish add <species> [qty]`                                              | Add a species (default qty 5). `<species>` is fuzzy — a name or id fragment.                                                                                                                                    |
|         | `fish remove <species>`                                                 | Remove a stocked species.                                                                                                                                                                                       |
|         | `fish set <species> <qty>`                                              | Set a stocked species' quantity (0 removes it).                                                                                                                                                                 |
| `item`  | `item add <rock\|wood\|plant\|decor>`                                   | Drop a random catalog item of that kind into the tank.                                                                                                                                                          |
| `dose`  | `dose list`                                                             | List every catalog nutrient (name · category · representative dose).                                                                                                                                            |
|         | `dose <product> [amount]`                                               | Dose a nutrient. `<product>` is fuzzy (id or name fragment, Tab-completes). `amount` defaults to the product's representative dose, and may carry a unit suffix (`2ml`, `0.6g`). **Recorded only** (see below). |
| `reset` | `reset`                                                                 | Reload the pristine showcase scene.                                                                                                                                                                             |
| `sim`   | `sim save <name>`                                                       | Save the **current** scene as a named simulation (overwrites if it exists).                                                                                                                                     |
|         | `sim load <name>`                                                       | Load a saved simulation. `sim load demo` loads the built-in showcase.                                                                                                                                           |
|         | `sim list`                                                              | List simulations (the built-in `demo` + your saved ones).                                                                                                                                                       |
|         | `sim delete <name>`                                                     | Delete a saved simulation.                                                                                                                                                                                      |

### Dosing nutrients (recorded only)

The **Dose** control HUD group and the `dose` console verb both add a real
aquarium nutrient / additive (dry fertiliser salts, all-in-one liquids, liquid
carbon, conditioners, remineralizers, buffers, bacteria) from the catalog. Both
resolve the catalog `nutrient` row and dispatch the **`DoseNutrient`** command
through the normal NgRx + Command pipeline (so it's undoable like any other
mutation).

> **Recorded only — chemistry deferred.** `DoseNutrient` appends a `DoseEvent` to
> the runtime `scene.doseLog` (with linearly-scaled per-axis ppm/dGH deltas for
> products that publicly **disclose** them, and a qualitative `affects` list for
> proprietary ones — no fabricated numbers). It does **not** yet move any
> water-chemistry parameter: the canonical `Tank.waterChemistry` state is a Stage
> 13 (`domain/water-sim`) addition that hasn't shipped. A future water-sim reads
> the dose log to apply the actual effect.

`dose` fuzzy-matches the product the same way `fish` matches species:
`dose easy-green`, `dose nutrient.aio.easy-green`, and `dose easy` (if
unambiguous) all resolve to the same product; an ambiguous token lists the
candidates. Tab-completes over nutrient ids + names.

```text
> dose list                  # list every nutrient
> dose easy-green            # dose Easy Green at its representative dose
> dose kno3 0.6              # 0.6 g of dry KNO3
> dose excel 2ml             # 2 ml of liquid carbon (unit suffix optional)
```

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
> dose easy-green             # dose a nutrient (recorded only)
> water 540                   # raise the water line to 540 mm
> water test                  # print the test-kit readout + bands
> water change 50             # 50% water change (dilutes live nitrate/ammonia)
> light dusk                  # warm, low evening light
> hud hide controls           # hide the left control panel
> hud toggle vitality         # flip the fish-vitality HUD (left-middle)
> hud hide actions            # hide the bottom-center husbandry tool bar
> hud toggle perf             # flip the FPS strip on the info HUD
> hud hide all                # hide every HUD for a clean capture
> hud show all                # bring them back
> reset                       # start over from the showcase default
```

---

## Game modes (Stage 16)

Alongside `simulation`, the launch system has a **game** family —
`?mode=game:<submode>` in a browser, `--mode game:<submode>` on the desktop —
where you **control a fish** instead of just watching the tank. The four
sub-modes are `survival`, `feeding`, `predator`, and `cleaner`. They share one
shell (`@aquascape/features/game`): an objective/score HUD, a state machine
(objective → playing → paused → won/lost → results), and a device-independent
input layer. **All four modes are fully playable** (F16.2 / F16.3 / F16.4 /
F16.5 — see below) — Stage 16 is complete.

### Survival — flee the predators (F16.2)

In `game:survival` you are **prey**. Roaming **predators hunt you** — the same
`FearSystem` proximity path the showcase uses — and you flee with the keyboard,
using hardscape as cover. The HUD shows a **countdown** plus a **health** and a
**stamina** bar; **survive 90 seconds** to win. You **lose** if a predator gets
within the catch radius (90 mm), if your stamina runs out (it drains while a
predator looms within 280 mm and recovers when you're safe), or if your Stage 14
**health** hits zero (e.g. a fouled tank). Your **score** is the whole seconds
survived. The pure rules (caught/threat detection, stamina, win/lose) live in
`@aquascape/features/game` → `survival-rules.ts`; the world reads + the
win/lose dispatch live in `SurvivalGameService` (`apps/web/src/app/game/`). If
the loaded tank has no predators of its own, the service quietly promotes the
few fish farthest from you to roaming hunters at the start (and demotes them on
exit) so there's always a threat. The service **mutates nothing** in the sim
each frame (it only reads), so non-game worlds still replay byte-identically.

### Feeding — eat the falling food (F16.3)

In `game:feeding` typed food (flakes) **falls from the surface** and you eat it
by **swimming into it**. Each bite **fills a food meter** (the HUD's "Food" bar)
and scores a point; **fill the meter to 90 %** to win. But don't **gorge** — a
bite taken while the meter is already full is wasted and **costs** a point (it
also fouls the tank, the same over-feeding loop the live chemistry models). The
meter slowly **drains** over time, so keep eating. You **lose** if your Stage 14
**health** starves to zero, or if the 60-second clock expires below target. The
pure rules (eat detection, meter fill/drain, bite scoring, win/lose) live in
`@aquascape/features/game` → `feeding-rules.ts`; the food drop + the eaten-sprite
despawn + the win/lose dispatch live in `FeedingGameService`
(`apps/web/src/app/game/`). The drop + despawn happen between sim ticks (gated on
your live position; drop columns come from a service-local PRNG, never the sim
core), kept out of the deterministic sim core.

### Predator — hunt the prey (F16.4)

In `game:predator` you ARE the predator. The player fish is flagged with the
existing `Predator` tag, so prey **flee from you** via the same `FearSystem`
proximity risk that already drives the showcase's roaming predator. Swim within
the catch radius (90 mm) of a prey fish and you **eat it** — it vanishes and your
**score** (= catches) ticks up. The HUD shows a **countdown**; **catch 8 prey
before the 60-second clock runs out** to win, otherwise you lose. The pure rules
(catch detection, win/lose, countdown) live in
`@aquascape/features/game` → `predator-rules.ts`; the catch loop + the despawn +
the win/lose dispatch live in `PredatorGameService`
(`apps/web/src/app/game/`). The catch/despawn happens between sim ticks (gated on
your live position), kept out of the deterministic sim core — so non-game worlds
still replay byte-identically.

### Cleaner — scrub the tank (F16.5)

In `game:cleaner` you wield a **cleaning tool** and **clean the tank**. Press
**`T`** to cycle the active tool — a glass **scraper** (clears green-spot +
diatom), a stiff **brush** (clears black-beard + hair off hardscape), or the
gravel **siphon** (lifts settled waste). **Hold Space** near a rock/wood surface
to scrub its algae away with the active tool; the more **effective** the tool,
the faster it clears. The siphon **reuses Stage 15's nozzle** (no fork) — when
it's the active tool the nozzle hangs at your position and **vacuums waste**,
diluting the live tank chemistry (the same dilution the water-change tool uses).
The HUD's "Food" bar becomes a **cleanliness meter** and your **score** is the
tank's clean-percent (0–100). **Win** by cleaning the tank below the algae target;
**lose** if the 90-second clock runs out while it's still dirty. The active
tool's name + a hint show in a corner indicator. The pure rules (reach detection,
tool→algae mapping, rasp amount, cleanliness scoring, win/lose) live in
`@aquascape/features/game` → `cleaner-rules.ts`; the algae rasp + the waste
dilution + the win/lose dispatch live in `CleanerGameService`
(`apps/web/src/app/game/`). The rasp happens between sim ticks (gated on your
live position + held button), kept out of the deterministic sim core — so
non-game worlds still replay byte-identically.

### Trying it

- Browser / dev server: `http://localhost:4200/?mode=game:predator`
  (or `…/?mode=game:cleaner`, etc.).
- Desktop: `aquascape --mode game:predator` (or the **Mode → Game** menu).

### What activation does (the flow)

`AppComponent.enterGameMode(<submode>)` mirrors the showcase activation, plus
the player seam:

```
enterGameMode('predator')
  ├─ load createShowcaseScene()         deterministic tank + fish (reused, not a fork)
  ├─ ViewModeService.forceMode('fish-eye')   3D, camera rides the player
  ├─ store.dispatch(setScene)           → LivestockSimulationService re-spawns the world
  ├─ pickPlayerEntity(world) → world.setPlayer(eid)   one fish becomes YOU (snapshot index 0)
  ├─ GameModeService.startGame() + dispatch('start')  → live "playing" loop
  ├─ per-mode rules service (one of):
  │    predator → PredatorGameService.start  tags YOU a predator → prey flee; catch detection
  │    survival → SurvivalGameService.start  promotes hunters; caught/stamina/health win-lose
  │    feeding  → FeedingGameService.start   drops food; eat-by-proximity fills the meter
  │    cleaner  → CleanerGameService.start   resolves cleaning tools; scrub algae / siphon waste
  └─ GameInputService.start(sink, frameHook)   per-frame keyboard → velocity → world,
                                               + the per-mode rules hook
```

### Controls (keyboard)

`WASD` / arrows strafe + ascend/descend, `Q`/`E` (or `PageUp`/`PageDown`) move
into/out of the tank depth, `Space` / `Shift` are the (mode-specific) action
buttons, `Esc` exits. In **cleaner** mode, `T` cycles the active cleaning tool
(scraper → brush → siphon) and `Space` is the "use tool" / scrub button.
Bindings are keyed by `KeyboardEvent.code` so they work on any layout. A **gamepad** backend plugs into the same input layer later (the
separate "game-controller support" plan) — the shell + scoring are unchanged.

### The input loop (where the player velocity is injected)

`GameInputService` (app layer — `apps/web/src/app/game/`) owns the keyboard
listener + a `requestAnimationFrame` loop. Each frame it: resolves held key
codes → an `InputIntent` (`keysToIntent`) → pushes it onto `GameModeService`
(which derives a world velocity via `intentToVelocity`, scaled by the sub-mode's
player speed) → pushes that velocity onto `world.setPlayerVelocity(...)`. The
velocity is only **stored** there; the world applies it at the very **top of
`world.step()`**, before any AI system runs (the `SteeringIntegrator` skips the
player so behaviours never fight the input). So the rAF rate (≈60 Hz) is
independent of the sim step rate (30 Hz) — whatever velocity is current when
`step()` runs is what the player integrates. The live velocity is the **one**
non-deterministic input; the scene, player selection, and sim are all
seed-deterministic.

## Exiting simulation mode

**Esc** is the exit key, and what it does depends on how you got into simulation mode:

| You launched…                            | Esc…                                                                                                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--mode simulation` kiosk (desktop)      | **Quits the app** — there's nothing to return to.                                                                                                                                  |
| Entered simulation via the **Mode** menu | **Returns to the editor** (and exits fullscreen).                                                                                                                                  |
| `?mode=simulation` in a browser tab      | Tries to close the tab; if the browser refuses, reveals the editor with the scene still loaded.                                                                                    |
| `--mode game:<submode>` / `?mode=game:…` | Same split: kiosk quits; menu-entered returns to the editor; browser tab tries to close then reveals the editor (the player tag is relinquished so the world replays clean again). |

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
