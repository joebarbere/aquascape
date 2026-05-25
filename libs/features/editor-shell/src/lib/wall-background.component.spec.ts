// WallBackgroundComponent tests. Stage 5.x.

import { TestBed } from '@angular/core/testing';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  WALL_BACKGROUND_COLLAPSED_KEY,
  WallBackgroundComponent,
} from './wall-background.component';
import {
  DEFAULT_WALL_COLOR,
  DEFAULT_WALL_HEIGHT_MM,
  DEFAULT_WALL_WIDTH_MM,
  STORAGE_KEY_WALL_COLOR,
  STORAGE_KEY_WALL_ENABLED,
  STORAGE_KEY_WALL_HEIGHT_MM,
  STORAGE_KEY_WALL_WIDTH_MM,
  WallBackgroundService,
} from './wall-background.service';

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
    imports: [WallBackgroundComponent],
    providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
  });
  const fixture = TestBed.createComponent(WallBackgroundComponent);
  fixture.detectChanges();
  const service = TestBed.inject(WallBackgroundService);
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

describe('WallBackgroundComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('initial state', () => {
    it('renders the show-background checkbox unchecked by default', () => {
      const { fixture } = configure();
      expect(inputByAriaLabel(fixture, 'Show background').checked).toBe(false);
    });

    it('renders the default color in the color + hex inputs', () => {
      const { fixture } = configure();
      expect(inputByAriaLabel(fixture, 'Background color picker').value).toBe(
        DEFAULT_WALL_COLOR,
      );
      expect(inputByAriaLabel(fixture, 'Background color hex value').value).toBe(
        DEFAULT_WALL_COLOR,
      );
    });

    it('renders the default width + height in the numeric inputs', () => {
      const { fixture } = configure();
      expect(inputByAriaLabel(fixture, 'Background width in millimetres').valueAsNumber).toBe(
        DEFAULT_WALL_WIDTH_MM,
      );
      expect(inputByAriaLabel(fixture, 'Background height in millimetres').valueAsNumber).toBe(
        DEFAULT_WALL_HEIGHT_MM,
      );
    });

    it('badge reads "off" while disabled', () => {
      const { fixture } = configure();
      const badge = fixture.nativeElement.querySelector('.panel-header__count');
      expect(badge?.textContent?.trim()).toBe('off');
    });
  });

  describe('user changes flow through the service + storage', () => {
    it('checking show-background enables the wall + persists', async () => {
      const { fixture, service, storage } = configure();
      const cb = inputByAriaLabel(fixture, 'Show background');
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.enabled()).toBe(true);
      expect(storage.data.get(STORAGE_KEY_WALL_ENABLED)).toBe(true);
    });

    it('badge flips to "on" when enabled', () => {
      const { fixture, service } = configure();
      service.setEnabled(true);
      fixture.detectChanges();
      const badge = fixture.nativeElement.querySelector('.panel-header__count');
      expect(badge?.textContent?.trim()).toBe('on');
    });

    it('color picker updates the service + persists', async () => {
      const { fixture, service, storage } = configure();
      const picker = inputByAriaLabel(fixture, 'Background color picker');
      picker.value = '#aabbcc';
      picker.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.color()).toBe('#aabbcc');
      expect(storage.data.get(STORAGE_KEY_WALL_COLOR)).toBe('#aabbcc');
    });

    it('width input updates the service + persists', async () => {
      const { fixture, service, storage } = configure();
      const input = inputByAriaLabel(fixture, 'Background width in millimetres');
      input.value = '800';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.widthMm()).toBe(800);
      expect(storage.data.get(STORAGE_KEY_WALL_WIDTH_MM)).toBe(800);
    });

    it('height input updates the service + persists', async () => {
      const { fixture, service, storage } = configure();
      const input = inputByAriaLabel(fixture, 'Background height in millimetres');
      input.value = '500';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.heightMm()).toBe(500);
      expect(storage.data.get(STORAGE_KEY_WALL_HEIGHT_MM)).toBe(500);
    });

    it('hydrated service state populates the form on construction', async () => {
      const storage = new FakeStorageService();
      await storage.set(STORAGE_KEY_WALL_ENABLED, true);
      await storage.set(STORAGE_KEY_WALL_COLOR, '#112233');
      await storage.set(STORAGE_KEY_WALL_WIDTH_MM, 800);
      await storage.set(STORAGE_KEY_WALL_HEIGHT_MM, 400);
      const { fixture } = configure(storage);
      await flushPromises();
      fixture.detectChanges();
      expect(inputByAriaLabel(fixture, 'Show background').checked).toBe(true);
      expect(inputByAriaLabel(fixture, 'Background color picker').value).toBe('#112233');
      expect(inputByAriaLabel(fixture, 'Background width in millimetres').valueAsNumber).toBe(800);
      expect(inputByAriaLabel(fixture, 'Background height in millimetres').valueAsNumber).toBe(400);
    });
  });

  describe('collapsible header', () => {
    it('renders the header as a button with aria-expanded=true by default', () => {
      const { fixture } = configure();
      const toggle = fixture.nativeElement.querySelector(
        '.panel-header__toggle',
      ) as HTMLButtonElement;
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.getAttribute('aria-controls')).toBe('wall-background-body');
    });

    it('clicking the header toggles collapsed + hides the body', () => {
      const { fixture } = configure();
      const toggle = fixture.nativeElement.querySelector(
        '.panel-header__toggle',
      ) as HTMLButtonElement;
      const body = fixture.nativeElement.querySelector(
        '#wall-background-body',
      ) as HTMLElement;
      expect(fixture.componentInstance.collapsed()).toBe(false);
      expect(body.hidden).toBe(false);
      toggle.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.collapsed()).toBe(true);
      expect(body.hidden).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('persists collapsed state to StorageService on toggle', async () => {
      const { fixture, storage } = configure();
      fixture.componentInstance.toggleCollapsed();
      fixture.detectChanges();
      await flushPromises();
      expect(storage.data.get(WALL_BACKGROUND_COLLAPSED_KEY)).toBe(true);
    });

    it('hydrates collapsed state from StorageService on init', async () => {
      const storage = new FakeStorageService();
      await storage.set(WALL_BACKGROUND_COLLAPSED_KEY, true);
      const { fixture } = configure(storage);
      await flushPromises();
      fixture.detectChanges();
      expect(fixture.componentInstance.collapsed()).toBe(true);
    });
  });
});
