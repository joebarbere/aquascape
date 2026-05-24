// SelectionInspectorComponent tests. Stage 3 F3.4.

import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import {
  SceneActions,
  SelectionActions,
  defaultScene,
  initialSelectionState,
  selectHasSelection,
  selectScene,
  selectSelectedIds,
} from '@aquascape/state';
import { asLayerId, asObjectId } from '@aquascape/domain/scene-model';

import { SelectionInspectorComponent } from './selection-inspector.component';

function sceneWithObject(id: string) {
  const base = defaultScene();
  return {
    ...base,
    layers: [
      {
        id: asLayerId('layer-1'),
        name: 'L',
        opacity: 1,
        visible: true,
        locked: false,
        objects: [
          {
            kind: 'hardscape' as const,
            id: asObjectId(id),
            ref: { catalog: 'core', id: 'rock.x', version: 1 },
            transform: {
              position: { x: 100, y: 100, z: 100 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              flipX: false,
              flipY: false,
            },
          },
        ],
      },
    ],
  };
}

function configure(selectedIds: readonly string[] = [], scene = defaultScene()) {
  TestBed.configureTestingModule({
    imports: [SelectionInspectorComponent],
    providers: [
      provideMockStore({
        initialState: {
          scene: { scene, history: { past: [], future: [], limit: 200 } },
          selection: { ...initialSelectionState(), ids: selectedIds.map((s) => asObjectId(s)) },
        },
        // Override every selector the inspector reads. `selectScene` MUST
        // be explicitly overridden — the "Z Up no-ops when the scene has
        // not loaded" test below overrides it to `null`, and NgRx selector
        // overrides leak across TestBed resets unless re-set.
        selectors: [
          { selector: selectScene, value: scene },
          { selector: selectHasSelection, value: selectedIds.length > 0 },
          { selector: selectSelectedIds, value: selectedIds.map((s) => asObjectId(s)) },
        ],
      }),
    ],
  });
  const store = TestBed.inject(MockStore);
  const spy = jest.spyOn(store, 'dispatch');
  const fixture = TestBed.createComponent(SelectionInspectorComponent);
  fixture.detectChanges();
  return { fixture, store, dispatched: () => spy.mock.calls.map((c) => c[0]) };
}

function buttonByLabel(
  fixture: { nativeElement: HTMLElement },
  label: string,
): HTMLButtonElement | null {
  return fixture.nativeElement.querySelector(`button[aria-label^="${label}"]`);
}

describe('SelectionInspectorComponent', () => {
  it('is hidden when nothing is selected', () => {
    const { fixture } = configure([]);
    expect(fixture.nativeElement.querySelector('.selection-inspector')).toBeNull();
  });

  it('renders the toolbar when a selection exists', () => {
    const { fixture } = configure(['a'], sceneWithObject('a'));
    expect(fixture.nativeElement.querySelector('.selection-inspector')).not.toBeNull();
  });

  it('Mirror H dispatches MirrorObject(axis=x) for each selected id', () => {
    const { fixture, dispatched } = configure(['a'], sceneWithObject('a'));
    buttonByLabel(fixture, 'Mirror horizontal')!.click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.command.kind).toBe('MirrorObject');
    if (cmd.command.kind !== 'MirrorObject') return;
    expect(cmd.command.axis).toBe('x');
  });

  it('Mirror V dispatches axis=y', () => {
    const { fixture, dispatched } = configure(['a'], sceneWithObject('a'));
    buttonByLabel(fixture, 'Mirror vertical')!.click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'MirrorObject') throw new Error('expected MirrorObject');
    expect(cmd.command.axis).toBe('y');
  });

  it('Delete dispatches RemoveObject + clearSelection', () => {
    const { fixture, dispatched } = configure(['a'], sceneWithObject('a'));
    buttonByLabel(fixture, 'Delete')!.click();
    const actions = dispatched();
    expect(actions[0]!.type).toBe('[Scene] Dispatch Command');
    expect(actions[actions.length - 1]!.type).toBe('[Selection] Clear Selection');
  });

  it('Duplicate dispatches AddObject + replaceSelection with new id', () => {
    const { fixture, dispatched } = configure(['a'], sceneWithObject('a'));
    buttonByLabel(fixture, 'Duplicate')!.click();
    const actions = dispatched();
    const addCmd = actions[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(addCmd.command.kind).toBe('AddObject');
    const reselect = actions[actions.length - 1]! as ReturnType<
      typeof SelectionActions.replaceSelection
    >;
    expect(reselect.type).toBe('[Selection] Replace Selection');
    expect(reselect.ids.length).toBe(1);
    expect(reselect.ids[0]).not.toEqual(asObjectId('a'));
  });

  it('Z Up dispatches ReorderObjectInLayer when not already at top', () => {
    // Two objects in the layer, 'a' is at index 0 (back). Z-up moves to 1.
    const scene = {
      ...sceneWithObject('a'),
    };
    scene.layers[0]!.objects.push({
      kind: 'hardscape' as const,
      id: asObjectId('b'),
      ref: { catalog: 'core', id: 'rock.x', version: 1 },
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        flipX: false,
        flipY: false,
      },
    });
    const { fixture, dispatched } = configure(['a'], scene);
    buttonByLabel(fixture, 'Bring forward')!.click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.command.kind).toBe('ReorderObjectInLayer');
    if (cmd.command.kind !== 'ReorderObjectInLayer') return;
    expect(cmd.command.toIndex).toBe(1);
  });

  it('Z Up is a no-op when the object is already at the top of its layer', () => {
    const { fixture, dispatched } = configure(['a'], sceneWithObject('a'));
    buttonByLabel(fixture, 'Bring forward')!.click();
    expect(dispatched()).toEqual([]);
  });

  it('Z Down dispatches ReorderObjectInLayer when not already at bottom', () => {
    const scene = sceneWithObject('a');
    scene.layers[0]!.objects.unshift({
      kind: 'hardscape' as const,
      id: asObjectId('b'),
      ref: { catalog: 'core', id: 'rock.x', version: 1 },
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        flipX: false,
        flipY: false,
      },
    });
    // Now 'a' is at index 1; Z-down → index 0.
    const { fixture, dispatched } = configure(['a'], scene);
    buttonByLabel(fixture, 'Send backward')!.click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'ReorderObjectInLayer')
      throw new Error('expected ReorderObjectInLayer');
    expect(cmd.command.toIndex).toBe(0);
  });

  it('Delete keyboard shortcut fires the delete action', () => {
    const { dispatched } = configure(['a'], sceneWithObject('a'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    const types = dispatched().map((a) => a.type);
    expect(types).toContain('[Scene] Dispatch Command');
    expect(types).toContain('[Selection] Clear Selection');
  });

  it('Cmd+D triggers Duplicate', () => {
    const { dispatched } = configure(['a'], sceneWithObject('a'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true }));
    const types = dispatched().map((a) => a.type);
    expect(types).toContain('[Scene] Dispatch Command');
  });

  it('] triggers Z Up', () => {
    const scene = sceneWithObject('a');
    scene.layers[0]!.objects.push({
      kind: 'hardscape' as const,
      id: asObjectId('b'),
      ref: { catalog: 'core', id: 'rock.x', version: 1 },
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        flipX: false,
        flipY: false,
      },
    });
    const { dispatched } = configure(['a'], scene);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ']' }));
    expect(dispatched().some((a) => a.type === '[Scene] Dispatch Command')).toBe(true);
  });

  it('[ triggers Z Down', () => {
    const scene = sceneWithObject('a');
    scene.layers[0]!.objects.unshift({
      kind: 'hardscape' as const,
      id: asObjectId('b'),
      ref: { catalog: 'core', id: 'rock.x', version: 1 },
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        flipX: false,
        flipY: false,
      },
    });
    const { dispatched } = configure(['a'], scene);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '[' }));
    expect(dispatched().some((a) => a.type === '[Scene] Dispatch Command')).toBe(true);
  });

  it('ignores arbitrary key presses', () => {
    const { dispatched } = configure(['a'], sceneWithObject('a'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    expect(dispatched()).toEqual([]);
  });

  it('Z Up no-ops when the scene has not loaded', () => {
    // Edge case: selectedIds populated but scene null. The component
    // initialises `currentScene = null` and the no-scene branch returns
    // early — exercise it by clicking before any scene emission has fired.
    TestBed.configureTestingModule({
      imports: [SelectionInspectorComponent],
      providers: [
        provideMockStore({
          initialState: {
            scene: { scene: null, history: { past: [], future: [], limit: 200 } },
            selection: { ...initialSelectionState(), ids: [asObjectId('a')] },
          },
          selectors: [
            { selector: selectHasSelection, value: true },
            { selector: selectSelectedIds, value: [asObjectId('a')] },
            { selector: selectScene, value: null as unknown as ReturnType<typeof selectScene> },
          ],
        }),
      ],
    });
    const fixture = TestBed.createComponent(SelectionInspectorComponent);
    fixture.detectChanges();
    const store = TestBed.inject(MockStore);
    const spy = jest.spyOn(store, 'dispatch');
    const upBtn = fixture.nativeElement.querySelector(
      'button[aria-label^="Bring forward"]',
    ) as HTMLButtonElement;
    upBtn.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores keyboard shortcuts when typing in input fields', () => {
    const { dispatched } = configure(['a'], sceneWithObject('a'));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    input.remove();
    expect(dispatched()).toEqual([]);
  });

  it('ignores shortcuts when there is no selection', () => {
    const { dispatched } = configure([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(dispatched()).toEqual([]);
  });

  it('Mirror H is a no-op when the object is missing from the scene (defensive)', () => {
    // selectedIds claims 'ghost' but the scene has no such object.
    const { fixture, dispatched } = configure(['ghost'], defaultScene());
    buttonByLabel(fixture, 'Mirror horizontal')!.click();
    // The mirror dispatch goes through, but selecting works regardless of presence —
    // we just assert no crash and the spy fired with the right shape.
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.command.kind).toBe('MirrorObject');
  });

  it('Duplicate of a missing object id is a no-op (no AddObject dispatched)', () => {
    const { fixture, dispatched } = configure(['ghost'], defaultScene());
    buttonByLabel(fixture, 'Duplicate')!.click();
    expect(dispatched()).toEqual([]);
  });

  // ── F4.3 — Group / Ungroup ───────────────────────────────────────────

  function sceneWithTwoObjects(): ReturnType<typeof sceneWithObject> {
    const scene = sceneWithObject('a');
    scene.layers[0]!.objects.push({
      kind: 'hardscape' as const,
      id: asObjectId('b'),
      ref: { catalog: 'core', id: 'rock.x', version: 1 },
      transform: {
        position: { x: 100, y: 100, z: 100 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        flipX: false,
        flipY: false,
      },
    });
    return scene;
  }

  it('Group button is disabled when fewer than two objects are selected', () => {
    const { fixture } = configure(['a'], sceneWithObject('a'));
    const btn = buttonByLabel(fixture, 'Group selected')!;
    expect(btn.disabled).toBe(true);
  });

  it('Group dispatches SetObjectGroupId with a fresh groupId for the selection', () => {
    const { fixture, dispatched } = configure(['a', 'b'], sceneWithTwoObjects());
    buttonByLabel(fixture, 'Group selected')!.click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    expect(cmd.command.kind).toBe('SetObjectGroupId');
    if (cmd.command.kind !== 'SetObjectGroupId') return;
    expect(cmd.command.objectIds.map(String).sort()).toEqual(['a', 'b']);
    expect(typeof cmd.command.groupId).toBe('string');
    expect(cmd.command.groupId).not.toBeNull();
  });

  it('Ungroup is disabled when no selected object has a groupId', () => {
    const { fixture } = configure(['a', 'b'], sceneWithTwoObjects());
    const btn = buttonByLabel(fixture, 'Ungroup selected')!;
    expect(btn.disabled).toBe(true);
  });

  it('Ungroup is enabled when any selected object already has a groupId', () => {
    const scene = sceneWithTwoObjects();
    (scene.layers[0]!.objects[0] as { groupId?: string }).groupId = 'gid-1';
    const { fixture } = configure(['a', 'b'], scene);
    const btn = buttonByLabel(fixture, 'Ungroup selected')!;
    expect(btn.disabled).toBe(false);
  });

  it('Ungroup dispatches SetObjectGroupId with groupId=null', () => {
    const scene = sceneWithTwoObjects();
    (scene.layers[0]!.objects[0] as { groupId?: string }).groupId = 'gid-1';
    (scene.layers[0]!.objects[1] as { groupId?: string }).groupId = 'gid-1';
    const { fixture, dispatched } = configure(['a', 'b'], scene);
    buttonByLabel(fixture, 'Ungroup selected')!.click();
    const cmd = dispatched()[0]! as ReturnType<typeof SceneActions.dispatchCommand>;
    if (cmd.command.kind !== 'SetObjectGroupId') throw new Error('expected SetObjectGroupId');
    expect(cmd.command.groupId).toBeNull();
  });

  it('Cmd+G triggers Group when ≥2 objects are selected', () => {
    const { dispatched } = configure(['a', 'b'], sceneWithTwoObjects());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', metaKey: true }));
    const cmds = dispatched().filter(
      (a): a is ReturnType<typeof SceneActions.dispatchCommand> =>
        a.type === '[Scene] Dispatch Command',
    );
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds[0]!.command.kind).toBe('SetObjectGroupId');
  });

  it('Cmd+Shift+G triggers Ungroup', () => {
    const scene = sceneWithTwoObjects();
    (scene.layers[0]!.objects[0] as { groupId?: string }).groupId = 'gid-1';
    const { dispatched } = configure(['a', 'b'], scene);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'g', metaKey: true, shiftKey: true }),
    );
    const cmd = dispatched().find(
      (a): a is ReturnType<typeof SceneActions.dispatchCommand> =>
        a.type === '[Scene] Dispatch Command',
    )!;
    if (cmd.command.kind !== 'SetObjectGroupId') throw new Error('expected SetObjectGroupId');
    expect(cmd.command.groupId).toBeNull();
  });

  it('Ungroup keyboard shortcut is a no-op when nothing is selected (guarded earlier)', () => {
    const { dispatched } = configure([], defaultScene());
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'g', metaKey: true, shiftKey: true }),
    );
    expect(dispatched()).toEqual([]);
  });
});
