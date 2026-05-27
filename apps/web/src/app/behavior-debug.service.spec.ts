// Tests for BehaviorDebugService — Stage 11 F11.6 Wave 4.
//
// Tiny service, tiny spec: a single signal flipped by `toggle()` /
// `setEnabled()`. The visibility GATING of the overlay (dev mode, view
// mode, world non-null) is tested in `behavior-debug-overlay.component.spec.ts`
// — this spec only covers the toggle primitive.

import { TestBed } from '@angular/core/testing';

import { BehaviorDebugService } from './behavior-debug.service';

describe('BehaviorDebugService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('starts disabled', () => {
    const svc = TestBed.inject(BehaviorDebugService);
    expect(svc.enabled()).toBe(false);
  });

  it('toggle() flips the flag', () => {
    const svc = TestBed.inject(BehaviorDebugService);
    svc.toggle();
    expect(svc.enabled()).toBe(true);
    svc.toggle();
    expect(svc.enabled()).toBe(false);
    svc.toggle();
    expect(svc.enabled()).toBe(true);
  });

  it('setEnabled() forces the flag to a specific value', () => {
    const svc = TestBed.inject(BehaviorDebugService);
    svc.setEnabled(true);
    expect(svc.enabled()).toBe(true);
    // Re-set to true is a no-op (no toggle), still true.
    svc.setEnabled(true);
    expect(svc.enabled()).toBe(true);
    svc.setEnabled(false);
    expect(svc.enabled()).toBe(false);
  });

  it('is a singleton at the root injector', () => {
    const a = TestBed.inject(BehaviorDebugService);
    const b = TestBed.inject(BehaviorDebugService);
    expect(a).toBe(b);
  });
});
