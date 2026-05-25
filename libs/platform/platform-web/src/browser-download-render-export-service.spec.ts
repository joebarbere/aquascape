// BrowserDownloadRenderExportService tests. Stage 6 F6.1.

import { BrowserDownloadRenderExportService } from './browser-download-render-export-service';

function makeFakes(): {
  doc: {
    createElement: jest.Mock;
    body: { appendChild: jest.Mock; removeChild: jest.Mock };
    lastAnchor: { href: string; download: string; click: jest.Mock; style: { display: string } } | null;
  };
  url: { createObjectURL: jest.Mock; revokeObjectURL: jest.Mock };
} {
  const anchorPool: Array<{
    href: string;
    download: string;
    click: jest.Mock;
    style: { display: string };
  }> = [];
  const doc = {
    createElement: jest.fn((_tag: string) => {
      const a = {
        href: '',
        download: '',
        click: jest.fn(),
        style: { display: '' },
      };
      anchorPool.push(a);
      return a as unknown as HTMLAnchorElement;
    }),
    body: {
      appendChild: jest.fn((node: Node) => node),
      removeChild: jest.fn((node: Node) => node),
    },
    get lastAnchor() {
      return anchorPool[anchorPool.length - 1] ?? null;
    },
  };
  const url = {
    createObjectURL: jest.fn((_: Blob) => 'blob:fake-url'),
    revokeObjectURL: jest.fn(),
  };
  return { doc, url };
}

describe('BrowserDownloadRenderExportService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates an anchor + clicks it + returns the suggested name in `path`', async () => {
    const { doc, url } = makeFakes();
    const svc = new BrowserDownloadRenderExportService(doc, url);
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await svc.exportPng({ bytes, suggestedName: 'scape.png' });
    expect(result).toEqual({ path: 'download://scape.png' });
    expect(doc.createElement).toHaveBeenCalledWith('a');
    expect(url.createObjectURL).toHaveBeenCalledTimes(1);
    expect(doc.body.appendChild).toHaveBeenCalled();
    expect(doc.body.removeChild).toHaveBeenCalled();
    expect(doc.lastAnchor?.href).toBe('blob:fake-url');
    expect(doc.lastAnchor?.download).toBe('scape.png');
    expect(doc.lastAnchor?.click).toHaveBeenCalledTimes(1);
  });

  it('passes the bytes through to the Blob with the right MIME for .png', async () => {
    const { doc, url } = makeFakes();
    const svc = new BrowserDownloadRenderExportService(doc, url);
    await svc.exportPng({ bytes: new Uint8Array([1]), suggestedName: 'x.png' });
    const blob = url.createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('image/png');
  });

  it('derives image/jpeg for .jpg / .jpeg names', async () => {
    const { doc, url } = makeFakes();
    const svc = new BrowserDownloadRenderExportService(doc, url);
    await svc.exportPng({ bytes: new Uint8Array([1]), suggestedName: 'x.jpg' });
    expect((url.createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe('image/jpeg');

    url.createObjectURL.mockClear();
    await svc.exportPng({ bytes: new Uint8Array([1]), suggestedName: 'x.jpeg' });
    expect((url.createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe('image/jpeg');
  });

  it('derives text/markdown for .md + application/json for .json', async () => {
    const { doc, url } = makeFakes();
    const svc = new BrowserDownloadRenderExportService(doc, url);
    await svc.exportPng({ bytes: new Uint8Array([1]), suggestedName: 'summary.md' });
    expect((url.createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe('text/markdown');

    url.createObjectURL.mockClear();
    await svc.exportPng({ bytes: new Uint8Array([1]), suggestedName: 'summary.json' });
    expect((url.createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe('application/json');
  });

  it('derives image/webp for .webp', async () => {
    const { doc, url } = makeFakes();
    const svc = new BrowserDownloadRenderExportService(doc, url);
    await svc.exportPng({ bytes: new Uint8Array([1]), suggestedName: 'x.webp' });
    expect((url.createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe('image/webp');
  });

  it('derives text/markdown for .markdown (alternate extension)', async () => {
    const { doc, url } = makeFakes();
    const svc = new BrowserDownloadRenderExportService(doc, url);
    await svc.exportPng({ bytes: new Uint8Array([1]), suggestedName: 'notes.markdown' });
    expect((url.createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe('text/markdown');
  });

  it('falls back to application/octet-stream for unknown extensions', async () => {
    const { doc, url } = makeFakes();
    const svc = new BrowserDownloadRenderExportService(doc, url);
    await svc.exportPng({ bytes: new Uint8Array([1]), suggestedName: 'mystery.qqq' });
    expect((url.createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe('application/octet-stream');
  });

  it('hides the synthetic anchor via display: none', async () => {
    const { doc, url } = makeFakes();
    const svc = new BrowserDownloadRenderExportService(doc, url);
    await svc.exportPng({ bytes: new Uint8Array([1]), suggestedName: 'x.png' });
    expect(doc.lastAnchor?.style.display).toBe('none');
  });

  it('revokes the object URL after a 100ms grace period', async () => {
    const { doc, url } = makeFakes();
    const svc = new BrowserDownloadRenderExportService(doc, url);
    await svc.exportPng({ bytes: new Uint8Array([1]), suggestedName: 'x.png' });
    // Revoke hasn't fired yet (still in the setTimeout window).
    expect(url.revokeObjectURL).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
