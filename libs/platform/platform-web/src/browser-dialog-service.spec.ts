/**
 * @jest-environment jsdom
 */

import { BrowserDialogService } from './browser-dialog-service';

// jsdom does not implement HTMLDialogElement.showModal/close — patch in noops.
beforeAll(() => {
  if (typeof HTMLDialogElement !== 'undefined') {
    const proto = HTMLDialogElement.prototype as unknown as {
      showModal?: () => void;
      close?: () => void;
    };
    if (typeof proto.showModal !== 'function') proto.showModal = () => undefined;
    if (typeof proto.close !== 'function') proto.close = () => undefined;
  }
});

describe('BrowserDialogService.confirm', () => {
  it('resolves true when OK is clicked', async () => {
    const svc = new BrowserDialogService();
    const promise = svc.confirm({ title: 't', message: 'm' });
    const ok = findButton('OK');
    ok!.click();
    expect(await promise).toBe(true);
  });

  it('resolves false when Cancel is clicked', async () => {
    const svc = new BrowserDialogService();
    const promise = svc.confirm({ title: 't', message: 'm' });
    findButton('Cancel')!.click();
    expect(await promise).toBe(false);
  });

  it('styles the OK button as danger when danger=true', async () => {
    const svc = new BrowserDialogService();
    const promise = svc.confirm({ title: 't', message: 'm', danger: true });
    const ok = findButton('OK');
    expect(ok?.className).toBe('danger');
    ok!.click();
    await promise;
  });

  it('treats ESC (cancel event) as false', async () => {
    const svc = new BrowserDialogService();
    const promise = svc.confirm({ title: 't', message: 'm' });
    const dialog = document.querySelector('dialog.aquascape-dialog') as HTMLDialogElement;
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(await promise).toBe(false);
  });
});

describe('BrowserDialogService.alert', () => {
  it('resolves when OK is clicked', async () => {
    const svc = new BrowserDialogService();
    const promise = svc.alert({ title: 't', message: 'm' });
    findButton('OK')!.click();
    await expect(promise).resolves.toBeUndefined();
  });

  it('treats ESC as dismissal', async () => {
    const svc = new BrowserDialogService();
    const promise = svc.alert({ title: 't', message: 'm' });
    const dialog = document.querySelector('dialog.aquascape-dialog') as HTMLDialogElement;
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await expect(promise).resolves.toBeUndefined();
  });
});

function findButton(text: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement | null;
}
