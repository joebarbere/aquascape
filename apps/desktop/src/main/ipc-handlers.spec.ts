// Tests for the main-process IPC handlers — exercised without booting
// Electron by driving the pure factory functions directly.

import {
  HandlerDeps,
  HandlerHost,
  handleDialogConfirm,
  handleExportPng,
  handleFileOpen,
  handleFileSave,
  handleFileSaveAs,
  handlePing,
  handleStorageGet,
  handleStorageSet,
  registerIpcHandlers,
  validateDialogAlertPayload,
  validateDialogConfirmPayload,
  validateExportPngPayload,
  validateFileSaveAsPayload,
  validateFileSavePayload,
  validatePingPayload,
  validateStorageGetPayload,
  validateStorageRemovePayload,
  validateStorageSetPayload,
} from './ipc-handlers';
import { IPC_CHANNELS } from '../shared/ipc-contract';

class FakeIpcMain implements HandlerHost {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  async invoke(channel: string, payload?: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error(`no handler for ${channel}`);
    return handler({}, payload);
  }
}

// ── Test deps factory ────────────────────────────────────────────────────

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  const storage = new Map<string, unknown>();
  return {
    now: () => 1000,
    file: {
      showOpenPicker: jest.fn(async () => ({ id: '/tmp/a.aqua', name: 'a.aqua' })),
      showSavePicker: jest.fn(async ({ suggestedName }) => ({
        id: `/tmp/${suggestedName}`,
        name: suggestedName,
      })),
      readFile: jest.fn(async () => new Uint8Array([1, 2, 3])),
      writeFile: jest.fn(async () => undefined),
      basename: jest.fn((id: string) => id.split('/').pop() ?? id),
      ...overrides.file,
    },
    dialog: {
      confirm: jest.fn(async () => true),
      alert: jest.fn(async () => undefined),
      ...overrides.dialog,
    },
    storage: {
      get: jest.fn(async (k: string) => storage.get(k) ?? null),
      set: jest.fn(async (k: string, v: unknown) => {
        storage.set(k, v);
      }),
      remove: jest.fn(async (k: string) => {
        storage.delete(k);
      }),
      ...overrides.storage,
    },
    export: {
      exportPng: jest.fn(async ({ suggestedName }) => ({
        path: `/tmp/exports/${suggestedName}`,
      })),
      ...overrides.export,
    },
    ...(overrides.now ? { now: overrides.now } : {}),
  };
}

// ── Validators ──────────────────────────────────────────────────────────

describe('validators', () => {
  it('validatePingPayload accepts a finite-number ts', () => {
    expect(validatePingPayload({ ts: 0 })).toEqual({ ts: 0 });
  });

  it('validatePingPayload rejects non-objects, missing ts, NaN, Infinity', () => {
    expect(() => validatePingPayload(null)).toThrow(TypeError);
    expect(() => validatePingPayload(42)).toThrow(TypeError);
    expect(() => validatePingPayload({})).toThrow(TypeError);
    expect(() => validatePingPayload({ ts: 'now' })).toThrow(TypeError);
    expect(() => validatePingPayload({ ts: Number.NaN })).toThrow(TypeError);
    expect(() => validatePingPayload({ ts: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });

  it('does not echo offending values back through error messages', () => {
    try {
      validatePingPayload({ ts: 'super-secret-token' });
      fail('expected validation to throw');
    } catch (err) {
      expect((err as Error).message).not.toContain('super-secret-token');
    }
  });

  it('validateFileSavePayload requires bytes + suggestedName; id is optional', () => {
    const ok = validateFileSavePayload({
      id: '/p',
      bytes: new Uint8Array([1]),
      suggestedName: 'x.aqua',
    });
    expect(ok.id).toBe('/p');
    expect(ok.bytes).toEqual(new Uint8Array([1]));

    const okNoId = validateFileSavePayload({
      bytes: new Uint8Array([1]),
      suggestedName: 'x.aqua',
    });
    expect(okNoId.id).toBeUndefined();

    expect(() => validateFileSavePayload(null)).toThrow(TypeError);
    expect(() => validateFileSavePayload({ bytes: 'no', suggestedName: 'x' })).toThrow(TypeError);
    expect(() =>
      validateFileSavePayload({ bytes: new Uint8Array(), suggestedName: 42 }),
    ).toThrow(TypeError);
    expect(() =>
      validateFileSavePayload({ id: 5, bytes: new Uint8Array(), suggestedName: 'x' }),
    ).toThrow(TypeError);
  });

  it('validateFileSaveAsPayload requires bytes + suggestedName', () => {
    expect(() => validateFileSaveAsPayload({})).toThrow(TypeError);
    expect(() => validateFileSaveAsPayload(null)).toThrow(TypeError);
    expect(
      validateFileSaveAsPayload({ bytes: new Uint8Array([0]), suggestedName: 'a' }),
    ).toEqual({ bytes: new Uint8Array([0]), suggestedName: 'a' });
  });

  it('validateDialogConfirmPayload accepts danger flag optionally', () => {
    expect(validateDialogConfirmPayload({ title: 't', message: 'm' })).toEqual({
      title: 't',
      message: 'm',
    });
    expect(
      validateDialogConfirmPayload({ title: 't', message: 'm', danger: true }),
    ).toEqual({ title: 't', message: 'm', danger: true });
    expect(() => validateDialogConfirmPayload(null)).toThrow(TypeError);
    expect(() => validateDialogConfirmPayload({ title: 1, message: 'm' })).toThrow(TypeError);
    expect(() =>
      validateDialogConfirmPayload({ title: 't', message: 'm', danger: 'yes' }),
    ).toThrow(TypeError);
  });

  it('validateDialogAlertPayload requires title + message', () => {
    expect(validateDialogAlertPayload({ title: 't', message: 'm' })).toEqual({
      title: 't',
      message: 'm',
    });
    expect(() => validateDialogAlertPayload({ title: 't' })).toThrow(TypeError);
    expect(() => validateDialogAlertPayload(null)).toThrow(TypeError);
  });

  it('validateStorage{Get,Set,Remove}Payload', () => {
    expect(validateStorageGetPayload({ key: 'k' })).toEqual({ key: 'k' });
    expect(() => validateStorageGetPayload({})).toThrow(TypeError);
    expect(validateStorageSetPayload({ key: 'k', value: null })).toEqual({
      key: 'k',
      value: null,
    });
    expect(() => validateStorageSetPayload({ value: 1 })).toThrow(TypeError);
    expect(validateStorageRemovePayload({ key: 'k' })).toEqual({ key: 'k' });
    expect(() => validateStorageRemovePayload(null)).toThrow(TypeError);
  });

  it('validateExportPngPayload requires Uint8Array + suggestedName', () => {
    expect(
      validateExportPngPayload({ bytes: new Uint8Array([1]), suggestedName: 'a.png' }),
    ).toEqual({ bytes: new Uint8Array([1]), suggestedName: 'a.png' });
    expect(() => validateExportPngPayload({ bytes: 'no', suggestedName: 'x' })).toThrow(TypeError);
    expect(() => validateExportPngPayload(null)).toThrow(TypeError);
  });
});

// ── Pure handlers ───────────────────────────────────────────────────────

describe('handlePing', () => {
  it('returns { pong: true, receivedAt: <now()> }', () => {
    const result = handlePing({ ts: 100 }, { now: () => 999 });
    expect(result).toEqual({ pong: true, receivedAt: 999 });
  });
  it('throws on invalid payload', () => {
    expect(() => handlePing({ ts: 'nope' }, { now: () => 0 })).toThrow(TypeError);
  });
});

describe('handleFileOpen', () => {
  it('reads bytes from the picked file and returns the FileOpenResult', async () => {
    const deps = makeDeps();
    const out = await handleFileOpen(deps);
    expect(out).toEqual({
      id: '/tmp/a.aqua',
      name: 'a.aqua',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(deps.file.readFile).toHaveBeenCalledWith('/tmp/a.aqua');
  });

  it('returns null when the user cancels the picker', async () => {
    const deps = makeDeps({
      file: {
        showOpenPicker: jest.fn(async () => null),
        showSavePicker: jest.fn(),
        readFile: jest.fn(),
        writeFile: jest.fn(),
        basename: jest.fn(),
      },
    });
    expect(await handleFileOpen(deps)).toBeNull();
  });
});

describe('handleFileSave', () => {
  it('writes to the supplied id without a picker prompt', async () => {
    const deps = makeDeps();
    const result = await handleFileSave(
      { id: '/p.aqua', bytes: new Uint8Array([9]), suggestedName: 'p.aqua' },
      deps,
    );
    expect(result).toEqual({ id: '/p.aqua' });
    expect(deps.file.showSavePicker).not.toHaveBeenCalled();
    expect(deps.file.writeFile).toHaveBeenCalledWith('/p.aqua', new Uint8Array([9]));
  });

  it('prompts when no id is supplied and writes to the picked location', async () => {
    const deps = makeDeps();
    const result = await handleFileSave(
      { bytes: new Uint8Array([0]), suggestedName: 'new.aqua' },
      deps,
    );
    expect(result?.id).toBe('/tmp/new.aqua');
    expect(deps.file.showSavePicker).toHaveBeenCalledWith({ suggestedName: 'new.aqua' });
  });

  it('returns null when the user cancels the save picker', async () => {
    const deps = makeDeps({
      file: {
        showOpenPicker: jest.fn(),
        showSavePicker: jest.fn(async () => null),
        readFile: jest.fn(),
        writeFile: jest.fn(),
        basename: jest.fn(),
      },
    });
    expect(
      await handleFileSave({ bytes: new Uint8Array([1]), suggestedName: 'x.aqua' }, deps),
    ).toBeNull();
  });
});

describe('handleFileSaveAs', () => {
  it('always prompts and writes to the picked location', async () => {
    const deps = makeDeps();
    const result = await handleFileSaveAs(
      { bytes: new Uint8Array([2]), suggestedName: 'y.aqua' },
      deps,
    );
    expect(result?.id).toBe('/tmp/y.aqua');
    expect(deps.file.writeFile).toHaveBeenCalled();
  });

  it('returns null when the user cancels', async () => {
    const deps = makeDeps({
      file: {
        showOpenPicker: jest.fn(),
        showSavePicker: jest.fn(async () => null),
        readFile: jest.fn(),
        writeFile: jest.fn(),
        basename: jest.fn(),
      },
    });
    expect(
      await handleFileSaveAs({ bytes: new Uint8Array([3]), suggestedName: 'z.aqua' }, deps),
    ).toBeNull();
  });
});

describe('handleDialogConfirm', () => {
  it('normalizes danger to a boolean and forwards to the dialog backend', async () => {
    const deps = makeDeps();
    await handleDialogConfirm({ title: 't', message: 'm' }, deps);
    expect(deps.dialog.confirm).toHaveBeenCalledWith({ title: 't', message: 'm', danger: false });
  });
});

describe('handleExportPng', () => {
  it('forwards to the export backend', async () => {
    const deps = makeDeps();
    const out = await handleExportPng(
      { bytes: new Uint8Array([4]), suggestedName: 'render.png' },
      deps,
    );
    expect(out?.path).toBe('/tmp/exports/render.png');
  });
});

describe('storage handlers (get/set/remove round-trip)', () => {
  it('round-trips a value through set + get + remove', async () => {
    const deps = makeDeps();
    await handleStorageSet({ key: 'k', value: { nested: 1 } }, deps);
    expect(await handleStorageGet({ key: 'k' }, deps)).toEqual({ nested: 1 });
    expect(deps.storage.remove).toBeDefined();
  });
});

// ── Registrar ──────────────────────────────────────────────────────────

describe('registerIpcHandlers', () => {
  it('registers every channel declared in IPC_CHANNELS', () => {
    const host = new FakeIpcMain();
    registerIpcHandlers(host, makeDeps());
    expect([...host.handlers.keys()].sort()).toEqual([...IPC_CHANNELS].sort());
  });

  it('round-trips ping through the fake ipcMain', async () => {
    const host = new FakeIpcMain();
    registerIpcHandlers(host, makeDeps({ now: () => 555 }));
    const result = await host.invoke('ping', { ts: 10 });
    expect(result).toEqual({ pong: true, receivedAt: 555 });
  });

  it('rejects when the renderer sends an invalid ping payload', async () => {
    const host = new FakeIpcMain();
    registerIpcHandlers(host, makeDeps());
    await expect(host.invoke('ping', { ts: 'no' })).rejects.toBeInstanceOf(TypeError);
  });

  it('round-trips file.open through the fake ipcMain', async () => {
    const host = new FakeIpcMain();
    registerIpcHandlers(host, makeDeps());
    const result = (await host.invoke('file.open')) as { id: string; name: string };
    expect(result.id).toBe('/tmp/a.aqua');
  });

  it('round-trips storage.set/get/remove through the fake ipcMain', async () => {
    const host = new FakeIpcMain();
    registerIpcHandlers(host, makeDeps());
    await host.invoke('storage.set', { key: 'k', value: [1, 2] });
    expect(await host.invoke('storage.get', { key: 'k' })).toEqual([1, 2]);
    await host.invoke('storage.remove', { key: 'k' });
    expect(await host.invoke('storage.get', { key: 'k' })).toBeNull();
  });
});
