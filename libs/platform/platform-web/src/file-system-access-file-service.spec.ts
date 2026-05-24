/**
 * @jest-environment jsdom
 */

import {
  FileSystemAccessFileService,
  isFileSystemAccessAvailable,
} from './file-system-access-file-service';

// jsdom's Blob lacks .arrayBuffer; polyfill via FileReader.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  (Blob.prototype as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = function () {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = (): void => resolve(r.result as ArrayBuffer);
      r.onerror = (): void => reject(r.error);
      r.readAsArrayBuffer(this as Blob);
    });
  };
}

interface FakeWritable {
  written: Uint8Array[];
  closed: boolean;
}

interface FakeHandle {
  name: string;
  bytes: Uint8Array;
  writable: FakeWritable;
}

function makeFakeHandle(name: string, bytes: Uint8Array): FakeHandle {
  const writable: FakeWritable = { written: [], closed: false };
  return { name, bytes, writable };
}

function adaptHandle(h: FakeHandle) {
  return {
    name: h.name,
    async getFile() {
      return new Blob([h.bytes as never]) as Blob & {
        arrayBuffer(): Promise<ArrayBuffer>;
      };
    },
    async createWritable() {
      return {
        async write(data: BufferSource) {
          const u8 =
            data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
          h.writable.written.push(u8);
        },
        async close() {
          h.writable.closed = true;
        },
      };
    },
  };
}

function installPicker(opts: {
  open?: () => Promise<FakeHandle[]> | Promise<never>;
  save?: () => Promise<FakeHandle> | Promise<never>;
}): void {
  Object.assign(window, {
    showOpenFilePicker: opts.open
      ? async () => (await opts.open!()).map(adaptHandle)
      : undefined,
    showSaveFilePicker: opts.save
      ? async () => adaptHandle(await opts.save!())
      : undefined,
  });
}

function uninstallPicker(): void {
  delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
}

afterEach(() => {
  uninstallPicker();
});

describe('isFileSystemAccessAvailable', () => {
  it('returns false when the pickers are absent', () => {
    expect(isFileSystemAccessAvailable()).toBe(false);
  });

  it('returns true when both pickers are present', () => {
    installPicker({
      open: async () => [makeFakeHandle('a.aqua', new Uint8Array([1]))],
      save: async () => makeFakeHandle('b.aqua', new Uint8Array()),
    });
    expect(isFileSystemAccessAvailable()).toBe(true);
  });
});

describe('FileSystemAccessFileService.openDocument', () => {
  it('returns bytes + name + a fresh id on a successful pick', async () => {
    const handle = makeFakeHandle('iwagumi.aqua', new Uint8Array([1, 2, 3]));
    installPicker({ open: async () => [handle] });

    const svc = new FileSystemAccessFileService();
    const result = await svc.openDocument();
    expect(result).not.toBeNull();
    expect(result?.name).toBe('iwagumi.aqua');
    expect(result?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(typeof result?.id).toBe('string');
  });

  it('returns null when the user cancels (AbortError)', async () => {
    installPicker({
      open: async () => {
        const err = new Error('cancelled');
        (err as { name: string }).name = 'AbortError';
        throw err;
      },
    });
    const svc = new FileSystemAccessFileService();
    expect(await svc.openDocument()).toBeNull();
  });

  it('rethrows non-AbortError failures', async () => {
    installPicker({
      open: async () => {
        throw new Error('boom');
      },
    });
    const svc = new FileSystemAccessFileService();
    await expect(svc.openDocument()).rejects.toThrow('boom');
  });

  it('returns null when the picker resolves to an empty list', async () => {
    installPicker({ open: async () => [] });
    const svc = new FileSystemAccessFileService();
    expect(await svc.openDocument()).toBeNull();
  });
});

describe('FileSystemAccessFileService.saveDocument', () => {
  it('writes to the previously-opened handle without prompting', async () => {
    const handle = makeFakeHandle('iwagumi.aqua', new Uint8Array([1, 2, 3]));
    installPicker({
      open: async () => [handle],
      save: async () => {
        throw new Error('save picker should not be called when re-saving');
      },
    });
    const svc = new FileSystemAccessFileService();
    const opened = await svc.openDocument();
    if (opened === null) throw new Error('open returned null');

    const result = await svc.saveDocument({
      id: opened.id,
      bytes: new Uint8Array([9, 9, 9]),
      suggestedName: opened.name,
    });
    expect(result?.id).toBe(opened.id);
    expect(handle.writable.written).toEqual([new Uint8Array([9, 9, 9])]);
    expect(handle.writable.closed).toBe(true);
  });

  it('falls through to saveAs when the id is unknown', async () => {
    const saveHandle = makeFakeHandle('new.aqua', new Uint8Array());
    installPicker({
      save: async () => saveHandle,
    });
    const svc = new FileSystemAccessFileService();
    const result = await svc.saveDocument({
      id: 'unknown',
      bytes: new Uint8Array([4]),
      suggestedName: 'new.aqua',
    });
    expect(result?.id).toBeDefined();
    expect(saveHandle.writable.written).toEqual([new Uint8Array([4])]);
  });

  it('falls through to saveAs when no id is supplied', async () => {
    const saveHandle = makeFakeHandle('also-new.aqua', new Uint8Array());
    installPicker({ save: async () => saveHandle });
    const svc = new FileSystemAccessFileService();
    const result = await svc.saveDocument({
      bytes: new Uint8Array([5]),
      suggestedName: 'also-new.aqua',
    });
    expect(result?.id).toBeDefined();
  });
});

describe('FileSystemAccessFileService.saveDocumentAs', () => {
  it('returns null when the user cancels the save picker', async () => {
    installPicker({
      save: async () => {
        const err = new Error('cancelled');
        (err as { name: string }).name = 'AbortError';
        throw err;
      },
    });
    const svc = new FileSystemAccessFileService();
    expect(
      await svc.saveDocumentAs({ bytes: new Uint8Array([1]), suggestedName: 'x' }),
    ).toBeNull();
  });

  it('rethrows non-AbortError errors', async () => {
    installPicker({
      save: async () => {
        throw new Error('quota');
      },
    });
    const svc = new FileSystemAccessFileService();
    await expect(
      svc.saveDocumentAs({ bytes: new Uint8Array([1]), suggestedName: 'x' }),
    ).rejects.toThrow('quota');
  });

  it('throws when used outside a window context', () => {
    // Pass a globalRef without a window — picker() throws on use.
    const svc = new FileSystemAccessFileService({} as typeof globalThis);
    return expect(
      svc.saveDocumentAs({ bytes: new Uint8Array(), suggestedName: 'x' }),
    ).rejects.toThrow(/non-window/);
  });
});
