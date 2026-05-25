// ViewportService tests. Stage 5.x (user-controlled zoom).

import { TestBed } from '@angular/core/testing';

import { ViewportService } from './viewport.service';

describe('ViewportService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function makeService(): ViewportService {
    TestBed.configureTestingModule({ providers: [ViewportService] });
    return TestBed.inject(ViewportService);
  }

  it('starts with no overrides (fit-to-window)', () => {
    const s = makeService();
    expect(s.userZoomMult()).toBeNull();
    expect(s.userPan()).toBeNull();
    expect(s.isFit()).toBe(true);
  });

  it('setZoomMult sets the multiplier signal', () => {
    const s = makeService();
    s.setZoomMult(1.5);
    expect(s.userZoomMult()).toBe(1.5);
    expect(s.isFit()).toBe(false);
  });

  it('setPan sets the pan signal', () => {
    const s = makeService();
    s.setPan({ x: 10, y: -5 });
    expect(s.userPan()).toEqual({ x: 10, y: -5 });
    expect(s.isFit()).toBe(false);
  });

  it('setZoomAndPan updates both atomically', () => {
    const s = makeService();
    s.setZoomAndPan(2, { x: 5, y: 5 });
    expect(s.userZoomMult()).toBe(2);
    expect(s.userPan()).toEqual({ x: 5, y: 5 });
    expect(s.isFit()).toBe(false);
  });

  it('reset() clears both overrides', () => {
    const s = makeService();
    s.setZoomAndPan(3, { x: 100, y: 100 });
    s.reset();
    expect(s.userZoomMult()).toBeNull();
    expect(s.userPan()).toBeNull();
    expect(s.isFit()).toBe(true);
  });

  it('setZoomMult(null) clears only the zoom override (pan stays)', () => {
    const s = makeService();
    s.setZoomAndPan(2, { x: 10, y: 10 });
    s.setZoomMult(null);
    expect(s.userZoomMult()).toBeNull();
    expect(s.userPan()).toEqual({ x: 10, y: 10 });
    expect(s.isFit()).toBe(false);
  });

  it('setPan(null) clears only the pan override (zoom stays)', () => {
    const s = makeService();
    s.setZoomAndPan(2, { x: 10, y: 10 });
    s.setPan(null);
    expect(s.userZoomMult()).toBe(2);
    expect(s.userPan()).toBeNull();
    expect(s.isFit()).toBe(false);
  });

  it('isFit stays true when one override is null and the other is unset', () => {
    const s = makeService();
    expect(s.isFit()).toBe(true);
    s.setZoomMult(null);
    s.setPan(null);
    expect(s.isFit()).toBe(true);
  });

  it('isFit becomes true again after reset, even if both were set', () => {
    const s = makeService();
    s.setZoomMult(0.5);
    s.setPan({ x: 1, y: 1 });
    expect(s.isFit()).toBe(false);
    s.reset();
    expect(s.isFit()).toBe(true);
  });
});
