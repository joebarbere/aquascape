/**
 * FlowFieldSystem (Stage 11 F11.5 Wave 4).
 *
 * Reads the world's registered `FlowField` (baked once per scene by the
 * `LivestockSimulationService` via `@aquascape/domain/fluid-sim`'s
 * `bakeFlowField` — equipment outflow + intake → divergence-free velocity
 * grid) and sums a per-entity drag force into `Force`. The fish then drift
 * toward filter intakes and get nudged by outflow jets every tick.
 *
 * Slot order (see `docs/caveats/livestock-ecs.md` system-ordering table):
 *
 *   … DepthSystem → **FlowFieldSystem** → SteeringIntegrator …
 *
 * Running *between* DepthSystem and SteeringIntegrator means the flow
 * contribution sums into Force alongside schooling + depth + feeding +
 * curiosity, then SteeringIntegrator clamps `|Velocity|` to `vMax` and
 * enforces `turnMax`. Adding flow as just-another-force keeps the integrator
 * authoritative for limits.
 *
 * MODE-AGNOSTIC
 * -------------
 * Flow applies in REFUGE / PURSUE too — a frightened fish still gets pushed
 * by the filter. No `BehaviorMode` gate. (Contrast with SchoolingSystem,
 * which skips REFUGE/PURSUE to keep the refuge attractor dominant; flow is
 * an *environmental* force, not a *decision*.)
 *
 * DETERMINISM
 * -----------
 * `sampleFlowField` is a pure trilinear interpolation — no PRNG draws, no
 * Date.now, no Math.random. Iterates entities in bitECS eid order. Two
 * worlds with the same baked flow field + same SpawnOpts sequence produce
 * byte-identical Force contributions every tick.
 *
 * NO-OP FAST PATH
 * ---------------
 * If `world.getFlowField()` returns null (the service hasn't baked yet, or
 * the scene has no flow sources), the system early-returns — Force stays
 * untouched and SteeringIntegrator sees only the upstream contributions.
 * Empty tanks pay zero cost per tick.
 */
import { defineQuery } from 'bitecs';
import { sampleFlowField } from '@aquascape/domain/fluid-sim';
import { Force, Position, Velocity } from './components';
import type { LivestockWorld } from './world';

/**
 * Coupling between sampled water velocity (mm/s) and the force we add to
 * each fish (mm/s²). Fish are mostly streamlined — weak coupling — and the
 * flow field's source intensity already encodes the equipment's effective
 * power, so we apply a single global scalar rather than per-species drag.
 *
 * Concrete number: 0.5 means a 50 mm/s outflow jet contributes 25 mm/s²
 * to the fish — small relative to schooling (~100s mm/s²) but cumulative
 * across many ticks, so the fish visibly drifts toward intakes over a few
 * seconds. SteeringIntegrator clamps the final velocity to vMax, so even
 * an over-tuned source can't accelerate a fish beyond its cruise speed.
 */
const DRAG_COEFFICIENT = 0.5;

const flowQuery = defineQuery([Position, Velocity, Force]);

export function flowFieldSystem(world: LivestockWorld): void {
  const field = world.getFlowField();
  if (field === null) return;
  const ecs = world.ecs;
  // Scratch object reused for the Vec3 we hand to sampleFlowField — the
  // sample API returns a fresh Vec3, but the input is a structural shape
  // we can pre-allocate to avoid per-fish allocation in the hot loop.
  const probe = { x: 0, y: 0, z: 0 };
  for (const eid of flowQuery(ecs)) {
    probe.x = Position.x[eid] as number;
    probe.y = Position.y[eid] as number;
    probe.z = Position.z[eid] as number;
    const sample = sampleFlowField(field, probe);
    Force.x[eid] = (Force.x[eid] as number) + sample.x * DRAG_COEFFICIENT;
    Force.y[eid] = (Force.y[eid] as number) + sample.y * DRAG_COEFFICIENT;
    Force.z[eid] = (Force.z[eid] as number) + sample.z * DRAG_COEFFICIENT;
  }
}
