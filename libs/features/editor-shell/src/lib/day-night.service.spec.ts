// Tests for DayNightService — Stage 11 F11.7 Wave 1.
//
// Covers:
//  - signal defaults (phase 0.5, mode 'manual')
//  - setPhase wrap semantics (in-range, > 1, negative)
//  - setMode round-trip
//  - lookup at all four keypoints matches the F11.7 table exactly
//  - lookup at two interpolated phases (dawn↔noon mid, midnight↔dawn early)
//  - tick advances phase only in real-time mode

import { TestBed } from '@angular/core/testing';

import { DayNightService } from './day-night.service';

describe('DayNightService — defaults + setters', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('starts at phase 0.5 (noon)', () => {
    const svc = TestBed.inject(DayNightService);
    expect(svc.phase()).toBe(0.5);
  });

  it('starts in manual mode', () => {
    const svc = TestBed.inject(DayNightService);
    expect(svc.mode()).toBe('manual');
  });

  it('is a singleton at the root injector', () => {
    const a = TestBed.inject(DayNightService);
    const b = TestBed.inject(DayNightService);
    expect(a).toBe(b);
  });

  it('setPhase(0.3) updates the phase in-range', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setPhase(0.3);
    expect(svc.phase()).toBeCloseTo(0.3, 10);
  });

  it('setPhase(1.7) wraps modulo 1 to 0.7', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setPhase(1.7);
    expect(svc.phase()).toBeCloseTo(0.7, 10);
  });

  it('setPhase(-0.2) wraps to 0.8', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setPhase(-0.2);
    expect(svc.phase()).toBeCloseTo(0.8, 10);
  });

  it('setPhase(1.0) wraps to 0', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setPhase(1.0);
    expect(svc.phase()).toBe(0);
  });

  it('setMode round-trips each mode value', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setMode('real-time');
    expect(svc.mode()).toBe('real-time');
    svc.setMode('equipment');
    expect(svc.mode()).toBe('equipment');
    svc.setMode('manual');
    expect(svc.mode()).toBe('manual');
  });
});

describe('DayNightService — lookup() at keypoints', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('matches the midnight (phase 0.0) keypoint exactly', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setPhase(0.0);
    expect(svc.lookup()).toEqual({
      ambientColor: '#0a1430',
      directionalIntensity: 0.05,
      backgroundTint: '#0a1430',
      emissiveBoost: 0.4,
    });
  });

  it('matches the dawn (phase 0.25) keypoint exactly', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setPhase(0.25);
    expect(svc.lookup()).toEqual({
      ambientColor: '#7a6a4e',
      directionalIntensity: 0.55,
      backgroundTint: '#3a4060',
      emissiveBoost: 0.1,
    });
  });

  it('matches the noon (phase 0.5) keypoint exactly', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setPhase(0.5);
    expect(svc.lookup()).toEqual({
      ambientColor: '#fff5e0',
      directionalIntensity: 1.0,
      backgroundTint: '#a4c7e8',
      emissiveBoost: 0.0,
    });
  });

  it('matches the dusk (phase 0.75) keypoint exactly', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setPhase(0.75);
    expect(svc.lookup()).toEqual({
      ambientColor: '#a87344',
      directionalIntensity: 0.45,
      backgroundTint: '#3a3030',
      emissiveBoost: 0.1,
    });
  });
});

describe('DayNightService — lookup() interpolation', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('lerps halfway between dawn + noon at phase 0.375', () => {
    // segment [0.25, 0.50], t = (0.375 - 0.25) / 0.25 = 0.5.
    // ambient dawn #7a6a4e → noon #fff5e0:
    //   r: 0x7a=122, 0xff=255  → 0.5 lerp = 188.5 → round 189 → 0xbd
    //   g: 0x6a=106, 0xf5=245  → 0.5 lerp = 175.5 → round 176 → 0xb0
    //   b: 0x4e=78,  0xe0=224  → 0.5 lerp = 151   → 0x97
    // directional: lerp(0.55, 1.0, 0.5) = 0.775
    // background dawn #3a4060 → noon #a4c7e8:
    //   r: 0x3a=58,  0xa4=164  → 111   → 0x6f
    //   g: 0x40=64,  0xc7=199  → 131.5 → round 132 → 0x84
    //   b: 0x60=96,  0xe8=232  → 164   → 0xa4
    // emissive: lerp(0.1, 0.0, 0.5) = 0.05
    const svc = TestBed.inject(DayNightService);
    svc.setPhase(0.375);
    const out = svc.lookup();
    expect(out.ambientColor).toBe('#bdb097');
    expect(out.directionalIntensity).toBeCloseTo(0.775, 10);
    expect(out.backgroundTint).toBe('#6f84a4');
    expect(out.emissiveBoost).toBeCloseTo(0.05, 10);
  });

  it('lerps halfway between midnight + dawn at phase 0.125', () => {
    // segment [0.0, 0.25], t = 0.125 / 0.25 = 0.5.
    // ambient midnight #0a1430 → dawn #7a6a4e:
    //   r: 0x0a=10,  0x7a=122  → 66    → 0x42
    //   g: 0x14=20,  0x6a=106  → 63    → 0x3f
    //   b: 0x30=48,  0x4e=78   → 63    → 0x3f
    // directional: lerp(0.05, 0.55, 0.5) = 0.3
    // background midnight #0a1430 → dawn #3a4060:
    //   r: 10, 58   → 34   → 0x22
    //   g: 20, 64   → 42   → 0x2a
    //   b: 48, 96   → 72   → 0x48
    // emissive: lerp(0.4, 0.1, 0.5) = 0.25
    const svc = TestBed.inject(DayNightService);
    svc.setPhase(0.125);
    const out = svc.lookup();
    expect(out.ambientColor).toBe('#423f3f');
    expect(out.directionalIntensity).toBeCloseTo(0.3, 10);
    expect(out.backgroundTint).toBe('#222a48');
    expect(out.emissiveBoost).toBeCloseTo(0.25, 10);
  });

  it('lerps across the wrap segment (dusk → midnight) at phase 0.875', () => {
    // segment [0.75, 1.0], t = (0.875 - 0.75) / 0.25 = 0.5.
    // ambient dusk #a87344 → midnight #0a1430:
    //   r: 0xa8=168, 0x0a=10  → 89   → 0x59
    //   g: 0x73=115, 0x14=20  → 67.5 → 68 → 0x44
    //   b: 0x44=68,  0x30=48  → 58   → 0x3a
    // directional: lerp(0.45, 0.05, 0.5) = 0.25
    const svc = TestBed.inject(DayNightService);
    svc.setPhase(0.875);
    const out = svc.lookup();
    expect(out.ambientColor).toBe('#59443a');
    expect(out.directionalIntensity).toBeCloseTo(0.25, 10);
  });
});

describe('DayNightService — tick()', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('in real-time mode, tick(dt) advances phase by dt / 86400', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setMode('real-time');
    svc.setPhase(0.5);
    // 8640 sec = 0.1 of a day.
    svc.tick(8640);
    expect(svc.phase()).toBeCloseTo(0.6, 10);
  });

  it('in real-time mode, repeated ticks accumulate', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setMode('real-time');
    svc.setPhase(0.0);
    svc.tick(8640);
    svc.tick(8640);
    svc.tick(8640);
    expect(svc.phase()).toBeCloseTo(0.3, 10);
  });

  it('in real-time mode, tick wraps past 1.0 back to [0, 1)', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setMode('real-time');
    svc.setPhase(0.9);
    svc.tick(8640 * 2); // +0.2 → 1.1 → wraps to 0.1
    expect(svc.phase()).toBeCloseTo(0.1, 10);
  });

  it('in manual mode, tick is a no-op (phase unchanged)', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setMode('manual');
    svc.setPhase(0.5);
    svc.tick(8640);
    expect(svc.phase()).toBe(0.5);
  });

  it('in equipment mode, tick is a no-op (phase unchanged)', () => {
    const svc = TestBed.inject(DayNightService);
    svc.setMode('equipment');
    svc.setPhase(0.25);
    svc.tick(8640);
    expect(svc.phase()).toBe(0.25);
  });
});
