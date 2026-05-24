// Tests for the preload bridge factory. Together with the ipc-handlers
// tests, this proves the renderer→preload→main path without booting
// Electron — the same FakeIpcMain instance plays both sides of the wire.

import { registerIpcHandlers } from '../main/ipc-handlers';
import { buildBridge, type BridgeInvoker } from './build-bridge';

describe('buildBridge', () => {
  it('exposes a ping function on the bridge', () => {
    const invoker: BridgeInvoker = {
      invoke: jest.fn().mockResolvedValue({ pong: true, receivedAt: 1 }),
    };
    const bridge = buildBridge(invoker);
    expect(typeof bridge.ping).toBe('function');
  });

  it('forwards ping(payload) to invoker.invoke("ping", payload)', async () => {
    const invoke = jest.fn().mockResolvedValue({ pong: true, receivedAt: 42 });
    const bridge = buildBridge({ invoke });

    const result = await bridge.ping({ ts: 7 });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('ping', { ts: 7 });
    expect(result).toEqual({ pong: true, receivedAt: 42 });
  });

  it('does not expose raw ipcRenderer methods', () => {
    const bridge = buildBridge({ invoke: jest.fn() }) as Record<string, unknown>;
    // The bridge is exactly the typed contract — nothing else.
    expect(Object.keys(bridge).sort()).toEqual(['ping']);
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

    async invoke(channel: string, payload: unknown): Promise<unknown> {
      const handler = this.handlers.get(channel);
      if (handler === undefined) throw new Error(`no handler for ${channel}`);
      return handler({}, payload);
    }
  }

  it('ping → pong round-trips through the bridge and the handler', async () => {
    const fake = new Fake();
    registerIpcHandlers(fake, { now: () => 12345 });
    const bridge = buildBridge({ invoke: (channel, payload) => fake.invoke(channel, payload) });

    const result = await bridge.ping({ ts: 1 });

    expect(result).toEqual({ pong: true, receivedAt: 12345 });
  });

  it('rejects when the renderer hands the bridge an invalid payload that escapes its types', async () => {
    const fake = new Fake();
    registerIpcHandlers(fake);
    const bridge = buildBridge({ invoke: (channel, payload) => fake.invoke(channel, payload) });

    // Simulate a renderer that bypasses the types (e.g. compromised /
    // malicious code). The main-process validator must still reject.
    await expect(
      (bridge.ping as (p: unknown) => Promise<unknown>)({ ts: 'nope' }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
