# Stage 14 — Fish vitality & feeding (food types, health, hunger)

**Stage:** 14 — Fish vitality & feeding.
**Owner:** `growth-sim-engineer` / domain-sim (the `livestock-ecs` components + systems) +
`angular-feature-engineer` (vitality HUD).
**Status:** Not started.

## Goal

Make feeding meaningful: several **food types** with distinct drop behaviour, and fish that have
**health (hearts) + a hunger/food meter** driven by feeding and water quality — surfaced as a HUD
panel + click-to-inspect (not per-fish shader bars).

## Spec reference

Extends Stage 11 F11.4 feeding (`libs/domain/livestock-ecs/src/lib/feeding-system.ts`:
`FoodSprite{lifetime,calories}`, the hunger drive, oto algae-rasp). Consumes Stage 13 water quality.
Respects the livestock shader's **16-vertex-attribute ANGLE ceiling**
(`docs/caveats/livestock-ecs.md`).

## Dependencies

**Requires:** Stage 11 feeding (shipped); Stage 13 F13.4 `food` catalog kind + F13.1 water quality
(for the water→health link). **Enables:** Stage 15 (the feeding action tool reuses typed-food spawn)
and Stage 16 (feeding/survival game modes use food + health).

## Substages

### F14.1 — Food types + animated drop
Extend `FoodSprite` with a `foodType` (+ nutrition from the `food` catalog row) and per-type **sink
behaviour**: flakes float then sink slowly, pellets sink fast, wafers settle on the substrate, live
food darts. A typed-spawn path on `LivestockSimulationService` (position + type) replacing the
random scatter as the primitive (Stage 15 places the drop; the existing "feed tank" stays as a
quick random scatter).

### F14.2 — Health + hunger components
Add `HealthDrive { health: f32 }`; extend the existing hunger in `FeedingDrive`. Wiring (all via
deterministic `tickPrng`, never `Math.random`, keyed by `spawnIndex`):
- Hunger rises over time; eating resets it (existing).
- **Starvation** (sustained high hunger) → health decays.
- **Water quality** (Stage 13 ammonia/nitrite) → health decays; clean water → slow recovery.
New system slotted after `feedingSystem` in `world.ts` `step()`.

### F14.3 — Surfacing vitality (HUD + inspector)
Add `health` + `hunger` slabs to `WorldSnapshot`. Render as a **HUD vitality panel** (school
averages: avg/min health, % hungry) + **click-to-inspect a fish** (its hearts + hunger), modelled on
the simulation info HUD + the behavior-debug inspector. **No per-fish floating bars** — the fish
shader is already at the 16-attribute limit, so per-instance bars would risk a zero-fish-render
regression; the HUD/inspector route avoids new vertex attributes entirely. (Game modes reuse this for
the player fish.)

### F14.4 — Waste → chemistry loop
Uneaten food (despawned) + fish waste feed the Stage 13 ammonia source term, closing the
feed → waste → bioload → nitrogen loop. A small per-tick waste accumulator the `WaterChemistryService`
reads.

## Scope

**Out:** per-fish floating health bars (deferred unless an attribute is freed up — see the
livestock-ecs caveat's attribute-budget note); fish breeding/death (a later stage).

## Acceptance criteria

- [ ] Different food types fall + are eaten differently (surface vs substrate feeders find their
      food); same seed ⇒ byte-identical feeding over a 1000-tick replay.
- [ ] Starving fish lose health; well-fed fish in clean water recover; dirty water lowers health.
- [ ] The vitality HUD shows live school health/hunger; clicking a fish shows its values.
- [ ] Feeding raises waste → ammonia in the Stage 13 model.

## Testing

- **Unit (≥90%):** the health/hunger system (deterministic given inputs); food-type sink params;
  the 1000-tick replay byte-identity gate (per the livestock-ecs caveat).
- **Component:** the vitality HUD renders from a snapshot; the inspector from a picked entity.
- **E2E (real-GPU loop):** drop typed food, assert fish converge + the HUD health/hunger updates.

## Notes

Mind the determinism + 16-attribute caveats in `docs/caveats/livestock-ecs.md` (update it with the
HealthDrive component + the "vitality is HUD-surfaced, not a vertex attribute" decision). The
`WorldSnapshot` additions follow the existing slab + pooling pattern in `world.ts`.
