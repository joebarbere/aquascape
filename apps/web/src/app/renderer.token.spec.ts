// Verifies that the SCENE_RENDERER token's default factory yields a
// Canvas2DRenderer. The production composition root depends on this default
// (no explicit provider needed in main.ts for the renderer).

import { TestBed } from '@angular/core/testing';
import { Canvas2DRenderer } from '@aquascape/rendering/renderer-2d';

import { SCENE_RENDERER } from './renderer.token';

describe('SCENE_RENDERER token', () => {
  it('defaults to a Canvas2DRenderer instance', () => {
    TestBed.configureTestingModule({ providers: [] });
    const renderer = TestBed.inject(SCENE_RENDERER);
    expect(renderer).toBeInstanceOf(Canvas2DRenderer);
  });

  it('returns a fresh instance per injector (no shared state across test beds)', () => {
    TestBed.configureTestingModule({ providers: [] });
    const a = TestBed.inject(SCENE_RENDERER);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [] });
    const b = TestBed.inject(SCENE_RENDERER);
    expect(a).not.toBe(b);
  });
});
