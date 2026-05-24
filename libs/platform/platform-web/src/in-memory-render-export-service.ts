// Stage 0 stub. Render export records the requested PNG in memory and returns
// a `memory://` URI in place of a real filesystem path. F1.4 replaces this
// with a real `URL.createObjectURL` download flow.

import type { ExportPngResult, RenderExportService } from '@aquascape/platform/platform-api';

interface StoredExport {
  readonly bytes: Uint8Array;
  readonly name: string;
}

export class InMemoryRenderExportService implements RenderExportService {
  private readonly exports = new Map<string, StoredExport>();

  async exportPng(args: {
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<ExportPngResult | null> {
    const out = new Uint8Array(args.bytes.byteLength);
    out.set(args.bytes);
    this.exports.set(args.suggestedName, {
      bytes: out,
      name: args.suggestedName,
    });
    return { path: `memory://exports/${args.suggestedName}` };
  }
}
