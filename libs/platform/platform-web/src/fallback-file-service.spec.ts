/**
 * @jest-environment jsdom
 */

import { FallbackFileService } from './fallback-file-service';

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
// jsdom in this env doesn't define URL.createObjectURL on window.URL.
if (typeof window.URL.createObjectURL !== 'function') {
  (window.URL as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:test-url';
}
if (typeof window.URL.revokeObjectURL !== 'function') {
  (window.URL as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
}

describe('FallbackFileService.openDocument', () => {
  it('reads the picked file and returns name + bytes', async () => {
    const svc = new FallbackFileService();
    const promise = svc.openDocument();

    // Intercept the input the service created and feed it a fake File.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    const bytes = new Uint8Array([10, 20, 30]);
    const file = new File([bytes as never], 'fallback.aqua', { type: 'application/aqua' });
    Object.defineProperty(input!, 'files', {
      value: { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) } as unknown as FileList,
      configurable: true,
    });
    input!.dispatchEvent(new Event('change'));

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result?.name).toBe('fallback.aqua');
    expect(result?.bytes).toEqual(bytes);
    // The input is removed after the operation.
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('returns null when the user cancels the picker (no files)', async () => {
    const svc = new FallbackFileService();
    const promise = svc.openDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: { 0: undefined, length: 0, item: () => null } as unknown as FileList,
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    expect(await promise).toBeNull();
  });

  it('settles null via the window focus fallback when no change event fires', async () => {
    // jsdom's requestAnimationFrame is synchronous-via-setTimeout(0).
    const svc = new FallbackFileService();
    const promise = svc.openDocument();
    // Don't fire `change` or `cancel`; instead, fire `focus` on the window
    // and let the rAF cascade settle the promise to null.
    window.dispatchEvent(new Event('focus'));
    // Drain two rAFs (each is a setTimeout(0) under jsdom).
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(await promise).toBeNull();
  });
});

describe('FallbackFileService.saveDocument(As)', () => {
  let createSpy: jest.SpyInstance;
  let revokeSpy: jest.SpyInstance;
  let clickSpy: jest.SpyInstance;

  beforeEach(() => {
    createSpy = jest
      .spyOn(window.URL, 'createObjectURL')
      .mockReturnValue('blob:test-url');
    revokeSpy = jest.spyOn(window.URL, 'revokeObjectURL').mockReturnValue(undefined);
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it('collapses Save into Save As (no silent overwrite in the fallback)', async () => {
    const svc = new FallbackFileService();
    const result = await svc.saveDocument({
      id: 'whatever',
      bytes: new Uint8Array([1, 2]),
      suggestedName: 'doc.aqua',
    });
    expect(result?.id).toMatch(/^fallback-save-/);
    expect(clickSpy).toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalled();
  });

  it('saveDocumentAs triggers a download for the supplied bytes', async () => {
    const svc = new FallbackFileService();
    const result = await svc.saveDocumentAs({
      bytes: new Uint8Array([7, 7]),
      suggestedName: 'as.aqua',
    });
    expect(result?.id).toMatch(/^fallback-save-/);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('revokes the object URL after the click (microtask)', async () => {
    const svc = new FallbackFileService();
    await svc.saveDocumentAs({ bytes: new Uint8Array([0]), suggestedName: 'x.aqua' });
    await Promise.resolve();
    expect(revokeSpy).toHaveBeenCalledWith('blob:test-url');
  });

  it('throws when the Document has no defaultView', async () => {
    const fakeDoc = {
      createElement: (tag: string) => document.createElement(tag),
      body: document.body,
      defaultView: null,
    } as unknown as Document;
    const svc = new FallbackFileService(fakeDoc);
    await expect(
      svc.saveDocumentAs({ bytes: new Uint8Array(), suggestedName: 'x.aqua' }),
    ).rejects.toThrow(/without a window/);
  });
});
