/**
 * UUID v4 minting for branded `ObjectId` / `LayerId`.
 *
 * Default factory uses `crypto.randomUUID()` (Node ≥ 19 / modern browsers).
 * An optional {@link IdFactory} indirection is exposed so tests/golden
 * scenarios can swap in a deterministic source without pulling in a UUID
 * dependency.
 */

import type { LayerId, ObjectId, Uuid } from './types';

/** Source of UUID v4 strings. Implementations must return RFC-4122 v4 UUIDs. */
export interface IdFactory {
  uuid(): Uuid;
}

/** Default factory backed by `crypto.randomUUID()`. */
export const defaultIdFactory: IdFactory = {
  uuid: () => crypto.randomUUID(),
};

let activeFactory: IdFactory = defaultIdFactory;

/**
 * Override the id factory used by {@link newObjectId} / {@link newLayerId}.
 * Test-only. Pass `undefined` to reset to {@link defaultIdFactory}.
 */
export function setIdFactory(factory: IdFactory | undefined): void {
  activeFactory = factory ?? defaultIdFactory;
}

/** Mint a fresh branded {@link ObjectId}. */
export function newObjectId(): ObjectId {
  return activeFactory.uuid() as ObjectId;
}

/** Mint a fresh branded {@link LayerId}. */
export function newLayerId(): LayerId {
  return activeFactory.uuid() as LayerId;
}

/** Cast an existing string (e.g. read from a document) into an `ObjectId`. */
export function asObjectId(s: string): ObjectId {
  return s as ObjectId;
}

/** Cast an existing string (e.g. read from a document) into a `LayerId`. */
export function asLayerId(s: string): LayerId {
  return s as LayerId;
}
