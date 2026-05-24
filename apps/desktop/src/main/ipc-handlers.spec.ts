// Tests for the main-process IPC handlers — exercised without booting
// Electron by driving the pure factory functions directly.

import { HandlerHost, handlePing, registerIpcHandlers, validatePingPayload } from './ipc-handlers';

class FakeIpcMain implements HandlerHost {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  async invoke(channel: string, payload: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error(`no handler for ${channel}`);
    return handler({}, payload);
  }
}

describe('validatePingPayload', () => {
  it('accepts a finite-number ts', () => {
    expect(validatePingPayload({ ts: 0 })).toEqual({ ts: 0 });
    expect(validatePingPayload({ ts: 1e12 })).toEqual({ ts: 1e12 });
  });

  it('rejects non-objects', () => {
    expect(() => validatePingPayload(null)).toThrow(TypeError);
    expect(() => validatePingPayload(42)).toThrow(TypeError);
    expect(() => validatePingPayload('hi')).toThrow(TypeError);
  });

  it('rejects missing or non-numeric ts', () => {
    expect(() => validatePingPayload({})).toThrow(TypeError);
    expect(() => validatePingPayload({ ts: 'now' })).toThrow(TypeError);
    expect(() => validatePingPayload({ ts: Number.NaN })).toThrow(TypeError);
    expect(() => validatePingPayload({ ts: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });

  it('does not echo the offending value back through the error message', () => {
    try {
      validatePingPayload({ ts: 'super-secret-token' });
      fail('expected validation to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
      expect((err as Error).message).not.toContain('super-secret-token');
    }
  });
});

describe('handlePing', () => {
  it('returns { pong: true, receivedAt: <now()> }', () => {
    const result = handlePing({ ts: 100 }, { now: () => 999 });
    expect(result).toEqual({ pong: true, receivedAt: 999 });
  });

  it('throws on invalid payload', () => {
    expect(() => handlePing({ ts: 'nope' }, { now: () => 0 })).toThrow(TypeError);
  });
});

describe('registerIpcHandlers', () => {
  it('registers a ping handler that round-trips through the fake ipcMain', async () => {
    const host = new FakeIpcMain();
    registerIpcHandlers(host, { now: () => 555 });

    const result = await host.invoke('ping', { ts: 10 });
    expect(result).toEqual({ pong: true, receivedAt: 555 });
  });

  it('rejects when the renderer sends an invalid payload', async () => {
    const host = new FakeIpcMain();
    registerIpcHandlers(host, { now: () => 0 });

    await expect(host.invoke('ping', { ts: 'no' })).rejects.toBeInstanceOf(TypeError);
  });

  it('registers exactly the channels declared in IPC_CHANNELS', () => {
    const host = new FakeIpcMain();
    registerIpcHandlers(host);
    expect([...host.handlers.keys()].sort()).toEqual(['ping']);
  });
});
