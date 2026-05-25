// SnapSettingsComponent tests. Stage 5 F5.4.

import { TestBed } from '@angular/core/testing';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  SNAP_SETTINGS_COLLAPSED_KEY,
  SnapSettingsComponent,
} from './snap-settings.component';
import {
  STORAGE_KEY_SNAP_ENABLED,
  STORAGE_KEY_SNAP_GRID_SIZE_MM,
  STORAGE_KEY_SNAP_TOLERANCE_CSS_PX,
  STORAGE_KEY_SNAP_TO_GRID,
  STORAGE_KEY_SNAP_TO_GUIDES,
  STORAGE_KEY_SNAP_TO_OBJECTS,
  SnapOptionsService,
} from './snap-options.service';

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
    imports: [SnapSettingsComponent],
    providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
  });
  const fixture = TestBed.createComponent(SnapSettingsComponent);
  fixture.detectChanges();
  return {
    fixture,
    service: TestBed.inject(SnapOptionsService),
    storage,
  };
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

describe('SnapSettingsComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('initial state', () => {
    it('renders Snap-enabled checked + every kind checked + badge 3/3', () => {
      const { fixture } = configure();
      expect(inputByAriaLabel(fixture, 'Enable snapping').checked).toBe(true);
      expect(inputByAriaLabel(fixture, 'Snap to grid').checked).toBe(true);
      expect(inputByAriaLabel(fixture, 'Snap to guides').checked).toBe(true);
      expect(inputByAriaLabel(fixture, 'Snap to other objects').checked).toBe(true);
      const badge = fixture.nativeElement.querySelector('.panel-header__count');
      expect(badge?.textContent?.trim()).toBe('3/3');
    });

    it('renders the defaults in grid + tolerance inputs', () => {
      const { fixture } = configure();
      expect(inputByAriaLabel(fixture, 'Grid spacing in millimetres').valueAsNumber).toBe(10);
      expect(inputByAriaLabel(fixture, 'Snap tolerance in CSS pixels').valueAsNumber).toBe(8);
    });
  });

  describe('user toggles flow through to service + storage', () => {
    it('disabling master flips checkbox + badge to 0/3 + persists', async () => {
      const { fixture, service, storage } = configure();
      const master = inputByAriaLabel(fixture, 'Enable snapping');
      master.checked = false;
      master.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.enabled()).toBe(false);
      const badge = fixture.nativeElement.querySelector('.panel-header__count');
      expect(badge?.textContent?.trim()).toBe('0/3');
      expect(storage.data.get(STORAGE_KEY_SNAP_ENABLED)).toBe(false);
    });

    it('per-kind checkboxes update the service + persist independently', async () => {
      const { fixture, service, storage } = configure();
      inputByAriaLabel(fixture, 'Snap to guides').checked = false;
      inputByAriaLabel(fixture, 'Snap to guides').dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await flushPromises();
      // Toggled field flipped in the service + persisted.
      expect(service.toGuides()).toBe(false);
      expect(storage.data.get(STORAGE_KEY_SNAP_TO_GUIDES)).toBe(false);
      // Other kinds left intact in-memory; they are NOT written to storage
      // because nothing changed them (defaults live in code, not storage).
      expect(service.toGrid()).toBe(true);
      expect(service.toObjects()).toBe(true);
      expect(storage.data.has(STORAGE_KEY_SNAP_TO_GRID)).toBe(false);
      expect(storage.data.has(STORAGE_KEY_SNAP_TO_OBJECTS)).toBe(false);
    });

    it('the to-grid checkbox flips toGrid + persists', async () => {
      const { fixture, service, storage } = configure();
      const cb = inputByAriaLabel(fixture, 'Snap to grid');
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.toGrid()).toBe(false);
      expect(storage.data.get('aquascape.ui.snap.toGrid')).toBe(false);
    });

    it('the to-objects checkbox flips toObjects + persists', async () => {
      const { fixture, service, storage } = configure();
      const cb = inputByAriaLabel(fixture, 'Snap to other objects');
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.toObjects()).toBe(false);
      expect(storage.data.get('aquascape.ui.snap.toObjects')).toBe(false);
    });

    it('the tolerance input ignores non-finite values', () => {
      const { fixture, service } = configure();
      const before = service.toleranceCssPx();
      // Simulate a numeric input with NaN (e.g. user typed garbage and the
      // browser surfaces valueAsNumber === NaN). The handler must early-return
      // so the service keeps its previous value.
      fixture.componentInstance.onToleranceChange({
        target: { valueAsNumber: Number.NaN } as HTMLInputElement,
      } as unknown as Event);
      expect(service.toleranceCssPx()).toBe(before);
    });

    it('the grid-size input ignores non-finite values', () => {
      const { fixture, service } = configure();
      const before = service.gridSizeMm();
      fixture.componentInstance.onGridSizeChange({
        target: { valueAsNumber: Number.NaN } as HTMLInputElement,
      } as unknown as Event);
      expect(service.gridSizeMm()).toBe(before);
    });

    it('grid size input updates service + persists', async () => {
      const { fixture, service, storage } = configure();
      const input = inputByAriaLabel(fixture, 'Grid spacing in millimetres');
      input.value = '20';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.gridSizeMm()).toBe(20);
      expect(storage.data.get(STORAGE_KEY_SNAP_GRID_SIZE_MM)).toBe(20);
    });

    it('tolerance input updates service + persists', async () => {
      const { fixture, service, storage } = configure();
      const input = inputByAriaLabel(fixture, 'Snap tolerance in CSS pixels');
      input.value = '14';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await flushPromises();
      expect(service.toleranceCssPx()).toBe(14);
      expect(storage.data.get(STORAGE_KEY_SNAP_TOLERANCE_CSS_PX)).toBe(14);
    });

    it('per-kind checkboxes are disabled when master is off', () => {
      const { fixture, service } = configure();
      service.setEnabled(false);
      fixture.detectChanges();
      expect(inputByAriaLabel(fixture, 'Snap to grid').disabled).toBe(true);
      expect(inputByAriaLabel(fixture, 'Snap to guides').disabled).toBe(true);
      expect(inputByAriaLabel(fixture, 'Snap to other objects').disabled).toBe(true);
      expect(inputByAriaLabel(fixture, 'Grid spacing in millimetres').disabled).toBe(true);
      expect(inputByAriaLabel(fixture, 'Snap tolerance in CSS pixels').disabled).toBe(true);
    });

    it('hydrated service state populates the form on init', async () => {
      const storage = new FakeStorageService();
      await storage.set(STORAGE_KEY_SNAP_ENABLED, false);
      await storage.set(STORAGE_KEY_SNAP_TO_GRID, false);
      await storage.set(STORAGE_KEY_SNAP_GRID_SIZE_MM, 25);
      const { fixture } = configure(storage);
      await flushPromises();
      fixture.detectChanges();
      expect(inputByAriaLabel(fixture, 'Enable snapping').checked).toBe(false);
      expect(inputByAriaLabel(fixture, 'Snap to grid').checked).toBe(false);
      expect(inputByAriaLabel(fixture, 'Grid spacing in millimetres').valueAsNumber).toBe(25);
    });
  });

  describe('collapsible header', () => {
    it('renders as a button with aria-expanded=true by default', () => {
      const { fixture } = configure();
      const toggle = fixture.nativeElement.querySelector(
        '.panel-header__toggle',
      ) as HTMLButtonElement;
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.getAttribute('aria-controls')).toBe('snap-settings-body');
    });

    it('clicking the header toggles collapsed + hides the body', () => {
      const { fixture } = configure();
      const toggle = fixture.nativeElement.querySelector(
        '.panel-header__toggle',
      ) as HTMLButtonElement;
      const body = fixture.nativeElement.querySelector(
        '#snap-settings-body',
      ) as HTMLElement;
      expect(body.hidden).toBe(false);
      toggle.click();
      fixture.detectChanges();
      expect(body.hidden).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('persists collapsed flag on toggle', async () => {
      const { fixture, storage } = configure();
      fixture.componentInstance.toggleCollapsed();
      fixture.detectChanges();
      await flushPromises();
      expect(storage.data.get(SNAP_SETTINGS_COLLAPSED_KEY)).toBe(true);
    });

    it('hydrates collapsed flag from storage on init', async () => {
      const storage = new FakeStorageService();
      await storage.set(SNAP_SETTINGS_COLLAPSED_KEY, true);
      const { fixture } = configure(storage);
      await flushPromises();
      fixture.detectChanges();
      expect(fixture.componentInstance.collapsed()).toBe(true);
    });
  });
});
