// Verifies that the SCENE_RENDERER_{2D,3D} token default factories yield
// the matching concrete renderer. The production composition root depends
// on these defaults (no explicit provider needed in main.ts).

import { TestBed } from '@angular/core/testing';
import { Canvas2DRenderer } from '@aquascape/rendering/renderer-2d';
import { Three3DRenderer } from '@aquascape/rendering/renderer-3d';

import { SCENE_RENDERER_2D, SCENE_RENDERER_3D } from './renderer.token';

describe('SCENE_RENDERER_2D token', () => {
  it('defaults to a Canvas2DRenderer instance', () => {
    TestBed.configureTestingModule({ providers: [] });
    const renderer = TestBed.inject(SCENE_RENDERER_2D);
    expect(renderer).toBeInstanceOf(Canvas2DRenderer);
  });

  it('returns a fresh instance per injector (no shared state across test beds)', () => {
    TestBed.configureTestingModule({ providers: [] });
    const a = TestBed.inject(SCENE_RENDERER_2D);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [] });
    const b = TestBed.inject(SCENE_RENDERER_2D);
    expect(a).not.toBe(b);
  });
});

describe('SCENE_RENDERER_3D token', () => {
  it('defaults to a Three3DRenderer instance', () => {
    TestBed.configureTestingModule({ providers: [] });
    const renderer = TestBed.inject(SCENE_RENDERER_3D);
    expect(renderer).toBeInstanceOf(Three3DRenderer);
  });

  it('returns a fresh instance per injector (no shared state across test beds)', () => {
    TestBed.configureTestingModule({ providers: [] });
    const a = TestBed.inject(SCENE_RENDERER_3D);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [] });
    const b = TestBed.inject(SCENE_RENDERER_3D);
    expect(a).not.toBe(b);
  });

  it('the 2D and 3D tokens yield different renderer classes', () => {
    TestBed.configureTestingModule({ providers: [] });
    const two = TestBed.inject(SCENE_RENDERER_2D);
    const three = TestBed.inject(SCENE_RENDERER_3D);
    expect(two).not.toBe(three);
    expect(two).toBeInstanceOf(Canvas2DRenderer);
    expect(three).toBeInstanceOf(Three3DRenderer);
  });
});
