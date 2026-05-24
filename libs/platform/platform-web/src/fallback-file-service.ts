// Safari / Firefox fallback for `FileService`. F1.4.
//
// Without the File System Access API we can still let the user open + save
// `.aqua` files, but the UX is the classic HTML 4 / HTML 5 pair:
//
//   * Open  — `<input type=file accept=".aqua">` programmatically click()'d
//             then awaited via its `change` event.
//   * Save  — a `<a download>` link to a `Blob` URL, clicked once, then
//             revoked. Every save is a fresh download; we cannot
//             silently overwrite a previously-saved file.
//
// Because the fallback has no concept of a stable "handle to a user-chosen
// path", `saveDocument({ id })` collapses to `saveDocumentAs` — the contract
// already allows the same result shape, and the UI can flag the difference
// by checking `selectHasFile` after the save (it stays `false`).

import type {
  FileService,
  OpenDocumentResult,
  SaveDocumentResult,
} from '@aquascape/platform/platform-api';

/** Synthetic id for fallback saves. The renderer treats it as opaque. */
let nextFallbackId = 0;
function mintFallbackId(prefix: 'open' | 'save'): string {
  nextFallbackId += 1;
  return `fallback-${prefix}-${nextFallbackId}`;
}

/**
 * Build a DOM-driven FileService. The constructor takes the host
 * `Document` so unit tests can pass a jsdom-built document instead of
 * relying on a real browser.
 */
export class FallbackFileService implements FileService {
  constructor(private readonly doc: Document = globalThis.document) {}

  async openDocument(): Promise<OpenDocumentResult | null> {
    const input = this.doc.createElement('input');
    input.type = 'file';
    input.accept = '.aqua,application/aqua';
    // Append so iOS Safari surfaces the picker correctly.
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    this.doc.body.appendChild(input);

    try {
      const file = await pickSingleFile(input);
      if (file === null) return null;
      const buf = await file.arrayBuffer();
      return { id: mintFallbackId('open'), bytes: new Uint8Array(buf), name: file.name };
    } finally {
      input.remove();
    }
  }

  saveDocument(args: {
    id?: string;
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<SaveDocumentResult | null> {
    // Without FSA there is no concept of "save to known handle" — collapse
    // to saveAs. The renderer's `selectHasFile` will still report false
    // after the save, so the UI distinguishes "saved a copy" from "saved
    // back to disk".
    return this.saveDocumentAs(args);
  }

  async saveDocumentAs(args: {
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<SaveDocumentResult | null> {
    const win = this.doc.defaultView;
    if (win === null) {
      throw new Error('FallbackFileService used in a Document without a window');
    }
    // BlobPart: Uint8Array is acceptable per the DOM spec; some lib.dom
    // versions over-narrow the type, so we widen via `as never`.
    const blob = new Blob([args.bytes as never], { type: 'application/aqua' });
    const url = win.URL.createObjectURL(blob);
    try {
      const anchor = this.doc.createElement('a');
      anchor.href = url;
      anchor.download = args.suggestedName;
      anchor.rel = 'noopener';
      // Same hidden-style trick as open(); some browsers won't trigger a
      // download from an unattached element.
      anchor.style.position = 'fixed';
      anchor.style.left = '-9999px';
      this.doc.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
      }
    } finally {
      // Defer revoke a microtask so the download starts. Chromium revokes
      // mid-download under the immediate-revoke form.
      queueMicrotask(() => win.URL.revokeObjectURL(url));
    }
    return { id: mintFallbackId('save') };
  }
}

/**
 * Promise-wrap the `<input type=file>` change event. Resolves to `null` on
 * cancel (best-effort: browsers don't fire a 'cancel' on every platform).
 * The window 'focus' fallback covers cancel in Firefox/Safari.
 */
function pickSingleFile(input: HTMLInputElement): Promise<File | null> {
  return new Promise<File | null>((resolve) => {
    let settled = false;
    const settle = (value: File | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    input.addEventListener('change', () => {
      const f = input.files?.[0];
      settle(f ?? null);
    });
    input.addEventListener('cancel', () => settle(null));

    // Focus-back fallback: after the picker closes, the window gets focus.
    // If `files` is still empty after a tick, the user cancelled.
    const onFocus = (): void => {
      // Two animation frames is enough for the change event (if any) to win.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!settled && (input.files === null || input.files.length === 0)) {
            settle(null);
          }
        });
      });
    };
    window.addEventListener('focus', onFocus, { once: true });

    input.click();
  });
}
