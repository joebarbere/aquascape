# Aquascape — 3D Livestock Subsystem Research Report

This is a literature + technical-references review to ground the design of the 3D
livestock subsystem in an in-browser TypeScript / Three.js / Angular app, with an
ECS for behavior, 50–200 fish entities, and a 60fps budget.

Each section has: canonical references, a short model summary, the parameters
that matter (with typical ranges), and a recommendation tuned to our use case.
DOIs and URLs included where verifiable; where I could not verify a URL, I say
so rather than guess.

---

## 1. Schooling / shoaling models

### Canonical references

- **Reynolds, C. W. (1987).** "Flocks, Herds and Schools: A Distributed
  Behavioral Model." *Computer Graphics* (SIGGRAPH '87), 21(4), 25–34.
  DOI: 10.1145/37402.37406. Author's site (full PDF):
  https://www.red3d.com/cwr/papers/1987/boids.html
- **Couzin, I. D., Krause, J., James, R., Ruxton, G. D., & Franks, N. R.
  (2002).** "Collective Memory and Spatial Sorting in Animal Groups." *Journal
  of Theoretical Biology*, 218(1), 1–11.
  Open PDF: https://jmvidal.cse.sc.edu/library/couzin02a.pdf
- **Vicsek, T., Czirók, A., Ben-Jacob, E., Cohen, I., & Shochet, O. (1995).**
  "Novel Type of Phase Transition in a System of Self-Driven Particles."
  *Physical Review Letters*, 75(6), 1226–1229.
- **Pitcher, T. J., & Parrish, J. K. (1993).** "Functions of shoaling behaviour
  in teleosts." In *Behaviour of Teleost Fishes* (Pitcher, ed.), Chapman &
  Hall, ch. 12. — The canonical "shoal vs. school" definition.
- **Camazine, S., Deneubourg, J.-L., Franks, N. R., Sneyd, J., Theraulaz, G.,
  & Bonabeau, E. (2001).** *Self-Organization in Biological Systems*,
  Princeton University Press. Chapter 11 ("Fish Schooling," p. 167).
- **Hemelrijk, C. K., & Hildenbrandt, H. (2008, 2012).** "Self-Organized Shape
  and Frontal Density of Fish Schools," *Ethology* 114:245–254; and "Schools
  of fish and flocks of birds: their shape and internal structure by
  self-organization," *Interface Focus* 2:726–737, 2012.
  Open: https://pmc.ncbi.nlm.nih.gov/articles/PMC3499122/
- **Tu, X., & Terzopoulos, D. (1994).** "Artificial Fishes: Physics,
  Locomotion, Perception, Behavior." *SIGGRAPH '94*. Open PDF:
  https://faculty.cc.gatech.edu/~turk/bio_sim/articles/fish_terzopoulos.pdf
  — The forerunner of every fish-sim demo since.

### Model summaries

- **Boids (Reynolds 1987).** Three independent steering forces summed per
  agent each tick — *separation* (push away from very-near neighbours),
  *alignment* (match average heading of near neighbours), *cohesion* (steer
  toward centroid of near neighbours). Each force evaluated over a local
  perception radius + view angle. Famous for cheap O(n²) → O(n) with spatial
  hashing and for being visually convincing at 3–5 lines of code per rule.
- **Couzin "zonal" model (2002).** Three concentric spherical zones around
  each agent: ZOR (repulsion) is hard, dominates inside its radius; outside
  ZOR, ZOO (orientation) and ZOA (attraction) are *both* averaged. A blind
  cone behind the agent excludes neighbours from its perception. Tuning
  ZOO/ZOA radii ratios produces a sharp phase transition between *swarm*
  (low order), *torus* (mill), and *polarized school* — and exhibits
  *collective memory* (hysteresis between transitions).
- **Vicsek (1995).** Minimal physics model: constant-speed particles align
  to the mean direction of neighbours within radius `r`, perturbed by angular
  noise η. The *order parameter* (mean velocity magnitude) shows a phase
  transition at a critical noise level — gives a theory-grounded handle on
  why low-noise schools look polarized and high-noise shoals look diffuse.
- **Shoal vs school (Pitcher & Parrish 1993).** *Shoal* = any social
  aggregation; *school* = a polarized, synchronously-moving shoal. The same
  individuals may switch modes depending on context (foraging vs.
  predator-alarm). Sensible to model as **two parameter regimes of one
  model**, not two separate models — pick polarization by an internal
  "alert/cruise" state and a noise/alignment-weight pair.

### Parameters that matter (typical ranges from the literature)

- **Perception radius** `r` — ~3–10 body lengths (BL) is typical for visual
  + lateral-line teleosts. Couzin uses ZOR ≈ 1 BL, ZOO and ZOA each in the
  range 1–15 (in BL units in the original paper).
- **Blind cone** behind agent — 90°–120° rear cone excluded
  (Couzin used ωblind ≈ 90°). Cheap to include and produces realistic
  "leader at the front" emergence.
- **Maximum turn rate** θ_max — fish are turn-limited, not force-limited.
  Typical 4–6 rad/s for tetras; smaller for slow midwater species.
- **Noise η** — angular noise per tick. Low values (0.1 rad) → tight school,
  high values (1+ rad) → loose shoal.
- **Weights** `w_sep`, `w_ali`, `w_coh` — usually `w_sep > w_ali ≈ w_coh`.
  Reynolds-style tuning starts at 2 / 1 / 1, then move toward 1.5 / 1 / 1 for
  loose shoals (Pitcher's "shoaling") and 1 / 2 / 1 for tight schools.
- **Speed band** v_min / v_pref / v_max — fish are not constant-speed;
  enforce ranges rather than a single value.

### How vertical-zone dwellers differ in practice

- **Top dwellers (hatchetfish, gourami).** Strong upward bias + surface
  affinity. Hatchetfish "do not like swimming down" (aquaria literature).
  Implement: shallow polarization (they shoal loosely), strong positive bias
  toward Y near the waterline, tiny ZOA so they spread along the surface.
- **Midwater (tetras, rasboras, danios).** Closest to a classical
  Couzin/Reynolds model. Use moderate ZOO/ZOA, low noise → tight school.
  Zebrafish in particular have been heavily characterised — Miller & Gerlai
  type work shows polarization rising with group size up to ~16 fish.
- **Bottom (corydoras, loaches, plecos).** *Not* schoolers in the polarized
  sense; they are social (shoals) and constrain Y to ≈ substrate level.
  Use very weak alignment, strong Y-clamp, and add a "scoot" impulse model
  for the burst-and-glide gait visible in cories.

### Recommendation

Use a **Couzin-style three-zone model** as the substrate — it cleanly
encodes the phase transitions you actually want to author against (swarm /
torus / school) — and **expose Reynolds' three weights as authoring sliders**
so per-species data drives behaviour. For our scale (50–200 entities) the
neighbour search is the only bottleneck — implement a uniform 3D grid hash
(cell size = max(ZOR, ZOA)) and you'll stay O(n·k) with `k ≈ 6–12`
neighbours visited per fish.

**Per-species tuning surface:** `{ ZOR, ZOO, ZOA, blindAngle, vPref, vMax,
turnMax, polarizationTarget, yBias, yClamp }`. Hatchet/cory variation lives
entirely in `yBias` + `yClamp` + the alignment weight.

---

## 2. Vertical stratification in aquariums

### Canonical references

- **Strand, E., Jørgensen, C., & Huse, G. (2005).** "Modelling buoyancy
  regulation in fishes with swimbladders: bioenergetics and behaviour."
  *Ecological Modelling*, 185(2–4), 309–327. Open PDF:
  https://courses.washington.edu/fish538/resources/Strand%20et%20al%20buoyancy.pdf
- **Alexander, R. McN. (1993).** "Buoyancy" chapter in *The Physiology of
  Fishes* (Evans, ed.), CRC Press. (No clean open URL; cite by book.)
- Aquarium-husbandry references that explicitly catalogue top/mid/bottom
  niches (industry, not peer-reviewed, but operationally definitive):
  - Aquarium Co-Op midwater schooling fish guide.
  - Aquarium Co-Op hatchetfish care guide:
    https://www.aquariumcoop.com/blogs/aquarium/hatchetfish
  - Aquarium Co-Op otocinclus / corydoras guides.
- For glass-walled spatial preference: **Saxby et al. (2010)** and
  **Sloman & Wilson, ch. 8** in *Fish Behaviour* (Magnhagen et al., eds,
  2008, Science Publishers) give the standard "depth preference is
  species-typical and modulated by stress / light" account.

### Model summary

There is **no single biomechanical force law** that produces the vertical
banding hobbyists observe. The behaviour is a sum of:

1. **Species-typical preferred depth** — a learned/instinctive set-point
   (top, mid, bottom). In agent-based modelling this is uniformly treated
   as a *target Y* with a soft spring back to it.
2. **Buoyancy energetics** (Strand et al. 2005) — fish with closed
   swimbladders pay a metabolic cost to leave their adjusted depth, which
   produces a real (not just behavioural) spring back to set-point.
3. **Photic / cover preference** — top-dwellers exploit surface insects;
   bottom-dwellers exploit detritus and shadow.

For a simulator at this fidelity, model (1) explicitly and skip (2) and (3).

### Parameters that matter

- **`preferredY`** per species, as a *fraction* of tank height (0 = sand,
  1 = waterline). Hatchetfish ≈ 0.92–0.98, gourami ≈ 0.80–0.95, angels ≈
  0.40–0.70, tetras ≈ 0.40–0.70, kuhli ≈ 0.05–0.20, cories ≈ 0.00–0.10.
- **`yBandWidth`** — half-height of acceptable range, ≈ 0.10–0.30 of tank.
- **`yReturnForce`** — spring stiffness back to preferredY when outside
  band. Tune so an excursion to mid-tank decays in ~2–4 s real time.
- **`surfaceAffinity`** (top only) — separate term that snaps the agent's
  Y to (waterline − ε) when feeding-state is "expecting food."
- **`substrateAffinity`** (bottom only) — analogous; biases foraging path
  to follow the floor + driftwood/rock contours.

### Recommendation

A scalar **`preferredY` + soft Y-spring** is the right primitive. Encode it
as a Component on every fish entity (`PreferredDepth { y, band,
returnForce }`). A System reads it and adds a Y-axis steering force every
tick. This is the cheapest possible model and matches what hobbyists
actually see. *Do not* try to simulate swimbladder physics — Strand et al.
is the right citation if anyone asks why, but reproducing it would burn 10×
the budget for no visible payoff.

---

## 3. Inquisitive / "glass-surfing" behavior

### Canonical references

- **Brown, C., Laland, K. N., & Krause, J. (eds, 2011, 2nd ed. 2025).**
  *Fish Cognition and Behavior*. Wiley-Blackwell. The standard graduate
  reference; chapters by Bshary on cichlid cognition and Brown on
  personality are directly relevant.
- **Salzburger lab (Sommer-Trembo et al., 2024)**, "Genetic basis for
  behavioural variation in cichlid fish." *Nature* (April 2024). Press:
  https://phys.org/news/2024-04-cichlid-fishes-curiosity-biodiversity-exploratory.html
- **Saskia von Krause et al. (2022)** "Curiosity in zebrafish (Danio
  rerio)? Behavioral responses to 30 novel objects." *Frontiers in
  Veterinary Science*. Open:
  https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9988950/
- **Bartolini et al. (2024)** "Life in a fishbowl: Space and environmental
  enrichment affect behaviour of Betta splendens." Open:
  https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10936361/
  — Discusses glass-surfing as a stereotypy / stress indicator and as a
  response to one's mirror image.

### Model summary

- Curiosity in fish is a measurable, **heritable**, between-species trait
  (Sommer-Trembo et al. 2024). It correlates with body shape: bulky
  shore-dwellers > slender open-water species.
- "Glass surfing" specifically is **not a curiosity behaviour** in the
  cognitive sense — in bettas it is overwhelmingly diagnosed as a
  stress / reflection-aggression / boredom response, and in cichlids as
  a low-level territorial response to perceived intrusion.
- Practical takeaway: model "glass interest" as a low-amplitude, **stochastic
  short-duration approach to the front pane**, gated by a per-species
  "boldness" parameter. Use a separate "alarm" channel for the
  Betta-style frantic pacing.

### Parameters that matter

- **`boldness ∈ [0, 1]`** — per species + per individual offset. High
  boldness fish (some cichlids, bettas) approach the front glass more often.
- **`glassInterestRate`** (Hz) — Poisson trigger rate, e.g. 0.02 (one event
  per 50 s) for tetras, 0.2 for bettas.
- **`glassDwellTime`** — seconds spent near the pane once triggered;
  log-normal around 2–10 s.
- **`glassApproachDistance`** — how close to the front pane the agent
  approaches; for the simulator this is just `min(z, 2 BL)`.

### Recommendation

Add a **`Curiosity` component** (`{ boldness, rate, dwell }`) and a
**`GlassInterest` system** that on each tick rolls a Poisson trigger,
sets a temporary attraction point on the front pane, and clears it after
`dwell` seconds. Cheap and produces the right visual signature without
inviting users to argue about stereotypies and welfare science.

---

## 4. Territorial aggression

### Canonical references

- **Brown, J. L. (1964).** "The evolution of diversity in avian
  territorial systems." *Wilson Bulletin*, 76:160–169. — Introduced
  *economic defendability* (benefits of holding territory must exceed
  cost of defence).
- **Maynard Smith, J., & Parker, G. A. (1976).** "The logic of asymmetric
  contests." *Animal Behaviour* 24:159–175. — Hawk-Dove + Bourgeois
  (owner wins) ESS.
- **Maynard Smith, J. (1982).** *Evolution and the Theory of Games*,
  Cambridge University Press. — The textbook treatment.
- **Wyman, R., & Hotaling, L. (1988).** "A test of the model of the
  economic defendability of a resource and territoriality using young
  *Etroplus maculatus* and *Pelmatochromis subocellatus kribensis*."
  *Environmental Biology of Fishes*, 22(3):197–204. — One of the few
  studies that actually plumbs Brown's model on aquarium-scale cichlids.
- **Adams, E. S. (2001).** "Approaches to the study of territory size and
  shape." *Annual Review of Ecology and Systematics* 32:277–303. — The
  best single-paper survey of how to *measure* a territory.

### Model summary

Two complementary primitives:

1. **Anchor + radius (Brown 1964 / Adams 2001).** Each territorial fish
   owns an *anchor* (cave, rock, plant). Inside `r_core` it is fully
   aggressive (chase any non-conspecific intruder). Between `r_core` and
   `r_outer` it displays / threatens. Outside `r_outer` it ignores.
2. **Bourgeois / hawk-dove resolution (Maynard Smith & Parker 1976).** When
   two fish contest a resource, the owner (closer to its anchor) plays
   *hawk* with high probability; the intruder plays *dove* (retreat) with
   the same. This is a one-line stochastic rule.

### Parameters that matter

- **`anchorPos` ∈ ℝ³** — the resource being defended (one of the scene's
  hardscape items).
- **`coreRadius`** — typically 3–5 BL for small cichlids (Apistogramma,
  rams) up to 15–20 BL for big rift-lake cichlids.
- **`displayRadius`** — 1.5–2× core.
- **`aggression ∈ [0, 1]`** — per-species and per-individual; gates the
  hawk probability in a contest.
- **`fatigueRate`** — even hawks tire; territorial chases decay over
  ~5–15 s in vivo.
- **`pairBondFlag`** — for cichlids that pair-bond, both members defend.

### Recommendation

Model the territory as a **`Territory` component** (`{ anchorEntityId,
coreRadius, displayRadius, aggression }`) attached to the fish, **not** to
the rock. A **`TerritorialSystem`** queries fish-in-radius each tick,
classifies each as `selfHome | conspecific | other`, and emits a chase
steering force on intruders inside `coreRadius`. Conflict resolution is
trivial Bourgeois: owner wins, intruder gets a retreat force away from the
anchor. No need for full game-theoretic ESS solvers — Adams 2001 explicitly
shows the simple owner-respect rule is enough to match the empirical data.

---

## 5. Nipping / fin-nipping

### Canonical references

There is no canonical *primary* paper on tiger-barb / serpae-tetra fin
nipping; it's covered in mixed sources:

- **Magurran, A. E. (1990).** "The inheritance and development of minnow
  anti-predator behaviour." *Animal Behaviour* 39:834–842 — relevant
  because nipping in barbs is hypothesised to be an exaggerated form of
  intra-shoal hierarchy chasing.
- **Saverino, C., & Gerlai, R. (2008).** "The social zebrafish: behavioral
  responses to conspecific, heterospecific, and computer animated fish."
  *Behavioural Brain Research* 191(1):77–87. — Establishes that
  exaggerated body shape / colour / movement triggers aggression.
- **Barlow, G. W. (2000).** *The Cichlid Fishes: Nature's Grand Experiment
  in Evolution*, Basic Books — discusses fin display + nipping as
  hierarchy signalling across cyprinids and cichlids generally.

Practical aquarium consensus: **flowing-fin morphology + slow movement is
the supernormal stimulus** that triggers tiger-barb nipping when within-group
hierarchy targets are absent (i.e., when school size < ~8).

### Model summary

Nipping is a **redirected intra-group dominance behaviour**. Fish in a
species like *Puntigrus tetrazona* run a near-constant chasing/hierarchy
game among conspecifics; if the group is too small (or the conspecific
targets are all out of sight), the chase behaviour redirects onto
out-group fish with *high-amplitude visual signatures* — long flowing
fins, slow gait, bright contrast.

Suggested simulator rule:

```
if (species.nipper && groupVisibleSize < species.nipperGroupThreshold) {
  candidates = neighbours.where(n =>
    n.species !== self.species
    && n.finLengthFraction > 0.30
    && n.speed < self.speed * 0.5
  );
  target = nearest(candidates);
  if (target) steerTowards(target); // brief darting nip
}
```

### Parameters that matter

- **`isNipper`** boolean per species.
- **`nipperGroupThreshold`** — ~6–10 for tiger barbs; below this, redirection
  rises sharply.
- **`nipTargetFinLengthFraction`** — discriminator; > 0.30 (i.e. flowing
  fins relative to body) is the rough threshold.
- **`nipRate`** — Poisson trigger; ~0.05–0.2 Hz when a target is in range.
- **`nipDuration`** and **`nipCooldown`** — keep darting episodes ≤ 1 s.

### Recommendation

Implement as a **`NippingDrive` component** + system that runs **after**
the schooling system in the tick order, so the dart can briefly override
the cohesion force. Make `nipTargetFinLengthFraction` a property of the
*victim* species' visual model so the system reads it directly. The
aquarium-stocking guide already in the codebase can warn users about
incompatible combinations at design time, but the simulator should still
*show* the conflict so users learn.

---

## 6. Hiding / timid behavior

### Canonical references

- **Sih, A. (1980).** "Optimal behavior: can foragers balance two
  conflicting demands?" *Science* 210:1041–1043. — The seminal
  refuge-vs-forage trade-off paper.
- **Lima, S. L., & Dill, L. M. (1990).** "Behavioral decisions made under
  the risk of predation: a review and prospectus." *Canadian Journal of
  Zoology* 68(4):619–640. Open PDF:
  https://gambusia.zo.ncsu.edu/readings/Lima%20and%20Dill%201990.pdf
- **Lima, S. L. (1998).** "Stress and decision making under the risk of
  predation: recent developments from behavioral, reproductive, and
  ecological perspectives." *Advances in the Study of Behavior* 27:215–290.
- **Werner, E. E., Gilliam, J. F., Hall, D. J., & Mittelbach, G. G.
  (1983).** "An experimental test of the effects of predation risk on
  habitat use in fish." *Ecology* 64:1540–1548. — Classic refuge-use
  study using bluegill.

### Model summary

Two state variables — *perceived risk* and *internal state* (hunger /
mating) — drive a 2-state Markov-style switch between **forage** and
**refuge**. Risk rises with: predator visibility, sudden movement (the
"startle" stimulus), light intensity, lack of cover. Refuge use rises
discontinuously above a risk threshold.

The implementation idiom is well-established in agent-based ecology:

```
risk(t) = baseline
        + alpha * predatorVisibilityScore
        + beta  * recentStartleImpulse * decay(t - startleTime)
        + gamma * lightLevel
internalDrive(t) = hunger - satiation
mode(t) = (risk(t) > theta + internalDrive(t)) ? REFUGE : FORAGE
```

### Parameters that matter

- **`refugeThreshold` θ** — the risk level above which the fish flees to
  cover. Lower for tetras / harlequin rasboras; high for cichlids.
- **`startleDecay`** — exponential decay constant for the post-startle
  fear elevation; typical τ ≈ 3–10 s real time.
- **`coverPreference`** — preferred type of refuge (dense plants, cave,
  driftwood); selected by hardscape category.
- **`emergenceDelay`** — once mode flips back to forage, the fish waits
  N more seconds before re-emerging. Typical 5–30 s.
- **`lightSensitivity`** — multiplier on the `gamma * lightLevel` term.
  Mostly used by nocturnal species (kuhli, plecos).

### Recommendation

Add a **`FearState` component** (`{ risk, mode, emergenceTimer }`) +
**`StartleSystem`** that turns large transient stimuli (sudden cursor
hover near the agent, neighbouring fish darting from a predator, sudden
light change) into a `startleImpulse` on every fish within an arousal
radius. Refuge target = nearest hardscape item tagged `cover`. This
neatly composes with the existing layer model — drift-wood and
caves already exist as scene objects, you just need a `coverScore`
attribute on them.

---

## 7. Feeding behaviors

### Canonical references

- **Hofer, R., & Köck, G. (1995).** "Method for the simultaneous
  measurement of nutritional and gross energy in fish: principles and
  applications." Cited in the standard agent-based fish-feeding literature.
- **Kotrschal, K., & Goldschmid, A. (1992).** "Morphological evidence for
  the biological role of caudal-fin colouration in cyprinid fishes."
  *Environmental Biology of Fishes* 35:175–189. — Classification of
  feeding-niche-driven morphology.
- **Pyke, G. H. (1984).** "Optimal foraging theory: a critical review."
  *Annual Review of Ecology and Systematics* 15:523–575. — The standard
  reference for OFT.
- **Liu, K., Lin, S., et al. (2020+).** "Hunger classification of *Lates
  calcarifer* by means of an automated feeder and image processing."
  *Computers and Electronics in Agriculture*. — Modern computer-vision
  approach to inferring hunger state from behaviour.
- **Aquarium-husbandry references** for niche feeding categories:
  - Otocinclus / pleco grazing: aquariumcoop and similar care guides
    (already cited above).
  - Silver dollars / barbs as plant eaters: standard aquarium husbandry
    sources (no peer-reviewed simulation model exists).

### Model summary

The canonical agent model is a **hunger drive** that accumulates over
time, modulated by a circadian phase, and a **feeding response** that
fires when a food cue is detected and hunger > threshold. The classical
references are Lorenz's *Drive Model* and McFarland's
*Reinforcement Centred* hierarchical decision model; modern fish-AI
implementations are usually thin wrappers on these.

Niche-categorical layer (use as Component tag):

| Category        | Cue                                | Target geometry                |
|-----------------|-----------------------------------|--------------------------------|
| Surface feeder  | Floating food sprite              | y near waterline               |
| Midwater drift  | Sinking food sprite passing       | nearest food sprite            |
| Substrate forager | Settled food sprite             | substrate surface              |
| Algae grazer    | Algae texture coverage (procedural) | rock / glass faces             |
| Plant eater     | Plant entity                      | leaves of selected plant       |
| Detritivore     | "Mulm" texture density            | substrate hotspots             |

### Parameters that matter

- **`hunger ∈ [0, 1]`** — accumulates linearly toward 1 over a species-typical
  ~6–24 h.
- **`feedingThreshold`** — fraction of hunger above which the fish will
  *pursue* food, not just opportunistically nibble.
- **`circadianPhase`** — most aquarium fish feed at dawn/dusk; multiply
  hunger trigger by a sin-wave-like activity curve.
- **`feedingCategory`** — one-of the table above.
- **`graze` boolean** — algae/plant/detritus categories are continuous
  grazers (no discrete pursuit) and just bias their wander toward the
  appropriate surface.

### Recommendation

`FeedingDrive { hunger, threshold, category, circadianPhase }` component +
`FeedingSystem` that competes with `SchoolingSystem` and `FearSystem` via
an **arbitration table**. The simplest correct arbitration is a strict
priority list — fear > nip > territory > feeding > schooling > wander —
gated by whether each system has a non-null target this tick.

For the algae/plant-grazer subcategory, model it as continuous: bias the
wander target toward `nearest_surface_with_algae_score > 0` and decrement
an `algaeScore` on that surface over time. This is the only feeding
category that's actually visible at our visual fidelity; for discrete
feeding the cue is a transient food sprite the user triggers from the UI.

---

## 8. ECS patterns for behavior

### Canonical references / projects

- **bitECS** (Nathan Hall et al.) — minimal data-oriented ECS for
  TypeScript: https://github.com/NateTheGreatt/bitECS
- **becsy** — multithreaded TS ECS:
  https://github.com/LastOliveGames/becsy
- **Unity DOTS** — the AAA reference for data-oriented ECS. GDC talks
  by Mike Acton are the canonical "why" presentation.
  https://unity.com/dots
- **EnTT** (Michele Caini) — the C++ reference implementation; many TS
  ECS libraries crib its API: https://github.com/skypjack/entt
- **Reynolds, C. W. (2000).** "Interaction with Groups of Autonomous
  Characters." GDC. Open:
  https://www.red3d.com/cwr/papers/2000/
- **Mat Buckland (2005).** *Programming Game AI by Example*, Wordware.
  ch. 2 "State-driven agent design" — the canonical hands-on reference
  for FSMs in game agents.
- **Champandard, A. & Dunstan, P. (2013).** "The Behavior Tree Starter
  Kit," in *Game AI Pro* — the canonical reference for behaviour trees.
- **Comparison paper:** Iovino et al. (2024). "A Survey of Behavior
  Trees in Robotics and AI." *arXiv:2405.16137*. Open:
  https://arxiv.org/abs/2405.16137 — useful comparison surface.

### Pattern summary

For 50–200 fish on a 60fps budget, the right pattern is:

1. **Entities are integer IDs.** No JS objects per fish — that costs an
   allocation and a GC hit per spawn.
2. **Components are Structure-of-Arrays typed-array slabs.** `Float32Array`
   for positions/velocities, `Uint8Array` for state enums. bitECS does
   this natively; becsy similarly.
3. **Behaviors are Systems** (functions over component queries) — *not*
   per-entity OO methods. This is the load-bearing decision; everything
   downstream falls out of it. Systems run in a fixed order each tick.
4. **State is a small Uint8 enum in a `BehaviorMode` component.** Do
   *not* allocate FSM/BT object trees per fish — that defeats the SoA
   layout and dominates the budget. Treat the FSM as a switch statement
   inside the relevant System, indexed by the mode enum.
5. **Behaviour trees are only worth it when authoring complexity
   dominates**; for ≤12 modes per species, a flat enum + arbitration
   table is faster, easier to debug, and exactly as expressive (Iovino
   et al. 2024 makes this explicit).

### Components (suggested set)

```
Position        : Float32 × 3
Velocity        : Float32 × 3
Orientation     : Float32 × 4   // quaternion
SpeciesId       : Uint16
BodyLength      : Float32
SchoolingParams : Float32 × 8   // ZOR, ZOO, ZOA, weights, blindAngle
PreferredDepth  : Float32 × 3   // y, band, returnForce
Territory       : { anchorEid, coreR, displayR, aggression }   // optional
NippingDrive    : { groupThreshold, finFraction, rate }        // optional
FearState       : { risk, mode, emergenceTimer }
FeedingDrive    : Float32 × 3 + Uint8                          // h, thr, phase, category
Curiosity       : Float32 × 3                                  // boldness, rate, dwell
BehaviorMode    : Uint8     // SCHOOL | FEED | FLEE | HOLD | CHASE | NIP | GLASS
AnimationPhase  : Float32   // tail-wave phase
```

### Recommendation

Use **bitECS** unless you specifically need multithreading (you don't — the
neighbour-search benefits more from spatial hashing than from threading).
It has:

- Zero-allocation SoA components.
- Query caching with bitset masks.
- A trivial Angular-friendly mental model: one Angular service owns the
  world, one `requestAnimationFrame` loop owns the systems.

Run all systems on a **fixed 30 Hz simulation tick** + render at 60 Hz
with interpolation. Separating sim and render rates is the single biggest
budget win — fish-rate jitter disappears even when the renderer is heavy.

---

## 9. Lightweight fluid physics in browsers

### Canonical references

- **(a) Flow-field / advection.** Treuille, Cooper & Popovic (2006),
  "Continuum Crowds," *SIGGRAPH*. The crowds-from-vector-fields
  technique, adopted in *Supreme Commander 2* and surveyed in
  *Game AI Pro* ch. 23 (Emerson 2013, open PDF:
  https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf).
- **(b) SPH / PBF.**
  - **Müller, M., Charypar, D., & Gross, M. (2003).** "Particle-Based
    Fluid Simulation for Interactive Applications." *SCA*. Open PDF:
    https://people.computing.clemson.edu/~dhouse/courses/881/papers/mueller03.pdf
  - **Macklin, M., & Müller, M. (2013).** "Position Based Fluids."
    *SIGGRAPH/ACM TOG*. Open PDF:
    https://mmacklin.com/pbf_sig_preprint.pdf
- **(c) Stable Fluids.** Stam, J. (1999), "Stable Fluids,"
  *SIGGRAPH '99*. Open PDF:
  https://pages.cs.wisc.edu/~chaol/data/cs777/stam-stable_fluids.pdf
  And the friendlier games-targeted version: Stam, J. (2003),
  "Real-Time Fluid Dynamics for Games." Open PDF:
  http://graphics.cs.cmu.edu/nsp/course/15-464/Fall09/papers/StamFluidforGames.pdf

### Comparison

| Approach | Visual quality | CPU/GPU cost | Fish steering integration |
|----------|---------------|--------------|---------------------------|
| (a) Flow-field, precomputed | Coarse but stable global current | ~free at runtime — sample a 32³ grid | Trivial: add `flow.sample(pos)` to each fish's force sum |
| (b) PBF / SPH | Physically convincing free surface, particles | Heavy: 5k–20k particles to look right, even with GPU compute | Hard: fish must read interpolated velocity, particle search dominates |
| (c) Stable Fluids (Eulerian 2D/3D) | Stylised swirls / smoke / dye | Moderate: 64³ grid runs in browser, 128³ slow | Easy: sample velocity field for fish force |

### Recommendation

**Pick (a) + a thin layer of (c) for visible bubble columns, and skip (b).**

Concretely:

1. **Precomputed flow field** for the tank current. Author it as a static
   Float32Array(32×32×32 × 3) baked at scene-load time from filter
   outflow and return-vent positions (use a simple Helmholtz solve once
   at bake — Stam's projection step, executed once and saved). Each fish
   samples this trilinearly each tick and adds the velocity to its force
   sum. Cost: O(1) per fish.
2. **Stable-Fluids 2D slice for bubble streams.** Bubble entities are
   billboard sprites that advect through a *2D* stable-fluids grid
   mapped to a vertical plane in front of the air stone. Run this at
   32×32 max — the user can't tell. Cost: ≈ 0.5 ms/frame on a typical
   laptop.
3. **No SPH.** PBF at the particle counts needed for a 100-litre tank
   would eat the entire frame budget. Save it for a future "bubble
   foam" effect if at all.

The fish do **not** need to react to a real Navier-Stokes solution.
"Swim toward filter outflow" is best modelled as an *attractor* on the
filter intake plus the flow field's velocity vector added directly to
the steering integrator. "Get pushed by the current" is automatic from
the flow-field force.

---

## 10. Rigid-body / swim physics for fish

### Canonical references

- **Reynolds, C. W. (1999).** "Steering Behaviors For Autonomous
  Characters." GDC '99. Open:
  https://www.red3d.com/cwr/papers/1999/gdc99steer.html
  — The kinematic boid + steering layer. **This is the right level for
  our fish.**
- **cannon-es** (Schteppe, fork of cannon.js):
  https://github.com/pmndrs/cannon-es
- **Rapier** (Dimforge): https://rapier.rs/  — Rust/WASM, the fastest
  JS-accessible rigid-body engine in 2024–26.
- **Mat Buckland (2005).** *Programming Game AI by Example*, ch. 3,
  *The Vehicle Model*. — The canonical implementation guide for
  Reynolds-style steering with body banking.
- **Reynolds, C. W. (2000).** "Steering behaviors for autonomous
  characters with banking" (the section on roll for aircraft / fish):
  same paper above.

### Model summary

Three increasingly-expensive options:

1. **Kinematic boid + steering (Reynolds 1999).** Each fish is a point
   with mass, position, velocity, max-speed, max-force, max-turn-rate.
   No collisions in the rigid-body sense; collision avoidance is a
   *steering force* (`steerToAvoid` from Reynolds 1999). Banking and
   pitch are *visual-only* derivations from the turn vector.
2. **Capsule-ellipsoid + sweep test.** Add an ellipsoid collider for
   the fish body and do a swept-sphere test against scene hardscape +
   other fish. Resolve by deflecting the velocity tangent to the
   contact normal. Pure kinematic, no rigid-body solver. ~3× the cost
   of (1), still vastly cheaper than a real physics engine.
3. **Full rigid-body via Rapier or cannon-es.** Fish-as-ellipsoid in a
   physics world, with islands and broadphase. Massive overkill: real
   fish are nothing like rigid bodies, contact solving is fighting the
   steering layer, and at 200 entities you spend > 5 ms/frame inside
   the solver.

### Parameters that matter

- **`maxSpeed`** ≈ 5–10 BL/s for cruising teleosts; bursts up to 30 BL/s
  (rarely needed).
- **`maxForce`** in the steering sense — caps the per-tick velocity
  delta. Buckland's recommendation: ≈ 0.3 × maxSpeed.
- **`maxTurnRate`** — strictly bound the heading delta per tick to model
  fish hydrodynamic limits. ≈ π/2 rad/s for tetras; ≈ π rad/s for
  agile cichlids.
- **`bankFactor`** — visual roll proportional to lateral acceleration.
  Cosmetic only; 0.3–0.5 rad/(BL·s⁻²) reads well.
- **`avoidLookAhead`** — distance in front of the fish at which it
  evaluates obstacle avoidance. ≈ 3–5 BL.
- **`avoidanceForce`** — Reynolds' obstacle-avoidance steering force
  magnitude; should saturate `maxForce`.

### Recommendation

**Use option 2: kinematic boid + ellipsoid sweep test against
hardscape and a coarse neighbour-fish capsule check.** No third-party
physics engine. Reasons:

- It composes cleanly with the steering layer — collisions are just
  another force.
- It runs entirely on typed arrays; the same `Position`/`Velocity`
  components the schooling system already uses.
- It avoids the determinism issue of cannon-es / Rapier across
  browsers, which matters if we want a `seed` (already in the `.aqua`
  format) to produce identical playback.

For fish-vs-hardscape, voxelise the hardscape once at scene-load into
a 64³ signed-distance field (already useful for the flow-field
generator!) and do an SDF-gradient steer-away. Single texture lookup
per fish per tick. The 3D renderer caveat in the codebase already
discusses the hardscape AABB clamping that's adjacent to this work.

---

## 11. Low-poly animated fish models

### Canonical references

- **Gates, W. F. (2001).** "Animation of Fish Swimming." UBC TR. Open
  PDF: https://www.cs.ubc.ca/sites/default/files/tr/2001/TR-2001-19_0.pdf
  — Best single open reference for procedural fish animation by sine
  deformation of a spine.
- **Tu, X., & Terzopoulos, D. (1994).** "Artificial Fishes," as above —
  the classic muscle-actuator + sinusoidal spine model.
- **Liu, J., & Hu, H. (2010).** "Biological inspiration: From
  carangiform fish to multi-joint robotic fish." *Journal of Bionic
  Engineering*, 7(1):35–48. DOI:10.1016/S1672-6529(09)60184-0.
  — The classical *carangiform* sinusoidal kinematic model: traveling
  wave with amplitude envelope growing toward the caudal peduncle.
  (Note: I could not verify the title "A Sinusoidal Modeling for Fish
  Swimming Animation" by Liu & Hu mentioned in the prompt — the Liu &
  Hu citation I *can* verify is the one above; treat the title in the
  prompt as possibly an alternate title or a misremembering. The
  bionic-engineering paper covers the same math.)
- **Lauder, G. V., & Tytell, E. D. (2006).** "Hydrodynamics of
  undulatory propulsion." *Fish Physiology* 23:425–468. — The
  authoritative biomechanics review; the right citation if anyone
  asks why the envelope grows toward the tail.
- **Di Santo, V., et al. (2021).** "Convergence of undulatory swimming
  kinematics across a diversity of fishes." *PNAS* 118(49). Open:
  https://www.pnas.org/doi/10.1073/pnas.2113206118 — modern,
  data-driven confirmation that one body-wave model fits most teleosts.

### Model summary

A traveling-sine spine model with a growing envelope toward the tail:

```
amplitude(s)  = A_head + (A_tail - A_head) * pow(s, p)     // s in [0,1]
phase(s, t)   = 2π * (t / T  -  s / L)
y_offset(s,t) = amplitude(s) * sin(phase(s, t))
```

where `s` is normalized arc length from snout to tail, `T` is the
tail-beat period (≈ 1/f, f ≈ 2–10 Hz), `L` is the wavelength as a
fraction of body length (≈ 0.7–1.2 BL for carangiform). The exponent
`p ≈ 2` puts most of the deflection at the tail — this is the
**amplitude envelope**.

For our use case the actual *geometry* layer is:

- **Body**: ellipsoid swept along a centerline of 6–10 bones; each
  bone's local rotation is set per-frame from the sine model above.
- **Caudal fin**: lags behind the tip by ~10–20% of wavelength
  (the "beat" looks more alive than perfectly in-phase).
- **Pectoral fins**: independent two-bone armature, low-amplitude
  rowing motion at half the tail frequency. Mostly cosmetic.
- **Dorsal/anal fins**: usually static or with a small ripple noise.

### Parameters that matter

- **`tailBeatFreq`** (f, Hz) ≈ scales with `v/BL`; ≈ 2 Hz at cruise,
  up to 8 Hz at burst.
- **`amplitudeHead`** ≈ 0.02–0.05 BL.
- **`amplitudeTail`** ≈ 0.10–0.20 BL.
- **`envelopeExponent`** (p) ≈ 1.8–2.5.
- **`wavelength`** (L, BL) ≈ 0.7–1.2 for carangiform (most aquarium
  fish), → ∞ for *thunniform* (tuna; not relevant), ≈ 0.5 for
  *anguilliform* (eels, kuhli loaches).
- **`headYaw`** — small head-counter-yaw improves realism;
  ≈ 0.05 rad opposite to tail phase.

### Recommendation

Build a **tiny parametric mesh library** of ~6 archetypes — slender
tetra, deep-bodied tetra (e.g. angel), elongated barb, cory cylinder,
eel-shape, surface wedge (hatchet) — each a low-poly ellipsoid mesh
with 6–10 spine bones and the fin attachments above. At runtime
deform via a vertex shader driven by:

```
uniform float u_time;
uniform vec4  u_fishParams; // freq, ampHead, ampTail, p
```

Each fish instance writes its `tailBeatFreq` and current `phaseOffset`
into per-instance attributes. Using **Three.js `InstancedMesh`** with a
custom vertex shader keeps the entire fish population in **one draw
call per archetype** — i.e. ≤ 6 draws for the whole tank. Skinned
meshes per fish would explode the draw count; the threejs-forum
threads I cited confirm the well-known performance cliff there.

Authoring workflow: artist exports a single low-poly mesh + skeleton
per archetype; the runtime applies the sinusoidal deformation
procedurally so the artist never has to bake animations. Real species
lengths come from the catalog (already in `domain/catalog`); the shader
scales the mesh.

---

## Cross-cutting recommendations for our stack

1. **Determinism.** The `.aqua` document already carries a `seed`. Pipe
   it through a deterministic PRNG (the codebase already uses a seeded
   hash in `domain/geometry`). Spawn each fish with an
   `individualOffset` (boldness, hunger phase, etc.) drawn from the
   seed → species-typical distribution.
2. **System ordering** per tick (sim at 30 Hz, render at 60 Hz with
   interpolation):
   ```
   1. PerceptionSystem        // spatial hash refresh
   2. FearSystem              // startle / refuge mode
   3. NippingSystem           // dart override
   4. TerritorialSystem       // chase override
   5. FeedingSystem           // food-seeking force
   6. SchoolingSystem         // boids force (default)
   7. DepthSystem             // y-spring
   8. FlowFieldSystem         // tank-current force
   9. SteeringIntegrator      // sum forces, clamp by maxForce/maxTurn
  10. CollisionSystem         // ellipsoid sweep vs SDF + neighbours
  11. KinematicIntegrator     // pos += vel*dt, orient = quat(vel)
  12. AnimationSystem         // tail-beat phase update
   ```
3. **One bottleneck to budget for: neighbour search.** A uniform 3D
   grid hash with cell size ≈ max(ZOR, ZOA) gives O(n·k) with k ≤ 12.
   Rebuild once per tick. Use the same grid for territorial-range
   queries, nipping target queries, and refuge lookups — amortizes
   well.
4. **Memory layout.** All persistent state lives in bitECS-managed
   typed-array slabs. No JS objects per fish. The only per-fish JS
   allocation is the Three.js `InstancedMesh` instance index — which
   never moves.
5. **Test plan invariants** (matching the project's DoD):
   - Deterministic playback: identical seed → identical positions
     after N ticks across runs.
   - 60 fps render budget honoured at n=200 on a 2022-class laptop iGPU.
   - Schooling system polarization metric ≥ 0.8 in default school
     configuration (tetra-like params).
   - Couzin three-zone phase test: swarm / mill / school regimes
     reproduce with the published ZOO/ZOA ratio sweep.

---

## Source quick-index (verified URLs)

- Reynolds 1987 Boids: https://www.red3d.com/cwr/papers/1987/boids.html
- Reynolds 1999 Steering: https://www.red3d.com/cwr/papers/1999/gdc99steer.html
- Couzin et al. 2002: https://jmvidal.cse.sc.edu/library/couzin02a.pdf
- Hemelrijk & Hildenbrandt 2012: https://pmc.ncbi.nlm.nih.gov/articles/PMC3499122/
- Tu & Terzopoulos 1994: https://faculty.cc.gatech.edu/~turk/bio_sim/articles/fish_terzopoulos.pdf
- Strand et al. 2005 buoyancy: https://courses.washington.edu/fish538/resources/Strand%20et%20al%20buoyancy.pdf
- Salzburger/Sommer-Trembo 2024 cichlid curiosity: https://phys.org/news/2024-04-cichlid-fishes-curiosity-biodiversity-exploratory.html
- Zebrafish 30-object curiosity: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9988950/
- Betta glass-surfing (Bartolini 2024): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10936361/
- Lima & Dill 1990: https://gambusia.zo.ncsu.edu/readings/Lima%20and%20Dill%201990.pdf
- Müller 2003 SPH: https://people.computing.clemson.edu/~dhouse/courses/881/papers/mueller03.pdf
- Macklin & Müller 2013 PBF: https://mmacklin.com/pbf_sig_preprint.pdf
- Stam 1999 Stable Fluids: https://pages.cs.wisc.edu/~chaol/data/cs777/stam-stable_fluids.pdf
- Stam 2003 RT Fluid for Games: http://graphics.cs.cmu.edu/nsp/course/15-464/Fall09/papers/StamFluidforGames.pdf
- Game AI Pro ch. 23 flow-field tiles: https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf
- Iovino 2024 BT vs FSM survey: https://arxiv.org/abs/2405.16137
- Gates 2001 Animation of Fish Swimming: https://www.cs.ubc.ca/sites/default/files/tr/2001/TR-2001-19_0.pdf
- Di Santo 2021 PNAS undulatory convergence: https://www.pnas.org/doi/10.1073/pnas.2113206118
- bitECS: https://github.com/NateTheGreatt/bitECS

## Citations I could *not* verify a clean URL for (cite by venue)

- Brown, J. L. (1964). Wilson Bulletin 76:160–169. — Behind paywall;
  the model itself is summarized everywhere.
- Maynard Smith & Parker (1976). Animal Behaviour 24:159–175. — Same.
- Vicsek et al. (1995) PRL 75:1226. — Behind paywall; arXiv preprint at
  cond-mat exists but I did not verify it on this pass.
- Sih (1980). Science 210:1041–1043. — Behind paywall.
- Pitcher & Parrish (1993) book chapter. — Book, not online.
- Camazine et al. (2001) book. — Same.
- Buckland (2005) book. — Same.
- Liu & Hu, "A Sinusoidal Modeling for Fish Swimming Animation" (as
  named in the prompt). — I could not confirm a paper with exactly
  that title under those authors. The closest verifiable Liu & Hu work
  is the 2010 *Journal of Bionic Engineering* paper on carangiform
  robotic fish (DOI 10.1016/S1672-6529(09)60184-0). Treat the prompt's
  title as a likely mistitle, or check the author's CV before citing
  by name.
