import { TestBed } from '@angular/core/testing';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import { ThemeService } from './theme.service';
import { ThemeToggleComponent } from './theme-toggle.component';

function stubStorage(): StorageService {
  const map = new Map<string, unknown>();
  return {
    get: <T>(k: string) => Promise.resolve((map.get(k) ?? null) as T | null),
    set: <T>(k: string, v: T) => {
      map.set(k, v);
      return Promise.resolve();
    },
    remove: (k: string) => {
      map.delete(k);
      return Promise.resolve();
    },
  };
}

function configure(): {
  fixture: ReturnType<typeof TestBed.createComponent<ThemeToggleComponent>>;
  service: ThemeService;
  button: HTMLButtonElement;
} {
  // Reset any leftover data-theme from a previous test in the same suite.
  document.documentElement.removeAttribute('data-theme');
  TestBed.configureTestingModule({
    imports: [ThemeToggleComponent],
    providers: [{ provide: STORAGE_SERVICE, useValue: stubStorage() }],
  });
  const fixture = TestBed.createComponent(ThemeToggleComponent);
  fixture.detectChanges();
  const button = fixture.nativeElement.querySelector('button.theme-toggle') as HTMLButtonElement;
  return { fixture, service: TestBed.inject(ThemeService), button };
}

afterEach(() => {
  // Keep <html data-theme> off between tests so the toggle starts fresh.
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeToggleComponent', () => {
  it('starts in "system" mode and shows the half-moon icon', () => {
    const { button, service } = configure();
    expect(service.preference()).toBe('system');
    expect(button.textContent?.trim()).toBe('◐');
  });

  it('cycles system → light on click', () => {
    const { button, service, fixture } = configure();
    button.click();
    fixture.detectChanges();
    expect(service.preference()).toBe('light');
    expect(button.textContent?.trim()).toBe('☀');
  });

  it('cycles light → dark on click', () => {
    const { button, service, fixture } = configure();
    service.setPreference('light');
    fixture.detectChanges();
    button.click();
    fixture.detectChanges();
    expect(service.preference()).toBe('dark');
    expect(button.textContent?.trim()).toBe('☾');
  });

  it('cycles dark → system on click', () => {
    const { button, service, fixture } = configure();
    service.setPreference('dark');
    fixture.detectChanges();
    button.click();
    fixture.detectChanges();
    expect(service.preference()).toBe('system');
  });

  it('aria-label names the current preference and the cycle target', () => {
    const { button, service, fixture } = configure();
    expect(button.getAttribute('aria-label')).toContain('system');
    expect(button.getAttribute('aria-label')).toContain('Click to switch to light');
    service.setPreference('dark');
    fixture.detectChanges();
    expect(button.getAttribute('aria-label')).toContain('dark');
    expect(button.getAttribute('aria-label')).toContain('Click to switch to system');
  });
});
