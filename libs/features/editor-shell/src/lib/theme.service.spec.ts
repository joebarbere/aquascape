import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import { STORAGE_KEY_THEME, ThemeService, type ThemePreference } from './theme.service';

function makeStorage(initial: Record<string, unknown> = {}): {
  service: StorageService;
  store: Map<string, unknown>;
  setSpy: jest.Mock;
} {
  const store = new Map<string, unknown>(Object.entries(initial));
  const setSpy = jest.fn();
  const service: StorageService = {
    get: <T>(key: string) => Promise.resolve((store.get(key) ?? null) as T | null),
    set: <T>(key: string, value: T) => {
      store.set(key, value);
      setSpy(key, value);
      return Promise.resolve();
    },
    remove: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
  return { service, store, setSpy };
}

interface FakeMqlListener {
  (event: { matches: boolean }): void;
}
interface FakeMql {
  matches: boolean;
  addEventListener: jest.Mock<void, ['change', FakeMqlListener]>;
}

function makeDocument(initialDark = false): {
  doc: Document;
  root: HTMLElement;
  mql: FakeMql;
  fire: (matches: boolean) => void;
} {
  const root = document.createElement('html') as HTMLElement;
  // Reset any leftover attribute from prior tests.
  root.removeAttribute('data-theme');
  let mqlMatches = initialDark;
  const listeners: FakeMqlListener[] = [];
  const mql: FakeMql = {
    get matches() {
      return mqlMatches;
    },
    addEventListener: jest.fn((_type: 'change', listener: FakeMqlListener) => {
      listeners.push(listener);
    }),
  } as unknown as FakeMql;
  const win = {
    matchMedia: jest.fn(() => mql),
  } as unknown as Window & typeof globalThis;
  const doc = {
    documentElement: root,
    defaultView: win,
  } as unknown as Document;
  const fire = (matches: boolean): void => {
    mqlMatches = matches;
    for (const l of listeners) l({ matches });
  };
  return { doc, root, mql, fire };
}

function configure(overrides: {
  storageInitial?: Record<string, unknown>;
  initialDark?: boolean;
}): {
  service: ThemeService;
  root: HTMLElement;
  fire: (matches: boolean) => void;
  setSpy: jest.Mock;
} {
  const storage = makeStorage(overrides.storageInitial ?? {});
  const docHarness = makeDocument(overrides.initialDark ?? false);
  TestBed.configureTestingModule({
    providers: [
      { provide: DOCUMENT, useValue: docHarness.doc },
      { provide: STORAGE_SERVICE, useValue: storage.service },
      ThemeService,
    ],
  });
  const service = TestBed.inject(ThemeService);
  return { service, root: docHarness.root, fire: docHarness.fire, setSpy: storage.setSpy };
}

describe('ThemeService', () => {
  it('defaults to "system" with no persisted preference', () => {
    const { service } = configure({});
    expect(service.preference()).toBe('system');
  });

  it('effective() follows the OS when preference is "system"', () => {
    const { service } = configure({ initialDark: true });
    expect(service.effective()).toBe('dark');
  });

  it('effective() switches when the OS theme changes mid-session', () => {
    const { service, fire } = configure({ initialDark: false });
    expect(service.effective()).toBe('light');
    fire(true);
    expect(service.effective()).toBe('dark');
  });

  it('setPreference("dark") writes data-theme on <html>', () => {
    const { service, root } = configure({});
    service.setPreference('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(service.preference()).toBe('dark');
    expect(service.effective()).toBe('dark');
  });

  it('setPreference("light") writes data-theme="light"', () => {
    const { service, root } = configure({});
    service.setPreference('light');
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('setPreference("system") removes data-theme entirely', () => {
    const { service, root } = configure({});
    service.setPreference('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    service.setPreference('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('setPreference persists to storage under STORAGE_KEY_THEME', () => {
    const { service, setSpy } = configure({});
    service.setPreference('dark');
    expect(setSpy).toHaveBeenCalledWith(STORAGE_KEY_THEME, 'dark');
  });

  it('primes the preference from storage on construction', async () => {
    const { service, root } = configure({
      storageInitial: { [STORAGE_KEY_THEME]: 'dark' as ThemePreference },
    });
    // Constructor read is async — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(service.preference()).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores garbage values from storage (stays on "system")', async () => {
    const { service, root } = configure({
      storageInitial: { [STORAGE_KEY_THEME]: 'rainbow' },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(service.preference()).toBe('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('survives a storage.get() rejection', async () => {
    const root = document.createElement('html');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DOCUMENT,
          useValue: { documentElement: root, defaultView: null } as unknown as Document,
        },
        {
          provide: STORAGE_SERVICE,
          useValue: {
            get: () => Promise.reject(new Error('boom')),
            set: () => Promise.resolve(),
            remove: () => Promise.resolve(),
          },
        },
        ThemeService,
      ],
    });
    const service = TestBed.inject(ThemeService);
    await Promise.resolve();
    await Promise.resolve();
    expect(service.preference()).toBe('system');
  });
});
