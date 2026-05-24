// Tests for the preload bridge factory. Together with the ipc-handlers
// tests, this proves the renderer→preload→main path without booting
// Electron — the same FakeIpcMain instance plays both sides of the wire.

import { registerIpcHandlers } from '../main/ipc-handlers';
import { IPC_CHANNELS } from '../shared/ipc-contract';
import { buildBridge, type BridgeInvoker } from './build-bridge';

describe('buildBridge', () => {
  it('exposes a function for every IPC channel', () => {
    const invoker: BridgeInvoker = { invoke: jest.fn().mockResolvedValue(null) };
    const bridge = buildBridge(invoker) as Record<string, unknown>;
    for (const channel of IPC_CHANNELS) {
      expect(typeof bridge[channel]).toBe('function');
    }
  });

  it('forwards ping(payload) to invoker.invoke("ping", payload)', async () => {
    const invoke = jest.fn().mockResolvedValue({ pong: true, receivedAt: 42 });
    const bridge = buildBridge({ invoke });

    const result = await bridge.ping({ ts: 7 });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('ping', { ts: 7 });
    expect(result).toEqual({ pong: true, receivedAt: 42 });
  });

  it('forwards file.open() with no payload', async () => {
    const invoke = jest.fn().mockResolvedValue(null);
    const bridge = buildBridge({ invoke });
    await bridge['file.open']();
    expect(invoke).toHaveBeenCalledWith('file.open');
  });

  it('forwards storage.set(payload) faithfully', async () => {
    const invoke = jest.fn().mockResolvedValue(undefined);
    const bridge = buildBridge({ invoke });
    await bridge['storage.set']({ key: 'k', value: { x: 1 } });
    expect(invoke).toHaveBeenCalledWith('storage.set', { key: 'k', value: { x: 1 } });
  });

  it('does not expose raw ipcRenderer methods', () => {
    const bridge = buildBridge({ invoke: jest.fn() }) as Record<string, unknown>;
    expect(Object.keys(bridge).sort()).toEqual([...IPC_CHANNELS].sort());
    expect('send' in bridge).toBe(false);
    expect('on' in bridge).toBe(false);
    expect('postMessage' in bridge).toBe(false);
  });
});

describe('preload bridge + main handlers end-to-end (no Electron)', () => {
  // A single fake plays both ipcRenderer (for the bridge) and ipcMain
  // (for the registrar). This is the closest we can get to a real round-trip
  // without spawning Electron.
  class Fake {
    private readonly handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();

    handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void {
      this.handlers.set(channel, listener);
    }

    async invoke(channel: string, payload?: unknown): Promise<unknown> {
      const handler = this.handlers.get(channel);
      if (handler === undefined) throw new Error(`no handler for ${channel}`);
      return handler({}, payload);
    }
  }

  // Reusable deps stub — every backend is a no-op that returns plausible data.
  function makeDeps() {
    const storage = new Map<string, unknown>();
    return {
      now: () => 12345,
      file: {
        showOpenPicker: async () => ({ id: '/p/a.aqua', name: 'a.aqua' }),
        showSavePicker: async (a: { suggestedName: string }) => ({
          id: `/p/${a.suggestedName}`,
          name: a.suggestedName,
        }),
        readFile: async () => new Uint8Array([1]),
        writeFile: async () => undefined,
        basename: (id: string) => id.split('/').pop() ?? id,
      },
      dialog: {
        confirm: async () => true,
        alert: async () => undefined,
      },
      storage: {
        get: async (k: string) => storage.get(k) ?? null,
        set: async (k: string, v: unknown) => {
          storage.set(k, v);
        },
        remove: async (k: string) => {
          storage.delete(k);
        },
      },
      export: {
        exportPng: async (a: { suggestedName: string }) => ({ path: `/x/${a.suggestedName}` }),
      },
    };
  }

  it('ping → pong round-trips through the bridge and the handler', async () => {
    const fake = new Fake();
    registerIpcHandlers(fake, makeDeps());
    const bridge = buildBridge({ invoke: (channel, payload) => fake.invoke(channel, payload) });
    const result = await bridge.ping({ ts: 1 });
    expect(result).toEqual({ pong: true, receivedAt: 12345 });
  });

  it('rejects when the renderer hands the bridge an invalid payload that escapes its types', async () => {
    const fake = new Fake();
    registerIpcHandlers(fake, makeDeps());
    const bridge = buildBridge({ invoke: (channel, payload) => fake.invoke(channel, payload) });
    await expect(
      (bridge.ping as (p: unknown) => Promise<unknown>)({ ts: 'nope' }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('file.save → handler writes bytes via the FileBackend', async () => {
    const fake = new Fake();
    const deps = makeDeps();
    const writeSpy = jest.spyOn(deps.file, 'writeFile');
    registerIpcHandlers(fake, deps);
    const bridge = buildBridge({ invoke: (channel, payload) => fake.invoke(channel, payload) });
    const result = await bridge['file.save']({
      id: '/p/x.aqua',
      bytes: new Uint8Array([7, 8]),
      suggestedName: 'x.aqua',
    });
    expect(result).toEqual({ id: '/p/x.aqua' });
    expect(writeSpy).toHaveBeenCalledWith('/p/x.aqua', new Uint8Array([7, 8]));
  });

  it('storage.get returns null for an unknown key', async () => {
    const fake = new Fake();
    registerIpcHandlers(fake, makeDeps());
    const bridge = buildBridge({ invoke: (channel, payload) => fake.invoke(channel, payload) });
    expect(await bridge['storage.get']({ key: 'missing' })).toBeNull();
  });
});
