// CompositionOverlaysComponent tests. Stage 5 F5.3.

import { TestBed } from '@angular/core/testing';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  COMPOSITION_OVERLAYS_COLLAPSED_KEY,
  CompositionOverlaysComponent,
} from './composition-overlays.component';
import {
  OverlayOptionsService,
  STORAGE_KEY_OVERLAY_FOCAL,
  STORAGE_KEY_OVERLAY_GOLDEN,
  STORAGE_KEY_OVERLAY_THIRDS,
} from './overlay-options.service';

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
}

function configure(storage: FakeStorageService = new FakeStorageService()) {
  TestBed.configureTestingModule({
    imports: [CompositionOverlaysComponent],
    providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
  });
  const fixture = TestBed.createComponent(CompositionOverlaysComponent);
  fixture.detectChanges();
  const service = TestBed.inject(OverlayOptionsService);
  return { fixture, service, storage };
}

function checkboxByLabel(fixture: ReturnType<typeof configure>['fixture'], label: string): HTMLInputElement | null {
  const labels = fixture.nativeElement.querySelectorAll(
    '.composition-overlays__field',
  ) as NodeListOf<HTMLLabelElement>;
  for (const l of labels) {
    if (l.textContent?.trim() === label) {
      return l.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    }
  }
  return null;
}

describe('CompositionOverlaysComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('default state', () => {
    it('renders three unchecked checkboxes', () => {
      const { fixture } = configure();
      const golden = checkboxByLabel(fixture, 'Golden ratio');
      const thirds = checkboxByLabel(fixture, 'Rule of thirds');
      const focal = checkboxByLabel(fixture, 'Focal points');
      expect(golden).not.toBeNull();
      expect(thirds).not.toBeNull();
      expect(focal).not.toBeNull();
      expect(golden!.checked).toBe(false);
      expect(thirds!.checked).toBe(false);
      expect(focal!.checked).toBe(false);
    });

    it('shows the 0/3-enabled badge in the header', () => {
      const { fixture } = configure();
      const count = fixture.nativeElement.querySelector('.panel-header__count');
      expect(count?.textContent?.trim()).toBe('0/3');
    });

    it('renders a "not saved with the document" hint', () => {
      const { fixture } = configure();
      const hint = fixture.nativeElement.querySelector('.composition-overlays__hint');
      expect(hint).not.toBeNull();
      expect(hint!.textContent).toMatch(/not saved/i);
    });
  });

  describe('toggling overlays', () => {
    it('checking the golden box updates the service and persists', async () => {
      const { fixture, service, storage } = configure();
      const golden = checkboxByLabel(fixture, 'Golden ratio')!;
      golden.checked = true;
      golden.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.goldenRatio()).toBe(true);
      expect(storage.data.get(STORAGE_KEY_OVERLAY_GOLDEN)).toBe(true);
    });

    it('checking the thirds box updates the service and persists', async () => {
      const { fixture, service, storage } = configure();
      const thirds = checkboxByLabel(fixture, 'Rule of thirds')!;
      thirds.checked = true;
      thirds.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.thirds()).toBe(true);
      expect(storage.data.get(STORAGE_KEY_OVERLAY_THIRDS)).toBe(true);
    });

    it('checking the focal-points box updates the service and persists', async () => {
      const { fixture, service, storage } = configure();
      const focal = checkboxByLabel(fixture, 'Focal points')!;
      focal.checked = true;
      focal.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.focalPoints()).toBe(true);
      expect(storage.data.get(STORAGE_KEY_OVERLAY_FOCAL)).toBe(true);
    });

    it('enabledCount badge updates as flags flip', async () => {
      const { fixture } = configure();
      const golden = checkboxByLabel(fixture, 'Golden ratio')!;
      const thirds = checkboxByLabel(fixture, 'Rule of thirds')!;
      golden.checked = true;
      golden.dispatchEvent(new Event('change'));
      thirds.checked = true;
      thirds.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      const count = fixture.nativeElement.querySelector('.panel-header__count');
      expect(count!.textContent?.trim()).toBe('2/3');
    });

    it('unchecking a box flips the flag back off and persists', async () => {
      const { fixture, service, storage } = configure();
      const golden = checkboxByLabel(fixture, 'Golden ratio')!;
      golden.checked = true;
      golden.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.goldenRatio()).toBe(true);

      golden.checked = false;
      golden.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.goldenRatio()).toBe(false);
      expect(storage.data.get(STORAGE_KEY_OVERLAY_GOLDEN)).toBe(false);
    });

    it('hydrated service state shows checked boxes after construction', async () => {
      const storage = new FakeStorageService();
      await storage.set(STORAGE_KEY_OVERLAY_GOLDEN, true);
      await storage.set(STORAGE_KEY_OVERLAY_THIRDS, true);
      const { fixture } = configure(storage);
      await flushPromises();
      fixture.detectChanges();
      expect(checkboxByLabel(fixture, 'Golden ratio')!.checked).toBe(true);
      expect(checkboxByLabel(fixture, 'Rule of thirds')!.checked).toBe(true);
      expect(checkboxByLabel(fixture, 'Focal points')!.checked).toBe(false);
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
      expect(toggle.getAttribute('aria-controls')).toBe('composition-overlays-body');
    });

    it('clicking the header toggles the collapsed signal and hides the body', () => {
      const { fixture } = configure();
      const toggle = fixture.nativeElement.querySelector(
        '.panel-header__toggle',
      ) as HTMLButtonElement;
      const body = fixture.nativeElement.querySelector(
        '#composition-overlays-body',
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
      expect(storage.data.get(COMPOSITION_OVERLAYS_COLLAPSED_KEY)).toBe(true);
    });

    it('hydrates collapsed state from StorageService on init', async () => {
      const storage = new FakeStorageService();
      await storage.set(COMPOSITION_OVERLAYS_COLLAPSED_KEY, true);
      const { fixture } = configure(storage);
      await flushPromises();
      fixture.detectChanges();
      expect(fixture.componentInstance.collapsed()).toBe(true);
    });
  });
});
