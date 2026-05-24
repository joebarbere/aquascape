// Public API for @aquascape/platform/platform-api.
//
// Interface-only library. Defines FileService / DialogService / StorageService /
// RenderExportService. Concrete implementations live in platform-web and
// platform-electron. Plan §2.5 / Stage 0 F0.5.
//
// IMPORTANT: this lib must remain framework-free. No Angular, no DOM, no
// Electron, no NgRx. Angular InjectionToken bindings live in the separate
// `@aquascape/platform/platform-api/angular` sub-entry so the framework-free
// surface above stays clean.
//
// Capability contract (plan §2.5 + F0.5 spec):
//   * Each method that may not complete (user cancelled, no document, etc.)
//     returns `null` rather than throwing. Feature code learns to handle the
//     absent-capability path once and uses it for both "user cancelled" and
//     "stub can't service this yet".
//   * Every byte payload is a `Uint8Array`. Implementations must not mutate
//     the input array; callers must not mutate it after handing it over.

// ─── File IO ─────────────────────────────────────────────────────────────────

/** Result of a successful `openDocument()`. */
export interface OpenDocumentResult {
  /** Opaque identifier for the document handle, scoped to the platform. */
  readonly id: string;
  /** Raw bytes of the opened document. */
  readonly bytes: Uint8Array;
  /** Suggested display name (filename without path, or platform-chosen label). */
  readonly name: string;
}

/** Result of a successful `saveDocument()` / `saveDocumentAs()`. */
export interface SaveDocumentResult {
  /** Opaque identifier for the saved document handle. */
  readonly id: string;
}

/**
 * Document file IO. Platform-specific implementations route through the
 * File System Access API (web) or a typed IPC bridge into the Electron main
 * process. Returns `null` when the user cancels or the capability is
 * unavailable.
 */
export interface FileService {
  /** Open a document. Returns `null` if the user cancels. */
  openDocument(): Promise<OpenDocumentResult | null>;

  /**
   * Save bytes back to the document identified by `id` (if provided) or to a
   * fresh handle. Returns `null` if the user cancels.
   */
  saveDocument(args: {
    id?: string;
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<SaveDocumentResult | null>;

  /** Save bytes under a fresh handle, prompting for location. */
  saveDocumentAs(args: {
    bytes: Uint8Array;
    suggestedName: string;
  }): Promise<SaveDocumentResult | null>;
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────

/**
 * Modal user prompts. Implementations route through native OS dialogs in
 * Electron and HTML dialog elements on the web.
 */
export interface DialogService {
  /**
   * Ask for confirmation. `danger: true` styles the dialog as a destructive
   * action. Returns `true` if the user confirms, `false` otherwise.
   */
  confirm(args: { title: string; message: string; danger?: boolean }): Promise<boolean>;

  /** Show an informational message. Resolves when dismissed. */
  alert(args: { title: string; message: string }): Promise<void>;
}

// ─── Key-value storage ───────────────────────────────────────────────────────

/**
 * Small key-value storage for preferences, recent-document lists, autosave
 * metadata, etc. Backed by IndexedDB on the web and the Electron `userData`
 * directory on desktop. Values are arbitrary JSON-serializable shapes;
 * implementations must perform the (de)serialization without leaking class
 * instances or functions.
 */
export interface StorageService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

// ─── Render export ───────────────────────────────────────────────────────────

/** Result of a successful `exportPng()`. */
export interface ExportPngResult {
  /**
   * Location of the export. For real implementations this is a filesystem
   * path; for stubs it's an in-memory URI such as `memory://exports/<name>`.
   */
  readonly path: string;
}

/**
 * Export rendered output to disk. Returns `null` if the user cancels or the
 * capability is unavailable.
 */
export interface RenderExportService {
  exportPng(args: { bytes: Uint8Array; suggestedName: string }): Promise<ExportPngResult | null>;
}

// ─── Bundle ──────────────────────────────────────────────────────────────────

/**
 * The full set of platform services that an app composes at boot. Concrete
 * platforms (`platform-web`, `platform-electron`) export a `create*Platform()`
 * factory returning this shape.
 */
export interface Platform {
  readonly fileService: FileService;
  readonly dialogService: DialogService;
  readonly storageService: StorageService;
  readonly renderExportService: RenderExportService;
}
