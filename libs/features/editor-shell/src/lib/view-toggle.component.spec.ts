// ViewToggleComponent tests. Stage 10 F10.2.

import { TestBed } from '@angular/core/testing';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import { ViewModeService } from './view-mode.service';
import { ViewToggleComponent } from './view-toggle.component';

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
  fixture: ReturnType<typeof TestBed.createComponent<ViewToggleComponent>>;
  service: ViewModeService;
  buttons: HTMLButtonElement[];
} {
  TestBed.configureTestingModule({
    imports: [ViewToggleComponent],
    providers: [{ provide: STORAGE_SERVICE, useValue: stubStorage() }],
  });
  const fixture = TestBed.createComponent(ViewToggleComponent);
  fixture.detectChanges();
  const buttons = Array.from(
    fixture.nativeElement.querySelectorAll('button.seg'),
  ) as HTMLButtonElement[];
  return { fixture, service: TestBed.inject(ViewModeService), buttons };
}

describe('ViewToggleComponent', () => {
  it('renders three buttons labelled "2D", "3D" and "Fish eye"', () => {
    const { buttons } = configure();
    expect(buttons.length).toBe(3);
    expect(buttons[0]?.textContent?.trim()).toBe('2D');
    expect(buttons[1]?.textContent?.trim()).toBe('3D');
    expect(buttons[2]?.textContent?.trim()).toBe('Fish eye');
  });

  it('marks the 2D button as pressed by default', () => {
    const { buttons } = configure();
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('false');
    expect(buttons[2]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders a role="group" with a meaningful aria-label', () => {
    const { fixture } = configure();
    const group = fixture.nativeElement.querySelector('.view-toggle') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Canvas view mode');
  });

  it('clicking the inactive 3D button dispatches setMode("3d")', () => {
    const { buttons, service, fixture } = configure();
    const spy = jest.spyOn(service, 'setMode');
    buttons[1]?.click();
    fixture.detectChanges();
    expect(spy).toHaveBeenCalledWith('3d');
    expect(service.mode()).toBe('3d');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking the fish-eye button dispatches setMode("fish-eye")', () => {
    const { buttons, service, fixture } = configure();
    const spy = jest.spyOn(service, 'setMode');
    buttons[2]?.click();
    fixture.detectChanges();
    expect(spy).toHaveBeenCalledWith('fish-eye');
    expect(service.mode()).toBe('fish-eye');
    expect(buttons[2]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('fish-eye aria-label reflects the active mode', () => {
    const { buttons, service, fixture } = configure();
    expect(buttons[2]?.getAttribute('aria-label')).toBe(
      'Switch to fish-eye view (camera rides a fish)',
    );
    service.setMode('fish-eye');
    fixture.detectChanges();
    expect(buttons[2]?.getAttribute('aria-label')).toBe('Fish-eye view (active)');
  });

  it('clicking the already-active button is a no-op (mode unchanged)', () => {
    const { buttons, service, fixture } = configure();
    expect(service.mode()).toBe('2d');
    buttons[0]?.click();
    fixture.detectChanges();
    expect(service.mode()).toBe('2d');
  });

  it('Cmd+Shift+3 toggles the mode', () => {
    const { service, fixture } = configure();
    expect(service.mode()).toBe('2d');
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '3',
        code: 'Digit3',
        metaKey: true,
        shiftKey: true,
      }),
    );
    fixture.detectChanges();
    expect(service.mode()).toBe('3d');
  });

  it('Ctrl+Shift+3 also toggles (non-mac shortcut)', () => {
    const { service, fixture } = configure();
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '3',
        code: 'Digit3',
        ctrlKey: true,
        shiftKey: true,
      }),
    );
    fixture.detectChanges();
    expect(service.mode()).toBe('3d');
  });

  it('Cmd+3 alone (no shift) does NOT toggle — avoids clash with future Cmd-3', () => {
    const { service, fixture } = configure();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '3', code: 'Digit3', metaKey: true }),
    );
    fixture.detectChanges();
    expect(service.mode()).toBe('2d');
  });

  it('Shift+3 alone (no Cmd/Ctrl) does NOT toggle', () => {
    const { service, fixture } = configure();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '#', code: 'Digit3', shiftKey: true }),
    );
    fixture.detectChanges();
    expect(service.mode()).toBe('2d');
  });

  it('keyboard shortcut is ignored when target is INPUT', () => {
    const { service, fixture } = configure();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    // Dispatch the event with the input as the target via `Object.defineProperty`
    // — KeyboardEvent doesn't accept a target in its constructor.
    const event = new KeyboardEvent('keydown', {
      key: '3',
      code: 'Digit3',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: input, configurable: true });
    document.dispatchEvent(event);
    fixture.detectChanges();
    expect(service.mode()).toBe('2d');
    input.remove();
  });

  it('keyboard shortcut is ignored when target is TEXTAREA', () => {
    const { service, fixture } = configure();
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const event = new KeyboardEvent('keydown', {
      key: '3',
      code: 'Digit3',
      metaKey: true,
      shiftKey: true,
    });
    Object.defineProperty(event, 'target', { value: ta, configurable: true });
    document.dispatchEvent(event);
    fixture.detectChanges();
    expect(service.mode()).toBe('2d');
    ta.remove();
  });

  it('keyboard shortcut is ignored when target is SELECT', () => {
    const { service, fixture } = configure();
    const sel = document.createElement('select');
    document.body.appendChild(sel);
    const event = new KeyboardEvent('keydown', {
      key: '3',
      code: 'Digit3',
      metaKey: true,
      shiftKey: true,
    });
    Object.defineProperty(event, 'target', { value: sel, configurable: true });
    document.dispatchEvent(event);
    fixture.detectChanges();
    expect(service.mode()).toBe('2d');
    sel.remove();
  });

  it('aria-label reflects the active mode', () => {
    const { buttons, service, fixture } = configure();
    expect(buttons[0]?.getAttribute('aria-label')).toBe('2D view (active)');
    expect(buttons[1]?.getAttribute('aria-label')).toBe('Switch to 3D view');
    service.setMode('3d');
    fixture.detectChanges();
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Switch to 2D view');
    expect(buttons[1]?.getAttribute('aria-label')).toBe('3D view (active)');
  });
});
