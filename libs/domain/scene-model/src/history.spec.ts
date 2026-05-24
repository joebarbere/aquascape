import {
  addLayer,
  addObject,
  applyCommand,
  moveObject,
  noop,
  removeObject,
  renameLayer,
} from './commands';
import type { Command } from './commands';
import { createHistory } from './history';
import { asLayerId, asObjectId } from './ids';
import { getLayerById } from './selectors';
import { makeHardscape, makeLayer, makeScene } from './test-fixtures';
import type { Scene } from './types';

const layer1 = asLayerId('11111111-0000-4000-8000-000000000001');

function replay(commands: Command[]): Scene {
  let scene = makeScene();
  for (const c of commands) {
    const r = applyCommand(scene, c);
    if (!r.ok) throw new Error(`replay failed: ${r.reason}`);
    scene = r.scene;
  }
  return scene;
}

describe('createHistory', () => {
  it('starts empty', () => {
    const h = createHistory();
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.bound).toBe(200);
  });

  it('respects a custom bound', () => {
    const h = createHistory({ bound: 5 });
    expect(h.bound).toBe(5);
  });

  it('throws on non-positive bound', () => {
    expect(() => createHistory({ bound: 0 })).toThrow();
    expect(() => createHistory({ bound: -1 })).toThrow();
    expect(() => createHistory({ bound: 1.5 })).toThrow();
  });
});

describe('History.push / undo / redo', () => {
  it('push records and advances the scene', () => {
    const scene = makeScene();
    const h0 = createHistory();
    const r = h0.push(renameLayer(layer1, 'Renamed'), scene);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.history.past).toHaveLength(1);
    expect(getLayerById(r.scene, layer1)?.name).toBe('Renamed');
  });

  it('push returns null when command would be rejected', () => {
    const scene = makeScene();
    const h0 = createHistory();
    expect(h0.push(renameLayer(asLayerId('nope'), 'x'), scene)).toBeNull();
  });

  it('undo on empty history returns null', () => {
    expect(createHistory().undo(makeScene())).toBeNull();
  });

  it('redo on empty future returns null', () => {
    expect(createHistory().redo(makeScene())).toBeNull();
  });

  it('push then undo restores the original scene', () => {
    const scene = makeScene();
    const r1 = createHistory().push(renameLayer(layer1, 'Renamed'), scene);
    if (!r1) throw new Error('push failed');
    const r2 = r1.history.undo(r1.scene);
    if (!r2) throw new Error('undo failed');
    expect(r2.scene).toEqual(scene);
    expect(r2.history.past).toEqual([]);
    expect(r2.history.future).toHaveLength(1);
  });

  it('undo then redo round-trips', () => {
    const scene = makeScene();
    const r1 = createHistory().push(renameLayer(layer1, 'A'), scene);
    if (!r1) throw new Error();
    const r2 = r1.history.undo(r1.scene);
    if (!r2) throw new Error();
    const r3 = r2.history.redo(r2.scene);
    if (!r3) throw new Error();
    expect(r3.scene).toEqual(r1.scene);
    expect(r3.history.past).toHaveLength(1);
    expect(r3.history.future).toHaveLength(0);
  });

  it('push after undo truncates the redo stack', () => {
    const scene = makeScene();
    const r1 = createHistory().push(renameLayer(layer1, 'A'), scene);
    if (!r1) throw new Error();
    const r2 = r1.history.undo(r1.scene);
    if (!r2) throw new Error();
    // r2.future has the undone entry. Pushing a new command must drop it.
    const r3 = r2.history.push(renameLayer(layer1, 'B'), r2.scene);
    if (!r3) throw new Error();
    expect(r3.history.future).toEqual([]);
    expect(r3.history.past).toHaveLength(1);
    expect(getLayerById(r3.scene, layer1)?.name).toBe('B');
  });

  it('honours the bound (oldest dropped)', () => {
    const scene = makeScene();
    let history = createHistory({ bound: 3 });
    let current = scene;
    const names = ['A', 'B', 'C', 'D', 'E'];
    for (const n of names) {
      const r = history.push(renameLayer(layer1, n), current);
      if (!r) throw new Error();
      history = r.history;
      current = r.scene;
    }
    expect(history.past).toHaveLength(3);
    // Only the last three pushes are still undoable.
    let s = current;
    let h = history;
    const undone: string[] = [];
    while (true) {
      const r = h.undo(s);
      if (!r) break;
      s = r.scene;
      h = r.history;
      const name = getLayerById(s, layer1)?.name;
      if (name !== undefined) undone.push(name);
    }
    // After three undos we're at the state after pushing 'B' (last dropped is
    // 'A', then 'B' was the 2nd push, 3rd is 'C' on top). Undoing all three
    // peels back to the state after 'B'.
    expect(undone).toContain('D');
    expect(undone).toContain('C');
    expect(undone).toContain('B');
  });

  it('undo across multiple pushes peels back in reverse order', () => {
    const scene = makeScene();
    let history = createHistory();
    let current = scene;
    const cmds: Command[] = [
      addLayer(makeLayer('11111111-0000-4000-8000-00000000aa01', 'L1')),
      renameLayer(layer1, 'X'),
      moveObject(asObjectId('aaaaaaaa-0000-4000-8000-000000000001'), {
        x: 0,
        y: 0,
        z: 0,
      }),
    ];
    for (const c of cmds) {
      const r = history.push(c, current);
      if (!r) throw new Error();
      history = r.history;
      current = r.scene;
    }
    // Undo three times -> back to original
    for (let i = 0; i < 3; i++) {
      const r = history.undo(current);
      if (!r) throw new Error();
      history = r.history;
      current = r.scene;
    }
    expect(current).toEqual(scene);
  });

  it('replay invariant: state equals replaying the live (non-undone) commands', () => {
    const scene = makeScene();
    let history = createHistory();
    let current = scene;
    const liveCommands: Command[] = [];
    const ops: Array<{ kind: 'push'; cmd: Command } | { kind: 'undo' } | { kind: 'redo' }> = [
      { kind: 'push', cmd: renameLayer(layer1, 'A') },
      { kind: 'push', cmd: renameLayer(layer1, 'B') },
      { kind: 'undo' },
      { kind: 'push', cmd: renameLayer(layer1, 'C') },
      { kind: 'undo' },
      { kind: 'redo' },
    ];
    for (const op of ops) {
      if (op.kind === 'push') {
        const r = history.push(op.cmd, current);
        if (!r) throw new Error();
        history = r.history;
        current = r.scene;
        liveCommands.push(op.cmd);
      } else if (op.kind === 'undo') {
        const r = history.undo(current);
        if (!r) throw new Error();
        history = r.history;
        current = r.scene;
        liveCommands.pop();
      } else {
        const r = history.redo(current);
        if (!r) throw new Error();
        history = r.history;
        current = r.scene;
        // The just-redone command is the one at the head of past.
        const entry = history.past[history.past.length - 1];
        if (entry) liveCommands.push(entry.command);
      }
    }
    expect(current).toEqual(replay(liveCommands));
  });

  it('immutability: prior history values are not mutated by later ops', () => {
    const scene = makeScene();
    const h0 = createHistory();
    const r1 = h0.push(renameLayer(layer1, 'A'), scene);
    if (!r1) throw new Error();
    const beforePast = h0.past;
    const r2 = r1.history.push(renameLayer(layer1, 'B'), r1.scene);
    if (!r2) throw new Error();
    expect(h0.past).toBe(beforePast);
    expect(h0.past).toHaveLength(0);
    expect(r1.history.past).toHaveLength(1);
    expect(r2.history.past).toHaveLength(2);
  });

  it('noop command is recorded and undoable', () => {
    const scene = makeScene();
    const r1 = createHistory().push(noop(), scene);
    if (!r1) throw new Error();
    expect(r1.scene).toBe(scene);
    const r2 = r1.history.undo(r1.scene);
    if (!r2) throw new Error();
    expect(r2.scene).toEqual(scene);
  });

  it('add-then-remove object across history round-trips', () => {
    const scene = makeScene();
    const obj = makeHardscape('cccccccc-0000-4000-8000-0000000000ff');
    let h = createHistory();
    let s = scene;
    const r1 = h.push(addObject(layer1, obj), s);
    if (!r1) throw new Error();
    h = r1.history;
    s = r1.scene;
    const r2 = h.push(removeObject(obj.id), s);
    if (!r2) throw new Error();
    h = r2.history;
    s = r2.scene;
    // undo twice
    const u1 = h.undo(s);
    if (!u1) throw new Error();
    const u2 = u1.history.undo(u1.scene);
    if (!u2) throw new Error();
    expect(u2.scene).toEqual(scene);
  });
});
