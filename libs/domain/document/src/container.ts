/**
 * `.aqua` file container: ZIP (with assets + optional thumbnail) or bare JSON.
 *
 * Readers must accept both forms: small asset-free documents may ship as a JSON
 * file with the `.aqua` extension. We sniff for the ZIP local-file-header magic
 * (`PK\x03\x04`) and route accordingly.
 *
 * fflate is used for the ZIP work — it's zero-dep, pure JS, sync, and runs
 * unchanged in node, the browser, and the Electron renderer. Asset paths inside
 * the ZIP must live under `assets/` per the format spec.
 */

import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

import { AQUA_CONTAINER } from './aqua-document';

/** Bytes a `.aqua` file may carry alongside the document JSON. */
export interface AquaContainerAssets {
  /** Map of "assets/<id>.<ext>" → bytes. Keys MUST begin with `assets/`. */
  assets?: ReadonlyMap<string, Uint8Array>;
  /** Optional PNG bytes for `thumbnail.png` (galleries, file pickers). */
  thumbnail?: Uint8Array;
}

/** What a loader pulls out of a `.aqua` container (bare-JSON or ZIP). */
export interface AquaContainerContents {
  /** The unparsed `document.json` payload as UTF-8 text. */
  documentJson: string;
  /** Assets keyed by their full in-zip path (`assets/<id>.<ext>`). */
  assets: ReadonlyMap<string, Uint8Array>;
  /** PNG bytes if a `thumbnail.png` entry was present. */
  thumbnail?: Uint8Array;
  /** `'zip'` if a true ZIP container, `'json'` if the input was bare JSON. */
  source: 'zip' | 'json';
}

/** Bytes that are *just* a UTF-8 JSON document with no zip wrapper. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const; // "PK\x03\x04"

/** Quick magic-byte sniff. A `Uint8Array` shorter than 4 bytes is "not a ZIP". */
export function isZipContainer(bytes: Uint8Array): boolean {
  if (bytes.length < ZIP_MAGIC.length) return false;
  for (let i = 0; i < ZIP_MAGIC.length; i++) {
    if (bytes[i] !== ZIP_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Parse a `.aqua` container from raw bytes. The bytes may be a true ZIP or a
 * bare UTF-8 JSON file with `.aqua` extension; we accept both.
 *
 * Throws on malformed ZIP or missing `document.json` inside a ZIP — these are
 * structural errors that callers cannot recover from. JSON parsing of
 * `documentJson` is the caller's responsibility.
 */
export function readAquaContainer(bytes: Uint8Array): AquaContainerContents {
  if (!isZipContainer(bytes)) {
    return {
      documentJson: strFromU8(bytes),
      assets: new Map(),
      source: 'json',
    };
  }

  const entries = unzipSync(bytes);
  const docBytes = entries[AQUA_CONTAINER.documentEntry];
  if (!docBytes) {
    throw new Error(
      `Aqua container is missing required entry "${AQUA_CONTAINER.documentEntry}"`,
    );
  }

  const assets = new Map<string, Uint8Array>();
  let thumbnail: Uint8Array | undefined;
  for (const [path, payload] of Object.entries(entries)) {
    if (path === AQUA_CONTAINER.documentEntry) continue;
    if (path === AQUA_CONTAINER.thumbnailEntry) {
      thumbnail = payload;
      continue;
    }
    if (path.startsWith(AQUA_CONTAINER.assetsDir)) {
      assets.set(path, payload);
    }
  }

  return {
    documentJson: strFromU8(docBytes),
    assets,
    ...(thumbnail !== undefined ? { thumbnail } : {}),
    source: 'zip',
  };
}

/**
 * Pack a JSON payload + optional assets + optional thumbnail into a ZIP
 * `.aqua` container.
 *
 * Asset keys MUST live under `assets/` — `packAquaContainer` enforces this
 * rather than silently relocating them, so authoring bugs surface immediately.
 */
export function packAquaContainer(
  documentJson: string,
  extras: AquaContainerAssets = {},
): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    [AQUA_CONTAINER.documentEntry]: strToU8(documentJson),
  };

  if (extras.assets) {
    for (const [path, bytes] of extras.assets) {
      if (!path.startsWith(AQUA_CONTAINER.assetsDir)) {
        throw new Error(
          `Asset path "${path}" must live under "${AQUA_CONTAINER.assetsDir}"`,
        );
      }
      entries[path] = bytes;
    }
  }
  if (extras.thumbnail !== undefined) {
    entries[AQUA_CONTAINER.thumbnailEntry] = extras.thumbnail;
  }

  return zipSync(entries);
}
