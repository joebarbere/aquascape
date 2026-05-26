import { defineQuery, hasComponent } from 'bitecs';
import {
  AnimationPhase,
  Archetype,
  BehaviorMode,
  BEHAVIOR_MODE,
  BodyLength,
  FISH_ARCHETYPE,
  Orientation,
  Position,
  SpeciesId,
  Velocity,
} from './components';
import { createLivestockWorld } from './world';

function spawnDefault(world: ReturnType<typeof createLivestockWorld>, overrides = {}) {
  return world.spawnFish({
    archetype: FISH_ARCHETYPE.SLIM_TETRA,
    speciesId: 0x1234,
    bodyLengthMm: 30,
    position: { x: 100, y: 50, z: 200 },
    ...overrides,
  });
}

describe('createLivestockWorld + spawnFish', () => {
  it('returns a world with the given seed and zero tick counter', () => {
    const w = createLivestockWorld(0xdeadbeef);
    // `| 0` coerces deadbeef → int32 (negative); we mirror that in the world.
    expect(w.seed).toBe(0xdeadbeef | 0);
    expect(w.tickCounter).toBe(0);
  });

  it('adds entities that the bitECS Position query finds', () => {
    const w = createLivestockWorld(1);
    const a = spawnDefault(w);
    const b = spawnDefault(w);
    const q = defineQuery([Position]);
    const found = q(w.ecs);
    expect(found).toContain(a);
    expect(found).toContain(b);
    expect(found.length).toBe(2);
  });

  it('attaches every F11.1 component to each spawned entity', () => {
    const w = createLivestockWorld(7);
    const eid = spawnDefault(w);
    for (const c of [
      Position,
      Velocity,
      Orientation,
      SpeciesId,
      BodyLength,
      Archetype,
      AnimationPhase,
      BehaviorMode,
    ]) {
      expect(hasComponent(w.ecs, c, eid)).toBe(true);
    }
  });

  it('initialises component arrays with the SpawnOpts values', () => {
    const w = createLivestockWorld(0);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.HATCHET_WEDGE,
      speciesId: 42,
      bodyLengthMm: 25,
      position: { x: 11, y: 22, z: 33 },
      orientation: { x: 0.1, y: 0.2, z: 0.3, w: 0.927 },
      tailBeatFreq: 5,
      ampHead: 0.05,
      ampTail: 0.2,
      phaseOffset: 1.5,
    });
    expect(Position.x[eid]).toBeCloseTo(11);
    expect(Position.y[eid]).toBeCloseTo(22);
    expect(Position.z[eid]).toBeCloseTo(33);
    expect(Velocity.x[eid]).toBe(0);
    expect(Velocity.y[eid]).toBe(0);
    expect(Velocity.z[eid]).toBe(0);
    expect(Orientation.x[eid]).toBeCloseTo(0.1);
    expect(Orientation.y[eid]).toBeCloseTo(0.2);
    expect(Orientation.z[eid]).toBeCloseTo(0.3);
    expect(Orientation.w[eid]).toBeCloseTo(0.927);
    expect(SpeciesId.id[eid]).toBe(42);
    expect(BodyLength.mm[eid]).toBe(25);
    expect(Archetype.id[eid]).toBe(FISH_ARCHETYPE.HATCHET_WEDGE);
    expect(AnimationPhase.freq[eid]).toBeCloseTo(5);
    expect(AnimationPhase.ampHead[eid]).toBeCloseTo(0.05);
    expect(AnimationPhase.ampTail[eid]).toBeCloseTo(0.2);
    expect(AnimationPhase.phase[eid]).toBeCloseTo(1.5);
    expect(BehaviorMode.mode[eid]).toBe(BEHAVIOR_MODE.FORAGE);
  });

  it('uses identity quaternion + default animation params when omitted', () => {
    const w = createLivestockWorld(0);
    const eid = spawnDefault(w);
    expect(Orientation.x[eid]).toBe(0);
    expect(Orientation.y[eid]).toBe(0);
    expect(Orientation.z[eid]).toBe(0);
    expect(Orientation.w[eid]).toBe(1);
    expect(AnimationPhase.freq[eid]).toBeCloseTo(4);
    expect(AnimationPhase.ampHead[eid]).toBeCloseTo(0.02);
    expect(AnimationPhase.ampTail[eid]).toBeCloseTo(0.12);
    expect(AnimationPhase.phase[eid]).toBe(0);
  });

  it('masks speciesId into ui16 and archetype into ui8', () => {
    const w = createLivestockWorld(0);
    const eid = w.spawnFish({
      archetype: 0x1ff, // overflows ui8 → wraps to 0xff
      speciesId: 0xfffff, // overflows ui16 → wraps to 0xffff
      bodyLengthMm: 30,
      position: { x: 0, y: 0, z: 0 },
    });
    expect(Archetype.id[eid]).toBe(0xff);
    expect(SpeciesId.id[eid]).toBe(0xffff);
  });

  it('step() increments tickCounter by one', () => {
    const w = createLivestockWorld(0);
    spawnDefault(w);
    expect(w.tickCounter).toBe(0);
    w.step(1 / 30);
    expect(w.tickCounter).toBe(1);
    w.step(1 / 30);
    w.step(1 / 30);
    expect(w.tickCounter).toBe(3);
  });

  it('despawn removes the entity from queries', () => {
    const w = createLivestockWorld(0);
    const a = spawnDefault(w);
    const b = spawnDefault(w);
    w.despawn(a);
    const q = defineQuery([Position]);
    const found = q(w.ecs);
    expect(found).not.toContain(a);
    expect(found).toContain(b);
  });

  it('dispose resets tickCounter', () => {
    const w = createLivestockWorld(0);
    w.step(1 / 30);
    expect(w.tickCounter).toBe(1);
    w.dispose();
    expect(w.tickCounter).toBe(0);
  });
});

describe('WorldSnapshot', () => {
  it('entityCount matches spawn/despawn arithmetic', () => {
    const w = createLivestockWorld(0);
    expect(w.snapshot(0).entityCount).toBe(0);
    const a = spawnDefault(w);
    spawnDefault(w);
    expect(w.snapshot(0).entityCount).toBe(2);
    w.despawn(a);
    expect(w.snapshot(0).entityCount).toBe(1);
  });

  it('typed-array lengths match entityCount × stride', () => {
    const w = createLivestockWorld(0);
    spawnDefault(w);
    spawnDefault(w);
    spawnDefault(w);
    const s = w.snapshot(0);
    expect(s.entityCount).toBe(3);
    expect(s.ids.length).toBe(3);
    expect(s.position.length).toBe(9);
    expect(s.orientation.length).toBe(12);
    expect(s.phase.length).toBe(3);
    expect(s.archetype.length).toBe(3);
    expect(s.scale.length).toBe(3);
  });

  it('snapshot carries position + scale + archetype + phase per entity', () => {
    const w = createLivestockWorld(0);
    w.spawnFish({
      archetype: FISH_ARCHETYPE.EEL,
      speciesId: 1,
      bodyLengthMm: 80,
      position: { x: 1, y: 2, z: 3 },
      tailBeatFreq: 3,
      phaseOffset: 0.5,
    });
    const s = w.snapshot(0);
    expect(s.position[0]).toBeCloseTo(1);
    expect(s.position[1]).toBeCloseTo(2);
    expect(s.position[2]).toBeCloseTo(3);
    expect(s.orientation[3]).toBeCloseTo(1); // identity quaternion .w
    expect(s.archetype[0]).toBe(FISH_ARCHETYPE.EEL);
    expect(s.scale[0]).toBeCloseTo(80);
    expect(s.phase[0]).toBeCloseTo(0.5);
  });

  it('grows the pool past 64 entities without losing data', () => {
    const w = createLivestockWorld(0);
    for (let i = 0; i < 130; i++) {
      w.spawnFish({
        archetype: FISH_ARCHETYPE.BARB,
        speciesId: i,
        bodyLengthMm: 10 + i,
        position: { x: i, y: 0, z: 0 },
      });
    }
    const s = w.snapshot(0);
    expect(s.entityCount).toBe(130);
    expect(s.position[(130 - 1) * 3]).toBeCloseTo(129);
    expect(s.scale[129]).toBeCloseTo(10 + 129);
  });
});
