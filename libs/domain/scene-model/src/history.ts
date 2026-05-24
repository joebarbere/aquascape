/**
 * Undo/redo history.
 *
 * Pure immutable: each operation returns a fresh `History` value rather than
 * mutating in place. Performing a new `push` after `undo` truncates the
 * redo stack. The stack is bounded; oldest entries drop deterministically
 * from the head once the bound is exceeded.
 *
 * The history stores PAIRS of `(command, inverse)`. We capture the inverse
 * at `push` time — when `command` is applied to scene `S`, we record
 * `invertCommand(S, command)` so undo can run later without re-deriving from
 * a stale scene.
 *
 * The current scene is owned by the caller (NgRx or test harness). The
 * History only knows how to drive transitions on it.
 */

import { applyCommand, invertCommand } from './commands';
import type { Command } from './commands';
import type { Scene } from './types';

/** A single recorded edit: forward command + its precomputed inverse. */
export interface HistoryEntry {
  command: Command;
  inverse: Command;
}

/** Optional configuration for {@link createHistory}. */
export interface HistoryOptions {
  /** Maximum number of past entries to retain. Default 200. */
  bound?: number;
}

/**
 * Immutable history value. `past[past.length - 1]` is the most recent edit
 * (the one `undo` will reverse). `future` is filled by `undo` and consumed
 * by `redo`.
 */
export interface History {
  readonly past: readonly HistoryEntry[];
  readonly future: readonly HistoryEntry[];
  readonly bound: number;

  /**
   * Apply `command` to `scene`, record the entry, and return the new scene
   * + history. If the command would be rejected by {@link applyCommand},
   * returns `null` (the caller decides how to surface it).
   */
  push(command: Command, scene: Scene): { scene: Scene; history: History } | null;

  /**
   * Undo the most recent edit. Returns `null` if `past` is empty.
   */
  undo(scene: Scene): { scene: Scene; history: History } | null;

  /**
   * Redo the most recently undone edit. Returns `null` if `future` is empty.
   */
  redo(scene: Scene): { scene: Scene; history: History } | null;
}

const DEFAULT_BOUND = 200;

class HistoryImpl implements History {
  readonly past: readonly HistoryEntry[];
  readonly future: readonly HistoryEntry[];
  readonly bound: number;

  constructor(past: readonly HistoryEntry[], future: readonly HistoryEntry[], bound: number) {
    this.past = past;
    this.future = future;
    this.bound = bound;
  }

  push(command: Command, scene: Scene): { scene: Scene; history: History } | null {
    const inverse = invertCommand(scene, command);
    const result = applyCommand(scene, command);
    if (!result.ok) {
      return null;
    }
    let nextPast: HistoryEntry[] = [...this.past, { command, inverse }];
    if (nextPast.length > this.bound) {
      // Drop oldest deterministically.
      nextPast = nextPast.slice(nextPast.length - this.bound);
    }
    // New push truncates redo.
    return {
      scene: result.scene,
      history: new HistoryImpl(nextPast, [], this.bound),
    };
  }

  undo(scene: Scene): { scene: Scene; history: History } | null {
    if (this.past.length === 0) {
      return null;
    }
    const entry = this.past[this.past.length - 1] as HistoryEntry;
    const result = applyCommand(scene, entry.inverse);
    if (!result.ok) {
      // Inverse should never reject against a well-tended scene; if it
      // does, surface the failure to the caller rather than silently
      // corrupting history.
      return null;
    }
    const nextPast = this.past.slice(0, -1);
    const nextFuture = [entry, ...this.future];
    return {
      scene: result.scene,
      history: new HistoryImpl(nextPast, nextFuture, this.bound),
    };
  }

  redo(scene: Scene): { scene: Scene; history: History } | null {
    if (this.future.length === 0) {
      return null;
    }
    const entry = this.future[0] as HistoryEntry;
    const result = applyCommand(scene, entry.command);
    if (!result.ok) {
      return null;
    }
    // Re-derive a fresh inverse against the pre-apply scene (it should
    // equal the originally stored inverse, but we re-compute to avoid
    // drift if any external state changed).
    const refreshedEntry: HistoryEntry = {
      command: entry.command,
      inverse: invertCommand(scene, entry.command),
    };
    const nextFuture = this.future.slice(1);
    const nextPast = [...this.past, refreshedEntry];
    return {
      scene: result.scene,
      history: new HistoryImpl(nextPast, nextFuture, this.bound),
    };
  }
}

/**
 * Create an empty {@link History}. `options.bound` defaults to 200.
 *
 * @throws if `bound` is not a positive integer.
 */
export function createHistory(options: HistoryOptions = {}): History {
  const bound = options.bound ?? DEFAULT_BOUND;
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new Error(`createHistory: bound must be a positive integer (got ${bound})`);
  }
  return new HistoryImpl([], [], bound);
}
