// ExportDialogComponent tests. Stage 6 F6.1 + F6.2.

import { TestBed } from '@angular/core/testing';

import type { CanvasLike } from '@aquascape/features/export';
import type { Scene } from '@aquascape/domain/scene-model';
import type { ExportPngResult, RenderExportService } from '@aquascape/platform/platform-api';
import { RENDER_EXPORT_SERVICE } from '@aquascape/platform/platform-api/angular';

import { ExportDialogComponent } from './export-dialog.component';

/** Same proxy-context trick the offscreen-render spec uses — every method
 *  is a silent no-op so Canvas2DRenderer can attach + render against this
 *  fake under jsdom without the real `getContext('2d')` throwing. */
function makeFakeCanvas(): CanvasLike {
  const noop = (): void => undefined;
  const ctx = new Proxy(
    { lineWidth: 1, strokeStyle: '#000', fillStyle: '#000', globalAlpha: 1 } as Record<string, unknown>,
    {
      get(target, prop) {
        if (prop in target) return Reflect.get(target, prop);
        return noop;
      },
      set(target, prop, value) {
        Reflect.set(target, prop, value);
        return true;
      },
    },
  );
  return {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: (kind: string): unknown => (kind === '2d' ? ctx : null),
    toBlob(callback: (blob: Blob | null) => void, type?: string): void {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const blob: Blob = {
        size: bytes.byteLength,
        type: type ?? 'image/png',
        arrayBuffer: (): Promise<ArrayBuffer> =>
          Promise.resolve(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          ),
        slice: () => blob,
        stream: () => {
          throw new Error('stream not implemented');
        },
        text: () => Promise.resolve(''),
      } as unknown as Blob;
      callback(blob);
    },
  };
}

class FakeRenderExportService implements RenderExportService {
  readonly calls: Array<{ bytes: Uint8Array; suggestedName: string }> = [];
  result: ExportPngResult | null = { path: 'memory://x' };
  async exportPng(args: {
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<ExportPngResult | null> {
    this.calls.push({ bytes: args.bytes, suggestedName: args.suggestedName });
    return this.result;
  }
}

function makeScene(): Scene {
  return {
    tank: {
      width: 360,
      height: 220,
      depth: 220,
      glassThickness: 5,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: [] },
    layers: [],
    seed: 1,
  } as Scene;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function configure() {
  const exportSvc = new FakeRenderExportService();
  TestBed.configureTestingModule({
    imports: [ExportDialogComponent],
    providers: [{ provide: RENDER_EXPORT_SERVICE, useValue: exportSvc }],
  });
  const fixture = TestBed.createComponent(ExportDialogComponent);
  fixture.componentInstance.currentScene = makeScene();
  fixture.componentInstance.createCanvasOverride = makeFakeCanvas;
  fixture.detectChanges();
  return { fixture, exportSvc };
}

function selectByAriaLabel(
  fixture: ReturnType<typeof configure>['fixture'],
  label: string,
): HTMLSelectElement {
  const el = fixture.nativeElement.querySelector(
    `select[aria-label="${label}"]`,
  ) as HTMLSelectElement | null;
  if (el === null) throw new Error(`No select with aria-label="${label}"`);
  return el;
}

describe('ExportDialogComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('visibility', () => {
    it('is hidden by default', () => {
      const { fixture } = configure();
      expect(fixture.nativeElement.querySelector('.export-dialog')).toBeNull();
    });

    it('open() renders the dialog', () => {
      const { fixture } = configure();
      fixture.componentInstance.open();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.export-dialog')).not.toBeNull();
    });

    it('close() hides + Esc closes', () => {
      const { fixture } = configure();
      fixture.componentInstance.open();
      fixture.detectChanges();
      fixture.componentInstance.onEscape();
      fixture.detectChanges();
      expect(fixture.componentInstance.visible()).toBe(false);
    });
  });

  describe('image export form', () => {
    it('defaults to PNG + first resolution preset + 92% quality', () => {
      const { fixture } = configure();
      fixture.componentInstance.open();
      fixture.detectChanges();
      expect(fixture.componentInstance.format()).toBe('png');
      expect(fixture.componentInstance.quality()).toBe(0.92);
      expect(fixture.componentInstance.resolutionId()).toBe('1080');
    });

    it('changing format updates the signal', () => {
      const { fixture } = configure();
      fixture.componentInstance.open();
      fixture.detectChanges();
      const sel = selectByAriaLabel(fixture, 'Image format');
      sel.value = 'jpeg';
      sel.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(fixture.componentInstance.format()).toBe('jpeg');
    });

    it('JPEG quality slider only renders when format=jpeg', () => {
      const { fixture } = configure();
      fixture.componentInstance.open();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('input[aria-label="JPEG quality"]')).toBeNull();
      fixture.componentInstance.format.set('jpeg');
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('input[aria-label="JPEG quality"]'),
      ).not.toBeNull();
    });

    it('quality slider updates the signal + label', () => {
      const { fixture } = configure();
      fixture.componentInstance.open();
      fixture.componentInstance.format.set('jpeg');
      fixture.detectChanges();
      const slider = fixture.nativeElement.querySelector(
        'input[aria-label="JPEG quality"]',
      ) as HTMLInputElement;
      slider.value = '0.5';
      slider.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(fixture.componentInstance.quality()).toBe(0.5);
      expect(fixture.componentInstance.qualityLabel()).toBe('50%');
    });
  });

  describe('image export action', () => {
    it('calls renderExportService.exportPng with bytes + suggestedName + reports success', async () => {
      const { fixture, exportSvc } = configure();
      fixture.componentInstance.open();
      fixture.detectChanges();
      await fixture.componentInstance.onExportImage();
      fixture.detectChanges();
      expect(exportSvc.calls).toHaveLength(1);
      expect(exportSvc.calls[0]?.suggestedName).toBe('aquascape-1920x1080.png');
      expect(exportSvc.calls[0]?.bytes.byteLength).toBeGreaterThan(0);
      const feedback = fixture.componentInstance.imageFeedback();
      expect(feedback.kind).toBe('ok');
      expect(feedback.message).toMatch(/memory:\/\/x/);
    });

    it('builds a .jpg filename when format=jpeg', async () => {
      const { fixture, exportSvc } = configure();
      fixture.componentInstance.open();
      fixture.componentInstance.format.set('jpeg');
      fixture.detectChanges();
      await fixture.componentInstance.onExportImage();
      expect(exportSvc.calls[0]?.suggestedName).toBe('aquascape-1920x1080.jpg');
    });

    it('reports cancelled when exportPng returns null', async () => {
      const { fixture, exportSvc } = configure();
      exportSvc.result = null;
      fixture.componentInstance.open();
      fixture.detectChanges();
      await fixture.componentInstance.onExportImage();
      fixture.detectChanges();
      expect(fixture.componentInstance.imageFeedback().kind).toBe('error');
      expect(fixture.componentInstance.imageFeedback().message).toMatch(/cancelled/i);
    });

    it('does nothing when currentScene is null', async () => {
      const { fixture, exportSvc } = configure();
      fixture.componentInstance.currentScene = null;
      fixture.componentInstance.open();
      fixture.detectChanges();
      await fixture.componentInstance.onExportImage();
      expect(exportSvc.calls).toHaveLength(0);
    });
  });

  describe('summary export', () => {
    it('exports markdown with .md filename by default', async () => {
      const { fixture, exportSvc } = configure();
      fixture.componentInstance.open();
      fixture.detectChanges();
      await fixture.componentInstance.onExportSummary();
      await flushPromises();
      expect(exportSvc.calls).toHaveLength(1);
      expect(exportSvc.calls[0]?.suggestedName).toBe('aquascape-summary.md');
      const text = new TextDecoder().decode(exportSvc.calls[0]?.bytes);
      expect(text).toMatch(/^# Aquascape layout summary/);
    });

    it('exports JSON with .json filename when summaryFormat=json', async () => {
      const { fixture, exportSvc } = configure();
      fixture.componentInstance.open();
      fixture.componentInstance.summaryFormat.set('json');
      fixture.detectChanges();
      await fixture.componentInstance.onExportSummary();
      await flushPromises();
      expect(exportSvc.calls[0]?.suggestedName).toBe('aquascape-summary.json');
      const text = new TextDecoder().decode(exportSvc.calls[0]?.bytes);
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('reports success feedback after summary export', async () => {
      const { fixture } = configure();
      fixture.componentInstance.open();
      fixture.detectChanges();
      await fixture.componentInstance.onExportSummary();
      fixture.detectChanges();
      expect(fixture.componentInstance.summaryFeedback().kind).toBe('ok');
    });
  });

  describe('no-scene case', () => {
    it('shows "no scene to export yet" message', () => {
      const { fixture } = configure();
      fixture.componentInstance.currentScene = null;
      fixture.componentInstance.open();
      fixture.detectChanges();
      const empty = fixture.nativeElement.querySelector('.export-dialog__empty');
      expect(empty?.textContent).toMatch(/No scene to export yet/);
    });
  });
});
