// BackdropPanelComponent tests. Stage 6 F6.3.

import { TestBed } from '@angular/core/testing';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  BACKDROP_PANEL_COLLAPSED_KEY,
  BackdropPanelComponent,
} from './backdrop-panel.component';
import {
  BackdropService,
  STORAGE_KEY_BACKDROP_ENABLED,
  STORAGE_KEY_BACKDROP_OPACITY,
} from './backdrop.service';

const SAMPLE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const FAKE_IMAGE = { __fake: 'image' } as unknown as CanvasImageSource;

class FakeStorageService implements StorageService {
  readonly data = new Map<string, unknown>();
  get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.data.get(key) as T | undefined) ?? null);
  }
  set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function configure(storage: FakeStorageService = new FakeStorageService()) {
  TestBed.configureTestingModule({
    imports: [BackdropPanelComponent],
    providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
  });
  const fixture = TestBed.createComponent(BackdropPanelComponent);
  const service = TestBed.inject(BackdropService);
  service.decoder = async (): Promise<CanvasImageSource> => FAKE_IMAGE;
  fixture.detectChanges();
  return { fixture, service, storage };
}

function inputByAriaLabel(
  fixture: ReturnType<typeof configure>['fixture'],
  label: string,
): HTMLInputElement {
  const el = fixture.nativeElement.querySelector(
    `input[aria-label="${label}"]`,
  ) as HTMLInputElement | null;
  if (el === null) throw new Error(`No input with aria-label="${label}"`);
  return el;
}

describe('BackdropPanelComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('initial state', () => {
    it('renders unchecked enable + file input + opacity disabled', () => {
      const { fixture } = configure();
      expect(inputByAriaLabel(fixture, 'Enable backdrop').checked).toBe(false);
      const opacity = inputByAriaLabel(fixture, 'Backdrop opacity');
      expect(opacity.disabled).toBe(true); // no image yet
      expect(
        fixture.nativeElement.querySelector('input[aria-label="Choose backdrop photo"]'),
      ).not.toBeNull();
    });

    it('badge reads "off" by default', () => {
      const { fixture } = configure();
      const badge = fixture.nativeElement.querySelector('.panel-header__count');
      expect(badge?.textContent?.trim()).toBe('off');
    });

    it('opacity label shows the default percentage', () => {
      const { fixture } = configure();
      const valueEl = fixture.nativeElement.querySelector('.backdrop-panel__field-value');
      expect(valueEl?.textContent?.trim()).toBe('60%');
    });
  });

  describe('toggle + opacity', () => {
    it('checking enable persists', async () => {
      const { fixture, storage } = configure();
      const cb = inputByAriaLabel(fixture, 'Enable backdrop');
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await flushPromises();
      expect(storage.data.get(STORAGE_KEY_BACKDROP_ENABLED)).toBe(true);
    });

    it('opacity slider updates service + storage when image is loaded', async () => {
      const { fixture, service, storage } = configure();
      await service.setImageFromDataUrl(SAMPLE_DATA_URL);
      service.setEnabled(true);
      fixture.detectChanges();
      const slider = inputByAriaLabel(fixture, 'Backdrop opacity');
      expect(slider.disabled).toBe(false);
      slider.value = '0.4';
      slider.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.opacity()).toBe(0.4);
      expect(storage.data.get(STORAGE_KEY_BACKDROP_OPACITY)).toBe(0.4);
    });
  });

  describe('file picker', () => {
    it('selecting a file commits the data URL + auto-enables', async () => {
      const { fixture, service } = configure();
      const fileInput = inputByAriaLabel(fixture, 'Choose backdrop photo');
      const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
      // Override FileReader globally so the data URL is deterministic.
      const originalReader = globalThis.FileReader;
      class FakeFileReader {
        result: string | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(_: File): void {
          this.result = SAMPLE_DATA_URL;
          if (this.onload !== null) this.onload();
        }
      }
      (globalThis as { FileReader: typeof FileReader }).FileReader =
        FakeFileReader as unknown as typeof FileReader;

      try {
        Object.defineProperty(fileInput, 'files', {
          value: { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) },
        });
        fileInput.dispatchEvent(new Event('change'));
        await flushPromises();
        fixture.detectChanges();

        expect(service.dataUrl()).toBe(SAMPLE_DATA_URL);
        expect(service.image()).toBe(FAKE_IMAGE);
        expect(service.enabled()).toBe(true);
        // Badge flips to "on".
        const badge = fixture.nativeElement.querySelector('.panel-header__count');
        expect(badge?.textContent?.trim()).toBe('on');
      } finally {
        globalThis.FileReader = originalReader;
      }
    });

    it('shows the Clear button only when an image is loaded', async () => {
      const { fixture, service } = configure();
      expect(fixture.nativeElement.querySelector('.backdrop-panel__clear')).toBeNull();
      await service.setImageFromDataUrl(SAMPLE_DATA_URL);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.backdrop-panel__clear')).not.toBeNull();
    });

    it('clicking Clear drops the loaded image', async () => {
      const { fixture, service } = configure();
      await service.setImageFromDataUrl(SAMPLE_DATA_URL);
      fixture.detectChanges();
      const clear = fixture.nativeElement.querySelector(
        '.backdrop-panel__clear',
      ) as HTMLButtonElement;
      clear.click();
      await flushPromises();
      fixture.detectChanges();
      expect(service.image()).toBeNull();
    });
  });

  describe('error surface', () => {
    it('displays the service lastError when the decoder fails', async () => {
      const { fixture, service } = configure();
      service.decoder = async (): Promise<CanvasImageSource> => {
        throw new Error('decode failure');
      };
      try {
        await service.setImageFromDataUrl(SAMPLE_DATA_URL);
      } catch {
        // expected
      }
      fixture.detectChanges();
      const err = fixture.nativeElement.querySelector('.backdrop-panel__error');
      expect(err?.textContent).toMatch(/decode failure/);
    });
  });

  describe('collapsible header', () => {
    it('renders aria-expanded=true by default', () => {
      const { fixture } = configure();
      const toggle = fixture.nativeElement.querySelector(
        '.panel-header__toggle',
      ) as HTMLButtonElement;
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('clicking the header toggles collapsed + hides body', () => {
      const { fixture } = configure();
      const toggle = fixture.nativeElement.querySelector(
        '.panel-header__toggle',
      ) as HTMLButtonElement;
      const body = fixture.nativeElement.querySelector('#backdrop-panel-body') as HTMLElement;
      expect(body.hidden).toBe(false);
      toggle.click();
      fixture.detectChanges();
      expect(body.hidden).toBe(true);
    });

    it('persists collapsed flag', async () => {
      const { fixture, storage } = configure();
      fixture.componentInstance.toggleCollapsed();
      fixture.detectChanges();
      await flushPromises();
      expect(storage.data.get(BACKDROP_PANEL_COLLAPSED_KEY)).toBe(true);
    });

    it('hydrates collapsed from storage', async () => {
      const storage = new FakeStorageService();
      await storage.set(BACKDROP_PANEL_COLLAPSED_KEY, true);
      const { fixture } = configure(storage);
      await flushPromises();
      fixture.detectChanges();
      expect(fixture.componentInstance.collapsed()).toBe(true);
    });
  });
});
