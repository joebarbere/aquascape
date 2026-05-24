// Smoke tests for the scene action group. The point is to lock the action
// type strings + payload shapes so devtools / replay tooling don't drift
// silently.

import { setTankDimensions } from '@aquascape/domain/scene-model';

import { SceneActions } from './scene.actions';

describe('SceneActions', () => {
  it('dispatchCommand carries the full command record', () => {
    const command = setTankDimensions({ width: 600, height: 360, depth: 360 });
    const action = SceneActions.dispatchCommand({ command });
    expect(action.type).toBe('[Scene] Dispatch Command');
    expect(action.command).toBe(command);
  });

  it('applyCommandSucceeded carries scene + history', () => {
    const action = SceneActions.applyCommandSucceeded({
      scene: { tank: {} } as never,
      history: { past: [], future: [], bound: 1 } as never,
    });
    expect(action.type).toBe('[Scene] Apply Command Succeeded');
  });

  it('commandRejected carries a typed reason + message', () => {
    const action = SceneActions.commandRejected({
      reason: 'invalid',
      message: 'oops',
    });
    expect(action.type).toBe('[Scene] Command Rejected');
    expect(action.reason).toBe('invalid');
    expect(action.message).toBe('oops');
  });

  it('undo / redo are empty-payload actions', () => {
    expect(SceneActions.undo().type).toBe('[Scene] Undo');
    expect(SceneActions.redo().type).toBe('[Scene] Redo');
  });

  it('setTankPresetRef accepts both a CatalogRef and null', () => {
    const setAction = SceneActions.setTankPresetRef({
      presetRef: { catalog: 'core', id: 'ada.mini-m', version: 1 },
    });
    expect(setAction.type).toBe('[Scene] Set Tank Preset Ref');
    expect(setAction.presetRef).toEqual({
      catalog: 'core',
      id: 'ada.mini-m',
      version: 1,
    });

    const clearAction = SceneActions.setTankPresetRef({ presetRef: null });
    expect(clearAction.presetRef).toBeNull();
  });
});
