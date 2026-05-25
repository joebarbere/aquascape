// Browser-download `RenderExportService`. Stage 6 F6.1.
//
// Wraps the bytes the caller hands in into a Blob, hands a download URL
// to a synthetic `<a download>` link, and triggers a click — the
// standard "save image" flow used by every web canvas app. Returns the
// requested filename so the export dialog can show a "saved as …"
// confirmation, even though the browser owns where the file actually
// lands (Downloads folder by default).
//
// Replaces the Stage-0 `InMemoryRenderExportService` in production. The
// in-memory variant stays exported for tests (`forceInMemory: true` +
// any spec that asserts on what the export pipeline produced).
//
// Why not `FileSystemFileService.saveDocument`? That path picks the
// document file, not arbitrary download artefacts. Image export is a
// different gesture — the user expects it to land in Downloads, not
// to be asked where to put it (matches Figma / Sketch / Photoshop
// "Export as PNG" UX). A future `saveImageAs` variant could open a
// File System Access save picker on Chromium; for now the simple
// download covers Chromium / Firefox / Safari uniformly.

import type { ExportPngResult, RenderExportService } from '@aquascape/platform/platform-api';

interface DocLike {
  createElement(tag: 'a'): HTMLAnchorElement;
  body: { appendChild: (node: Node) => Node; removeChild: (node: Node) => Node };
}

interface UrlLike {
  createObjectURL(obj: Blob): string;
  revokeObjectURL(url: string): void;
}

export class BrowserDownloadRenderExportService implements RenderExportService {
  constructor(
    private readonly doc: DocLike,
    private readonly url: UrlLike,
  ) {}

  async exportPng(args: {
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<ExportPngResult | null> {
    const blob = new Blob([args.bytes], { type: mimeFromName(args.suggestedName) });
    const objectUrl = this.url.createObjectURL(blob);
    try {
      const anchor = this.doc.createElement('a');
      anchor.href = objectUrl;
      anchor.download = args.suggestedName;
      // Keep the anchor out of the layout but attached so Firefox honours
      // the programmatic click (a detached anchor's click is ignored in
      // older Firefox builds).
      anchor.style.display = 'none';
      this.doc.body.appendChild(anchor);
      anchor.click();
      this.doc.body.removeChild(anchor);
    } finally {
      // Defer revocation so the browser has a tick to start the download
      // before the URL is invalidated. 100 ms is plenty without hanging
      // the test's promise chain.
      setTimeout(() => this.url.revokeObjectURL(objectUrl), 100);
    }
    return { path: `download://${args.suggestedName}` };
  }
}

/**
 * Derive the MIME type from the export filename's extension. Defaults to
 * `application/octet-stream` for unrecognised extensions so the browser
 * still triggers a download with the right disposition.
 */
function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'json':
      return 'application/json';
    case 'md':
    case 'markdown':
      return 'text/markdown';
    default:
      return 'application/octet-stream';
  }
}
