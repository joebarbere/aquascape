// `DialogService` implemented with a hand-rolled `<dialog>` element.
// F1.4.
//
// Why not `window.confirm` / `window.alert`? Two reasons:
//   1. They're synchronous and block the main thread, which kills any
//      ongoing renderer animation.
//   2. They can't be styled — the modal looks like a 1995 OS prompt next to
//      the rest of the editor.
//
// The implementation here is intentionally small: a single `<dialog>` is
// reused per prompt, opened with `showModal()`, and removed on close. The
// dialog UI is plain HTML so it inherits the editor's theme via host CSS.

import type { DialogService } from '@aquascape/platform/platform-api';

export class BrowserDialogService implements DialogService {
  constructor(private readonly doc: Document = globalThis.document) {}

  async confirm(args: { title: string; message: string; danger?: boolean }): Promise<boolean> {
    const dialog = this.buildDialog();
    dialog.innerHTML = '';
    appendHeader(this.doc, dialog, args.title);
    appendBody(this.doc, dialog, args.message);

    const actions = this.doc.createElement('div');
    actions.className = 'aquascape-dialog-actions';
    const cancelBtn = this.makeButton('Cancel');
    const okBtn = this.makeButton('OK');
    if (args.danger === true) okBtn.className = 'danger';
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    dialog.appendChild(actions);

    this.doc.body.appendChild(dialog);
    try {
      dialog.showModal();
      return await new Promise<boolean>((resolve) => {
        const close = (value: boolean): void => {
          dialog.close();
          resolve(value);
        };
        okBtn.addEventListener('click', () => close(true));
        cancelBtn.addEventListener('click', () => close(false));
        // ESC fires `cancel` on the dialog — treat as no.
        dialog.addEventListener('cancel', (ev) => {
          ev.preventDefault();
          close(false);
        });
      });
    } finally {
      dialog.remove();
    }
  }

  async alert(args: { title: string; message: string }): Promise<void> {
    const dialog = this.buildDialog();
    dialog.innerHTML = '';
    appendHeader(this.doc, dialog, args.title);
    appendBody(this.doc, dialog, args.message);

    const actions = this.doc.createElement('div');
    actions.className = 'aquascape-dialog-actions';
    const okBtn = this.makeButton('OK');
    actions.appendChild(okBtn);
    dialog.appendChild(actions);

    this.doc.body.appendChild(dialog);
    try {
      dialog.showModal();
      await new Promise<void>((resolve) => {
        const close = (): void => {
          dialog.close();
          resolve();
        };
        okBtn.addEventListener('click', close);
        dialog.addEventListener('cancel', (ev) => {
          ev.preventDefault();
          close();
        });
      });
    } finally {
      dialog.remove();
    }
  }

  private buildDialog(): HTMLDialogElement {
    const dialog = this.doc.createElement('dialog');
    dialog.className = 'aquascape-dialog';
    return dialog;
  }

  private makeButton(text: string): HTMLButtonElement {
    const b = this.doc.createElement('button');
    b.type = 'button';
    b.textContent = text;
    return b;
  }
}

function appendHeader(doc: Document, dialog: HTMLDialogElement, title: string): void {
  const h = doc.createElement('h2');
  h.textContent = title;
  dialog.appendChild(h);
}

function appendBody(doc: Document, dialog: HTMLDialogElement, message: string): void {
  const p = doc.createElement('p');
  p.textContent = message;
  dialog.appendChild(p);
}
