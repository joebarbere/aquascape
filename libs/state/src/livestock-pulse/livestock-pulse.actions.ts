// Livestock pulse — transient, fire-and-forget UI signals to the
// `LivestockSimulationService` that do NOT mutate the document.
//
// Stage 11 F11.4 Wave 4 introduces the first member: `Feed Tank`. The user
// clicks the "Feed tank" button in the livestock inventory panel; the
// service hears the action, spawns N FoodSprite ECS entities at the water
// surface, and the FeedingSystem (already shipped in Wave 3) does the rest.
//
// Why a dedicated slice (no reducer, no selectors, no state):
//   - The pulse carries NO document state — sprites live in the ECS world
//     for 30 s and self-despawn via FoodSpriteLifetimeSystem. Persisting
//     them in NgRx would duplicate the source of truth.
//   - Routing through `SceneActions.dispatchCommand` would be wrong: there
//     is no `Command` to undo (a "Feed tank" gesture isn't reversible — the
//     fish have already been fed in-sim), and the scene-model graph is
//     unchanged.
//   - Living alongside the other action groups in `libs/state/` keeps the
//     consumer (`LivestockSimulationService` via `@ngrx/effects` `Actions`)
//     and any future producer (e.g. an electron menu item, a keyboard
//     shortcut handler, a Playwright test gesture) speaking the same typed
//     vocabulary.
//
// Determinism note: the action stream itself is non-deterministic in real
// usage (the user clicks when they click). Tests that need replay-equivalent
// behaviour MUST dispatch in a fixed order; the service uses `tickPrng` for
// the per-sprite position draws on top of `world.tickCounter`, so two
// dispatches at the same tick produce the same sprite distribution.

import { createActionGroup, props } from '@ngrx/store';

export const LivestockPulseActions = createActionGroup({
  source: 'Livestock Pulse',
  events: {
    /**
     * Fire-and-forget — request the simulation service drop food sprites
     * at the water surface. `spriteCount` is optional; when omitted the
     * service picks a deterministic random count in `[3, 6]` via tickPrng
     * so two dispatches at the same world.tickCounter produce the same
     * sprite count. Pass an explicit count to force a specific number
     * (tests + future "feed N pellets" UI controls).
     */
    'Feed Tank': props<{ spriteCount?: number }>(),
  },
});
