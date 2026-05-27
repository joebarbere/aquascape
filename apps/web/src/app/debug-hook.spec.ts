// Tests for the read-only Playwright debug hook on
// `window.__aquascape_debug__`. Stage 11 follow-up.
//
// Scope:
//   1. Hook is attached after AppComponent boot in dev (jest) mode and
//      cleared on destroy.
//   2. `getEntityCount()` returns 0 before livestock loads + the spawned
//      count after a livestock-bearing scene emits.
//   3. `getScene()` returns the current store scene.
//   4. `getViewMode()` mirrors `ViewModeService.mode()`.
//
// We deliberately mock SCENE_RENDERER + use provideMockStore for the same
// reasons app.component.spec.ts does — the debug hook reads through the
// real services (LivestockSimulationService + ViewModeService + Store), so
// no further stubbing is needed.

import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { EMPTY } from 'rxjs';

import { asObjectId } from '@aquascape/domain/scene-model';
import type { Scene } from '@aquascape/domain/scene-model';
import {
  DIALOG_SERVICE,
  FILE_SERVICE,
  RENDER_EXPORT_SERVICE,
  STORAGE_SERVICE,
} from '@aquascape/platform/platform-api/angular';
import { createWebPlatform } from '@aquascape/platform/platform-web';
import type {
  HitResult,
  RenderOptions,
  RenderSurface,
  SceneRenderer,
  Viewport,
} from '@aquascape/rendering/renderer-api';
import { ViewModeService } from '@aquascape/features/editor-shell';
import {
  defaultScene,
  initialDocumentState,
  initialSelectionState,
  selectCanRedo,
  selectCanUndo,
  selectDisplayTitle,
  selectHasPendingDraft,
  selectHasSelection,
  selectLastError,
  selectPendingDraft,
  selectRecentFiles,
  selectScene,
  selectSelectedIds,
  selectStatus,
} from '@aquascape/state';

import { AppComponent } from './app.component';
import { SCENE_RENDERER_2D, SCENE_RENDERER_3D } from './renderer.token';

class MockSceneRenderer implements SceneRenderer {
  readonly attach = jest.fn<void, [RenderSurface]>();
  readonly render = jest.fn<void, [Scene, Viewport, RenderOptions?]>();
  readonly hitTest = jest.fn<HitResult | null, unknown[]>(() => null);
  readonly dispose = jest.fn<void, []>();
}

/** Mirror app.component.spec.ts's TestBed wiring — every store slice the
 *  composed children read from has to be present so child component
 *  instantiation doesn't crash before assertions land. */
function configure(initialScene: Scene = defaultScene()): void {
  const platform = createWebPlatform();
  const renderer2d = new MockSceneRenderer();
  const renderer3d = new MockSceneRenderer();
  TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      { provide: SCENE_RENDERER_2D, useValue: renderer2d },
      { provide: SCENE_RENDERER_3D, useValue: renderer3d },
      { provide: FILE_SERVICE, useValue: platform.fileService },
      { provide: DIALOG_SERVICE, useValue: platform.dialogService },
      { provide: STORAGE_SERVICE, useValue: platform.storageService },
      { provide: RENDER_EXPORT_SERVICE, useValue: platform.renderExportService },
      provideMockStore({
        initialState: {
          document: initialDocumentState(),
          selection: initialSelectionState(),
        },
        selectors: [
          { selector: selectScene, value: initialScene },
          { selector: selectDisplayTitle, value: 'Untitled' },
          { selector: selectStatus, value: 'idle' as const },
          { selector: selectRecentFiles, value: [] },
          { selector: selectHasPendingDraft, value: false },
          { selector: selectPendingDraft, value: null },
          { selector: selectLastError, value: null },
          { selector: selectSelectedIds, value: [] },
          { selector: selectHasSelection, value: false },
          { selector: selectCanUndo, value: false },
          { selector: selectCanRedo, value: false },
        ],
      }),
      // See app.component.spec.ts — Actions must be provided so the
      // LivestockSimulationService constructor's inject(Actions) resolves.
      provideMockActions(() => EMPTY),
    ],
  });
}

/** Scene fixture with a single livestock entry (4 neon-tetras). The
 *  `LivestockSimulationService` will spawn 4 ECS entities on first emission. */
function sceneWithFish(quantity = 4): Scene {
  return {
    ...defaultScene(),
    seed: 42,
    livestock: [
      {
        id: asObjectId('e1'),
        ref: { catalog: 'core', id: 'livestock.fish.neon-tetra', version: 1 },
        quantity,
      },
    ],
  };
}

describe('debug hook — attachment lifecycle', () => {
  afterEach(() => {
    // Belt-and-braces: even if a test forgets to destroy the fixture,
    // clear the global so leakage into the next test is impossible.
    delete (window as Window).__aquascape_debug__;
  });

  it('attaches window.__aquascape_debug__ after AppComponent initialises (dev/jest mode)', () => {
    configure();
    expect(window.__aquascape_debug__).toBeUndefined();
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(window.__aquascape_debug__).toBeDefined();
    // All four accessors are present + callable.
    const handle = window.__aquascape_debug__!;
    expect(typeof handle.getWorld).toBe('function');
    expect(typeof handle.getEntityCount).toBe('function');
    expect(typeof handle.getScene).toBe('function');
    expect(typeof handle.getViewMode).toBe('function');
    fixture.destroy();
  });

  it('clears window.__aquascape_debug__ on AppComponent destroy', () => {
    configure();
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(window.__aquascape_debug__).toBeDefined();
    fixture.destroy();
    expect(window.__aquascape_debug__).toBeUndefined();
  });
});

describe('debug hook — read-only accessors', () => {
  afterEach(() => {
    delete (window as Window).__aquascape_debug__;
  });

  it('getEntityCount() returns 0 before livestock loads', () => {
    // Default scene has no livestock → no world built → 0.
    configure(defaultScene());
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(window.__aquascape_debug__!.getEntityCount()).toBe(0);
    expect(window.__aquascape_debug__!.getWorld()).toBeNull();
    fixture.destroy();
  });

  it('getEntityCount() reflects the spawned ECS count after a livestock scene emits', () => {
    configure(defaultScene());
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(window.__aquascape_debug__!.getEntityCount()).toBe(0);

    // Push a livestock-bearing scene through the store — the simulation
    // service subscribes at construction, so the override + refreshState
    // triggers spawn synchronously.
    const store = TestBed.inject(MockStore);
    store.overrideSelector(selectScene, sceneWithFish(6));
    store.refreshState();

    expect(window.__aquascape_debug__!.getEntityCount()).toBe(6);
    expect(window.__aquascape_debug__!.getWorld()).not.toBeNull();
    fixture.destroy();
  });

  it('getScene() returns the current scene from the store', () => {
    const initial = defaultScene();
    configure(initial);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(window.__aquascape_debug__!.getScene()).toEqual(initial);

    // Mutate the store and re-read — the hook reads through to the store
    // each call, so the new scene is observed without re-attach.
    const grown: Scene = {
      ...initial,
      tank: { ...initial.tank, width: 1200, height: 450, depth: 450 },
    };
    const store = TestBed.inject(MockStore);
    store.overrideSelector(selectScene, grown);
    store.refreshState();
    expect(window.__aquascape_debug__!.getScene()).toEqual(grown);
    fixture.destroy();
  });

  it('getViewMode() mirrors ViewModeService.mode()', () => {
    configure();
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(window.__aquascape_debug__!.getViewMode()).toBe('2d');

    const vm = TestBed.inject(ViewModeService);
    vm.setMode('3d');
    expect(window.__aquascape_debug__!.getViewMode()).toBe('3d');
    fixture.destroy();
  });

  it('the hook exposes ONLY the read-only accessors (no dispatch / mutator surface)', () => {
    configure();
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const handle = window.__aquascape_debug__!;
    // Sort for stable comparison.
    const keys = Object.keys(handle).sort();
    expect(keys).toEqual([
      'getEntityCount',
      'getFoodSpriteCount',
      'getScene',
      'getViewMode',
      'getWorld',
    ]);
    // None of the obvious mutator names should be reachable through the
    // typed surface (and runtime check guards against accidental
    // additions slipping past the type system in future edits).
    expect((handle as Record<string, unknown>).dispatch).toBeUndefined();
    expect((handle as Record<string, unknown>).setMode).toBeUndefined();
    expect((handle as Record<string, unknown>).spawnFish).toBeUndefined();
    fixture.destroy();
  });

  it('getFoodSpriteCount() returns 0 before livestock loads (no world built)', () => {
    configure(defaultScene());
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(window.__aquascape_debug__!.getFoodSpriteCount()).toBe(0);
    fixture.destroy();
  });

  it('getFoodSpriteCount() reflects sprites spawned on the live world', () => {
    configure(defaultScene());
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(window.__aquascape_debug__!.getFoodSpriteCount()).toBe(0);

    // Push a livestock scene through so the world materialises, then
    // spawn sprites directly on the world handle the debug hook exposes.
    // (The Feed tank pulse pipeline is tested separately in the
    // livestock-simulation.service spec; here we just verify the debug
    // hook's accessor reads through to the same world.)
    const store = TestBed.inject(MockStore);
    store.overrideSelector(selectScene, sceneWithFish(2));
    store.refreshState();
    const world = window.__aquascape_debug__!.getWorld()!;
    expect(world).not.toBeNull();
    world.spawnFoodSprite({ x: 100, y: 200, z: 100 });
    world.spawnFoodSprite({ x: 200, y: 200, z: 200 });
    expect(window.__aquascape_debug__!.getFoodSpriteCount()).toBe(2);
    fixture.destroy();
  });
});
